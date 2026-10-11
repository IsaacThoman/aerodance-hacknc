import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { validateCatalog, validateSong } from '../packages/pose/song.js';

// Discover exported directories without needing an author-maintained manifest.
// Full audio/choreography validation remains in the game's bundle loader.
export async function discoverSongs(directory, { warn = console.warn } = {}) {
  let folders;
  try { folders = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return { version: 1, songs: [] };
    throw error;
  }
  const songs = [];
  for (const folder of folders.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!folder.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(folder.name)) continue;
    try {
      const root = await realpath(path.join(directory, folder.name));
      async function file(name) {
        const location = await realpath(path.join(root, name));
        if (!location.startsWith(root + path.sep)) throw Error('Asset escapes song directory');
        const info = await stat(location);
        if (!info.isFile()) throw Error(`Missing file: ${name}`);
        return { location, bytes: info.size };
      }
      async function json(name) {
        const info = await file(name);
        if (info.bytes > 1024 * 1024) throw Error(`Metadata exceeds size limit: ${name}`);
        return readFile(info.location);
      }
      const bytes = await json('song.json');
      const song = validateSong(JSON.parse(bytes));
      if (song.songId !== folder.name) throw Error('Folder name must match songId');
      const checksums = JSON.parse(await json('checksums.json'));
      if (checksums.schema !== 'aerodance.checksums' || checksums.schemaVersion !== 1 || !Array.isArray(checksums.files)) throw Error('Invalid checksums manifest');
      const required = ['song.json', song.audio.path, song.choreography.path, ...(song.cover ? [song.cover.path] : [])];
      if (new Set(required).size !== required.length) throw Error('Conflicting media paths');
      for (const name of required) {
        const matches = checksums.files.filter(entry => entry.path === name);
        const info = await file(name);
        if (matches.length !== 1 || !Number.isSafeInteger(matches[0].bytes) || matches[0].bytes !== info.bytes || info.bytes > 128 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(matches[0].sha256)) throw Error(`Missing or incomplete asset: ${name}`);
      }
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (checksums.files.find(entry => entry.path === 'song.json').sha256 !== hash) throw Error('Song metadata checksum mismatch');
      songs.push({
        id: song.songId, title: song.title, artist: song.artist,
        durationMs: song.durationMs, supportedPlayerCounts: song.supportedPlayerCounts,
        bundleRevision: song.bundleRevision, bundle: `${song.songId}/song.json`, sha256: hash,
        ...(song.difficulty ? { difficulty: song.difficulty } : {}),
        ...(song.stage ? { stage: song.stage } : {}),
        ...(song.cover ? { cover: `${song.songId}/${song.cover.path}` } : {}),
      });
    } catch (error) { warn(`Skipping song ${folder.name}: ${error.message}`); }
  }
  return validateCatalog({ version: 1, songs });
}

export function songCatalogMiddleware(directory) {
  return async (_req, res, next) => {
    try {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(await discoverSongs(directory)));
    } catch (error) { next(error); }
  };
}
