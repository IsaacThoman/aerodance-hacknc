import { Suspense, useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import Character from "./Character.jsx";

function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;
    room.dispose();
    pmrem.dispose();
    return () => {
      scene.environment = null;
      target.dispose();
    };
  }, [gl, scene]);
  return null;
}
function Orb({ position, scale = 1, color = "#defdff", ...props }) {
  return (
    <mesh position={position} scale={scale} {...props}>
      <sphereGeometry args={[1, 24, 16]} />
      <meshPhysicalMaterial
        color={color}
        roughness={0.1}
        metalness={0.25}
        clearcoat={1}
        transparent
        opacity={0.52}
        envMapIntensity={1.7}
      />
    </mesh>
  );
}
function Cloud({ position, scale = 1 }) {
  return (
    <group position={position} scale={scale}>
      {[
        [0, 0, 0, 1.1],
        [-1.1, -0.25, 0, 0.8],
        [1.2, -0.25, 0, 0.85],
        [0.4, 0.45, 0, 0.9],
      ].map(([x, y, z, s], i) => (
        <mesh key={i} position={[x, y, z]} scale={[s, s * 0.65, s * 0.65]}>
          <sphereGeometry args={[1, 16, 12]} />
          <meshStandardMaterial color="white" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}
function Island({ position, scale = 1 }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, -0.65, 0]} scale={[3.4, 0.9, 2.6]}>
        <sphereGeometry args={[1, 40, 20]} />
        <meshStandardMaterial color="#c7eff0" roughness={0.3} />
      </mesh>
      <mesh position={[0, -0.2, 0]} scale={[3.4, 0.55, 2.6]}>
        <sphereGeometry args={[1, 40, 20]} />
        <meshStandardMaterial color="#83ce43" roughness={0.6} />
      </mesh>
      <mesh position={[0, 1, 0]}>
        <cylinderGeometry args={[0.12, 0.2, 2, 12]} />
        <meshStandardMaterial color="#d7ede4" />
      </mesh>
      <mesh position={[0, 2.2, 0]} scale={[1.15, 1.4, 1.15]}>
        <sphereGeometry args={[1, 32, 24]} />
        <meshStandardMaterial color="#51ba44" roughness={0.35} />
      </mesh>
    </group>
  );
}
function World() {
  const bubbles = useRef();
  useFrame(({ clock }) => {
    if (bubbles.current) bubbles.current.rotation.y = clock.elapsedTime * 0.025;
  });
  return (
    <>
      <color attach="background" args={["#9adef3"]} />
      <fog attach="fog" args={["#b0e7f3", 22, 72]} />
      <hemisphereLight args={["#d9faff", "#489789", 1.3]} />
      <directionalLight
        castShadow
        position={[-6, 12, 8]}
        intensity={2.5}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-normalBias={0.03}
      />
      <pointLight
        position={[0, 1.3, 3]}
        color="#65f7ff"
        intensity={8}
        distance={9}
      />
      <Environment />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.8, 0]}>
        <planeGeometry args={[250, 250]} />
        <meshPhysicalMaterial
          color="#44c6dd"
          roughness={0.2}
          metalness={0.38}
          clearcoat={1}
        />
      </mesh>
      <mesh receiveShadow position={[0, -0.25, 0]}>
        <cylinderGeometry args={[8, 8.3, 0.45, 96]} />
        <meshStandardMaterial color="#e3f6ed" roughness={0.38} />
      </mesh>
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.018, 0]}
      >
        <ringGeometry args={[5.8, 7.85, 96]} />
        <meshStandardMaterial color="#83cd69" roughness={0.8} />
      </mesh>
      <mesh receiveShadow position={[0, 0.035, 0]}>
        <cylinderGeometry args={[4.6, 4.7, 0.12, 80]} />
        <meshPhysicalMaterial
          color="#e3fbff"
          metalness={0.3}
          roughness={0.2}
          clearcoat={1}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.101, 0]}>
        <ringGeometry args={[4.4, 4.45, 96]} />
        <meshBasicMaterial color="#38d7ed" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.102, 0]}>
        <ringGeometry args={[4.1, 4.12, 96]} />
        <meshBasicMaterial color="#b6e4e8" />
      </mesh>
      <group position={[0, 0, -5.3]}>
        <mesh position={[0, 2.5, 0]}>
          <torusGeometry args={[2.5, 0.14, 16, 80, Math.PI]} />
          <meshPhysicalMaterial
            color="#efffff"
            metalness={0.4}
            roughness={0.14}
          />
        </mesh>
        {[-2.5, 2.5].map((x) => (
          <mesh key={x} position={[x, 1.25, 0]}>
            <cylinderGeometry args={[0.14, 0.14, 2.5, 20]} />
            <meshPhysicalMaterial
              color="#efffff"
              metalness={0.4}
              roughness={0.14}
            />
          </mesh>
        ))}
        <mesh position={[0, 2.5, 0]}>
          <torusGeometry args={[2.3, 0.025, 10, 80, Math.PI]} />
          <meshBasicMaterial color="#7affdc" />
        </mesh>
      </group>
      <Island position={[-11, -0.4, -9]} scale={1.4} />
      <Island position={[12, -0.4, -16]} scale={2} />
      <Island position={[-18, -0.5, -26]} scale={2.3} />
      <Cloud position={[-10, 8, -17]} scale={2} />
      <Cloud position={[8, 9, -24]} scale={2.8} />
      <Cloud position={[0, 12, -35]} scale={3} />
      <group ref={bubbles}>
        {Array.from({ length: 18 }, (_, i) => (
          <Orb
            key={i}
            position={[
              Math.sin(i * 2.4) * (8 + i * 0.3),
              1.5 + (i % 5) * 1.25,
              Math.cos(i * 2.4) * (8 + i * 0.3),
            ]}
            scale={0.1 + (i % 4) * 0.12}
          />
        ))}
      </group>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 5, 0.1, -3]}>
          <mesh position={[0, 0.16, 0]}>
            <cylinderGeometry args={[0.65, 0.8, 0.3, 32]} />
            <meshStandardMaterial color="#e5fcfc" />
          </mesh>
          <mesh position={[0, 0.62, 0]} scale={[0.5, 0.5, 0.5]}>
            <sphereGeometry args={[1, 24, 16]} />
            <meshPhysicalMaterial
              color={s === 1 ? "#8fe65c" : "#7be8ee"}
              metalness={0.25}
              roughness={0.12}
              clearcoat={1}
            />
          </mesh>
        </group>
      ))}
    </>
  );
}
export default function Scene({ motion }) {
  const fixedTime = new URLSearchParams(window.location.search).get("t");
  const playback = useRef(
    fixedTime !== null && Number.isFinite(Number(fixedTime))
      ? Number(fixedTime)
      : 0,
  );
  const paused = useRef(
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const key = (event) => {
      if (event.code === "Space") {
        event.preventDefault();
        paused.current = !paused.current;
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const { camera } = useThree();
  useEffect(() => {
    camera.lookAt(0, 1.7, 0);
  }, [camera]);
  useFrame((_, delta) => {
    if (fixedTime === null && !paused.current)
      playback.current += Math.min(delta, 0.1);
  }, -1);
  return (
    <>
      <World />
      <Suspense fallback={null}>
        {[0, 1].map((person) => (
          <group key={person} position={[person === 0 ? -2 : 2, 0.11, 0]} scale={[-1, 1, 1]}>
            <Character
              motion={motion}
              person={person}
              playback={playback}
              appearance={{
                color: person === 0 ? "#078fff" : "#b86bff",
                gloss: 85,
                accessory: "None",
              }}
            />
          </group>
        ))}
      </Suspense>
    </>
  );
}
