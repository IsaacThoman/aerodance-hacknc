import {NdjsonDecoder, PoseState, deviceEndpoint} from './protocol.js';
const $ = id => document.getElementById(id);
const canvas = $('pose'), context = canvas.getContext('2d');
const bones = [[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],[12,14],[14,16],[16,18],[16,20],[16,22],[18,20],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32]];
const left = new Set([1,2,3,7,9,11,13,15,17,19,21,23,25,27,29,31]);
let state = new PoseState(), controller = null, retryTimer = null, generation = 0, connectedOnce = false;
let times = [], retry = 0, reconnecting = false, base = '';
$('origin').textContent = location.origin;
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(location.origin); $('message').textContent = 'Origin copied. Paste it into the Android app.'; }
  catch { $('message').textContent = `Set the Android allowed origin to ${location.origin}`; }
};
try { $('ip').value = localStorage.getItem('pose-board-ip') || '192.168.43.1'; } catch {}
function status(label, type) { $('connection').textContent = label; $('connection').dataset.state = type; }
function stop(message = 'Disconnected. The board can continue estimating poses.') {
  generation++; clearTimeout(retryTimer); retryTimer = null;
  controller?.abort(); controller = null;
  state = new PoseState(); times = []; reconnecting = false;
  $('connect').disabled = false; $('disconnect').disabled = true; $('ip').disabled = false;
  status('Disconnected', 'off'); $('message').textContent = message;
}
$('disconnect').onclick = () => stop();
$('connect').onclick = () => {
  try { base = deviceEndpoint($('ip').value); } catch (error) { $('message').textContent = error.message; return; }
  stop(); connectedOnce = false; retry = 0;
  try { localStorage.setItem('pose-board-ip', $('ip').value.trim()); } catch {}
  $('connect').disabled = true; $('disconnect').disabled = false; $('ip').disabled = true;
  connect(generation);
};
async function connect(token) {
  if (token !== generation) return;
  reconnecting = false; const attempt = new AbortController(); controller = attempt;
  const signal = attempt.signal;
  status(retry ? 'Reconnecting…' : 'Connecting…', 'pending');
  $('message').textContent = 'Checking the board and opening the pose stream…';
  state = new PoseState(); times = [];
  const timeout = setTimeout(() => attempt.abort(), 12000);
  try {
    const response = await fetch(`${base}/v1/status`, {signal, credentials:'omit', cache:'no-store'});
    if (!response.ok) throw Error(`Status HTTP ${response.status}`);
    const info = await response.json();
    if (info.protocolVersion !== 1 || !['synthetic','pose_landmarker_lite'].includes(info.capabilities?.poseModel)) throw Error('Unsupported controller protocol/model');
    if (token !== generation) return;
    $('model').textContent = info.capabilities.poseModel === 'synthetic' ? 'Synthetic' : 'Lite / CPU';
    const stream = await fetch(`${base}/v1/stream`, {signal, credentials:'omit', cache:'no-store'});
    if (!stream.ok || !stream.body) throw Error(`Stream HTTP ${stream.status}`);
    clearTimeout(timeout); connectedOnce = true;
    status('Streaming', 'streaming');
    $('message').textContent = 'Step back until your body is in view. Left/right colors follow anatomical labels.';
    state.lastRecord = performance.now();
    const decoder = new NdjsonDecoder(record => {
      const now = performance.now();
      if (state.accept(record, now)) {
        // Animation frames pause in hidden tabs; prune on receipt as well as draw.
        times = times.filter(t => now-t < 1000).slice(-999);
        times.push(now); retry = 0;
      }
      if (record.type === 'heartbeat' && record.pipelineState === 'error') throw Error('Android pipeline reported an error');
    });
    const reader = stream.body.getReader();
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (token !== generation) return;
        if (done) { decoder.finish(); throw Error('Stream ended'); }
        decoder.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } catch (error) {
    if (token !== generation) return;
    attempt.abort(); state = new PoseState(); times = [];
    const explanation = `${error.message}. Check Android Start, the exact allowed origin (${location.origin}), LAN connectivity, and browser network permissions.`;
    if (!connectedOnce || retry >= 5) { stop(explanation + ' Press Connect to retry.'); return; }
    const delay = Math.min(1000 * 2 ** retry++, 8000);
    reconnecting = true; status('Reconnecting…', 'pending');
    $('message').textContent = `${explanation} Retrying in ${delay / 1000}s.`;
    retryTimer = setTimeout(() => connect(token), delay);
  } finally { clearTimeout(timeout); }
}
setInterval(() => {
  if (controller && !reconnecting && state.lastRecord !== null && performance.now() - state.lastRecord > 12000) controller.abort();
}, 500);
function draw(now) {
  const width = canvas.clientWidth, height = canvas.clientHeight, dpr = devicePixelRatio || 1;
  if (canvas.width !== Math.round(width*dpr) || canvas.height !== Math.round(height*dpr)) { canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr); }
  context.setTransform(dpr,0,0,dpr,0,0); context.clearRect(0,0,width,height);
  const record = state.current(now), points = record?.poses[0]?.landmarks;
  $('empty').hidden = !!points;
  const stale = state.received !== null && !record;
  $('presence').textContent = points ? 'Person detected' : stale ? 'Stale / cleared' : record ? 'No person' : 'Waiting';
  $('age').textContent = state.received === null ? '—' : `${Math.round(now-state.received)} ms ago`;
  $('sequence').textContent = state.seq || '—';
  $('latency').textContent = record ? `${record.resultTimeMs-record.frameReceivedTimeMs} ms` : '—';
  $('dimensions').textContent = record ? `${record.input.width} × ${record.input.height}` : '—';
  times = times.filter(t => now-t < 1000); $('rate').textContent = String(times.length);
  if (!points) {
    $('empty').querySelector('strong').textContent = stale ? 'Waiting for a fresh pose' : record ? 'No person detected' : 'Ready when you are';
    $('empty').querySelector('p').textContent = stale ? 'The previous skeleton has been cleared.' : record ? 'Step into view with your shoulders, hips, and feet visible.' : 'Connect the board, then step into the camera view.';
  } else {
    const scale = Math.min((width-48)/record.input.width,(height-48)/record.input.height);
    const w = record.input.width*scale, h = record.input.height*scale, ox=(width-w)/2, oy=(height-h)/2;
    const position = i => [ox+($('mirror').checked ? 1-points[i].x : points[i].x)*w, oy+points[i].y*h];
    const visible = i => (points[i].visibility ?? 1) >= .35;
    const color = i => left.has(i) ? '#bdfb74' : i === 0 ? '#f0f5ef' : '#7cceff';
    context.lineWidth=3; context.lineCap='round';
    for (const [a,b] of bones) if (visible(a)&&visible(b)) {
      context.strokeStyle=color(b); context.beginPath(); context.moveTo(...position(a)); context.lineTo(...position(b)); context.stroke();
    }
    points.forEach((_,i) => { if(visible(i)){context.fillStyle=color(i);context.beginPath();context.arc(...position(i),i===0?5:3.5,0,Math.PI*2);context.fill();} });
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
window.addEventListener('pagehide', () => stop());
