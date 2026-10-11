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

Open http://localhost:5177. The API listens on 8082 and writes ignored
`studio-data/`. Production local serving uses `npm run studio:build`, then
`STUDIO_PORT=8082 npm run studio:start`.

## Create a routine

1. Create a project, import music, and enter **Song details**. Duration is measured
   by the browser audio decoder. Set the real artist, authors/choreographers, the
   **Stage** the game shows the routine on (Open Reef by default), and
   distribution licenses or permissions.
2. Import a pose JSON/Android NDJSON, or select a pose source and **Record new take**.
   For Android set Allowed Origin to the exact origin printed in the capture panel.
   Close other stream viewers and keep Android active. Connecting starts the
   camera and pose tracker; the panel shows initialization for up to 90 seconds
   (the board can take about 35 seconds). Recording stays disabled until the first
   pose record arrives, even if neither player is detected. You can start the
   countdown and then step into position. Cancel
   connection stops the wait. Disconnect saves battery, so reconnect initializes
   again. Set **Recording delay (seconds)** from 0 to 60 (default 3). A visible
   countdown gives you time to get into position before music and movement
   capture start. **Cancel countdown** stops the wait without adding a take.
   For **Webcam**, choose a camera and **Lite / Full / Heavy**, then **Start camera**
   and allow permission. The mirrored setup preview labels the two camera-side
   slots. Camera/model preferences are remembered in this browser. Changes restart
   tracking; controls are locked during recording and countdown. Use HTTPS or
   localhost for camera access. Models run in a worker; the status shows GPU/CPU
   and measured pose cadence. Video stays local; recording saves pose records.
   Stand upright with shoulders, hips, and feet visible while body calibration
   collects 20 reliable frames per player. The preview compensates for changes in
   apparent body size when you step back, including the floor and hip anchor.
   Use **Recalibrate body** at your final dancing position if the starting stance
   was poor. This button is locked during recording. Webcam-only exports retain
   the same distance compensation for playback; existing Android bundles retain
   their original calibration mode. This handles body size in the image, rather
   than correcting optical lens distortion.
3. Scrub the waveform, step samples, or play at 0.25/0.5/1 speed. Switch between
   Skeleton, Frutiger, and Both. The two preview characters have independent rigs.
   Choose **Live view** to preview Android or webcam poses without recording or importing
   music. Connect a pose source in the capture panel first, then step into view. Live
   poses are read-only in all three display modes; music can play for rehearsal.
   Choose **Playback** to return to the timeline and edit the routine. Recording
   automatically uses the live preview.
4. Select a player/joint and drag it in Skeleton/Both, or type XYZ. Choose a
   **Point group** to move the head, either hand, both hands, either foot, both feet, or the whole skeleton
   together by dragging any highlighted point. Each group move is one undo step. Confidence is
   read-only. A joint keyframe blends over 150 ms on either side. Undo/redo preserves
   the source take. Drag the selection start/end handles on the waveform to select a timeline
   range (arrow keys adjust a focused handle) to swap tracks, mirror, smooth, repair
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
This editor supports project format 1. Saved projects in another format are
reported and skipped at startup; the next compatible project opens instead.
If none can be opened, **Create new project** starts a separate project. Incompatible
files stay on disk and require an editor that supports their project format.
Project format versions are separate from the supported character calibration
profiles 1 and 2.
Revision conflicts report an error; reloading fetches the saved project instead
of silently overwriting it. Upload/capture errors show in the message bar. Hidden
tabs and lost pose connections interrupt recording; acknowledged source data
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
The character uses the original wrist and foot mapping. Live Frutiger previews
smooth landmark movement and distance estimates for display; skeletons, saved
takes, edits, and recorded playback use their original coordinates. Distance
compensation uses the torso's image size so noisy inferred depth cannot resize
the whole character. Recalibrate after choosing your dancing position.

## Install a song in the game

Extract the song ZIP **into** `client/public/songs/`. The archive already contains
`<songId>/`, so the result should be `client/public/songs/<songId>/song.json`, with
choreography, audio, and checksums beside it. The folder name must match the
exported `songId`. No manual manifest entry is needed.

The game discovers exported folders automatically. In development and the
production Express server, the catalog is scanned whenever Song Select opens.
Reopen Song Select after installing or replacing a song. Incomplete or invalid
bundles are skipped with a server/build warning; the game still verifies all
runtime file checksums when loading a selected song.

`npm run build` generates `dist/songs/manifest.json` for static hosting and copies
the song folders. Rebuild/redeploy after changing `client/public/songs/` for a
deployed game. On a running Express deployment, complete folders added directly
to `dist/songs/` are detected without a rebuild or server restart. Container
installations need those files inside the container, through a rebuilt image or
a mounted songs directory.

Re-exporting a song preserves its song ID and updates its bundle revision.
Replace its complete folder; discovery reads the new revision from `song.json`.
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

- Webcam capture uses browser frame observations and an audio-clock anchor,
  preserving video frame intervals through variable inference delays. Camera
  buffering and audio output delay remain uncalibrated; review start/end alignment.
  Takes retain model/hash, runtime version, delegate, timing method, and cadence.
  Webcam fixtures cover Chromium runtime/capture integration; real duet accuracy,
  hardware performance, and Safari/Firefox/mobile compatibility need manual checks.

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
