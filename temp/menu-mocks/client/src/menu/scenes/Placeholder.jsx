import { Hud, HUD_LEFT, HUD_TOP } from '../hud.jsx';
import { SceneCamera } from '../shared/hooks.js';
import { CloudField, SkyDome } from '../shared/Sky.jsx';
import { Logo } from '../ui/Logo.jsx';
import { UIButton } from '../ui/UIPlane.jsx';

// Temporary stand-in used while a scene is being built.
export default function Placeholder({ title = 'Coming soon' }) {
  return (
    <>
      <SceneCamera position={[0, 20, 120]} target={[0, 40, 0]} fov={50} />
      <SkyDome />
      <CloudField />
      <ambientLight intensity={1} />
      <Hud>
        <Logo position={[0, 150, 0]} tagline={title} />
        {['Play', 'Online', 'Options'].map((label, i) => (
          <UIButton
            key={label}
            label={label}
            icon={['play', 'globe', 'gear'][i]}
            position={[0, -10 - i * 84, 0]}
            appear={0.2 + i * 0.08}
            onClick={() => {}}
          />
        ))}
        <group position={[HUD_LEFT, HUD_TOP, 0]} />
      </Hud>
    </>
  );
}
