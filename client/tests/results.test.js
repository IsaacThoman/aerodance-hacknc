import assert from 'node:assert/strict';
import test from 'node:test';
import { battleResultsShow } from '../src/game/results.js';

const battle = (scores, winnerSeat) => ({
  id: 'round1', status: 'finished', winnerSeat,
  players: scores.map((score, seat) => ({ seat, name: seat === 0 ? 'Alice' : null,
    result: score === null ? null : { score, pops: 3, sync: 0.9, flair: 4 },
  })),
});
const detail = { score: 100, grade: 'A', accuracy: 0.9, coverage: 1, maxCombo: 4,
  judgements: { perfect: 3, good: 1, ok: 0, miss: 0, lost: 0 } };

test('finished links show the public winner and scores without inventing song grades', () => {
  const show = battleResultsShow(battle([100, 200], 1), null, 20);
  assert.equal(show.winner, 1);
  assert.equal(show.start, 20.3);
  assert.deepEqual(show.results.map((r) => r.score), [100, 200]);
  assert.deepEqual(show.results.map((r) => r.name), ['Alice', 'Player 2']);
  assert.equal(show.results[0].grade, undefined);
  assert.equal(show.results[0].judgements, undefined);
  assert.equal(show.results[0].summary.pops, 3);
});

test('reopened battle keeps matching detailed results and rejects stale grades', () => {
  const show = battleResultsShow(battle([100, 200], 1), { results: [detail, detail] }, 0);
  assert.equal(show.results[0].grade, 'A');
  assert.deepEqual(show.results[0].judgements, detail.judgements);
  assert.equal(show.results[1].score, 200);
  assert.equal(show.results[1].grade, undefined);
  assert.equal(show.winner, 1, 'saved stats never override the settled winner');
});

test('ties and missing scores stay ties without restoring a missing seat from storage', () => {
  const show = battleResultsShow(battle([0, null], null), { results: [{ ...detail, score: 0 }, { ...detail, score: 0 }] }, 0);
  assert.equal(show.winner, null);
  assert.equal(show.results[1].score, 0);
  assert.equal(show.results[1].summary, null);
  assert.equal(show.results[1].grade, undefined);
});

test('server seat IDs map to the displayed winner and larger battles keep every score', () => {
  const b = battle([10, 20, 30, 40, 50, 60, 70, 80], 7);
  const show = battleResultsShow(b, null, 0);
  assert.equal(show.winner, 7);
  assert.equal(show.results.length, 8);
  assert.equal(show.results[7].name, 'Player 8');
  assert.equal(show.results[7].score, 80);
  const reordered = battleResultsShow({ ...b, players: [...b.players].reverse() }, null, 0);
  assert.equal(reordered.winner, 0);
  assert.equal(reordered.results[0].score, 80);
});
