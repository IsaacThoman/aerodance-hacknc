import LagoonScene, { meta as lagoon } from './lagoon/LagoonScene.jsx';
import GalaxyScene, { meta as galaxy } from './galaxy/GalaxyScene.jsx';
import EcoCityScene, { meta as ecocity } from './ecocity/EcoCityScene.jsx';
import AuroraScene, { meta as aurora } from './aurora/AuroraScene.jsx';
import MeadowScene, { meta as meadow } from './meadow/MeadowScene.jsx';
import SkyStageScene, { meta as skystage } from './skystage/SkyStageScene.jsx';

// Menu variations in browse order. Each scene module exports its own `meta`
// ({ id, name, tone: 'light' | 'dark', post: overrides for post.jsx }).
export const SCENES = [
  { Component: LagoonScene, meta: lagoon },
  { Component: GalaxyScene, meta: galaxy },
  { Component: EcoCityScene, meta: ecocity },
  { Component: AuroraScene, meta: aurora },
  { Component: MeadowScene, meta: meadow },
  { Component: SkyStageScene, meta: skystage },
];
