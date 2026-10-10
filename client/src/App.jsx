import { useEffect, useLayoutEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import QRCode from 'qrcode';
import Scene from './Scene.jsx';
import MainMenu from './menu/MainMenu.jsx';
import MenuDancers from './menu/MenuDancers.jsx';
import { loadSound, saveSound } from './menu/soundSettings.js';
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

// Pairing card for the phone remote: the QR opens the player's stats page, and the
// first player to scan it gets the remote.
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

export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [stats, setStats] = useState({ online: 0 });
  const [menuOpen, setMenuOpen] = useState(true);
  // { mode: 'random' } or { mode: 'select', song }; the player hooks in here.
  const [selection, setSelection] = useState(null);
  const [sound, setSound] = useState(loadSound);

  useEffect(() => { saveSound(sound); }, [sound]);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('stats', setStats);
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
        <MenuDancers visible={menuOpen} />
        <MainMenu
          visible={menuOpen}
          onStart={(mode, song) => { setSelection({ mode, song }); setMenuOpen(false); }}
          sound={sound}
          onSoundChange={setSound}
        />
      </Canvas>
      <div className="hud">
        <div>
          <span className={`status ${connected ? 'online' : ''}`} />
          {connected ? 'connected' : 'disconnected'}
        </div>
        <div>online: {stats.online}</div>
      </div>
      {menuOpen && <RemoteCard />}
    </div>
  );
}
