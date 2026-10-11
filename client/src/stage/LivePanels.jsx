import { Suspense, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import Character from '../../../packages/character/Character.jsx';
import { DANCER_LOOKS } from '../../../packages/stages/shared/Dancers.jsx';
import { LIVE_PANEL, livePanelCenterX } from '../game/layout.js';

/*
 * The players' own characters during a song: one small glass dancer per player in the top
 * corners (player 1 left, player 2 right), copying their live pose. They ride along in
 * front of the stage camera, so they stay put while it drifts, and are mirrored like the
 * reference dancers so a player's raised right hand shows on the same side as the coach's.
 *
 * live: { playerCount, livePose(id, now) → { landmarks } | null, calibration(id) }
 */

// The character's height at scale 1 with its arms down, as it stands in a panel.
const HEIGHT = 3.4;
// In front of the camera: near enough to sit in front of any stage set.
const DISTANCE = 3;
const LOOKS = DANCER_LOOKS.map((look) => ({ ...look, opacity: 0.92 }));

function LivePlayer({ id, live, anchor }) {
  const poseRef = useRef(null);
  const [calibration, setCalibration] = useState(null);
  useFrame(() => {
    const c = live.calibration(id);
    if (c !== calibration) setCalibration(c);
    poseRef.current = live.livePose(id, performance.now());
  }, -1);
  return (
    <group ref={anchor}>
      {/* Mirrored like a dance coach, the same as the reference dancers. */}
      <group scale={[-1, 1, 1]}>
        {calibration && <Character poseRef={poseRef} calibration={calibration} appearance={LOOKS[id]} />}
      </group>
    </group>
  );
}

export default function LivePanels({ live }) {
  const root = useRef();
  const anchors = useMemo(() => [{ current: null }, { current: null }], []);
  useFrame(({ camera }) => {
    const g = root.current;
    if (!g || !camera.isPerspectiveCamera) return;
    // Close to the camera, so they shouldn't throw shadows across the stage.
    g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);
    const viewH = 2 * DISTANCE * Math.tan((camera.fov * Math.PI) / 360);
    const viewW = viewH * camera.aspect;
    const scale = (LIVE_PANEL.height * viewH) / HEIGHT;
    for (let id = 0; id < live.playerCount; id++) {
      const a = anchors[id].current;
      if (!a) continue;
      a.position.set((livePanelCenterX(id) - 0.5) * viewW, (0.5 - LIVE_PANEL.top - LIVE_PANEL.height) * viewH, -DISTANCE);
      a.scale.setScalar(scale);
    }
  }, 0.5);
  return (
    <group ref={root}>
      <Suspense fallback={null}>
        {Array.from({ length: live.playerCount }, (_, id) => <LivePlayer key={id} id={id} live={live} anchor={anchors[id]} />)}
      </Suspense>
    </group>
  );
}
