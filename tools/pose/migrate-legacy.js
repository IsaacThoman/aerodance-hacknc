import { readFile, writeFile } from 'node:fs/promises';
import { migrateLegacyMotion } from '../../packages/pose/legacy.js';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: node tools/pose/migrate-legacy.js input.json output.json');
const take = migrateLegacyMotion(JSON.parse(await readFile(input, 'utf8')));
await writeFile(output, JSON.stringify(take) + '\n');
console.log(`Migrated ${take.samples.length} samples to ${output}`);
