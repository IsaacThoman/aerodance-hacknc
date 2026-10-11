import { lazy } from 'react';
import { STAGE_METAS } from './catalog.js';

export { DEFAULT_STAGE, STAGE_LIST, resolveStage, stageName } from './catalog.js';

// Each stage component loads lazily, so only the visible stage is fetched.
const LOADERS = {
  sanctuary: () => import('./sanctuary/SanctuaryStage.jsx'),
  reef: () => import('./reef/ReefStage.jsx'),
  openreef: () => import('./openreef/OpenReefStage.jsx'),
  falls: () => import('./falls/FallsStage.jsx'),
  club: () => import('./club/ClubStage.jsx'),
  beach: () => import('./beach/BeachStage.jsx'),
};

// Dance stages in browse order: { meta (see catalog.js), Component }.
export const STAGES = STAGE_METAS.map((meta) => ({ meta, Component: lazy(LOADERS[meta.id]) }));

// Starts fetching a stage before it's shown (the browser keeps the module for lazy()).
export const preloadStage = (id) => LOADERS[id]?.().catch(() => {});
