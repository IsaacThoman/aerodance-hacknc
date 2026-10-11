import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { STAGES, resolveStage } from '../../../packages/stages/index.js';
import { RenderPipeline, resetPost } from '../../../packages/stages/shared/post.jsx';
import Dancers from '../../../packages/stages/shared/Dancers.jsx';
import { beat } from '../../../packages/stages/shared/hooks.js';

/**
 * The game's dance stages (packages/stages) inside its canvas, with the routine's dancers.
 *
 * Each stage was built to own a canvas: its StageCamera becomes the default camera, its
 * environment lights the default scene and RenderPipeline renders whatever those are. Here
 * the stage lives in a createPortal scene, whose store has its own scene and camera, so it
 * never touches the Aero world's. Changes of stage (and coming and going) happen behind a
 * pale veil drawn over the world (priority 1.6, under the menus): up, swap, let the new
 * stage compile for a few frames, down.
 *
 * While a stage is mounted it takes the renderer's shadow and tone-mapping settings and the
 * Aero world should pause (onState's `showing`); both are put back when it goes.
 *
 * <StageView active stageId="openreef" routine={{ bundle, playerCount, timeMs, playing }}
 *   onState={({ showing, ready, stage, failed, dancersFailed }) => ...} />
 */

const FADE_UP = 0.25;
const FADE_DOWN = 0.6;
// A new stage gets this many frames to compile its shaders before it is revealed.
const SETTLE_FRAMES = 3;
const STAGE_BPM = beat.bpm;

const byId = Object.fromEntries(STAGES.map((stage) => [stage.meta.id, stage]));

// Keeps one broken stage from taking down the game.
class StageBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error(`[stage] "${this.props.id}" crashed:`, error); }
  render() { return this.state.error ? this.props.fallback : this.props.children; }
}

// The dancers can fail on their own (their model didn't load); the stage carries on without them.
class DancerBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.warn('[stage] dancers could not load:', error); this.props.onFail(); }
  render() { return this.state.failed ? null : this.props.children; }
}

// Mounts once the lazily loaded stage has resolved.
function Ready({ onReady, id, failed = false }) {
  useLayoutEffect(() => { onReady(id, failed); }, [onReady, id, failed]);
  return null;
}

function Veil({ fade }) {
  const gl = useThree((state) => state.gl);
  const layer = useMemo(() => {
    const material = new THREE.MeshBasicMaterial({ color: '#f4fdff', transparent: true, toneMapped: false, depthTest: false, depthWrite: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    return { material, quad, scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1) };
  }, []);
  useEffect(() => () => { layer.material.dispose(); layer.quad.geometry.dispose(); }, [layer]);
  useFrame(() => {
    const v = fade.current.value;
    if (v < 0.001) return;
    layer.material.opacity = v;
    const ac = gl.autoClear;
    gl.autoClear = false;
    gl.clearDepth();
    gl.render(layer.scene, layer.camera);
    gl.autoClear = ac;
  }, 1.6);
  return null;
}

// Everything inside the portal: the pipeline, the stage and its dancers.
function StageContent({ id, routine, onReady, onDancersFail }) {
  const gl = useThree((state) => state.gl);
  const { meta, Component: Stage } = byId[id];

  // Borrow the renderer's settings while a stage is up (the Aero world sets its own once).
  useLayoutEffect(() => {
    const saved = {
      toneMapping: gl.toneMapping,
      toneMappingExposure: gl.toneMappingExposure,
      autoClear: gl.autoClear,
      shadow: { enabled: gl.shadowMap.enabled, type: gl.shadowMap.type, autoUpdate: gl.shadowMap.autoUpdate },
    };
    Object.assign(gl.shadowMap, { enabled: true, type: THREE.PCFShadowMap, autoUpdate: true });
    return () => {
      Object.assign(gl, { toneMapping: saved.toneMapping, toneMappingExposure: saved.toneMappingExposure, autoClear: saved.autoClear });
      Object.assign(gl.shadowMap, saved.shadow);
      gl.shadowMap.needsUpdate = true;
      beat.bpm = STAGE_BPM;
    };
  }, [gl]);

  useLayoutEffect(() => { resetPost(meta.post); }, [meta]);

  // Beat-reactive lights follow the song while it plays, when it knows its tempo.
  useFrame((_, delta) => {
    const bpm = routine?.bundle.song.bpm;
    if (!bpm || !routine.playing()) return;
    beat.bpm = bpm;
    // RenderPipeline's tickBeat adds this frame's delta next.
    beat.time = routine.timeMs() / 1000 - Math.min(delta, 0.1);
  }, 0.5);

  return (
    <>
      <RenderPipeline />
      <StageBoundary key={id} id={id} fallback={<Ready onReady={onReady} id={id} failed />}>
        <Suspense fallback={null}>
          <Stage />
          <Ready onReady={onReady} id={id} />
        </Suspense>
      </StageBoundary>
      <DancerBoundary onFail={onDancersFail}>
        <Dancers routine={routine} {...meta.dancers} />
      </DancerBoundary>
    </>
  );
}

export default function StageView({ active = false, stageId, routine, onState }) {
  const scene = useMemo(() => new THREE.Scene(), []);
  const [shown, setShown] = useState(null);
  const fade = useRef({ value: 0, settled: 0 });
  const st = useRef({ loaded: null, failed: new Set(), dancersFailed: false, requested: undefined, reported: '' }).current;
  const target = active ? resolveStage(stageId) : null;
  const props = useRef({});
  props.current = { target, shown, onState };
  // Keep dancing the last routine while the veil comes up on the way out.
  const lastRoutine = useRef(null);
  if (routine) lastRoutine.current = routine;
  else if (!shown) lastRoutine.current = null;

  const onReady = useMemo(() => (id, failed) => {
    st.loaded = id;
    if (failed) st.failed.add(id);
  }, [st]);
  const onDancersFail = useMemo(() => () => { st.dancersFailed = true; }, [st]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const f = fade.current;
    const { target: want, shown: have } = props.current;
    if (want !== have) {
      // Veil up, then swap what's mounted behind it.
      f.value = Math.min(1, f.value + dt / FADE_UP);
      if (f.value >= 1 && st.requested !== want) {
        st.requested = want;
        st.loaded = null;
        st.failed.delete(want);
        f.settled = 0;
        setShown(want);
      }
    } else {
      st.requested = have;
      // Veil down once the stage is in and compiled; a stage that failed stays veiled.
      if (have === null || (st.loaded === have && !st.failed.has(have))) {
        f.settled += 1;
        if (have === null || f.settled > SETTLE_FRAMES) f.value = Math.max(0, f.value - dt / FADE_DOWN);
      }
    }
    const ready = have !== null && st.loaded === have && f.value === 0;
    const failed = have !== null && st.failed.has(have);
    const report = `${have}|${ready}|${failed}|${st.dancersFailed}`;
    if (report !== st.reported) {
      st.reported = report;
      const { dataset } = state.gl.domElement;
      dataset.stage = have ?? '';
      dataset.stageReady = String(ready);
      props.current.onState?.({ showing: have !== null, ready, stage: have, failed, dancersFailed: st.dancersFailed });
    }
  });

  return (
    <>
      {shown && createPortal(<StageContent id={shown} routine={routine ?? lastRoutine.current} onReady={onReady} onDancersFail={onDancersFail} />, scene)}
      <Veil fade={fade} />
    </>
  );
}
