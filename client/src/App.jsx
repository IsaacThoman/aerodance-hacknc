import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import Scene from './Scene.jsx';
import { socket } from './socket.js';

export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [stats, setStats] = useState({ online: 0, spinsLastMinute: 0 });

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
    <>
      <Canvas camera={{ position: [0, 0, 5], fov: 50 }}>
        <Scene />
      </Canvas>
      <div className="hud">
        <div>
          <span className={`status ${connected ? 'online' : ''}`} />
          {connected ? 'connected' : 'disconnected'}
        </div>
        <div>online: {stats.online}</div>
        <div>spins (last minute): {stats.spinsLastMinute}</div>
        <div>click the shape to spin it</div>
      </div>
    </>
  );
}
