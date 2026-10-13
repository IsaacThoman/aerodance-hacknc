# Dance Studio

Local song/choreography editor for Aerodance. Projects live on disk; reference
poses use the game's `{playerId, landmarks}` pose format. No game database is needed.
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
2. Import a pose JSON/NDJSON, or start the webcam and **Record new take**.
   Choose a camera and **Lite / Full / Heavy**, then **Start camera**
   and allow permission. Recording stays disabled until the first pose result
   arrives, even if neither player is detected. You can start the countdown and
   then step into position. **Cancel connection** stops the wait. Set
   **Recording delay (seconds)** from 0 to 60 (default 3). A visible countdown
   gives you time to get into position before music and movement capture start.
   **Cancel countdown** stops the wait without adding a take. The mirrored setup preview labels the two camera-side
   slots. Camera/model preferences are remembered in this browser. Changes restart
   tracking; controls are locked during recording and countdown. Use HTTPS or
   localhost for camera access. Models run in a worker; the status shows GPU/CPU
   and measured pose cadence. Video stays local; recording saves pose records.
   Stand upright with shoulders, hips, and feet visible while body calibration
   collects 20 reliable frames per player. The preview compensates for changes in
   apparent body size when you step back, including the floor and hip anchor.
   Use **Recalibrate body** at your final dancing position if the starting stance
   was poor. This button is locked during recording. Webcam exports retain
   the same distance compensation for playback; older bundles retain
   their original calibration mode. This handles body size in the image, rather
   than correcting optical lens distortion.
   For a prerecorded video, choose **Import video**, select **Lite / Full / Heavy**,
   and scrub or play the source until you find an upright stance with shoulders,
   hips, and feet clearly visible. Choose **Use current frame for calibration**,
   then **Process video**. The selected frame calibrates every captured dancer;
   detected dancers remain visible in the calibration overlay even when their
   body confidence is too low. Each label explains whether that dancer is ready
   or needs a clearer frame; processing requires every shown dancer to be ready.
   if another dancer appears later, choose a frame containing both and **Save take**
   without processing the poses again. Detection uses the webcam's two left/right
   regions. The importer creates a new library take; use its menu to assign tracks.
   Inference runs locally and waits for each sampled frame, up to 30 samples/second.
   When whole-frame inference misses a dancer, the importer searches that side
   more closely, including the body area in portrait footage. Recovered poses
   retain the original video coordinates and the selected model.
   Slow models take longer rather than losing samples. Progress and **Cancel import**
   are available. MP4, WebM, MOV, and other formats work when the browser supports
   their codecs; videos must be no longer than one hour. Song audio stays unchanged,
   and video timestamps start at song time zero; adjust alignment with track offsets.
   Source footage is available only while the import panel is open. Saved projects
   and backups retain poses, model provenance, and the selected calibration, including
   after track edits or deleting the library take.
3. Scrub the waveform, step samples, or play at 0.25/0.5/1 speed. Switch between
   Skeleton, Frutiger, and Both. The two preview characters have independent rigs.
   Choose **Live view** to preview webcam poses without recording or importing
   music. Start the camera in the capture panel first, then step into view. Live
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
5. Select a take to open **Take view**, a read-only preview immediately before
   **Live view**. Scrub, step, and play the take without changing the routine.
   Take playback also works without music. A completed recording opens its new
   take automatically. Imports and recordings remain in the library until assigned.
   Open its **⋯** menu and choose **Overwrite P1 track**, **Overwrite P2 track**, or
   **Overwrite both tracks**. Each action copies the corresponding source player
   into independent track storage and uses the take's original audio alignment;
   it replaces the entire destination track, including its edits.
   Adjust each track's **Offset (seconds)** independently in Playback. Positive
   offsets delay poses; negative offsets advance them. Poses before song time zero
   are omitted from playback/export but retained for later realignment. Track
   offsets, edits, overwrite, clear, and interpolation support undo/redo.
6. Check music/pose alignment near both ends, set the playable range if needed,
   then confirm alignment in Song details. Review references and missing intervals
   in **Review**. Approvals require a reason; exclusions always override approvals.
7. **Export song** downloads a deterministic runtime ZIP containing song.json,
   choreography.json, audio, and checksums. Export rejects unresolved metadata,
   timing review, long missing references, rights, and empty score coverage.

Changes autosave after a short idle interval. **Save** forces persistence.
This editor uses project format 2 and migrates format 1 projects when opened.
Saved projects in unsupported formats are
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
`packages/character/assets/dance.json` is useful for trying the
editor. Its combined legacy confidence cannot be split into visibility/presence;
review/approve its reference poses explicitly before publication. It has no music.

**Interpolate P1/P2 missing intervals** fills every bounded gap on that player
track, including gaps longer than one second. It preserves available poses and
linearly interpolates missing XYZ coordinates at 30 Hz. Missing beginnings and
endings remain unchanged because they lack two endpoints. Generated poses have
unknown confidence and scoring remains disabled until explicitly approved.
The existing **Repair short gap** action still repairs a selected range within
one second. Interpolation does not modify the library take.

All deletion actions ask for confirmation. **Delete P1/P2 track** clears only that
track and resets its offset; it is undoable. **Delete** in a take's menu removes
that take and its raw capture while preserving assigned track poses and their
source provenance. **Delete project/song** permanently removes the whole routine,
including audio, tracks, takes, capture files, and revisions. It opens another
project, or a blank project when the library is empty. Deleting a project or a take
cannot be undone; use **Backup** before deleting material you want to retain.

Projects now use schema v2 with independent immutable track snapshots in
`tracks/`. Backups include snapshots required by current tracks and edit history,
so they still restore after source takes are deleted. Existing schema-v1 projects
are migrated when opened, and old backups are migrated on restore. Migration
preserves the current routine, review masks, original comparison poses, and
pre-zero data; it starts a fresh edit history. Runtime song bundle schemas remain
unchanged. The Frutiger rig is stylized 2.5D; elbows/knees remain editable in the
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
node tools/choreography/tests/video-import.browser.mjs
node tools/choreography/tests/video-duet.browser.mjs
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

- Older protocol-v2 takes and raw NDJSON imports still load. NDJSON without an
  audio anchor starts at zero; review its alignment manually.
- The editor imports JSON/NDJSON, its own project backups, and browser-decodable
  videos. Video import runs the same local models as the webcam; the optional
  Python tracker remains an offline tool.
- Automatic normalization of different camera placements, articulated IK, and
  curve/clip transition controls are future work; review poses after overwriting
  a track. Each independent player track retains its own inference dimensions.
- Audio decode/write validation uses the local browser's measured duration. Server
  transcoding and format-independent audio inspection are not implemented.
- Publication requires some eligible poses on both tracks and explicit gap review.
  Final scoring thresholds/minimum coverage belong to the game's scoring evaluation.
- The default server binds locally through Docker port publication. It has no
  multi-user authentication and should remain a trusted local authoring tool.
