// Name card, dancer placement and post settings, loaded before the stage itself.
const meta = {
  id: 'beach',
  name: 'Sugarsand Sunset',
  subtitle: 'Tropical island beach',
  accent: ['#ffd27a', '#ff8a2a'],
  // On the sand just up from the waterline (sandHeight is -0.50 / -0.55 under the two dancers).
  dancers: { position: [0, -0.53, 1], rotationY: 0, spacing: 4 },
  post: {
    bloomStrength: 0.3,
    bloomRadius: 0.42,
    bloomThreshold: 2.2,
    exposure: 0.85,
    vignette: 0.22,
    saturation: 1.15,
    tint: [1.02, 1, 0.97],
  },
};

export default meta;
