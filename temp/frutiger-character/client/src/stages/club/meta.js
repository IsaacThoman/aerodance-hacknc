// Name card, dancer placement and post settings, loaded before the stage itself.
const meta = {
  id: 'club',
  name: 'Club Aquarium',
  subtitle: 'Glass dance club',
  accent: ['#7ff3ff', '#7a2bd8'],
  dancers: { position: [0, 0, 0], rotationY: 0, spacing: 4 },
  post: {
    bloomStrength: 0.55,
    bloomRadius: 0.5,
    bloomThreshold: 1.0,
    exposure: 0.92,
    vignette: 0.3,
    saturation: 1.12,
    tint: [1, 1, 1],
  },
};

export default meta;
