// Artwork is saved before minting, so a wallet never receives a trophy whose PNG is missing.
export const MAX_PNG_BYTES = 8 * 1024 * 1024;

export function validateTrophyPng(png) {
  if (!Buffer.isBuffer(png) || png.length < 33 || png.length > MAX_PNG_BYTES
      || !png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      || png.toString('ascii', 12, 16) !== 'IHDR'
      || png.readUInt32BE(16) !== 1080 || png.readUInt32BE(20) !== 1080) {
    throw new Error('Renderer did not return a 1080×1080 trophy PNG');
  }
  return png;
}

export async function ensureTrophyArt(db, render, battleId) {
  const { rows: [battle] } = await db.query(
    `SELECT b.id, b.created_at, s.score, s.pops, s.sync, s.flair,
            EXISTS (SELECT 1 FROM trophy_art WHERE battle_id = b.id) AS art_ready
       FROM battles b JOIN battle_seats s ON s.battle_id = b.id AND s.seat = b.winner_seat
      WHERE b.id = $1 AND b.trophy_status IS NOT NULL`,
    [battleId],
  );
  if (!battle) return false;
  if (battle.art_ready) return true;
  const png = validateTrophyPng(await render(battle));
  // Keep the first completed render, even if a worker retries after saving it.
  await db.query('INSERT INTO trophy_art (battle_id, png) VALUES ($1, $2) ON CONFLICT DO NOTHING', [battleId, png]);
  return true;
}
