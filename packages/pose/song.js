import { finite, validateChoreography, sampleSnapshot } from './choreography.js';
const require = (condition, message) => { if (!condition) throw Error(message); };
const text = v => typeof v === 'string' && v.trim().length > 0;
const strings = v => Array.isArray(v) && v.every(text);
const counts = v => Array.isArray(v) && v.length === 2 && v[0] === 1 && v[1] === 2;
export function validateBundlePath(path) {
  require(typeof path === 'string' && /^[a-zA-Z0-9_./-]+$/.test(path) &&
    path.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid bundle asset path');
  return path;
}
export function validateCatalog(data) {
  require(data?.version === 1 && Array.isArray(data.songs), 'Song catalog format is unsupported.');
  const ids = new Set();
  for (const song of data.songs) {
    require(/^[a-z0-9][a-z0-9-]{0,79}$/.test(song.id) && !ids.has(song.id), 'Invalid or duplicate catalog song ID');
    ids.add(song.id);
    require(text(song.title) && text(song.artist) && finite(song.durationMs) && song.durationMs > 0 &&
      Number.isSafeInteger(song.bundleRevision) && song.bundleRevision > 0 && counts(song.supportedPlayerCounts), 'Invalid catalog song');
    validateBundlePath(song.bundle);
    if (song.cover !== undefined) validateBundlePath(song.cover);
    if (song.sha256 !== undefined) require(/^[a-f0-9]{64}$/.test(song.sha256), 'Invalid catalog song hash');
  }
  return data;
}
export function validateSong(song) {
  require(song?.schema === 'aerodance.song' && song.schemaVersion === 1, 'Unsupported song schema');
  require(/^[a-z0-9][a-z0-9-]{0,79}$/.test(song.songId) && Number.isSafeInteger(song.bundleRevision) && song.bundleRevision > 0, 'Invalid song identity');
  require(text(song.title) && text(song.artist) && strings(song.songwriters) && strings(song.choreographers), 'Invalid song credits');
  require(finite(song.durationMs) && song.durationMs > 0 && finite(song.playableStartMs) && finite(song.playableEndMs) &&
    0 <= song.playableStartMs && song.playableStartMs < song.playableEndMs && song.playableEndMs <= song.durationMs, 'Invalid playable interval');
  require(counts(song.supportedPlayerCounts), 'Song must support both player modes');
  require(song.coachMode === 'mirror-player' && song.rigProfile === 'frutiger-seven-bone-v1', 'Unsupported coach or rig profile');
  require(text(song.audio?.mimeType) && song.choreography?.schemaVersion === 1, 'Invalid media references');
  validateBundlePath(song.audio.path); validateBundlePath(song.choreography.path);
  if (song.cover) { validateBundlePath(song.cover.path); require(text(song.cover.mimeType), 'Invalid cover type'); }
  for (const kind of ['audio','choreography']) require(text(song.rights?.[kind]?.license) && typeof song.rights[kind].attribution === 'string', 'Missing rights metadata');
  require([song.createdAt, song.publishedAt].every(v => typeof v === 'string' && Number.isFinite(Date.parse(v))), 'Invalid song timestamps');
  require(text(song.build?.compilerVersion) && Number.isSafeInteger(song.build.projectRevision) && song.build.projectRevision >= 0, 'Missing build identity');
  return song;
}
export function validateSongChoreography(song, choreography) {
  validateSong(song); validateChoreography(choreography);
  for (const key of ['songId','durationMs','playableStartMs','playableEndMs']) require(song[key] === choreography[key], `Song/choreography ${key} mismatch`);
  const c = choreography.coordinates;
  require(c.ordering === 'mediapipe-pose-33' && c.xAxis === 'right' && c.yAxis === 'down' &&
    c.zAxis === 'away-from-camera' && c.depthUnit === 'relative-image-width', 'Unsupported coordinate axes');
  const s = choreography.sampling;
  require(finite(s?.targetRateHz) && s.targetRateHz > 0 && finite(s.maxInterpolationGapMs) &&
    s.maxInterpolationGapMs > 0 && s.maxInterpolationGapMs <= 200 && finite(s.confidenceThreshold) &&
    s.confidenceThreshold >= 0 && s.confidenceThreshold <= 1, 'Invalid sampling policy');
  for (const track of choreography.tracks) {
    require(track.calibration.profileVersion === 1 && text(track.label) && Array.isArray(track.unscorableIntervals), 'Invalid track metadata');
    for (const interval of track.unscorableIntervals) require(finite(interval.startMs) && finite(interval.endMs) &&
      interval.startMs >= song.playableStartMs && interval.startMs < interval.endMs && interval.endMs <= song.playableEndMs && text(interval.reason), 'Invalid score exclusion');
  }
  return choreography;
}
export function sampleSong(bundle, songTimeMs, playerCount) {
  require([1,2].includes(playerCount), 'Invalid player count');
  const { song, choreography } = bundle;
  if (!finite(songTimeMs) || songTimeMs < song.playableStartMs || songTimeMs >= song.playableEndMs) return { poses:[], quality:[] };
  const snapshot = sampleSnapshot(choreography.samples, songTimeMs, 'songTimeMs', choreography.sampling.maxInterpolationGapMs);
  snapshot.poses = snapshot.poses.filter(p => p.playerId < playerCount);
  snapshot.quality = snapshot.quality.filter(q => q.playerId < playerCount);
  for (const q of snapshot.quality) {
    if (choreography.tracks[q.playerId].unscorableIntervals.some(i => songTimeMs >= i.startMs && songTimeMs < i.endMs)) q.scoreEligible.fill(false);
  }
  return snapshot;
}
