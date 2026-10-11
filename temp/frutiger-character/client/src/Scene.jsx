import { Component, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import Dancers from './stages/shared/Dancers.jsx';
import { RenderPipeline, resetPost } from './stages/shared/post.jsx';
import { StageHud, useHudLayer } from './stages/shared/hud.jsx';
import { STAGES } from './stages/index.js';

// Keeps one broken stage from taking down the dancers.
class StageBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error(`[dance] stage "${this.props.id}" crashed:`, error);
  }
  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}

// Mounts only once the lazily loaded stage has resolved.
function Ready({ flag, id }) {
  useLayoutEffect(() => {
    flag.current = id;
  }, [flag, id]);
  return null;
}

function indexFromHash() {
  const id = window.location.hash.slice(1);
  const i = STAGES.findIndex((s) => s.meta.id === id);
  return i >= 0 ? i : 0;
}

const FADE_OUT = 0.25;
const FADE_IN = 0.6;

/**
 * The two captured dancers on one of several stages. Switch stages with
 * ← / →, 1–5, the name card's orbs, or a hash such as #club.
 * Space pauses the dancers; ?t=6 holds them at six seconds.
 */
export default function Scene({ motion }) {
  const layer = useHudLayer();
  const fixedTime = new URLSearchParams(window.location.search).get('t');
  const playback = useRef(fixedTime !== null && Number.isFinite(Number(fixedTime)) ? Number(fixedTime) : 0);
  const paused = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [target, setTarget] = useState(indexFromHash);
  const [shown, setShown] = useState(target);
  const fade = useRef({ value: 1, settledFrames: 0 });
  const loaded = useRef(null);

  const select = useCallback((i) => setTarget((i + STAGES.length) % STAGES.length), []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        paused.current = !paused.current;
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') setTarget((i) => (i + 1) % STAGES.length);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') setTarget((i) => (i - 1 + STAGES.length) % STAGES.length);
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= STAGES.length) setTarget(Number(e.key) - 1);
    };
    const onHash = () => setTarget(indexFromHash());
    window.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  useLayoutEffect(() => {
    const { meta } = STAGES[shown];
    resetPost(meta.post);
    window.history.replaceState(null, '', `${window.location.search}#${meta.id}`);
    fade.current.settledFrames = 0;
  }, [shown]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    if (fixedTime === null && !paused.current) playback.current += dt;
    const f = fade.current;
    if (target !== shown) {
      f.value = Math.min(1, f.value + dt / FADE_OUT);
      if (f.value >= 1) setShown(target);
    } else if (loaded.current === STAGES[shown].meta.id) {
      // Give a new stage a few frames to compile shaders before revealing it.
      f.settledFrames += 1;
      if (f.settledFrames > 3) f.value = Math.max(0, f.value - dt / FADE_IN);
    }
    if (import.meta.env.DEV) window.__danceStage = { id: STAGES[shown].meta.id, revealed: f.value === 0 };
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
      <Dancers motion={motion} playback={playback} {...meta.dancers} />
      <StageHud layer={layer} stages={STAGES.map((s) => s.meta)} index={target} onSelect={select} fade={fade} />
    </>
  );
}
