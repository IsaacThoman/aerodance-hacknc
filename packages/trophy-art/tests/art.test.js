import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ensureTrophyArt, validateTrophyPng } from '../index.js';

const png = await readFile(new URL('../../../temp/trophy-renders/renders/3wegvq.png', import.meta.url));
const battle = { id: '3wegvq', created_at: new Date('2026-10-11T18:00:00Z'), score: 824, pops: 55, sync: 0.76, flair: 91 };

function database(row = battle) {
  let saved;
  return {
    get saved() { return saved; },
    async query(sql, values) {
      assert.equal(values[0], battle.id);
      if (sql.startsWith('SELECT')) return { rows: row ? [{ ...row, art_ready: !!saved }] : [] };
      assert.match(sql, /^INSERT INTO trophy_art/);
      saved = values[1];
      return { rows: [] };
    },
  };
}

test('persists the winning result before minting, and reuses art after a mint retry', async () => {
  const db = database();
  let renders = 0;
  const render = async (spec) => {
    renders++;
    assert.equal(spec.score, 824);
    assert.equal(spec.created_at.toISOString(), battle.created_at.toISOString());
    return png;
  };
  assert.equal(await ensureTrophyArt(db, render, battle.id), true);
  assert.deepEqual(db.saved, png);
  assert.equal(await ensureTrophyArt(db, render, battle.id), true);
  assert.equal(renders, 1);
});

test('render failure or malformed art leaves the battle unprepared; a retry can succeed', async () => {
  const db = database();
  await assert.rejects(ensureTrophyArt(db, async () => { throw new Error('renderer offline'); }, battle.id), /offline/);
  await assert.rejects(ensureTrophyArt(db, async () => Buffer.from('<html>error</html>'), battle.id), /PNG/);
  assert.equal(db.saved, undefined);
  assert.equal(await ensureTrophyArt(db, async () => png, battle.id), true);
});

test('ties and battles without a trophy do not render', async () => {
  assert.equal(await ensureTrophyArt(database(null), () => { throw new Error('should not render'); }, battle.id), false);
});

test('rejects a PNG with the wrong dimensions', () => {
  const invalid = Buffer.from(png);
  invalid.writeUInt32BE(512, 16);
  assert.throws(() => validateTrophyPng(invalid), /1080/);
});
