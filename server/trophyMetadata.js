import { trophyTraits } from './trophyArt.js';

export function formatTrophyMetadata(b, baseUrl) {
  const t = trophyTraits(b);
  // Old assets retain the SVG until their backfill completes; new mints always have art ready.
  const image = `${baseUrl}/nft/${b.id}.${b.art_ready ? 'png' : 'svg'}`;
  return {
    name: `aerodance trophy #${b.id}`,
    symbol: 'AERO',
    description: `Won dance battle ${b.id} on aerodance 🫧 Frutiger Aero dance battles, scored live.`,
    image,
    external_url: baseUrl,
    attributes: [
      { trait_type: 'stage', value: t.stage.name },
      { trait_type: 'glass', value: t.glass },
      { trait_type: 'finish', value: t.finish },
      { trait_type: 'cup', value: t.cup },
      { trait_type: 'aura', value: t.aura ? 'Golden' : 'None' },
      { trait_type: 'battle', value: b.id },
      { trait_type: 'dancers', value: b.dancers },
      { trait_type: 'score', value: b.score ?? 0 },
      { trait_type: 'pops', value: b.pops ?? 0 },
      { trait_type: 'sync', value: b.sync ?? 0 },
      { trait_type: 'flair', value: b.flair ?? 0 },
      { trait_type: 'hype', value: b.hype },
      { trait_type: 'date', value: b.created_at.toISOString().slice(0, 10) },
    ],
    properties: { category: 'image', files: [{ uri: image, type: b.art_ready ? 'image/png' : 'image/svg+xml' }] },
  };
}
