import { Component as ReactComponent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { HudProvider, Hud, useHudLayer } from './hud.jsx';
import { RenderPipeline, resetPost } from './post.jsx';
import { SCENES } from './scenes/index.js';
import { OnlineBadge, SceneSwitcher, TransitionVeil } from './ui/Chrome.jsx';
import { useFontsReady } from './ui/fonts.js';
import { setCursor } from './shared/hooks.js';

// Keeps one broken scene from taking down the whole menu.
class SceneBoundary extends ReactComponent {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error(`[menu] scene "${this.props.id}" crashed:`, error);
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}

function indexFromHash() {
  const id = window.location.hash.slice(1);
  const i = SCENES.findIndex((s) => s.meta.id === id);
  return i >= 0 ? i : 0;
}

const FADE_OUT = 0.22;
const FADE_IN = 0.45;

/**
 * Main menu host: owns the HUD layer and render pipeline, and swaps between
 * menu variations behind a short white veil (arrow keys, 1-6, or the switcher).
 */
export default function MenuApp() {
  const layer = useHudLayer();
  const fontsReady = useFontsReady();
  const [target, setTarget] = useState(indexFromHash);
  const [shown, setShown] = useState(target);
  const fade = useRef({ value: 1, settledFrames: 0 });

  const select = useCallback((i) => setTarget((i + SCENES.length) % SCENES.length), []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setTarget((i) => (i + 1) % SCENES.length);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') setTarget((i) => (i - 1 + SCENES.length) % SCENES.length);
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= SCENES.length) setTarget(Number(e.key) - 1);
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
    const { meta } = SCENES[shown];
    resetPost(meta.post);
    setCursor(false);
    window.history.replaceState(null, '', `#${meta.id}`);
    fade.current.settledFrames = 0;
  }, [shown]);

  useFrame((_, delta) => {
    const f = fade.current;
    const dt = Math.min(delta, 1 / 30);
    if (target !== shown) {
      f.value = Math.min(1, f.value + dt / FADE_OUT);
      if (f.value >= 1) setShown(target);
    } else if (fontsReady) {
      // Give the new scene a couple of frames to compile before revealing it.
      f.settledFrames += 1;
      if (f.settledFrames > 3) f.value = Math.max(0, f.value - dt / FADE_IN);
    }
  });

  const { Component, meta } = SCENES[shown];
  const tone = meta.tone ?? 'light';

  return (
    <HudProvider layer={layer}>
      <RenderPipeline hudScene={layer.scene} hudCamera={layer.camera} />
      {fontsReady && (
        <SceneBoundary key={meta.id} id={meta.id}>
          <Component />
        </SceneBoundary>
      )}
      <Hud>
        {fontsReady && (
          <>
            <SceneSwitcher scenes={SCENES.map((s) => s.meta)} index={target} onSelect={select} tone={tone} />
            <OnlineBadge tone={tone} />
          </>
        )}
        <TransitionVeil fade={fade} />
      </Hud>
    </HudProvider>
  );
}
