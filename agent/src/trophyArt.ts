import { ensureTrophyArt, MAX_PNG_BYTES, type TrophySpec } from '../../packages/trophy-art/index.js';
import { pool } from './db.ts';

const rendererUrl = new URL(process.env.TROPHY_RENDERER_URL || 'http://renderer:4001');
if (rendererUrl.hostname === 'renderer' && process.env.SERVICE_NAME_RENDERER) {
  rendererUrl.hostname = process.env.SERVICE_NAME_RENDERER;
}

async function render(battle: TrophySpec): Promise<Buffer> {
  const response = await fetch(new URL('/render', rendererUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.INTERNAL_SECRET ? { 'x-internal-secret': process.env.INTERNAL_SECRET } : {}),
    },
    body: JSON.stringify(battle),
    signal: AbortSignal.timeout(310_000),
  });
  if (!response.ok) throw new Error(`Trophy renderer returned ${response.status}`);
  if (!response.headers.get('content-type')?.startsWith('image/png')) throw new Error('Trophy renderer returned non-PNG artwork');
  // Bound memory even if an upstream response is malformed.
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body!) {
    bytes += chunk.length;
    if (bytes > MAX_PNG_BYTES) throw new Error('Trophy render exceeds the PNG size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export const prepareTrophyArt = (battleId: string) => ensureTrophyArt(pool, render, battleId);
