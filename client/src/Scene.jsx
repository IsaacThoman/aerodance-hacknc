import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { socket } from './socket.js';

export default function Scene() {
  const mesh = useRef();
  const boost = useRef(0);
  const [hovered, setHovered] = useState(false);

  // Spins from any connected client kick the shape for everyone.
  useEffect(() => {
    const onSpin = () => {
      boost.current = Math.min(boost.current + 6, 30);
    };
    socket.on('spin', onSpin);
    return () => socket.off('spin', onSpin);
  }, []);

  useFrame((_, delta) => {
    boost.current *= Math.exp(-1.5 * delta);
    const speed = 0.4 + boost.current;
    mesh.current.rotation.x += speed * 0.6 * delta;
    mesh.current.rotation.y += speed * delta;
  });

  return (
    <>
      <color attach="background" args={['#202633']} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[3, 4, 5]} intensity={2} />
      <mesh
        ref={mesh}
        onClick={() => socket.emit('spin')}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        scale={hovered ? 1.1 : 1}
      >
        <torusKnotGeometry args={[1, 0.32, 160, 24]} />
        <meshStandardMaterial color={hovered ? '#7c9cff' : '#5b6cff'} roughness={0.3} metalness={0.4} />
      </mesh>
    </>
  );
}
