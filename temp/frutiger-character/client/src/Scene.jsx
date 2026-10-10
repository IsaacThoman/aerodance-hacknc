import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import Character from "./Character.jsx";
import { movementInput } from "./movement.js";

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
        <cylinderGeometry args={[2.15, 2.22, 0.12, 80]} />
        <meshPhysicalMaterial
          color="#e3fbff"
          metalness={0.3}
          roughness={0.2}
          clearcoat={1}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.101, 0]}>
        <ringGeometry args={[1.99, 2.045, 96]} />
        <meshBasicMaterial color="#38d7ed" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.102, 0]}>
        <ringGeometry args={[1.71, 1.72, 96]} />
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
const PICKUPS = [
  [3, 1, 1],
  [-3, 1, -1],
  [1, 1, -4],
  [-4, 1, 3],
  [4, 1, -3],
  [-1, 1, 5],
];
function Pickup({ position, index }) {
  const ref = useRef();
  useFrame(({ clock }) => {
    if (ref.current)
      ref.current.position.y =
        position[1] + Math.sin(clock.elapsedTime * 2 + index) * 0.15;
  });
  return (
    <group ref={ref} position={position}>
      <Orb scale={0.27} color="#f5ffb7" />
      <mesh rotation={[0, 0, Math.PI / 4]} scale={0.1}>
        <octahedronGeometry />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  );
}
export default function Scene({
  appearance,
  animation,
  playing,
  controls,
  collected,
  onCollect,
  resetKey,
  onMotion,
}) {
  const actor = useRef();
  const keys = useRef(new Set());
  const moving = useRef(false);
  const heading = useRef(0.22);
  const { camera, gl, size } = useThree();
  const [walk, setWalk] = useState(false);
  const drag = useRef(null);
  const orbit = useRef(0.22);
  const position = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const down = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName)) return;
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)
      )
        e.preventDefault();
      keys.current.add(e.key.toLowerCase());
    };
    const up = (e) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  useEffect(() => {
    const canvas = gl.domElement;
    const down = (e) => {
      drag.current = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (drag.current !== null && !playing) {
        orbit.current += (e.clientX - drag.current) * 0.008;
        drag.current = e.clientX;
      }
    };
    const up = () => {
      drag.current = null;
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, [gl, playing]);
  useEffect(() => {
    position.set(0, 0.11, 0);
    keys.current.clear();
  }, [playing, resetKey, position]);
  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const k = keys.current;
    let x = 0,
      z = 0;
    if (playing) {
      [x, z] = movementInput(k, controls.current);
      if (x || z) {
        position.x += x * dt * 2.8;
        position.z += z * dt * 2.8;
        const radius = Math.hypot(position.x, position.z);
        if (radius > 7.1) {
          position.x *= 7.1 / radius;
          position.z *= 7.1 / radius;
        }
        heading.current = Math.atan2(x, z);
      }
      PICKUPS.forEach((p, i) => {
        if (
          !collected.includes(i) &&
          Math.hypot(position.x - p[0], position.z - p[2]) < 0.65
        )
          onCollect(i);
      });
    }
    const isMoving = !!(x || z);
    if (isMoving !== moving.current) {
      moving.current = isMoving;
      setWalk(isMoving);
      onMotion(isMoving);
    }
    if (actor.current) {
      actor.current.position.copy(position);
      const target = playing ? heading.current : orbit.current;
      actor.current.rotation.y +=
        Math.atan2(
          Math.sin(target - actor.current.rotation.y),
          Math.cos(target - actor.current.rotation.y),
        ) *
        (1 - Math.exp(-dt * 10));
    }
    const portrait = size.width / size.height < 0.9;
    const desired = playing
      ? new THREE.Vector3(
          position.x * 0.6,
          portrait ? 8.5 : 6.4,
          position.z * 0.6 + (portrait ? 14.5 : 10),
        )
      : new THREE.Vector3(0, 3.8, portrait ? 10.7 : 10.2);
    camera.position.lerp(desired, 1 - Math.exp(-dt * 4));
    camera.lookAt(
      playing ? position.x * 0.6 : 0,
      playing ? 0.5 : portrait ? 1.05 : 1.5,
      playing ? position.z * 0.6 : 0,
    );
  });
  return (
    <>
      <World />
      <group ref={actor} position={[0, 0.11, 0]}>
        <Suspense fallback={null}>
          <Character
            appearance={appearance}
            animation={walk ? "Walk" : animation}
          />
        </Suspense>
      </group>
      {playing &&
        PICKUPS.map(
          (p, i) =>
            !collected.includes(i) && <Pickup key={i} position={p} index={i} />,
        )}
    </>
  );
}
