import reef from '../reef/meta.js';

// Name card, dancer placement and post settings, loaded before the stage itself.
// The Coral Dome stage without its dome, so it keeps the reef's look.
const meta = {
  id: 'openreef',
  name: 'Open Reef',
  subtitle: 'On the sand of a sunlit reef',
  accent: ['#8fe4ff', '#1a7fd0'],
  // On the sand around where the dome stood (SAND_Y in reef/Reef.jsx).
  dancers: { position: [0, -0.45, 0], rotationY: 0, spacing: 4 },
  post: reef.post,
};

export default meta;
