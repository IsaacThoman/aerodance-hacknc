import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { advance, Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PCFShadowMap } from 'three';
import { samplePose, validateMotion } from '../../../frutiger-character/client/src/motion.js';
import { STAGES } from '../../../frutiger-character/client/src/stages/index.js';
import Dancers, { DANCER_LOOKS } from '../../../frutiger-character/client/src/stages/shared/Dancers.jsx';
import { RenderPipeline, resetPost } from '../../../frutiger-character/client/src/stages/shared/post.jsx';
import { beat } from '../../../frutiger-character/client/src/stages/shared/hooks.js';
import { drawTitle, titleWidth } from '../../../../client/src/ui/draw.js';
import { BUFFER as THUMBNAIL_BUFFER, DESIGN, SHOTS } from './shots.js';

/*
 * Renders one thumbnail in-engine: a dance stage, the two captured dancers holding a pose,
 * a hand-placed 3:2 camera, and optionally the title screen's "aerodance." wordmark.
 *
 * The buffer is the game's own pixel grid cropped to 3:2: the game draws 640x480 and shows
 * it at 16:9, so its pixels are 4:3 wide. 540x480 shown at 3:2 has exactly the same pixel
 * size and shape, and the same post-processing (bloom, grade, ACES).
 *
 * The clock is stepped by hand (frameloop="never"): window.__thumb.render() plays the
 * stage forward at 60 fps to the shot's time, then reads back the frame with and
 * without the wordmark, with the dancers holding the shot's pose throughout.
 * For animations, window.__thumb.frame(i) captures 60 fps frame i with the dancers dancing
 * in step with the stage, reaching the shot's pose at the shot's time. scripts/render.mjs
 * drives it and writes the PNGs and GIFs.
 *
 * URL: ?shot=<id> (shots.js), or ?spec=<JSON> for a one-off shot. For GIFs: &loop=<from>,<to>
 * makes that stretch of the dance loop seamlessly, &buffer=<w>x<h> renders at another 3:2
 * size, and &beat=0 keeps the lights steady instead of pulsing on the beat.
 */

const STEP = 1 / 60;
const BUFFER = (() => {
  const size = new URLSearchParams(window.location.search).get('buffer')?.split('x').map(Number);
  return size ? { width: size[0], height: size[1], aspect: THUMBNAIL_BUFFER.aspect } : THUMBNAIL_BUFFER;
})();
const LOOP_BLEND = 0.6;

// The dance with its stretch from..to (seconds) made loopable: over the last LOOP_BLEND
// seconds the poses ease into the ones leading up to `from`, so `to` lands on `from`.
// The capture loops itself the same way. The rig's scale and floor come from the whole
// capture, so they shift very slightly (~0.2%).
function loopMotion(data, from, to) {
  const scratch = Array.from({ length: 33 }, () => [0, 0, 0, 0]);
  const poses = data.poses.map((frame, i) => {
    const k = Math.min(1, (data.times[i] - (to - LOOP_BLEND)) / LOOP_BLEND);
    // Samples just past `to` are blended fully so playback interpolates into the seam.
    if (k <= 0 || data.times[i] > to + 0.1) return frame;
    const a = k * k * (3 - 2 * k);
    return frame.map((joints, person) => {
      const target = samplePose(data, person, data.times[i] - (to - from), scratch);
      return joints.map((joint, j) => joint.map((v, axis) => v + (target[j][axis] - v) * a));
    });
  });
  return { ...data, poses };
}

function shotFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('spec')) return JSON.parse(params.get('spec'));
  return SHOTS.find((s) => s.id === params.get('shot')) ?? SHOTS[0];
}

// The shot's camera, at 3:2, stands in for the stage's own (orbiting, 16:9) camera:
// it takes over as the default camera whenever the stage sets its own.
function ShotCamera({ position, target, fov = 40, near, far }) {
  const camera = useMemo(() => {
    const cam = new THREE.PerspectiveCamera(fov, BUFFER.aspect, near ?? 0.1, far ?? 2000);
    cam.manual = true;
    cam.position.set(...position);
    cam.lookAt(...target);
    cam.updateMatrixWorld();
    return cam;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state) => {
    if (state.camera === camera) return;
    // Keep the stage's depth range unless the shot sets its own.
    camera.near = near ?? state.camera.near;
    camera.far = far ?? state.camera.far;
    camera.updateProjectionMatrix();
    state.set({ camera });
  }, -1);
  return null;
}

