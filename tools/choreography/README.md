# Dance Studio

Local song/choreography editor for Aerodance. Projects live on disk; reference
poses use the Android client's landmark object format. No game database is needed.
See the [format/workflow reference](../../docs/song-dance-authoring-workflow.md).

## Run

From the repository root:

```sh
docker compose -f tools/choreography/compose.yaml up --build -d
```

Open **http://localhost:8082**. Projects, audio, immutable takes, recorder batches,
and revision snapshots persist in the `studio-data` named volume. Stop with
`docker compose -f tools/choreography/compose.yaml down`; omit `--volumes` to retain
your work. Use **Backup** to download a portable project archive, and import that
ZIP to restore a separate project. The container runs as the `node` user.

Podman users can build/run directly when a Compose provider is unavailable:

```sh
podman build -f tools/choreography/Dockerfile -t aerodance-studio .
podman volume create aerodance-studio-data
podman run -d --name aerodance-studio -p 127.0.0.1:8082:3000 \
  -v aerodance-studio-data:/data:U aerodance-studio
```

For local Node development:

```sh
npm ci
npm run studio:dev
```

Open http://localhost:5175. The API listens on 8082 and writes ignored
`studio-data/`. Production local serving uses `npm run studio:build`, then
`STUDIO_PORT=8082 npm run studio:start`.

## Create a routine

1. Create a project, import music, and enter **Song details**. Duration is measured
   by the browser audio decoder. Set the real artist, authors/choreographers, and
   distribution licenses or permissions.
2. Import a pose JSON/Android NDJSON, or connect Android and **Record new take**.
   For Android set Allowed Origin to the exact origin printed in the capture panel.
   Close other stream viewers and keep Android active. Connecting starts the
   camera and pose tracker; the panel shows initialization for up to 90 seconds
   (the board can take about 35 seconds). Recording stays disabled until the first
   pose arrives; wait for both players to be detected before recording. Cancel
   connection stops the wait. Disconnect saves battery, so reconnect initializes
   again. Music starts after a three-second lead-in.
3. Scrub the waveform, step samples, or play at 0.25/0.5/1 speed. Switch between
   Skeleton, Frutiger, and Both. The two preview characters have independent rigs.
   Choose **Live view** to preview Android poses without recording or importing
   music. Connect Android in the capture panel first, then step into view. Live
   poses are read-only in all three display modes; music can play for rehearsal.
   Choose **Playback** to return to the timeline and edit the routine. Recording
   automatically uses the live preview.
4. Select a player/joint and drag it in Skeleton/Both, or type XYZ. Confidence is
   read-only. A joint keyframe blends over 150 ms on either side. Undo/redo preserves
   the source take. Select a timeline range to swap tracks, mirror, smooth, repair
   a short gap, approve references, or exclude reference scoring.
5. Adjust take offset in seconds for audio alignment. Selecting a take does not
   automatically overwrite current clips. **Replace selected phrase** uses the
   selected take's full source range on the selected player, splitting existing
   clips around the destination. It reports the need to review speed/joins.
6. Check music/pose alignment near both ends, set the playable range if needed,
   then confirm alignment in Song details. Review references and missing intervals
   in **Review**. Approvals require a reason; exclusions always override approvals.
7. **Export song** downloads a deterministic runtime ZIP containing song.json,
   choreography.json, audio, and checksums. Export rejects unresolved metadata,
   timing review, long missing references, rights, and empty score coverage.

Changes autosave after a short idle interval. **Save** forces persistence.
Revision conflicts report an error; reloading fetches the saved project instead
of silently overwriting it. Upload/capture errors show in the message bar. Hidden
tabs and lost Android connections interrupt recording; acknowledged source data
stays on disk. Failed uploads retain a recoverable capture prefix under `capture/`.

The committed capture at
`temp/frutiger-character/client/public/motion/dance.json` is useful for trying the
editor. Its combined legacy confidence cannot be split into visibility/presence;
review/approve its reference poses explicitly before publication. It has no music.

**Repair short gap** reconstructs the selected player between two available
endpoint poses within one second. Reconstructed confidence is null and scoring
is disabled until explicitly approved. Longer gaps need another take or a score
exclusion. The Frutiger rig is stylized 2.5D; elbows/knees remain editable in the
skeleton even though the character has no articulated elbow/knee bones.

## Install a song in the game

Extract the song ZIP to `client/public/songs/<songId>/`, verify its checksums, then
add an entry to `client/public/songs/manifest.json`:

```json
{
  "id": "your-song-id",
  "title": "Your song",
  "artist": "Your artist",
  "durationMs": 14000,
  "difficulty": "normal",
  "supportedPlayerCounts": [1, 2],
  "bundleRevision": 12,
  "bundle": "your-song-id/song.json"
}
```

Use actual values from exported song.json; keep the catalog's outer `version: 1`.
The runtime bundle contains both tracks; one-player mode selects track 0. Editor
export does not deploy or publish automatically. The game owns character assets.

## Checks

```sh
npm test
npm run studio:test
npm --prefix temp/frutiger-character test
npm run studio:build
npm run build
docker build -f tools/choreography/Dockerfile --target test -t studio-test .
docker build -f tools/choreography/Dockerfile --target ui-test -t studio-browser-test .
docker run --rm studio-browser-test
```

The browser test uses a real decoded WAV, imports the committed take, edits a
joint, checks undo/redo, reviews both tracks, saves/reopens, plays music, exports
a ZIP, renders Frutiger characters, and checks mobile layout. API/compiler tests
cover missing tracking, capture discontinuities, revision conflicts, idempotent
batches, backup restore, deterministic bundle checksums, and unsafe archives.

## Current limits

- Captures subtract the measured Android processing delay (`resultTimeMs` minus
  `frameReceivedTimeMs`) from the first pose's audio receipt position. Subsequent
  movement timing uses frame-arrival differences, so changing inference delays
  do not distort movement intervals. Original device/browser timestamps remain
  in the saved records. Raw Android NDJSON without an audio anchor starts at zero.
  Android's planned clock exchange is unavailable; network transit, sensor-to-callback
  delay, and audio output latency remain uncalibrated. Manually review alignment.
- The editor imports JSON/NDJSON and its own project backups. Uploading video and
  running the optional Python tracker inside the website are future work. The
  existing offline tracker can produce a take for import.
- Replacement takes must have matching inference dimensions. Automatic normalization
  of different camera placements, articulated IK, and curve/clip transition controls
  are future work; inspect replacement joins visually.
- Audio decode/write validation uses the local browser's measured duration. Server
  transcoding and format-independent audio inspection are not implemented.
- Publication requires some eligible poses on both tracks and explicit gap review.
  Final scoring thresholds/minimum coverage belong to the game's scoring evaluation.
- The default server binds locally through Docker port publication. It has no
  multi-user authentication and should remain a trusted local authoring tool.
