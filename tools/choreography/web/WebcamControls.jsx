import { useEffect, useRef } from 'react';
import { MODELS } from '../../../packages/pose/browser/models.js';
import { drawWebcamPreview } from '../../../packages/pose/browser/preview.js';

export default function WebcamControls({ source, connection, disabled }) {
  const canvas = useRef(null);
  const state = useRef({ source, connection }); state.current = { source, connection };
  useEffect(() => {
    let frame;
    const draw = () => {
      const { source, connection } = state.current;
      const g = canvas.current?.getContext('2d');
      if (g) drawWebcamPreview(g, source.video, connection.snapshot, { x: 0, y: 0, w: 320, h: 180 }, 2);
      frame = requestAnimationFrame(draw);
    };
    draw(); return () => cancelAnimationFrame(frame);
  }, []);
  const configure = options => { void source.configure(options).catch(() => {}); };
  return <div className="webcam-controls">
    <label>Camera<select aria-label="Webcam camera" value={connection.cameraId || ''} disabled={disabled}
      onChange={e => configure({ cameraId: e.target.value })}>
      <option value="">Default camera</option>
      {(connection.cameras || []).map(camera => <option key={camera.deviceId} value={camera.deviceId}>{camera.label}</option>)}
    </select></label>
    <label>Pose model<select aria-label="Webcam pose model" value={connection.model || 'lite'} disabled={disabled}
      onChange={e => configure({ modelId: e.target.value })}>
      {MODELS.map(model => <option key={model.id} value={model.id}>{model.label} · {model.description}</option>)}
    </select></label>
    <canvas ref={canvas} width="320" height="180" aria-label="Mirrored webcam setup preview" />
    <small>Video stays in this browser. Keep full bodies in separate camera halves.</small>
  </div>;
}
