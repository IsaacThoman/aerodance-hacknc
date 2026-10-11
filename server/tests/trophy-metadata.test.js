import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTrophyMetadata } from '../trophyMetadata.js';

const battle = { id: '3wegvq', created_at: new Date('2026-10-11T18:00:00Z'), score: 824, pops: 55, sync: 0.76, flair: 91, dancers: 2, hype: 3 };

test('rendered trophies advertise their persistent PNG and preserve their traits', () => {
  const meta = formatTrophyMetadata({ ...battle, art_ready: true }, 'https://aerodance.tech');
  assert.equal(meta.image, 'https://aerodance.tech/nft/3wegvq.png');
  assert.deepEqual(meta.properties.files, [{ uri: meta.image, type: 'image/png' }]);
  assert.deepEqual(meta.attributes, formatTrophyMetadata(battle, 'https://aerodance.tech').attributes);
});

test('existing NFTs retain working art until their render backfill completes', () => {
  const meta = formatTrophyMetadata(battle, 'https://aerodance.tech');
  assert.equal(meta.image, 'https://aerodance.tech/nft/3wegvq.svg');
  assert.equal(meta.properties.files[0].type, 'image/svg+xml');
});
