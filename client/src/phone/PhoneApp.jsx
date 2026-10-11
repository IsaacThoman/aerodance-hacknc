import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import AeroWorld from '../aero/AeroWorld.jsx';
import { api, deviceToken, local, useBattle } from '../battle/api.js';
import { socket } from '../socket.js';
import { stickerLabel } from '../ui/stickers.js';
import PhoneUI from './PhoneUI.jsx';

/**
 * /join/<battleId>: what a phone opens from the display's QR code (and /join on its own,
 * the Home Screen app). Same aero world and pixelated canvas as the display, in portrait.
 * First-timers pick a name and optionally link an iPhone number; then the first two
 * phones take the dancer seats and everyone after is the crowd, who can hype a dancer.
 * /join?remote=<code> (the menu screen's QR) hands off to the Wii remote (/remote.html)
 * once the phone has a profile.
 */

// Render buffer width; the height follows the screen, so pixels stay square.
const BUFFER_W = 360;
// The 3D world is the battery hog: it renders this often, and the canvas only redraws
// otherwise when the UI changes (frameloop="demand", see ui/useCanvasUI.js).
const WORLD_FPS = 15;

function WorldTicker({ fps }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) invalidate(); }, 1000 / fps);
    return () => clearInterval(t);
  }, [invalidate, fps]);
  return null;
}

function PhoneResolution() {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  useLayoutEffect(() => {
    gl.setSize(BUFFER_W, Math.max(1, Math.round((BUFFER_W * size.height) / size.width)), false);
  }, [gl, size.width, size.height]);
  return null;
}

const ADJECTIVES = ['Bubbly', 'Glassy', 'Aqua', 'Sunny', 'Dewy', 'Glossy', 'Breezy', 'Crystal', 'Misty', 'Lagoon', 'Shimmer', 'Azure'];
const NOUNS = ['Koi', 'Dolphin', 'Orca', 'Jellyfish', 'Seahorse', 'Fern', 'Raindrop', 'Cloud', 'Bubble', 'Lily', 'Manta', 'Sprout'];
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