// Holds the stage's beat clock between beats (no pulse, no rolling wave) before the stage
// reads it each frame, so beat-synced lights and bloom stay steady.
function SteadyBeat() {
  useFrame(() => {
    beat.pulse = 0;
    beat.phase = 1;
  }, -1);
  return null;
}

function Ready({ onReady }) {
  useLayoutEffect(() => onReady(), [onReady]);
  return null;
}

// The title screen's wordmark on a buffer-sized canvas, laid out in 3:2 design units and
// drawn over the frame with nearest filtering, exactly as the game's canvas UI draws it.
function makeLogo(logo) {
  const canvas = document.createElement('canvas');
  canvas.width = BUFFER.width;
  canvas.height = BUFFER.height;
  const g = canvas.getContext('2d');
  g.setTransform(BUFFER.width / DESIGN.width, 0, 0, BUFFER.height / DESIGN.height, 0, 0);
  const w = titleWidth(g, logo.size);
  const x = logo.x === 'left' ? 96 : logo.x === 'right' ? DESIGN.width - 96 - w : typeof logo.x === 'number' ? logo.x : (DESIGN.width - w) / 2;
  drawTitle(g, { x, y: logo.y, size: logo.size });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  return { scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1) };
}

// Reads the drawing buffer (or a render target) top-down as base64 RGBA.
function readFrame(gl, target = null) {
  const ctx = gl.getContext();
  const { width, height } = BUFFER;
  const pixels = new Uint8Array(width * height * 4);
  if (target) {
    gl.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  } else {
    gl.setRenderTarget(null);
    ctx.readPixels(0, 0, width, height, ctx.RGBA, ctx.UNSIGNED_BYTE, pixels);
  }
  const flipped = new Uint8Array(pixels.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) flipped.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  let binary = '';
  for (let i = 0; i < flipped.length; i += 0x8000) binary += String.fromCharCode(...flipped.subarray(i, i + 0x8000));
  return btoa(binary);
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

async function until(test, what, timeout = 60000) {
  const start = performance.now();
  while (!test()) {
    if (performance.now() - start > timeout) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function Thumbnail({ shot, motion }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  const dancers = useRef();
  const { meta, Component: Stage } = STAGES.find((s) => s.meta.id === shot.stage);
  const playback = useRef(shot.pose);
  const { opacity, ...placement } = shot.dancers ?? {};
  const looks = useMemo(() => (opacity === undefined ? DANCER_LOOKS : DANCER_LOOKS.map((look) => ({ ...look, opacity }))), [opacity]);
  const hud = useMemo(() => ({ scene: new THREE.Scene(), camera: new THREE.OrthographicCamera() }), []);
  // The dancers alone, white on black, from the shot's camera (GIFs never hold their pixels).
  const mask = useMemo(
    () => ({ target: new THREE.WebGLRenderTarget(BUFFER.width, BUFFER.height), material: new THREE.MeshBasicMaterial(), black: new THREE.Color(0) }),
    [],
  );
  const stageReady = useRef(false);
  const onReady = useCallback(() => { stageReady.current = true; }, []);

  useLayoutEffect(() => {
    gl.setSize(BUFFER.width, BUFFER.height, false);
  }, [gl, size.width, size.height]);
  useLayoutEffect(() => resetPost(meta.post), [meta]);

  useEffect(() => {
    const shotFrame = Math.max(1, Math.round(shot.time / STEP));
    let frame = 0;
    let layer = null;
    let loading = null;

    const load = async () => {
      await until(() => stageReady.current, 'the stage');
      // Both dancers' rigs are in the scene (the model loads in its own Suspense).
      await until(() => scene.getObjectsByProperty('name', 'Root').filter((o) => o.isBone).length >= 2, 'the dancers');
      // The wordmark's two Inter weights (index.html); never fall back to another font.
      if (shot.logo) {
        const faces = await Promise.all(['800', '200'].map((wt) => document.fonts.load(`${wt} 64px Inter`, 'aerodance')));
        if (faces.some((f) => !f.length)) throw new Error('Inter did not load, so the wordmark cannot be drawn');
        layer = makeLogo(shot.logo);
      }
      await nextTask();
    };

    const readMask = () => {
      const camera = get().camera;
      dancers.current.traverse((o) => o.layers.enable(1));
      const saved = { background: scene.background, fog: scene.fog, layers: camera.layers.mask, shadows: gl.shadowMap.autoUpdate };
      Object.assign(scene, { background: mask.black, fog: null, overrideMaterial: mask.material });
      camera.layers.set(1);
      gl.shadowMap.autoUpdate = false;
      gl.setRenderTarget(mask.target);
      gl.clear();
      gl.render(scene, camera);
      Object.assign(scene, { background: saved.background, fog: saved.fog, overrideMaterial: null });
      camera.layers.mask = saved.layers;
      gl.shadowMap.autoUpdate = saved.shadows;
      gl.setRenderTarget(null);
      return readFrame(gl, mask.target);
    };

    // Plays the clock forward to 60 fps frame `to` (frames only go forward), letting React
    // commit between batches, then reads it back without and with the wordmark, and
    // optionally the dancers' mask.
    // The rig places hands and feet from the previous frame's body, so a held pose is exact
    // while a danced one trails by a frame, as in the game.
    const capture = async (to, { dance = false, plain = true, logo = true, mask: withMask = false } = {}) => {
      await (loading ??= load());
      if (to < frame) throw new Error(`Frame ${to} is already behind the clock (${frame})`);
      for (let i = frame + 1; i <= to; i++) {
        playback.current = dance ? shot.pose + (i - shotFrame) * STEP : shot.pose;
        advance(i * STEP);
        frame = i;
        if (i % 20 === 0) await nextTask();
      }
      const result = { width: BUFFER.width, height: BUFFER.height, plain: plain ? readFrame(gl) : null, logo: null };
      if (logo && layer) {
        gl.autoClear = false;
        gl.clearDepth();
        gl.render(layer.scene, layer.camera);
        gl.autoClear = true;
        result.logo = readFrame(gl);
      }
      if (withMask) result.mask = readMask();
      return result;
    };

    window.__thumb = {
      shot,
      shotFrame,
      renderer: (() => {
        const ctx = gl.getContext();
        const info = ctx.getExtension('WEBGL_debug_renderer_info');
        return info ? ctx.getParameter(info.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER);
      })(),
      render: () => capture(shotFrame),
      frame: (i, options) => capture(i, { ...options, dance: true }),
    };
  }, [gl, scene, get, mask, shot]);

  return (
    <>
      <RenderPipeline hudScene={hud.scene} hudCamera={hud.camera} width={BUFFER.width} height={BUFFER.height} aspect={BUFFER.aspect} />
      <ShotCamera {...shot.camera} />
      {new URLSearchParams(window.location.search).get('beat') === '0' && <SteadyBeat />}
      <Suspense fallback={null}>
        <Stage motion={motion} playback={playback} />
        <Ready onReady={onReady} />
      </Suspense>
      <group ref={dancers}>
        <Dancers motion={motion} playback={playback} {...meta.dancers} {...placement} looks={looks} />
      </group>
    </>
  );
}

export default function App() {
  const shot = useMemo(shotFromUrl, []);
  const [motion, setMotion] = useState(null);
  useEffect(() => {
    const loop = new URLSearchParams(window.location.search).get('loop')?.split(',').map(Number);
    fetch(`${import.meta.env.BASE_URL}motion/dance.json`)
      .then((r) => r.json())
      .then((data) => setMotion(loop ? loopMotion(validateMotion(data), ...loop) : validateMotion(data)));
  }, []);
  return (
    <div className="frame">
      {motion && (
        <Canvas
          frameloop="never"
          dpr={1}
          shadows={{ type: PCFShadowMap }}
          camera={{ position: [0, 4.2, 13.5], fov: 40, aspect: BUFFER.aspect }}
          gl={{ antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' }}
        >
          <Thumbnail shot={shot} motion={motion} />
        </Canvas>
      )}
    </div>
  );
}
