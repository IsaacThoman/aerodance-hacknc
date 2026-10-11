import { useCallback, useEffect, useState } from 'react';

const fullscreenElement = (doc) => doc.fullscreenElement ?? doc.webkitFullscreenElement;

export function readFullscreenState(doc) {
  const el = doc.documentElement;
  const supported = typeof el.requestFullscreen === 'function'
    ? doc.fullscreenEnabled !== false && typeof doc.exitFullscreen === 'function'
    : doc.webkitFullscreenEnabled !== false && typeof el.webkitRequestFullscreen === 'function' && typeof doc.webkitExitFullscreen === 'function';
  return { active: !!fullscreenElement(doc), supported };
}

// Call directly from the canvas input handler: Safari needs the user's activation.
// Older Safari uses prefixed methods that return void instead of a Promise.
export function toggleFullscreen(doc) {
  if (fullscreenElement(doc)) {
    const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
    return exit.call(doc);
  }
  const el = doc.documentElement;
  const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
  return request.call(el);
}

export default function useFullscreen() {
  const [state, setState] = useState(() => readFullscreenState(document));
  const [error, setError] = useState(null);
  const failed = useCallback(() => setError('Click fullscreen on this display to retry.'), []);

  useEffect(() => {
    const changed = () => {
      setState(readFullscreenState(document));
      setError(null);
    };
    const events = [
      ['fullscreenchange', changed], ['webkitfullscreenchange', changed],
      ['fullscreenerror', failed], ['webkitfullscreenerror', failed],
    ];
    for (const [type, fn] of events) document.addEventListener(type, fn);
    changed();
    return () => {
      for (const [type, fn] of events) document.removeEventListener(type, fn);
    };
  }, [failed]);

  const toggle = useCallback(() => {
    setError(null);
    try {
      Promise.resolve(toggleFullscreen(document)).catch(failed);
    } catch {
      failed();
    }
  }, [failed]);

  return { ...state, error, toggle };
}
