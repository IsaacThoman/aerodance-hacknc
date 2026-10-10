import { useEffect, useRef } from 'react';
import { createAeroBackground } from './aeroBackground.js';

/**
 * Full-screen Frutiger Aero drone flight that sits behind the rest of the app.
 *
 * <AeroBackground speed={1} paused={false} quality="auto" onTelemetry={(t) => ...} />
 *
 * A fresh <canvas> is created on every mount so React StrictMode's
 * mount → unmount → mount cycle never reuses a lost WebGL context.
 */
export default function AeroBackground({ speed = 1, paused = false, quality = 'auto', onTelemetry, className = '' }) {
  const hostRef = useRef(null);
  const aeroRef = useRef(null);
  const teleRef = useRef(onTelemetry);
  teleRef.current = onTelemetry;

  useEffect(() => {
    const canvas = document.createElement('canvas');
    hostRef.current.appendChild(canvas);
    let aero = null;
    try {
      aero = createAeroBackground(canvas, {
        speed,
        quality,
        onTelemetry: (t) => teleRef.current?.(t),
      });
      aero.setPaused(paused);
      aeroRef.current = aero;
    } catch (err) {
      console.warn('Aero background could not start (WebGL unavailable?)', err);
    }
    return () => {
      aero?.destroy();
      aeroRef.current = null;
      canvas.remove();
    };
    // Rebuilding the scene is expensive; only a quality change triggers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality]);

  useEffect(() => { aeroRef.current?.setSpeed(speed); }, [speed]);
  useEffect(() => { aeroRef.current?.setPaused(paused); }, [paused]);

  return <div ref={hostRef} className={`aero-background ${className}`.trim()} aria-hidden="true" />;
}
