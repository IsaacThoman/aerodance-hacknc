import { useLayoutEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import MenuApp from './menu/MenuApp.jsx';
import { RENDER_HEIGHT, RENDER_WIDTH } from './menu/post.jsx';

function FixedRenderResolution() {
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);

  useLayoutEffect(() => {
    // Fiber tracks the displayed size for pointer events; keep the buffer at 640x480.
    gl.setSize(RENDER_WIDTH, RENDER_HEIGHT, false);
  }, [gl, size.width, size.height]);

  return null;
}

export default function App() {
  return (
    <div className="canvas-frame">
      {/* Scenes project at 16:9 into the 4:3 buffer, which the frame stretches back out. */}
      <Canvas dpr={1} gl={{ antialias: false, powerPreference: 'high-performance' }} camera={{ fov: 50, aspect: 16 / 9 }}>
        <FixedRenderResolution />
        <MenuApp />
      </Canvas>
    </div>
  );
}
