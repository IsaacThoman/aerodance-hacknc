import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import Scene from './Scene.jsx';
import MainMenu from './menu/MainMenu.jsx';
import MenuDancers from './menu/MenuDancers.jsx';
import { loadSound, saveSound } from './menu/soundSettings.js';
import { useLoopingMusic } from './audio/loopingMusic.js';
import { applySound } from './audio/mixer.js';
import BattleScreen from './battle/BattleScreen.jsx';
import DebugPanel from './battle/DebugPanel.jsx';
import { FAKE_DANCE_MS, fakeDance } from './battle/fakeDance.js';
import { api, createBattle, seatTokens, startBattle, useBattle } from './battle/api.js';
import PhoneApp from './phone/PhoneApp.jsx';
import { socket } from './socket.js';
import RemoteDock from './remote/RemoteDock.jsx';

function FixedRenderResolution() {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);

  useLayoutEffect(() => {
    // Fiber tracks the displayed size for pointer events; keep the buffer at 4:3.
    gl.setSize(640, 480, false);
  }, [gl, size.width, size.height]);

  return null;
}

// /battle/<id> is a battle on this display; ?p=<token> (play links the bot texts) is a seat
// this display may report for. The token moves to sessionStorage and out of the URL.
const battleRoute = () => location.pathname.match(/^\/battle\/([a-z0-9]+)\/?$/)?.[1] ?? null;

async function claimPlayLink(id) {
  const token = new URLSearchParams(location.search).get('p');
  if (!token) return;
  history.replaceState(null, '', `/battle/${id}`);
  try {
    const { seat } = await api('POST', `/battles/${id}/seat`, { playerToken: token });
    seatTokens.add(id, { [seat]: token });
  } catch (err) {
    console.warn('play link not accepted:', err.message);
  }
}

export default function App() {
  // Phones scanning a battle's QR code get the portrait phone view.
  return /^\/join(\/|$)/.test(location.pathname) ? <PhoneApp /> : <DisplayApp />;
}

function DisplayApp() {
  const [connected, setConnected] = useState(socket.connected);
  const [stats, setStats] = useState({ online: 0 });
  const [menuOpen, setMenuOpen] = useState(true);
  // { mode: 'random' } or { mode: 'select', song }; the player hooks in here.
  const [selection, setSelection] = useState(null);
  const [sound, setSound] = useState(loadSound);
  const [battleId, setBattleId] = useState(battleRoute);
  // Start pressed in the lobby; the dance itself hooks in here and reports with seatTokens.
  const [playing, setPlaying] = useState(false);
  const battle = useBattle(battleId);
  const battleRef = useRef(battle);
  battleRef.current = battle;

  const openBattle = useCallback((id) => {
    history.pushState(null, '', id ? `/battle/${id}` : '/');
    setBattleId(id);
    setPlaying(false);
  }, []);
  const newBattle = useCallback(() => {
    createBattle(2).then(openBattle, (err) => console.error('could not start a battle:', err.message));
  }, [openBattle]);

  useEffect(() => {
    if (battleId) claimPlayLink(battleId);
    const onPop = () => { setBattleId(battleRoute()); setPlaying(false); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A link to a battle that doesn't exist lands on the menu.
  useEffect(() => {
    if (battle?.missing) {
      history.replaceState(null, '', '/');
      setBattleId(null);
    }
  }, [battle]);

  // No real dance yet: Start runs a timed fake one that reports random scores (fakeDance.js).
  useEffect(() => {
    if (!playing || !battleId) return undefined;
    const t = setTimeout(() => {
      const b = battleRef.current;
      if (b?.id === battleId && b.status === 'open') {
        fakeDance(b).catch((err) => console.error('fake dance could not report:', err.message));
      }
    }, FAKE_DANCE_MS);
    return () => clearTimeout(t);
  }, [playing, battleId]);

  useEffect(() => { saveSound(sound); applySound(sound); }, [sound]);
  // "Pod Lounge" loops under the aero background as the menu music (Settings: Master,
  // Music, Menu music, Mute all).
  useLoopingMusic('/music/pod-lounge.mp3', 'menuMusic');

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('stats', setStats);
    // The socket may have connected before these listeners were added.
    setConnected(socket.connected);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('stats', setStats);
    };
  }, []);

  return (
    <div className="canvas-frame">
      <Canvas dpr={1} flat camera={{ fov: 66, near: 0.3, far: 6500 }}>
        <FixedRenderResolution />
        <Scene />
        <MenuDancers visible={menuOpen || !!battleId} />
        <MainMenu
          visible={menuOpen && !battleId}
          onStart={(mode, song) => { setSelection({ mode, song }); setMenuOpen(false); }}
          onBattle={newBattle}
          sound={sound}
          onSoundChange={setSound}
        />
        <BattleScreen
          visible={!!battleId}
          battle={battle}
          playing={playing}
          onPlay={() => {
            setPlaying(true);
            startBattle(battleId).catch((err) => console.warn('could not mark the battle started:', err.message));
          }}
          onBack={() => (playing ? setPlaying(false) : openBattle(null))}
          onRematch={newBattle}
          onMenu={() => openBattle(null)}
        />
        <DebugPanel battle={battleId ? battle : null} />
        <RemoteDock />
      </Canvas>
      <div className="hud">
        <div>
          <span className={`status ${connected ? 'online' : ''}`} />
          {connected ? 'connected' : 'disconnected'}
        </div>
        <div>online: {stats.online}</div>
      </div>
    </div>
  );
}
