import { useEffect, useLayoutEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import Scene from './Scene.jsx';
import MainMenu from './menu/MainMenu.jsx';
import { loadSound, saveSound } from './menu/soundSettings.js';
import { socket } from './socket.js';

function FixedRenderResolution() {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);

  useLayoutEffect(() => {
    // Fiber tracks the displayed size for pointer events; keep the buffer at 4:3.
    gl.setSize(640, 480, false);
  }, [gl, size.width, size.height]);

  return null;
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
    </div>
  );
}
