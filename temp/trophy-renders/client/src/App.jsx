import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { advance, Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PCFShadowMap } from 'three';
import { validateMotion } from '../../../../packages/character/motion.js';
import { STAGES } from '../../../../packages/stages/index.js';
import { post, resetPost } from '../../../../packages/stages/shared/post.jsx';
import { trophyTraits } from '../../../../server/trophyArt.js';
import { drawHud } from './hud.js';
import { TrophyPipeline } from './pipeline.jsx';
import { BATTLES, BUFFER, DATE, FRAMING } from './shots.js';
import Trophy from './Trophy.jsx';

/*
 * Renders one trophy NFT in-engine: the battle's stage (its real 3D scene, lights and
 * post-processing), the trophy built from its traits on the dance floor, and the 2D layer
 * (wordmark, battle chip, name card) on top. A depth of field keeps the trophy crisp
 * against a soft stage (pipeline.jsx).
 *
 * The clock is stepped by hand (frameloop="never"): window.__trophy.render() plays the
 * stage forward at 60 fps to the framing's time, then returns the frame as PNG data URLs
 * with and without the 2D layer. scripts/render.mjs drives it and writes the files.
 *
 * URL: ?battle=<id> (shots.js), or ?spec=<JSON> for any { id, score, pops, sync, flair }.
 */

// Stepped at 30 fps: plenty for water, lights and creatures to settle into a still frame.
const STEP = 1 / 30;

function battleFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const spec = params.has('spec') ? JSON.parse(params.get('spec')) : BATTLES.find((b) => b.id === params.get('battle')) ?? BATTLES[0];
  return { ...spec, created_at: new Date(spec.created_at ?? DATE) };
}

// A square camera standing in for the stage's own (orbiting, 16:9) one.
function ShotCamera({ position, target, fov }) {
  const camera = useMemo(() => {
    const cam = new THREE.PerspectiveCamera(fov, BUFFER.aspect, 0.1, 2000);
    cam.manual = true;
    cam.position.set(...position);
    cam.lookAt(...target);
    cam.updateMatrixWorld();
    return cam;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state) => {
    if (state.camera === camera) return;
    camera.near = state.camera.near;
    camera.far = state.camera.far;
    camera.updateProjectionMatrix();
    state.set({ camera });
  }, -1);
  return null;
}

function Ready({ onReady }) {
  useLayoutEffect(() => onReady(), [onReady]);
  return null;
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

async function until(test, what, timeout = 60000) {
  const start = performance.now();
  while (!test()) {
    if (performance.now() - start > timeout) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// The 2D layer as a fullscreen quad, drawn over the finished frame.
function hudLayer(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }),
  );
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  return { scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1) };
}

function TrophyShot({ battle, traits, motion }) {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const stage = STAGES.find((s) => s.meta.name === traits.stage.name);
  const { meta, Component: Stage } = stage;
  const framing = FRAMING[meta.id];
  const floor = meta.dancers.position;
  const at = (offset) => offset.map((v, i) => v + floor[i]);
  const playback = useRef(5);
  // Keep the trophy in focus: the distance from the camera to what it looks at.
  const focus = Math.hypot(...framing.camera.map((v, i) => v - framing.target[i]));
  const ready = useRef({ stage: false, trophy: false });
  const onStage = useCallback(() => { ready.current.stage = true; }, []);
  const onTrophy = useCallback(() => { ready.current.trophy = true; }, []);

  useLayoutEffect(() => {
    gl.setSize(BUFFER.width, BUFFER.height, false);
  }, [gl, size.width, size.height]);
  useLayoutEffect(() => {
    resetPost(meta.post);
    // A touch more vignette and a little less bloom than the stage's own, so the eye goes
    // to the trophy and its edges stay crisp.
    post.vignette += 0.12;
    post.bloomStrength *= 0.75;
    // Stages that bloom early (the club, at 1.0) would make a light trophy flare.
    post.bloomThreshold = Math.max(post.bloomThreshold, 1.6);
  }, [meta]);

  useEffect(() => {
    window.__trophy = {
      battle: battle.id,
      traits: { stage: traits.stage.name, glass: traits.glass, finish: traits.finish, cup: traits.cup, aura: traits.aura },
      renderer: (() => {
        const ctx = gl.getContext();
        const info = ctx.getExtension('WEBGL_debug_renderer_info');
        return info ? ctx.getParameter(info.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER);
      })(),
      async render() {
        await until(() => ready.current.stage && ready.current.trophy, 'the stage and trophy');
        const faces = await Promise.all(['800', '700', '600', '200'].map((wt) => document.fonts.load(`${wt} 64px Inter`, 'aerodance')));
        const fontWarning = faces.some((f) => !f.length) ? 'Inter did not load; the 2D layer fell back to another font' : null;
        await nextTask();
        const frames = Math.max(1, Math.round(framing.time / STEP));
        for (let i = 1; i <= frames; i++) {
          advance(i * STEP);
          if (i % 20 === 0) await nextTask();
        }
        const plain = gl.domElement.toDataURL('image/png');
        const layer = hudLayer(drawHud(battle, traits));
        gl.autoClear = false;
        gl.clearDepth();
        gl.render(layer.scene, layer.camera);
        gl.autoClear = true;
        return { plain, hud: gl.domElement.toDataURL('image/png'), fontWarning };
      },
    };
  }, [gl, battle, traits, framing]);

  return (
    <>
      <TrophyPipeline width={BUFFER.width} height={BUFFER.height} aspect={BUFFER.aspect} focus={focus} />
      <ShotCamera position={at(framing.camera)} target={at(framing.target)} fov={framing.fov} />
      <Suspense fallback={null}>
        <Stage motion={motion} playback={playback} />
        <Ready onReady={onStage} />
      </Suspense>
      <Trophy battle={battle} traits={traits} motion={motion} position={floor} bloomThreshold={meta.post.bloomThreshold} onReady={onTrophy} />
    </>
  );
}

export default function App() {
  const battle = useMemo(battleFromUrl, []);
  const traits = useMemo(() => trophyTraits(battle), [battle]);
  const [motion, setMotion] = useState(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}motion/dance.json`)
      .then((r) => r.json())
      .then((data) => setMotion(validateMotion(data)));
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
          <TrophyShot battle={battle} traits={traits} motion={motion} />
        </Canvas>
      )}
    </div>
  );
}
