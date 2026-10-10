import { useEffect, useLayoutEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import Scene from './Scene.jsx';
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
      <div className="canvas-frame">
        <Canvas dpr={1} camera={{ position: [0, 0, 5], fov: 50, aspect: 4 / 3 }}>
          <FixedRenderResolution />
          <Scene />
        </Canvas>
      </div>
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
