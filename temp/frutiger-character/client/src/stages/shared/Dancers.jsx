import { Suspense } from 'react';
import Character from '../../Character.jsx';

export const DANCER_LOOKS = [
  { color: '#078fff', gloss: 85, accessory: 'None' },
  { color: '#b86bff', gloss: 85, accessory: 'None' },
];

// The rig's feet rest about this far above the group origin's floor.
const FOOT_CLEARANCE = 0.015;

/**
 * The two captured glass dancers, standing on a stage's dance floor.
 *   position: [x, y, z] of the floor surface between them
 *   rotationY: turn the pair (they face +z by default)
 *   spacing: distance between the two dancers
 *   scale: uniform scale (1 = ~2.6 units tall)
 */
export default function Dancers({ motion, playback, position = [0, 0, 0], rotationY = 0, spacing = 4, scale = 1, looks = DANCER_LOOKS }) {
  return (
    <group position={[position[0], position[1] + FOOT_CLEARANCE * scale, position[2]]} rotation={[0, rotationY, 0]} scale={scale}>
      <Suspense fallback={null}>
        {[0, 1].map((person) => (
          <group key={person} position={[(person === 0 ? -1 : 1) * (spacing / 2), 0, 0]}>
            <Character motion={motion} person={person} playback={playback} appearance={looks[person]} />
          </group>
        ))}
      </Suspense>
    </group>
  );
}
