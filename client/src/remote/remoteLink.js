import { useSyncExternalStore } from 'react';
import { socket } from '../socket.js';

/**
 * Display side of the phone remote. Hosts a pairing code on the app's socket and shows
 * a QR to /join?remote=<code>. The first player to scan it holds the remote; their input
 * is re-emitted on `remote`, with the cursor kept in menu design units (1600x900):
 *
 *   move  { x, y }   cursor moved     down / up   A button      back   B button
 *   leave            the remote was released or disconnected
 */
const W = 1600;
const H = 900;

export const remote = new EventTarget();
const emit = (type, detail) => remote.dispatchEvent(new CustomEvent(type, { detail }));

let status = { code: null, joinUrl: null, holder: null, error: null };
const listeners = new Set();
const setStatus = (patch) => {
  status = { ...status, ...patch };
  listeners.forEach((fn) => fn());
};
// Only the display hosts a code: it starts on the first useRemoteStatus, not on import.
let started = false;
const subscribe = (fn) => {
  if (!started) { started = true; connect(); }
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const useRemoteStatus = () => useSyncExternalStore(subscribe, () => status);

const pos = { x: W / 2, y: H / 2 };

function connect() {
  // Reconnecting asks for the same code back so the QR on screen stays valid.
  const host = () => socket.emit('display:host', status.code, ({ code }) =>
    setStatus({ code, joinUrl: `${location.origin}/join?remote=${code}`, error: null }));
  if (socket.connected) host();
  socket.on('connect', host);
  socket.on('connect_error', () => setStatus({ error: 'Remote unavailable (server unreachable)' }));
  socket.on('disconnect', () => setStatus({ holder: null }));

  socket.on('remote:joined', ({ name }) => {
    setStatus({ holder: name });
    emit('move', { ...pos });
  });
  socket.on('remote:left', () => {
    setStatus({ holder: null });
    emit('leave');
  });
  socket.on('remote:move', ({ dx, dy }) => {
    pos.x = Math.min(W, Math.max(0, pos.x + dx));
    pos.y = Math.min(H, Math.max(0, pos.y + dy));
    emit('move', { ...pos });
  });
  socket.on('remote:button', ({ button, pressed }) => {
    if (button === 'a') emit(pressed ? 'down' : 'up', { ...pos });
    else if (button === 'b' && pressed) emit('back');
    else if (button === 'center' && pressed) {
      pos.x = W / 2;
      pos.y = H / 2;
      emit('move', { ...pos });
    }
  });
}
