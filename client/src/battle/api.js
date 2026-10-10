import { useEffect, useState } from 'react';
import { socket } from '../socket.js';

const store = (area) => ({
  get(key) {
    try { return JSON.parse(area.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try {
      if (value == null) area.removeItem(key);
      else area.setItem(key, JSON.stringify(value));
    } catch { /* storage unavailable */ }
  },
});
export const session = store(window.sessionStorage);
export const local = store(window.localStorage);

// The phone's profile credential (see /api/me).
export const deviceToken = {
  get: () => local.get('aerodance.device'),
  set: (token) => local.set('aerodance.device', token),
};

export async function api(method, path, body) {
  const device = deviceToken.get();
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(device ? { 'x-device-token': device } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'something went wrong'), { status: res.status });
  return data;
}

// Seat tokens let this display report results. They are never handed out again, so keep
// them for the tab's lifetime: { [seat]: token }.
export const seatTokens = {
  get: (battleId) => session.get(`aerodance.battle.${battleId}`) ?? {},
  add(battleId, seats) {
    session.set(`aerodance.battle.${battleId}`, { ...seatTokens.get(battleId), ...seats });
  },
};

export async function createBattle(players = 2) {
  const battle = await api('POST', '/battles', { players });
  seatTokens.add(battle.id, Object.fromEntries(battle.players.map((p) => [p.seat, p.token])));
  return battle.id;
}

export const reportResult = (battleId, token, result) =>
  api('POST', `/battles/${battleId}/result`, { playerToken: token, ...result });

export const joinUrl = (battleId) => `${location.origin}/join/${battleId}`;

// Live public state of a battle: null while loading, { missing: true } if it doesn't exist.
export function useBattle(id) {
  const [battle, setBattle] = useState(null);
  useEffect(() => {
    setBattle(null);
    if (!id) return undefined;
    const onBattle = (b) => { if (b.id === id) setBattle(b); };
    const watch = () => socket.emit('battle:watch', id);
    socket.on('battle', onBattle);
    socket.on('connect', watch);
    watch();
    // Receipts are pushed when the agent confirms them; this covers a missed push.
    const poll = setInterval(() => {
      if (!document.hidden) api('GET', `/battles/${id}`).then(onBattle, () => {});
    }, 15000);
    return () => {
      clearInterval(poll);
      socket.off('battle', onBattle);
      socket.off('connect', watch);
      socket.emit('battle:unwatch', id);
    };
  }, [id]);
  return battle;
}

// Calls fn({ seat, from }) the moment someone starts hyping a dancer in this battle.
export function useHype(id, fn) {
  useEffect(() => {
    if (!id) return undefined;
    const onHype = (h) => { if (h.battleId === id) fn(h); };
    socket.on('hype', onHype);
    return () => socket.off('hype', onHype);
  }, [id, fn]);
}
