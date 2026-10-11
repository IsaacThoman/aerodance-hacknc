import { useEffect, useLayoutEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import Scene from './Scene.jsx';
import MainMenu from './menu/MainMenu.jsx';
import MenuDancers from './menu/MenuDancers.jsx';
import { loadSound, saveSound } from './menu/soundSettings.js';
import { socket } from './socket.js';
import { AndroidPoseSource } from './pose/AndroidPoseSource.js';
import ConnectionPanel from './menu/ConnectionPanel.jsx';
import SongSelect from './game/SongSelect.jsx';

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
  const [menuScreen, setMenuScreen] = useState('main');
  const [screen, setScreen] = useState('menu');
  const [inputMode, setInputMode] = useState('android');
  const [playerCount, setPlayerCount] = useState(1);
  const [source] = useState(() => new AndroidPoseSource());
  const [connection, setConnection] = useState(source.view);
  const menuOpen = screen === 'menu';
  const selectedConnection = inputMode === 'webcam'
    ? { status: 'dummy', snapshot: null, message: 'Webcam dummy selected. Continue through the menus to test the flow.' }
    : connection;
  const changeInputMode = (mode) => {
    source.disconnect();
    setInputMode(mode);
    source.setPlayerCount(playerCount).catch(() => {});
  };

  useEffect(() => {
    const unsubscribe = source.subscribe(setConnection);
    const disconnect = () => source.disconnect();
    window.addEventListener('pagehide', disconnect);
    return () => { window.removeEventListener('pagehide', disconnect); unsubscribe(); source.disconnect(); };
  }, [source]);

  const choosePlayers = (count) => {
    if (inputMode === 'android' && source.view.configuring) return;
    setPlayerCount(count);
    setScreen('songs');
    if (inputMode === 'android') source.setPlayerCount(count).catch(() => {});
  };
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
          initialScreen={menuScreen}
          onStart={choosePlayers}
          sound={sound}
          onSoundChange={setSound}
        />
      </Canvas>
      {screen === 'songs' && <SongSelect playerCount={playerCount} connection={selectedConnection} onBack={() => { setMenuScreen('players'); setScreen('menu'); }} />}
      <ConnectionPanel source={source} connection={selectedConnection} inputMode={inputMode} onInputModeChange={changeInputMode} />
      <div className="hud">
        <div>
          <span className={`status ${connected ? 'online' : ''}`} />
          {connected ? 'Server online' : 'Server offline'}
        </div>
        <div>online: {stats.online}</div>
      </div>
    </div>
  );
}
