import { useSyncExternalStore } from 'react';
import { io } from 'socket.io-client';

/**
 * Display side of the phone remote. Connects to the agent (which serves the players'
 * stats pages), hosts a pairing code and shows a QR to /join?remote=<code>. The first
 * player to scan it holds the remote; their input is re-emitted on `remote`, with the
 * cursor kept in menu design units (1600x900):
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
export const useRemoteStatus = () =>
  useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => status);

const pos = { x: W / 2, y: H / 2 };

async function connect() {
  const { agentUrl } = await fetch('/api/config').then((r) => r.json()).catch(() => ({ agentUrl: 'http://localhost:4000' }));
  const agent = io(agentUrl);

  // Reconnecting asks for the same code back so the QR on screen stays valid.
  agent.on('connect', () => {
    agent.emit('display:host', status.code, ({ code, joinUrl }) => setStatus({ code, joinUrl, error: null }));
  });
  agent.on('connect_error', () => setStatus({ error: 'Remote unavailable (agent unreachable)' }));
  agent.on('disconnect', () => setStatus({ holder: null }));

  agent.on('remote:joined', ({ name }) => {
    setStatus({ holder: name });
    emit('move', { ...pos });
  });
  agent.on('remote:left', () => {
    setStatus({ holder: null });
    emit('leave');
  });
  agent.on('remote:move', ({ dx, dy }) => {
    pos.x = Math.min(W, Math.max(0, pos.x + dx));
    pos.y = Math.min(H, Math.max(0, pos.y + dy));
    emit('move', { ...pos });
  });
  agent.on('remote:button', ({ button, pressed }) => {
    if (button === 'a') emit(pressed ? 'down' : 'up', { ...pos });
    else if (button === 'b' && pressed) emit('back');
    else if (button === 'center' && pressed) {
      pos.x = W / 2;
      pos.y = H / 2;
      emit('move', { ...pos });
    }
  });
}

connect();
