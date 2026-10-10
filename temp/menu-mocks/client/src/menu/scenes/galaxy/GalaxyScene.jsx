import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Hud } from '../../hud.jsx';
import { createGalaxyState } from './layout.js';
import { GalaxyCamera } from './Camera.jsx';
import { DustClouds, FlareStars, NebulaSky, StarField } from './Space.jsx';
import LaunchStar from './LaunchStar.jsx';
import Meadow from './Meadow.jsx';
import Crystal from './Crystal.jsx';
import Candy from './Candy.jsx';
import Observatory from './Observatory.jsx';
import GasGiant from './GasGiant.jsx';
import { CollectBursts, Comet, FocusSparkles, Hoops, StarBits, StarPaths } from './Effects.jsx';
import { GalaxyMenu } from './Menu.jsx';
import { Bokeh, Lumas } from './Lumas.jsx';

export const meta = {
  id: 'galaxy',
  name: 'Starlight Galaxy',
  tone: 'dark',
  post: {
    bloomStrength: 0.55,
    bloomRadius: 0.5,
    bloomThreshold: 0.86,
    exposure: 1.0,
    toneMapping: THREE.NeutralToneMapping,
    vignette: 0.32,
    saturation: 1.12,
    tint: [1, 0.98, 1.03],
  },
};

export default function GalaxyScene() {
  const state = useMemo(createGalaxyState, []);
  useEffect(() => {
    if (import.meta.env.DEV) window.__galaxy = state;
    return () => {
      if (window.__galaxy === state) delete window.__galaxy;
    };
  }, [state]);
  return (
    <>
      <color attach="background" args={['#06041a']} />
      <GalaxyCamera state={state} />
      <NebulaSky />
      <StarField />
      <FlareStars />
      <DustClouds />
      <LaunchStar state={state} />
      <Meadow state={state} />
      <Crystal state={state} />
      <Candy state={state} />
      <Observatory state={state} />
      <GasGiant state={state} />
      <StarPaths state={state} />
      <Hoops state={state} />
      <FocusSparkles state={state} />
      <StarBits state={state} />
      <CollectBursts state={state} />
      <Comet />
      <Lumas />
      <Bokeh />
      <Hud>
        <GalaxyMenu state={state} />
      </Hud>
    </>
  );
}