export default function PhoneApp() {
  const battleId = useMemo(() => location.pathname.match(/^\/join\/([a-z0-9]+)/)?.[1] ?? null, []);
  const remoteCode = useMemo(() => new URLSearchParams(location.search).get('remote')?.toUpperCase() || null, []);
  const suggested = useMemo(() => `${pick(ADJECTIVES)} ${pick(NOUNS)}`, []);
  const [me, setMe] = useState(null);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState(null); // { role: 'dancer' | 'spectator', seat }
  const [hyping, setHyping] = useState(false);
  const [toast, setToast] = useState(null); // { text, link? }
  const [showInstall, setShowInstall] = useState(isIOS && !standalone && !local.get('aerodance.installDismissed'));
  const battle = useBattle(battleId);
  const nameRef = useRef(null);
  const phoneRef = useRef(null);
  const inputs = useMemo(() => ({ name: nameRef, phone: phoneRef }), []);

  const say = useCallback((text, link) => setToast({ text, link, at: Date.now() }), []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.link ? 4500 : 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const refreshMe = useCallback(async () => {
    try {
      setMe(await api('GET', '/me'));
    } catch (err) {
      if (err.status === 401) {
        deviceToken.set(null);
        setMe(null);
      }
    }
  }, []);

  // Boot: a returning device skips the form.
  useEffect(() => {
    (async () => {
      if (deviceToken.get()) await refreshMe();
      setReady(true);
    })();
  }, [refreshMe]);

  // Pushed when the agent links iMessage, a wallet funds, or hype lands.
  useEffect(() => {
    // The agent may link iMessage or fund the wallet before we're in the room: refetch once in.
    const watch = () => { if (deviceToken.get()) socket.emit('me:watch', deviceToken.get(), refreshMe); };
    watch();
    socket.on('connect', watch);
    socket.on('me:changed', refreshMe);
    return () => {
      socket.off('connect', watch);
      socket.off('me:changed', refreshMe);
    };
  }, [me?.id, refreshMe]);

  useEffect(() => {
    if (me && remoteCode) location.replace(`/remote.html?code=${encodeURIComponent(remoteCode)}`);
  }, [me, remoteCode]);

  // Take a seat (or join the crowd) once we have a profile.
  useEffect(() => {
    if (!me || !battleId || role) return;
    api('POST', `/battles/${battleId}/join`).then(
      (r) => {
        setRole(r);
        if (r.role === 'dancer') navigator.vibrate?.(60);
      },
      (err) => say(err.status === 404 ? "That battle doesn't exist anymore" : err.message),
    );
  }, [me, battleId, role, say]);

  // Stats change when a battle finishes; every phone buzzes when it's decided (Android:
  // iOS Safari has no vibration API).
  const status = battle?.status;
  const lastStatus = useRef(status);
  useEffect(() => {
    if (status === 'finished') refreshMe();
    if (lastStatus.current === 'open' && status === 'finished') navigator.vibrate?.([120, 80, 120, 80, 320]);
    lastStatus.current = status;
  }, [status, refreshMe]);

  const submit = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const name = nameRef.current.value.trim() || suggested;
      const res = await api('POST', '/me', { name, phone: phoneRef.current.value.trim() });
      deviceToken.set(res.deviceToken);
      setMe(res.me);
      setEditing(false);
      document.activeElement?.blur();
    } catch (err) {
      say(err.message);
    } finally {
      setSaving(false);
    }
  }, [saving, suggested, say]);

  const edit = useCallback(() => {
    nameRef.current.value = me?.name ?? '';
    phoneRef.current.value = me?.phone ?? '';
    setEditing(true);
  }, [me]);

  // { seat } tips devnet SOL; a sticker mints that sticker NFT into the dancer's wallet.
  const hype = useCallback(async (seat, sticker) => {
    if (hyping) return;
    setHyping(true);
    navigator.vibrate?.(30);
    try {
      if (sticker) say(`Minting your ${stickerLabel(sticker)} sticker NFT…`);
      const r = await api('POST', `/battles/${battleId}/hype`, sticker ? { seat, sticker } : { seat });
      say(sticker ? 'Sticker NFT sent!' : '+0.005 SOL hype sent', r.explorer);
    } catch (err) {
      say(err.message);
    } finally {
      setHyping(false);
    }
  }, [hyping, battleId, say]);

  const onKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (e.target === nameRef.current) phoneRef.current.focus();
    else submit();
  };

  const showForm = ready && (!me || editing);

  return (
    <div className="canvas-frame phone">
      <Canvas dpr={1} flat frameloop="demand" camera={{ fov: 66, near: 0.3, far: 6500 }}>
        <PhoneResolution />
        <WorldTicker fps={WORLD_FPS} />
        <AeroWorld speed={0.7} quality="low" fps={WORLD_FPS} />
        <PhoneUI
          ready={ready}
          me={me}
          battleId={battleId}
          battle={battle}
          role={role}
          showForm={showForm}
          editing={editing && !!me}
          saving={saving}
          hyping={hyping}
          toast={toast}
          showInstall={showInstall}
          suggested={suggested}
          inputs={inputs}
          onSubmit={submit}
          onCancelEdit={() => setEditing(false)}
          onEdit={edit}
          onHype={hype}
          onDismissInstall={() => { local.set('aerodance.installDismissed', true); setShowInstall(false); }}
        />
      </Canvas>
      <input
        ref={nameRef}
        className="phone-input"
        aria-label="Your name"
        maxLength={24}
        autoComplete="nickname"
        enterKeyHint="next"
        onKeyDown={onKeyDown}
      />
      <input
        ref={phoneRef}
        className="phone-input"
        aria-label="iPhone number (optional)"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        enterKeyHint="go"
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
