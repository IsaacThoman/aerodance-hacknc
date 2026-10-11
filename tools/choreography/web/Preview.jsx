import { Component, Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { PMREMGenerator } from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import Character from "../../../packages/character/Character.jsx";
import {
  CONNECTIONS,
  JOINT_NAMES,
} from "../../../packages/pose/choreography.js";
function Environment() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    camera.lookAt(0, 1.5, 0);
    const gen = new PMREMGenerator(gl),
      room = new RoomEnvironment(),
      target = gen.fromScene(room, 0.04);
    scene.environment = target.texture;
    room.dispose();
    gen.dispose();
    return () => {
      scene.environment = null;
      target.dispose();
    };
  }, [gl, scene, camera]);
  return null;
}
function Actor({ pose, calibration, id, mirrored, live }) {
  const invalidate = useThree((state) => state.invalidate);
  const poseRef = useRef(pose);
  poseRef.current = pose;
  useEffect(() => invalidate(), [pose, calibration, invalidate]);
  const appearance = useMemo(
    () => ({
      color: id === 0 ? "#32c6ea" : "#b79bff",
      gloss: 85,
      accessory: "None",
    }),
    [id],
  );
  return (
    <group position={[(id === 0 ? -1.8 : 1.8) * (mirrored ? -1 : 1), 0, 0]} scale={[mirrored ? -1 : 1, 1, 1]}>
      <Character
        poseRef={poseRef}
        calibration={calibration}
        appearance={appearance}
        live={live}
      />
    </group>
  );
}
class Boundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="preview-fallback">
        3D preview unavailable on this device. Use the skeleton view to edit
        poses.
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function Preview({
  snapshot,
  raw,
  tracks,
  mode,
  playerId,
  joint,
  selectedJoints = [joint],
  onSelect,
  onEdit,
  readOnly = false,
  mirrored = false,
  emptyMessage = "No pose at this time",
  emptyHint = "Import a take or connect Android to start capturing.",
}) {
  const svg = useRef(null);
  // Reflect the whole camera frame. The same involution converts pointer
  // coordinates back to source coordinates when editing the flipped preview.
  const viewX = (x) => mirrored ? 1 - x : x;
  function drag(event, index, pose) {
    event.preventDefault();
    event.stopPropagation();
    onSelect(pose.playerId, index);
    if (readOnly) return;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event, index, pose) {
    if (readOnly) return;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const r = svg.current.getBoundingClientRect();
    const x = viewX((event.clientX - r.left) / r.width),
      y = (event.clientY - r.top) / r.height;
    onEdit(pose.playerId, index, { ...pose.landmarks[index], x, y }, false);
  }
  function end(event, index, pose) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (readOnly) return;
    const r = svg.current.getBoundingClientRect();
    onEdit(
      pose.playerId,
      index,
      {
        ...pose.landmarks[index],
        x: viewX((event.clientX - r.left) / r.width),
        y: (event.clientY - r.top) / r.height,
      },
      true,
    );
  }
  return (
    <div className={`preview preview-${mode}`}>
      {mode !== "skeleton" && (
        <Boundary>
          <Canvas
            frameloop="demand"
            camera={{ position: [0, 3.1, 10.5], fov: 36 }}
            dpr={[1, 1.5]}
            gl={{ antialias: true }}
          >
            <color attach="background" args={["#183841"]} />
            <hemisphereLight
              intensity={1.8}
              args={["#dbffff", "#1d615d", 1.8]}
            />
            <directionalLight position={[-3, 6, 5]} intensity={3} />
            <Environment />
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]}>
              <circleGeometry args={[5.5, 80]} />
              <meshPhysicalMaterial
                color="#4b8088"
                metalness={0.4}
                roughness={0.24}
              />
            </mesh>
            <gridHelper
              args={[12, 20, "#397885", "#27545f"]}
              position={[0, -0.07, 0]}
            />
            <Suspense fallback={null}>
              {tracks.map((t) => (
                <Actor
                  key={t.playerId}
                  id={t.playerId}
                  calibration={t.calibration}
                  mirrored={mirrored}
                  live={readOnly}
                  pose={snapshot.poses.find((p) => p.playerId === t.playerId)}
                />
              ))}
            </Suspense>
          </Canvas>
        </Boundary>
      )}
      {mode !== "characters" && (
        <svg
          ref={svg}
          className="skeleton"
          viewBox="0 0 1000 750"
          preserveAspectRatio="none"
          aria-label={readOnly ? "Live pose skeleton" : "Editable pose skeleton"}
        >
          <defs>
            <pattern
              id="grid"
              width="50"
              height="50"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 50 0 L 0 0 0 50"
                fill="none"
                stroke="#c2f6ef"
                strokeOpacity=".06"
              />
            </pattern>
          </defs>
          <rect width="1000" height="750" fill="url(#grid)" />
          <line
            x1="500"
            x2="500"
            y1="0"
            y2="750"
            stroke="#8ec8ce"
            strokeOpacity=".25"
            strokeDasharray="6 10"
          />
          {(raw?.poses || []).map((p) => (
            <g key={p.playerId} className="original-pose">
              {CONNECTIONS.map(([a, b]) => (
                <line
                  key={`${a}-${b}`}
                  x1={viewX(p.landmarks[a].x) * 1000}
                  y1={p.landmarks[a].y * 750}
                  x2={viewX(p.landmarks[b].x) * 1000}
                  y2={p.landmarks[b].y * 750}
                  stroke="#f4ffff"
                  strokeOpacity=".18"
                  strokeWidth="2"
                />
              ))}
            </g>
          ))}
          {snapshot.poses.map((p) => (
            <g
              key={p.playerId}
              style={{ color: p.playerId === 0 ? "#51daf0" : "#be9cff" }}
            >
              {CONNECTIONS.map(([a, b]) => (
                <line
                  key={`${a}-${b}`}
                  x1={viewX(p.landmarks[a].x) * 1000}
                  y1={p.landmarks[a].y * 750}
                  x2={viewX(p.landmarks[b].x) * 1000}
                  y2={p.landmarks[b].y * 750}
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              ))}
              {p.landmarks.map((v, i) => (
                <circle
                  key={i}
                  cx={viewX(v.x) * 1000}
                  cy={v.y * 750}
                  r={playerId === p.playerId && selectedJoints.includes(i) ? 10 : 6}
                  fill={
                    playerId === p.playerId && selectedJoints.includes(i)
                      ? "#fff"
                      : "currentColor"
                  }
                  stroke="#173941"
                  strokeWidth="2"
                  className={readOnly ? "" : "joint"}
                  onPointerDown={(e) => drag(e, i, p)}
                  onPointerMove={(e) => move(e, i, p)}
                  onPointerUp={(e) => end(e, i, p)}
                >
                  <title>
                    {JOINT_NAMES[i]} · Player {p.playerId + 1}
                  </title>
                </circle>
              ))}
            </g>
          ))}
        </svg>
      )}
      <div className="stage-label" style={{ flexDirection: mirrored ? "row-reverse" : "row" }}>
        <span>
          <i className="dot cyan" />
          PLAYER 1
        </span>
        <span>
          <i className="dot violet" />
          PLAYER 2
        </span>
      </div>
      {!snapshot.poses.length && (
        <div className="empty-stage">
          {emptyMessage}
          <span>{emptyHint}</span>
        </div>
      )}
    </div>
  );
}
