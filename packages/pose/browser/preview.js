import { CONNECTIONS } from '../choreography.js';

// Shared setup view: mirrored display only; captured landmarks stay canonical.
export function drawWebcamPreview(g, video, snapshot, rect, playerCount = 2) {
  const { x, y, w, h } = rect;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#09273b'; g.fillRect(x, y, w, h);
  if (video?.readyState >= 2 && video.videoWidth) {
    const scale = Math.min(w / video.videoWidth, h / video.videoHeight);
    const dw = video.videoWidth * scale, dh = video.videoHeight * scale;
    const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
    g.save(); g.translate(dx + dw, dy); g.scale(-1, 1); g.drawImage(video, 0, 0, dw, dh); g.restore();
    for (const pose of snapshot?.poses || []) {
      g.strokeStyle = pose.playerId === 0 ? '#7dffff' : '#ffdc70'; g.lineWidth = 2;
      for (const [a, b] of CONNECTIONS) {
        const p = pose.landmarks[a], q = pose.landmarks[b];
        if (Math.min(p.visibility ?? 0, p.presence ?? 0, q.visibility ?? 0, q.presence ?? 0) < 0.5) continue;
        g.beginPath(); g.moveTo(dx + (1 - p.x) * dw, dy + p.y * dh); g.lineTo(dx + (1 - q.x) * dw, dy + q.y * dh); g.stroke();
      }
    }
  }
  g.font = 'bold 16px sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'center';
  if (playerCount === 2) {
    g.strokeStyle = '#fff8'; g.lineWidth = 1; g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h); g.stroke();
    g.fillText('P1', x + w / 4, y + 22); g.fillText('P2', x + w * 3 / 4, y + 22);
  } else g.fillText('P1', x + w / 2, y + 22);
  if (!video) g.fillText('Start camera to preview', x + w / 2, y + h / 2);
  g.restore();
}
