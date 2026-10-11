import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, createPortal, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PCFShadowMap } from 'three';
import { validateMotion } from '../../../../packages/character/motion.js';
import motionUrl from '../../../../packages/character/assets/dance.json?url';
import { STAGES } from '../../../../packages/stages/index.js';
import { RenderPipeline, resetPost } from '../../../../packages/stages/shared/post.jsx';
import { HUD_HEIGHT, HUD_WIDTH, useHudLayer } from '../../../../packages/stages/shared/hud.jsx';
import WinStage from './WinStage.jsx';
import WinHud from './WinHud.jsx';
import { MODES, tempResults, winnerOf } from './results.js';

/*
 * Win / end screens for every dance stage (temp/frutiger-character's stages, used as-is):
 * the stage behind, the dancers rearranged for the result, and the results in the
 * stage's HUD style. Player 1 or Player 2 wins, a tie, or a solo end screen, all with
 * (placeholder) scores.
 *
 * Keys: 1-6 or ← → switch stage, M cycles the result, R replays the reveal.
 * URL: #<stage>/<p1|p2|tie|solo>, e.g. #club/p2.
 */

const SONG = { title: 'Song Title One', artist: 'Artist Name' };
const FADE_OUT = 0.25;
const FADE_IN = 0.6;

function fromHash() {
  const [id, mode] = window.location.hash.slice(1).split('/');
  const stage = Math.max(0, STAGES.findIndex((s) => s.meta.id === id));
  const m = Math.max(0, MODES.findIndex((x) => x.id === mode));
  return { stage, mode: m };
}

function FixedRenderResolution() {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  useLayoutEffect(() => { gl.setSize(640, 480, false); }, [gl, size.width, size.height]);
  return null;
}

class StageBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error(`[win] stage "${this.props.id}" crashed:`, error); }
  render() { return this.state.error ? this.props.fallback : this.props.children; }
}

function Ready({ flag, id }) {
  useLayoutEffect(() => { flag.current = id; }, [flag, id]);
  return null;
}

function Veil({ layer, fade }) {
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: '#f4fdff', transparent: true, toneMapped: false, depthTest: false, depthWrite: false }), []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    material.opacity = fade.current.value;
    material.visible = fade.current.value > 0.001;
  });
  return createPortal(
    <mesh material={material} renderOrder={30}>
      <planeGeometry args={[HUD_WIDTH, HUD_HEIGHT]} />
    </mesh>,
    layer.scene,
  );
}

function WinScreens({ motion }) {
  const clock = useThree((s) => s.clock);
  const layer = useHudLayer();
  const initial = useMemo(fromHash, []);
  const [target, setTarget] = useState(initial.stage);
  const [shown, setShown] = useState(initial.stage);
  const [mode, setMode] = useState(initial.mode);
  const [run, setRun] = useState(0);
  const playback = useRef(0);
  const fade = useRef({ value: 1, settledFrames: 0 });
  const loaded = useRef(null);

  // Fresh placeholder scores and a fresh reveal for each stage / result / replay.
  const show = useRef(null);
  const key = `${shown}|${mode}|${run}`;
  if (show.current?.key !== key) {
    const results = tempResults(MODES[mode].id);
    show.current = { key, start: clock.elapsedTime, results, winner: winnerOf(results) };
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') setTarget((i) => (i + 1) % STAGES.length);
      else if (e.key === 'ArrowLeft') setTarget((i) => (i - 1 + STAGES.length) % STAGES.length);
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= STAGES.length) setTarget(Number(e.key) - 1);
      else if (e.key === 'm' || e.key === 'M') setMode((m) => (m + 1) % MODES.length);
      else if (e.key === 'r' || e.key === 'R' || e.key === 'Enter') setRun((r) => r + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useLayoutEffect(() => {
    resetPost(STAGES[shown].meta.post);
    fade.current.settledFrames = 0;
  }, [shown]);
  useEffect(() => {
    window.history.replaceState(null, '', `#${STAGES[shown].meta.id}/${MODES[mode].id}`);
  }, [shown, mode]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    playback.current += dt;
    const f = fade.current;
    if (target !== shown) {
      f.value = Math.min(1, f.value + dt / FADE_OUT);
      if (f.value >= 1) setShown(target);
    } else if (loaded.current === STAGES[shown].meta.id) {
      // Let a new stage compile its shaders, then reveal it and start the results from there.
      f.settledFrames += 1;
      if (f.settledFrames === 4) show.current.start = clock.elapsedTime + 0.3;
      if (f.settledFrames > 3) f.value = Math.max(0, f.value - dt / FADE_IN);
    }
  }, -1);

  const { Component: Stage, meta } = STAGES[shown];
  return (
    <>
      <RenderPipeline hudScene={layer.scene} hudCamera={layer.camera} />
      <StageBoundary key={meta.id} id={meta.id} fallback={<Ready flag={loaded} id={meta.id} />}>
        <Suspense fallback={null}>
          <Stage motion={motion} playback={playback} />
          <Ready flag={loaded} id={meta.id} />
        </Suspense>
      </StageBoundary>
      <WinStage key={key} motion={motion} playback={playback} show={show} floor={meta.dancers} accent={meta.accent ?? ['#7fe3ff', '#0a8fd8']} />
      <WinHud layer={layer} show={show} stage={meta} song={SONG} modeLabel={MODES[mode].label} onReplay={() => setRun((r) => r + 1)} />
      <Veil layer={layer} fade={fade} />
    </>
  );
}

export default function App() {
  const [motion, setMotion] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(motionUrl, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error('Capture unavailable'); return r.json(); })
      .then((data) => setMotion(validateMotion(data)))
      .catch((e) => { if (e.name !== 'AbortError') setError(true); });
    return () => controller.abort();
  }, []);
  return (
    <main className="canvas-frame" aria-label="Win screens for each dance stage">
      {error ? (
        <p role="alert">The dance capture could not load. Reload to try again.</p>
      ) : !motion ? (
        <p role="status">Loading…</p>
      ) : (
        <Canvas dpr={1} shadows={{ type: PCFShadowMap }} camera={{ position: [0, 4.2, 13.5], fov: 40, aspect: 16 / 9 }} gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}>
          <FixedRenderResolution />
          <WinScreens motion={motion} />
        </Canvas>
      )}
    </main>
  );
}
