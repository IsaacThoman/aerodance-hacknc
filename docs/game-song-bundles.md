# Game song bundles and pose migration

The game now reads the directory bundle contract in
[song-dance-authoring-workflow.md](song-dance-authoring-workflow.md).
The first integration is a music/reference-character preview in Song Select.
Countdown, live character panels, calibrated audible timing, scoring, and results
are still pending. Preview follows the media element's current song time, pauses
when the tab is hidden, and stops at the playable endpoint. It does not use the
silent demo's loop or seam blend.

## Install an exported bundle

Unpack the runtime ZIP into `client/public/songs/`, retaining its `<songId>/`
folder with `song.json`, `choreography.json`, audio, optional cover, and
`checksums.json`. The folder name must match `songId`. No manual catalog update
is needed: Vite development and the production Express server generate
`songs/manifest.json` from exported folders on each catalog request. Reopen Song
Select to see changes. Invalid metadata, missing files, mismatched file sizes,
and invalid metadata checksums cause a folder to be skipped with a warning.
The loader still performs full runtime integrity/schema checks when selected.

Builds generate the same catalog in `dist/songs/manifest.json` for static hosting.
Rebuild/redeploy after changing the source songs directory. On a running Express
server, installing complete folders directly in `dist/songs/` requires no restart.
Exported metadata supplies title, artist, duration, player counts, revision,
difficulty, optional cover, and a SHA-256 pin for `song.json`. Re-exported songs
are discovered with their updated revision. Install the complete directory before
opening Song Select. The game does not extract ZIP files or publish editor
projects. The public catalog remains empty until an authored song is ready.

Catalog paths resolve relative to the catalog; media paths resolve relative to
`song.json`. Only safe relative file paths are accepted. The loader checks
schema/profile support, catalog identity and revision, song/choreography time
agreement, both tracks, calibration, sample quality, file lengths and SHA-256 for
all referenced runtime files. Requests include the selected bundle revision.
Downloads have per-file and total declared-size limits. Errors appear in Song
Select and allow retry; leaving the screen cancels the pending request.

One-player preview selects player ID 0 from the same choreography. Two-player
preview selects IDs 0 and 1. The shared finite sampler preserves absence and
refuses interpolation over gaps longer than the authored limit (at most 200 ms).
Authored exclusions clear score eligibility without changing the visual pose.
Coach reflection is visual only; stored anatomy and player IDs remain unchanged.
Audio uses a verified in-memory Blob, released when preview closes.

Code:

- `packages/pose/song.js`: catalog/song validation, bundle cross-checks, finite sampling.
- `client/src/songs/loadBundle.js`: bounded HTTP loading and file integrity.
- `client/src/game/SongPreview.jsx`: finite music and independent Frutiger actors.

## Migrated silent capture

The menu and `/dance/` asset now uses `aerodance.take`, schema version 1, with
`durationMs`, unmirrored `input`, and `samples: [{takeTimeMs, poses, quality,
legacyConfidence}]`. Pose entries match Android's `{playerId, landmarks}` with
33 `{x,y,z,visibility,presence}` landmarks. Capture clocks remain separate from
Android wire envelopes; no session/sequence/device timestamps are invented.

The old tuple's fourth component combined visibility/presence. Migration sets
both new fields to `null`, retains every combined value in `legacyConfidence`,
and makes those joints unscorable. Source/model/settings/report remain provenance,
including the limitation that the old smoothed capture cannot recover original
gaps or repairs. This silent take is a preview, not a published song.

Convert an older capture with:

```sh
node tools/pose/migrate-legacy.js old-dance.json new-take.json
```

The demo loader retains explicit legacy import compatibility. Its playback and
retargeting use object landmarks. The offline video tracker exports only the new
take structure, retains separate original confidence fields, omits absent players,
and flags interpolated/smoothed joints for review. Its diagnostics retain raw
samples separately. Runtime preview still loops, while game bundle sampling is finite.

## Checks

```sh
node --test client/tests/*.test.js temp/frutiger-character/tests/*.test.js
npm run build
node client/tests/ui-flow.browser.mjs # requires Playwright and Chromium
```

Tests cover migration, wire-payload compatibility, integrity failures, revision
pinning, unsafe paths, cancellation, missing-player/gap behavior, exclusions,
track-0 equivalence, independent skeletons, both browser preview modes, and finite
music playback. Browser fixtures are private synthetic assets; they do not populate
the public catalog. Real authored music and device timing still require validation.
