import { lazy } from 'react';
import sanctuary from './sanctuary/meta.js';
import reef from './reef/meta.js';
import falls from './falls/meta.js';
import club from './club/meta.js';
import beach from './beach/meta.js';

// Dance stages in browse order. Each stage folder has a small `meta.js`:
// { id, name, subtitle, accent: [light, dark] orb colors for the name card,
//   dancers: props for shared/Dancers.jsx (floor position, rotationY, spacing, scale),
//   post: overrides for shared/post.jsx }
// and a lazily loaded stage component, so only the visible stage is fetched.
export const STAGES = [
  { meta: sanctuary, Component: lazy(() => import('./sanctuary/SanctuaryStage.jsx')) },
  { meta: reef, Component: lazy(() => import('./reef/ReefStage.jsx')) },
  { meta: falls, Component: lazy(() => import('./falls/FallsStage.jsx')) },
  { meta: club, Component: lazy(() => import('./club/ClubStage.jsx')) },
  { meta: beach, Component: lazy(() => import('./beach/BeachStage.jsx')) },
];
