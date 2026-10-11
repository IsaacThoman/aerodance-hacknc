import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import QRCode from 'qrcode';
import Scene from './Scene.jsx';
import MainMenu from './menu/MainMenu.jsx';
import MenuDancers from './menu/MenuDancers.jsx';
import { loadSound, saveSound } from './menu/soundSettings.js';
import BattleScreen from './battle/BattleScreen.jsx';
import DebugPanel from './battle/DebugPanel.jsx';
import { api, createBattle, seatTokens, useBattle } from './battle/api.js';
import PhoneApp from './phone/PhoneApp.jsx';
import { socket } from './socket.js';
import { useRemoteStatus } from './remote/remoteLink.js';

function FixedRenderResolution() {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);

  useLayoutEffect(() => {
    // Fiber tracks the displayed size for pointer events; keep the buffer at 4:3.
    gl.setSize(640, 480, false);
  }, [gl, size.width, size.height]);

  return null;
}

// Pairing card for the phone remote: the QR opens /join (which makes a profile if needed)
// and hands off to /remote.html; the first player to scan it gets the remote.
function RemoteCard() {
  const { joinUrl: url, holder, error } = useRemoteStatus();
  const [qr, setQr] = useState(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: '#0c2f52', light: '#ffffff' } })
      .then((data) => { if (!cancelled) setQr(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [url]);

  if (!url) return error ? <div className="remote-card"><div className="remote-sub">{error}</div></div> : null;
  return (
    <div className="remote-card">
      {qr && <img src={qr} alt="QR code to use your phone as the remote" />}
      <div>
        <div className="remote-title">🎮 {holder ? 'Remote connected' : 'Grab the remote'}</div>
        <div className="remote-sub">{holder ? `${holder} is pointing` : 'First to scan controls the menu'}</div>
      </div>
    </div>
  );
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

  useEffect(() => { saveSound(sound); }, [sound]);

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
          onPlay={() => setPlaying(true)}
          onBack={() => (playing ? setPlaying(false) : openBattle(null))}
          onRematch={newBattle}
          onMenu={() => openBattle(null)}
        />
        <DebugPanel battle={battleId ? battle : null} />
      </Canvas>
      <div className="hud">
        <div>
          <span className={`status ${connected ? 'online' : ''}`} />
          {connected ? 'connected' : 'disconnected'}
        </div>
        <div>online: {stats.online}</div>
      </div>
      {menuOpen && !battleId && <RemoteCard />}
    </div>
  );
}
