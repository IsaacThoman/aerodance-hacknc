import { useEffect, useRef, useState } from 'react';
import { MODELS } from '../../../packages/pose/browser/models.js';
import { CONNECTIONS } from '../../../packages/pose/choreography.js';
import { VideoImporter } from './videoImport.js';

export default function VideoImportPanel({ file, projectId, request, onImported, onClose, onBusy }) {
  const [url] = useState(() => URL.createObjectURL(file));
  const [model, setModel] = useState('lite');
  const [ready, setReady] = useState(false), [working, setWorking] = useState(false);
  const [processed, setProcessed] = useState(false), [calibration, setCalibration] = useState(null);
  const [detections, setDetections] = useState([]);
  const [error, setError] = useState(''), [progress, setProgress] = useState(null);
  const dialog = useRef(null), video = useRef(null), canvas = useRef(null), importer = useRef(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    dialog.current.showModal();
    return () => { active.current = false; importer.current?.abort(); URL.revokeObjectURL(url); onBusy(false); };
  }, [url, onBusy]);
  const close = () => { active.current = false; importer.current?.abort(); onClose(); };
  const getImporter = () => {
    importer.current ||= new VideoImporter({ video: video.current, modelId: model, projectId, request, onProgress: setProgress });
    return importer.current;
  };
  const run = async action => {
    setWorking(true); onBusy(true); setError('');
    try { await action(); }
    catch (e) { if (active.current && e.name !== 'AbortError') setError(e.message); }
    finally { if (active.current) { setWorking(false); onBusy(false); } }
  };
  const selectFrame = () => run(async () => {
    setProgress({ fraction: 0, message: `Checking calibration with ${model}…` });
    const frame = await getImporter().calibrate();
    setProgress(null);
    setCalibration({ mediaTimeMs: frame.mediaTimeMs, poses: frame.poses });
    setDetections(frame.detectedPoses);
    const c = canvas.current, g = c.getContext('2d');
    c.width = 480; c.height = Math.round(480 * video.current.videoHeight / video.current.videoWidth);
    g.drawImage(video.current, 0, 0, c.width, c.height);
    for (const pose of frame.detectedPoses) {
      g.strokeStyle = pose.ready ? pose.playerId ? '#be9cff' : '#51daf0' : '#ffc66d'; g.lineWidth = 2;
      for (const [a, b] of CONNECTIONS) {
        g.beginPath(); g.moveTo(pose.landmarks[a].x * c.width, pose.landmarks[a].y * c.height);
        g.lineTo(pose.landmarks[b].x * c.width, pose.landmarks[b].y * c.height); g.stroke();
      }
      g.fillStyle = g.strokeStyle; g.font = 'bold 16px sans-serif';
      g.fillText(`P${pose.playerId + 1}`, pose.landmarks[0].x * c.width, Math.max(20, pose.landmarks[0].y * c.height - 15));
    }
  });
  const process = () => run(async () => {
    video.current.pause();
    const job = getImporter();
    if (!job.processed) {
      await job.process(file.name);
      setProcessed(true);
    }
    setProgress({ fraction: 1, message: 'Saving video take…' });
    const take = await job.finalize(calibration);
    if (!active.current) return;
    await onImported(take);
    close();
  });
  return <dialog ref={dialog} className="video-import" aria-labelledby="video-import-title"
    onCancel={event => { event.preventDefault(); close(); }}>
    <div className="video-import-heading">
      <div><h2 id="video-import-title">Import video</h2><p className="muted">{file.name}</p></div>
      <button onClick={close} aria-label="Close video import">×</button>
    </div>
    <p className="muted">Choose a model, then pause on a frame with the dancers standing clearly in view. Import creates a new take; assign it to player tracks from the take menu.</p>
    <label>Pose model
      <select aria-label="Video pose model" value={model} disabled={working} onChange={event => {
        importer.current?.abort(); importer.current = null;
        setModel(event.target.value); setCalibration(null); setDetections([]); setProcessed(false); setProgress(null); setError('');
      }}>{MODELS.map(m => <option key={m.id} value={m.id}>{m.label} · {m.description}</option>)}</select>
    </label>
    <video ref={video} src={url} controls={!working} muted playsInline preload="auto" aria-label="Source video"
      onLoadedData={() => {
        const v = video.current;
        const valid = v.duration > 0 && v.duration <= 3600 && v.videoWidth > 0 && v.videoHeight > 0;
        setReady(valid);
        if (!valid) setError('Choose a video between zero and one hour long');
      }} onError={() => { setReady(false); setError('This browser could not decode the video. Try MP4 or WebM with a supported codec.'); }} />
    <button disabled={!ready || working} onClick={selectFrame}>Use current frame for calibration</button>
    <div className="video-calibration" hidden={!calibration}>
      <canvas ref={canvas} aria-label="Selected calibration frame" />
      {calibration && <p role="status">Calibration at {(calibration.mediaTimeMs / 1000).toFixed(2)}s · {calibration.poses.length
        ? `${calibration.poses.map(p => `P${p.playerId + 1}`).join(' and ')} ready` : 'choose a clearer frame'}</p>}
      {detections.map((pose, index) => <p role="status" key={index}>P{pose.playerId + 1} detected · {pose.reason}</p>)}
      {calibration && [0, 1].filter(id => !detections.some(p => p.playerId === id)).map(id =>
        <p role="status" key={`missing-${id}`}>P{id + 1} not detected in this frame · try another frame or Full / Heavy</p>)}
    </div>
    {progress && <div className="video-progress" role="status"><progress value={progress.fraction} max="1" /><p>{progress.message}</p></div>}
    {error && <p role="alert" className="video-import-error">{error}</p>}
    <p className="muted">Up to two dancers are detected using the webcam’s left/right regions. Song audio stays unchanged. The source video is available only for this session; poses and calibration are saved.</p>
    <div className="video-import-actions">
      <button onClick={close}>{working ? 'Cancel import' : 'Cancel'}</button>
      <button disabled={!ready || !calibration?.poses.length || detections.some(p => !p.ready) || working} onClick={process}>{processed ? 'Save take' : 'Process video'}</button>
    </div>
  </dialog>;
}
