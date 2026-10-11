import { reportResult, seatTokens } from './api.js';

/**
 * Stand-in for the real dance until it lands: Start runs a short timed "dance", then the
 * display reports random scores for every seat it holds a token for. One seated dancer,
 * picked at random, gets the clear top score; open seats report 0 so the battle settles
 * right away instead of waiting out the grace period.
 */
export const FAKE_DANCE_MS = 5000;

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

export async function fakeDance(battle) {
  const tokens = seatTokens.get(battle.id);
  const seated = battle.players.filter((p) => p.name && tokens[p.seat]).map((p) => p.seat);
  const winner = seated.length ? seated[randInt(0, seated.length - 1)] : null;

  const results = battle.players
    .filter((p) => tokens[p.seat])
    .map((p) => {
      if (!seated.includes(p.seat)) return { seat: p.seat, score: 0, pops: 0, sync: 0, flair: 0 };
      return {
        seat: p.seat,
        score: randInt(500, 850),
        pops: randInt(10, 60),
        sync: randInt(55, 98) / 100,
        flair: randInt(20, 100),
      };
    });
  const best = Math.max(0, ...results.map((r) => r.score));
  const top = results.find((r) => r.seat === winner);
  if (top) top.score = best + randInt(1, 120);

  await Promise.all(results.map(({ seat, ...result }) => reportResult(battle.id, tokens[seat], result)));
}
