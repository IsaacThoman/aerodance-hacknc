import { useEffect, useMemo } from 'react';
import { advance, Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PCFShadowMap } from 'three';
import Sticker, { STICKER_IDS } from './Sticker.jsx';

/*
 * Renders one hype sticker in-engine on a transparent background. The frame is drawn at
 * 1024 px and scaled down to SIZE px for clean edges.
 *
 * URL: ?sticker=bubble|koi|rainbow. window.__sticker.render() draws the frame and returns it
 * as a PNG data URL; scripts/render.mjs drives it and writes client/public/stickers/<id>.png.
 */

// The canvas fills .frame, which index.html sizes to RENDER px.
const SIZE = 512;

function stickerFromUrl() {
  const id = new URLSearchParams(window.location.search).get('sticker');
  return STICKER_IDS.includes(id) ? id : STICKER_IDS[0];
}

function Lights() {
  const target = useMemo(() => new THREE.Object3D(), []);
  return (
    <>
      <primitive object={target} />
      <ambientLight intensity={0.2} />
      {/* Key light from the top left, casting the subject's shadow onto the badge. */}
      <directionalLight
        position={[-2.2, 3.2, 5]}
        intensity={1.8}
        color="#fffaf2"
        target={target}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-radius={8}
        shadow-bias={-0.0004}
        shadow-camera-left={-1.6}
        shadow-camera-right={1.6}
        shadow-camera-top={1.6}
        shadow-camera-bottom={-1.6}
        shadow-camera-near={1}
        shadow-camera-far={12}
      />
      <directionalLight position={[2.5, -1.5, 3]} intensity={0.45} color="#bfefff" />
    </>
  );
}

function Capture({ id }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    window.__sticker = {
      id,
      async render() {
        await document.fonts.ready;
        advance(performance.now());
        advance(performance.now());
        const out = document.createElement('canvas');
        out.width = out.height = SIZE;
        const g = out.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(gl.domElement, 0, 0, SIZE, SIZE);
        return out.toDataURL('image/png');
      },
    };
  }, [gl, id]);
  return null;
}

export default function App() {
  const id = useMemo(stickerFromUrl, []);
  return (
    <div className="frame">
      <Canvas
        frameloop="never"
        dpr={1}
        shadows={{ type: PCFShadowMap }}
        camera={{ position: [0, 0, 6.6], fov: 22 }}
        gl={{ antialias: true, alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <Lights />
        <Sticker id={id} />
        <Capture id={id} />
      </Canvas>
    </div>
  );
}
