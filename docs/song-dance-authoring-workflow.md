# Song and dance authoring workflow

Design reference prepared 2026-10-10. This specifies authoring and game contracts
and extends the [game integration plan](android-game-integration-plan.md).

The local editor and Docker image are now implemented; see
[Dance Studio's run guide](../tools/choreography/README.md). It supports project
persistence, audio/waveform playback, Android recording and JSON/NDJSON import,
Frutiger/skeleton previews, coordinate edits and undo/redo, track swaps, mirroring,
smoothing, bounded gap repair, phrase replacement, review, backups, and runtime
bundle export. The sections below remain the broader design reference. Website
video import, calibrated Android clock mapping, mixed-camera normalization,
transition controls, and final scoring policy remain follow-up work. See the
run guide's current limits before treating every proposed field/API as implemented.

## Decisions

Build a local **Dance Studio** website, served by a dedicated Docker image. It
records Android poses while playing music, imports existing recordings, replays
the routine on the Frutiger characters, and provides a timeline and landmark
editor. Persist projects on a mounted volume. Export a portable song bundle the
game can serve as static files, without requiring the editor or Android to replay
reference choreography.

Use the **Android pose object structure** throughout the shared model and new
recordings: `poses: [{playerId, landmarks: [{x,y,z,visibility,presence}]}]`.
Replace the demo's `[x,y,z,confidence]` tuples through an explicit migration.
Keep the network envelope separate from the stored choreography envelope:

| Layer | Contract |
| --- | --- |
| Android wire | Existing protocol v2 records, unchanged, including device clocks and session/sequence. |
| Raw take | Original wire records plus recorder timing, status, calibration, and connection events. |
| Editable project | References to immutable takes/audio, alignment, ordered edits, and review decisions. |
| Runtime choreography | Song-relative samples using Android-shaped pose objects, with quality and calibration. |
| Song bundle | Metadata, music, choreography, optional cover art, and file integrity information. |

Do not fabricate Android `seq`, `sessionId`, or `frameReceivedTimeMs` for edited
samples. These describe capture, not song playback. Android `protocolVersion: 2`,
the old demo's `version: 1`, and the new schemas' `schemaVersion: 1` are independent
version namespaces. Sharing pose objects does not make the file a live stream.

One bundle contains two choreography tracks, IDs **0 and 1**. One-player mode
loads track 0 from that same bundle; two-player mode loads both. Initial publication
requires both tracks to pass review. Keep authoring drafts outside the public game
assets.

## Existing code to reuse

- [Android streaming contract](../client-android/camera-to-client-streaming.md):
  HTTP port 1337, status/config endpoints, one NDJSON streaming connection,
  complete snapshots, explicit IDs, and 33 MediaPipe image landmarks.
- [AndroidPoseSource](../client/src/pose/AndroidPoseSource.js) and
  [protocol decoder](../client/src/pose/protocol.js): connection lifecycle,
  bounded decoding, validation, and player-mode boundaries.
- [Frutiger capture guide](../temp/frutiger-character/README.md),
  [motion code](../temp/frutiger-character/client/src/motion.js), and
  [character component](../temp/frutiger-character/client/src/Character.jsx):
  independent skeleton instances, recorded sampling, calibration, and pose mapping.
- [Existing video tracker](../temp/frutiger-character/scripts/pose/track.py):
  locked offline capture and diagnostic overlays, as an optional import path.
- Song catalog (`songs/manifest.json`): generated automatically from exported
  song folders for development, production, and static builds, retaining version 1.

Extract shared protocol/pose/character modules before the editor and game diverge.
The current adapter exposes latest UI state, including repeated watchdog updates;
add a subscription for **each accepted decoded record and its receipt time** for
recording. Do not record render frames or repeatedly save its current snapshot.
Record heartbeats and empty pose records as well as detected people.

## Author's workflow

1. **Create project.** Enter song title, musical artist, songwriters/composers,
   choreographer, difficulty, and optional tags/BPM. Import music, inspect its
   waveform, and choose the playable interval. Measure duration from decoded audio;
   do not rely on a manually entered length. Give the project a stable song ID.
2. **Connect Android.** Enter its IP, set the Android allowed Origin to the exact
   editor origin, request two-player mode, wait for the configuration sequence
   boundary and running pipeline, and show both players' tracking. Release any
   game/test-page connection first: Android permits only one stream consumer.
3. **Check capture.** Keep a fixed camera and full bodies visible. In two-player
   capture, ID 0 means the unmirrored camera's left half and ID 1 the right half;
   these are region slots, not persistent person identities. Keep dancers in their
   halves, and capture a short stable calibration stance. Show confidence and gaps.
4. **Record take.** Begin saving before a three-second lead-in. Schedule music and
   countdown on one audio clock. Record all received records, clock mappings, and
   audio transport events through a short tail after the song. Display elapsed
   music time and capture/write health. Stop finalizes a take; another attempt
   creates another take without replacing the first.
5. **Align and review.** Review the beginning and end against a sync cue, audio, and
   optional locally uploaded video. Use calibrated frame time where available;
   otherwise label the take uncalibrated and manually align it before publication.
   Check both tracks for camera-half switches, low-confidence joints, and gaps.
6. **Edit.** Scrub or play with waveform, skeletons, and Frutiger characters. Trim,
   align, replace phrases from another take, repair identities, and correct raw
   landmark coordinates through reversible edits. Save/reopen with undo/redo.
7. **Compile and validate.** Bake the project into audio, metadata, and song-timed
   choreography. Review repaired joints and unscorable spans. Fix publication
   blockers and audition the resulting bundle using the same loader as the game.
8. **Export and install.** Download the runtime `.aerodance-song.zip` or unpacked
   directory. Copy its directory into `client/public/songs/<songId>/`, then reopen
   Song Select; the catalog is discovered automatically. Export an authoring
   backup separately if desired.

Android currently streams poses, not camera video or microphone audio. Music
plays on the authoring computer. Video review requires an independently recorded
file; adding camera streaming to Android is outside the initial workflow.

## Editor behavior

Use a normal responsive browser interface: library/project controls, waveform and
timeline, a large preview, and a landmark inspector. The timeline contains the
playable range, both track lanes, takes/clips, confidence/gap lanes, beat/phrase
markers, and score exclusions. Selecting a warning seeks to its exact interval.

Preview modes are **skeleton**, **Frutiger characters**, and **both**; add video
overlay when a source video exists. Show the original and edited skeletons with
distinct colors. Support play/pause, seek, frame/sample stepping, loop selection,
and audition at 0.25/0.5/1 speed. Looping is an editor transport option; it is never
baked into choreography. Music, video, skeletons, and characters follow the same
song cursor. Silent scrubbing is sufficient for the first implementation.

Landmark editing operates on the MediaPipe 33-joint skeleton, not the character's
seven bones. Select a named joint and drag its image-space X/Y or edit numeric
X/Y/Z in the inspector. Inspect visibility/presence without changing measured
confidence. Correcting a coordinate records an override; it does not rewrite the
raw take. The UI labels the joint as edited and shows its original value.

| Edit | Defined result |
| --- | --- |
| Trim/playable range | Select song-time bounds; preserve the imported audio and capture. |
| Align | Set one affine take-time to song-time mapping; show offset/drift explicitly. |
| Split/replace phrase | Change a track's clip list with source bounds and a mapping into the destination song interval. |
| Reassign/swap | Map source IDs to destination tracks for a selected interval; swap atomically. |
| Joint override | Set absolute XYZ at a selected source sample or song-time keyframe. |
| Keyframe blend | Apply an offset curve between named keys, using explicitly selected interpolation. |
| Gap repair | Fill a bounded interval from known endpoints; retain missing/low-confidence evidence. |
| Smooth | Apply a named, versioned filter with a window in milliseconds to a selected range. |
| Mirror choreography | Apply the anatomical transform described below; leave destination IDs unchanged. |
| Score exclusion | Mark a song-time interval unscorable with a reason. |

Each command records stable operation ID, scope, parameters, and order. Undo/redo
changes the active command cursor, not source files. Editing after undo truncates
the redo branch in the new project revision. Autosave uses revision-checked writes;
show a save/conflict error instead of silently overwriting another browser's work.

Missing players must remain visible as gaps. A whole-person gap over 200 ms requires
an explicit repair/replacement or score exclusion and review; this is an initial
authoring default, not a measured accuracy threshold. Never automatically stretch
a neighboring pose across a long gap. An excluded gap still needs an acceptable
visual treatment: fade/neutral preview or an explicitly reviewed animation repair.

## Container and persistence

Proposed layout:

```text
tools/choreography/
  Dockerfile
  compose.yaml
  web/                  # React/Vite editor
  server/               # Express project/upload/export API
  compiler/             # deterministic edit evaluation and validation
packages/pose/          # shared payload types, validators, transforms, samplers
packages/character/     # shared Frutiger rig calibration and pose application
```

Use a multi-stage image that builds the editor and serves its static files and API
from Express on port 3000. Use the repository's locked Node dependencies/runtime
as the starting point; run as a non-root user. No TimescaleDB is needed for local
authoring. Files, manifests, and atomic revision snapshots are sufficient initially.

The browser connects directly to Android and uploads ordered batches to its own
same-origin server. This avoids making container-to-LAN routing a capture
dependency. Browser capture runs independently of rendering; disk acknowledgments
and durable sequence tracking determine whether a take is complete.

Illustrative Compose configuration for the future tool:

```yaml
services:
  studio:
    build:
      context: ../..
      dockerfile: tools/choreography/Dockerfile
    ports:
      - "127.0.0.1:8082:3000"
    environment:
      STUDIO_DATA_DIR: /data
    volumes:
      - studio-data:/data
    restart: unless-stopped
volumes:
  studio-data:
```

Once implemented, open `http://localhost:8082` and configure that exact Origin on
Android. A named volume must have writable ownership for the container user. Make
project backup/download available in the website; restarting/rebuilding the image
must preserve projects. Binding on a LAN address is an explicit deployment choice;
add authentication before allowing untrusted access to write APIs.

Initial API responsibilities:

| Route | Behavior |
| --- | --- |
| `POST /api/projects` | Create a project and stable IDs. |
| `GET /api/projects/:id` | Read project and revision. |
| `PUT /api/projects/:id` | Save with expected revision; reject stale writes with 409. |
| `POST /api/projects/:id/assets` | Stream audio/video upload, hash and inspect it. |
| `POST /api/projects/:id/takes` | Start a take with source/status metadata. |
| `POST /api/takes/:id/batches` | Persist ordered recorder records and acknowledge durable progress. |
| `POST /api/takes/:id/finalize` | Seal the take, hash it, and report continuity/write failures. |
| `POST /api/projects/:id/compile` | Compile a pinned revision and return validation report/job ID. |
| `GET /api/exports/:id` | Download the validated runtime bundle or authoring backup. |

Batch IDs and record ordinals are idempotent; retrying a batch cannot duplicate
samples. Reject missing/out-of-order batches at finalization. Bound pending browser
uploads initially to 5 seconds or 8 MiB, whichever comes first. If persistence falls
behind, stop and mark the take incomplete rather than silently dropping records.
Do not pause stream reads to keep a slow disk happy: Android itself favors freshness.
If the page becomes hidden or transport/session/mode/input geometry changes, end
the active take as interrupted. Recovery creates a new take.

For an interrupted upload, retain the acknowledged prefix and a manifest describing
the missing tail. Such a take is a recoverable draft, not a complete recording.
Uploads/ZIP extraction must have bounded size and paths; reject absolute paths,
`..`, symlinks, duplicate entries, and decompression beyond the configured limit.
The editor serves project assets through ID-based routes, not arbitrary file paths.

Keep the locked Python/video importer optional, in a separate worker/image; live
Android authoring does not need Python, Blender, FFmpeg, or inference on the server.
Initial audio publication can accept a browser-decodable MP3 and copy it unchanged.
Waveforms and measured duration can be generated in the browser. Future transcoding
must record settings and calculate final duration/alignment after conversion.

## Authoring project format

Use UTF-8 JSON for manifests/projects and NDJSON for append-only raw records.
Use finite JSON numbers, explicit millisecond field names, and ISO 8601 UTC strings
for human timestamps. Runtime IDs are stable strings; source player IDs remain
integers. Assets are content-addressed with lowercase SHA-256 hashes.

```text
/data/projects/<projectId>/
  project.json
  revisions/<revision>.json
  assets/<sha256>.<extension>
  takes/<takeId>/
    take.json
    records.ndjson
    clock-mapping.json
    review/                 # optional video/overlay/report
  builds/<buildId>/
    validation.json
    runtime/<songId>/
```

`project.json` has `schema: "aerodance.project"`, `schemaVersion: 1`, `projectId`,
`songId`, `revision`, creation/update times, the song metadata, asset references,
take references, a `tracks` list, ordered `operations`, `operationCursor`, markers,
score exclusions, and compiler settings/version. Track IDs are 0 and 1.

Each track has `clips` with `clipId`, `takeId`, `sourcePlayerId`, `sourceStartMs`,
`sourceEndMs`, `songStartMs`, and positive `timeScale`. Source intervals are
half-open; their song duration is `(sourceEndMs-sourceStartMs)*timeScale`.
Clips cannot overlap on a track unless an explicit transition defines how they
blend. Record blend length/easing; flag the blended range for review. For ordinary
capture clips, derive placement from the take alignment, then freeze the resolved
mapping into the project revision. Warn on changed speed; do not time-warp a dance
silently to fill the song.

`take.json` has `schema: "aerodance.take"`, `schemaVersion: 1`, `takeId`, source
kind (`android`, `video`, or `legacy-demo`), original status/capabilities, input
geometry, session, model name/hash where available, recorder version, sample count,
observed sequence gaps, timestamp range, interruption reason, content hashes, and
alignment/review state. Unknown model versions/hashes are null, not invented.

Each Android `records.ndjson` line is one recorder envelope. For example, an
actual empty snapshot remains empty:

```json
{
  "ordinal": 1,
  "receivedBrowserTimeMs": 5200.25,
  "audioPositionAtReceiptMs": 4100.25,
  "record": {
    "protocolVersion": 2,
    "type": "pose",
    "sessionId": "session-abc",
    "seq": 42,
    "frameReceivedTimeMs": 1250,
    "resultTimeMs": 1384,
    "playerCount": 2,
    "input": { "width": 640, "height": 480, "mirrored": false },
    "poses": []
  }
}
```

Store each validated original `record` without field changes. Heartbeats use the
same envelope. Record audio start/pause/end and connection/calibration events as
separate envelopes with `event` in place of `record`; exactly one is present.
Browser timestamps have one clock origin per take, documented in `take.json`.
The Android 16 KiB limit applies to the inner wire record, not the recorder envelope.
Sequence gaps indicate records unavailable to the recorder, not necessarily failed
inference; the live protocol cannot recover samples it already replaced.

## Timing and audio alignment

The audio file's beginning is **song time 0 ms**. Store choreography times in that
coordinate system even if gameplay uses only a subsection. `playableStartMs` and
`playableEndMs` select the finite playable interval; countdown occupies separate
transport time and does not add three seconds to choreography timestamps.

Use one Web Audio transport for preview/recording. Schedule starts and derive song
position from the audio clock, accounting for audible-output mapping as described
in the [integration plan](android-game-integration-plan.md). Rendering samples that
position; it never advances music time by adding animation deltas.

Android uptime and browser `performance.now()` cannot be subtracted directly.
`clock-mapping.json` stores synchronization samples, mapping validity ranges,
drift/offset, residual capture delay, and uncertainty. The proposed Android
`GET /v1/time` capability in the integration plan **is not implemented today**.
Until it exists, retain receipt-time estimates and require reviewed manual alignment.
Do not claim that callback-to-result duration measures sensor-to-browser latency.

Define alignment as:

```text
takeTimeMs = frameReceivedTimeMs - firstFrameReceivedTimeMs   # Android
takeTimeMs = presentationTimeMs - importOriginMs              # video
songTimeMs = offsetMs + timeScale * takeTimeMs
```

`offsetMs` is where take time zero occurs in the song; positive means later.
`timeScale` defaults to 1 and may represent measured clock drift. A calibrated
Android mapping estimates callback time on the audible song clock, subtracting
measured capture delay. If that mapping varies over time, compile the stored
piecewise clock mappings before applying editorial alignment; do not force a bad
single affine fit. Store the chosen method and uncertainty in provenance.

Example: a take begins 3 seconds before music and has no drift, so `offsetMs=-3000`.
A pose at take time 5000 ms maps to song time 2000 ms. Negative/pre-roll and
post-song samples stay in the take but are outside the runtime playable range.
Track replacements use explicit clip mappings; review sync on both sides of joins.

## Runtime song bundle

Choose a **directory of JSON and media files**, packaged as a ZIP for transport.
Name the ZIP `<songId>-r<bundleRevision>.aerodance-song.zip`; it contains exactly
one top-level `<songId>/` directory. The game loads the unpacked files over HTTP,
not by extracting a ZIP during gameplay.

```text
<songId>/
  song.json
  choreography.json
  audio.mp3
  cover.webp              # optional
  checksums.json
```

Raw takes, device addresses, authoring projects, source videos, and undo history
belong in a separate `.aerodance-project.zip` backup. That backup includes all
referenced source assets, revisions, and compiler settings needed to rebuild.
Runtime provenance contains source content hashes and build identity, not local
paths or private footage. Characters are game-owned assets, not duplicated per song.

Example `song.json` (illustrative metadata, not a playable committed song):

```json
{
  "schema": "aerodance.song",
  "schemaVersion": 1,
  "songId": "glass-sky",
  "bundleRevision": 1,
  "title": "Glass Sky",
  "artist": "Example Artist",
  "songwriters": ["Example Composer"],
  "choreographers": ["Example Choreographer"],
  "description": "A two-player routine with side steps and overhead reaches.",
  "durationMs": 183420,
  "playableStartMs": 0,
  "playableEndMs": 183420,
  "bpm": 120,
  "difficulty": "normal",
  "tags": ["aero", "duet"],
  "supportedPlayerCounts": [1, 2],
  "audio": { "path": "audio.mp3", "mimeType": "audio/mpeg" },
  "choreography": { "path": "choreography.json", "schemaVersion": 1 },
  "cover": { "path": "cover.webp", "mimeType": "image/webp" },
  "coachMode": "mirror-player",
  "rigProfile": "frutiger-seven-bone-v1",
  "rights": {
    "audio": { "license": "author-supplied", "attribution": "Example Artist" },
    "choreography": { "license": "author-supplied", "attribution": "Example Choreographer" }
  },
  "createdAt": "2026-10-10T18:00:00Z",
  "publishedAt": "2026-10-10T19:00:00Z",
  "build": { "compilerVersion": "1.0.0", "projectRevision": 12 }
}
```

Required: schema/version, ID/revision, title, artist, songwriter/choreographer lists
(possibly empty), measured duration, playable bounds, supported player counts,
audio/choreography references, coach/rig profiles, rights metadata, timestamps,
and build identity. Optional: description, cover, BPM, tags, difficulty. Use null
for unknown BPM and an explicit `unknown` rights license when unresolved; never
infer permission from a file upload. Publication requires an author to resolve
distribution rights. Musical authorship is distinct from performing artist and
choreography authorship. This metadata records those decisions without prescribing
a licensing model.

`durationMs` is decoded final audio duration rounded to the nearest millisecond.
Playable bounds satisfy `0 <= start < end <= durationMs`. All intervals below are
half-open `[startMs,endMs)`. BPM is a descriptive hint; optional beat/phrase markers
carry actual song times and support variable tempo. BPM never sets the pose clock.

### Choreography structure

`choreography.json` uses `schema: "aerodance.choreography"`, `schemaVersion: 1`,
`songId`, `durationMs`, `playableStartMs`, `playableEndMs`, the coordinate convention,
sampling settings, `tracks`, `samples`, optional `markers`, and `provenance`.
Song identifiers and duration/bounds must match `song.json` exactly.

```text
coordinates:
  kind = mediapipe-image
  landmarkCount = 33
  ordering = mediapipe-pose-33
  xAxis = right; yAxis = down; zAxis = away-from-camera
  mirrored = false
  depthUnit = relative-image-width
sampling:
  targetRateHz = 30
  maxInterpolationGapMs = 200
  confidenceThreshold = 0.5
tracks: [track0, track1]
samples: [{songTimeMs, poses, quality}, ...]
```

The textual outline above is a field specification, not a JSON document.
Landmark X/Y refer to normalized image coordinates and can be outside `[0,1]`;
preserve finite values. Relative Z is not meters. Width/height belong to each
track's calibration. All runtime poses are unmirrored anatomical MediaPipe order.
Convert a genuinely mirrored source explicitly; a mirrored preview alone never
changes saved data.

Each `tracks` entry contains `playerId`, `label`, `calibration`, and
`unscorableIntervals: [{startMs,endMs,reason}]`. Calibration contains:

| Field | Meaning |
| --- | --- |
| `inputWidth`, `inputHeight` | Effective inference dimensions after source normalization. |
| `torsoLength` | Median reliable hip-to-shoulder distance using aspect-corrected XY. |
| `baseHip` | XYZ hip center for root translation, in normalized source coordinates. |
| `floorY` | Reviewed ankle-floor estimate in normalized image Y. |
| `profileVersion` | Version of the calibration calculation/character mapping. |

For character scale, start with the demo's target torso length `1.05 / torsoLength`.
Keep calibration fixed over playback. If a replacement take uses different geometry,
normalize it into the destination track's frame using reviewed torso scale, aspect,
and hip/floor alignment before baking. Preserve torso lean and relative movement;
do not independently recenter every frame. Reject an unnormalized mixed-camera
track rather than applying one aspect ratio to incompatible clips.

Every runtime sample is a complete snapshot using the same `poses` structure as
Android. Detected poses have exactly 33 landmark objects and explicit ID 0 or 1.
Omitted IDs are absent at that instant. Samples contain no network envelope fields.

This sample excerpt shows a single landmark **only to illustrate the shape**; a
valid pose must include all 33 landmarks, and quality arrays must have 33 entries:

```json
{
  "songTimeMs": 2000,
  "poses": [
    {
      "playerId": 0,
      "landmarks": [
        { "x": 0.25, "y": 0.42, "z": -0.08, "visibility": 0.97, "presence": 0.99 }
      ]
    }
  ],
  "quality": [
    {
      "playerId": 0,
      "landmarkOrigins": ["measured"],
      "scoreEligible": [true],
      "reviewed": false
    }
  ]
}
```

`quality` is keyed by the same explicit player IDs and has exactly one entry per
present pose. Keep it outside the pose payload so shared Android pose validation
still applies. `landmarkOrigins` has 33 enum values: `measured`, `resampled`,
`edited`, `gap-repaired`, or `missing-confidence`. `scoreEligible` has 33 booleans.
`reviewed` records approval of a changed pose; exclusions remain authoritative.
For compound operations use precedence: gap-repaired, edited, missing-confidence,
resampled, measured. Full operation history stays in the authoring project.

Visibility/presence are the original measured values at source knots. Normal
resampling linearly interpolates each confidence field only when both endpoints
provide it; otherwise it remains null. Coordinate edits and gap repairs never
increase measured confidence. For reconstructed joints retain low source evidence
or null scores. By default gap-repaired/edited/unknown-confidence joints are
unscorable; an explicit reviewed reference approval can enable them with a stored
reason in the project. Approving a reference does not relax live-input confidence.
Final `scoreEligible` also applies authored exclusions and the versioned compile
policy. A scorer must require adequate eligible torso/limb coverage; that scoring
policy remains the separate research task in the integration plan.

Bake a deterministic 30 Hz grid **plus exact edit, presence, gap, and exclusion
boundaries**. Include samples at playable start/end; the final endpoint is a
terminal sampling anchor, not another scored interval. Round song times to six
decimal places in milliseconds, sort, and deduplicate before compilation. Output
times strictly increase. Upsampling a 9 Hz take does not create new measurements:
interior joints are `resampled`, and quality reports retain the source rate.
Ordinary interpolation is permitted only between reliable endpoints with no
absence/discontinuity in between and a gap at most `maxInterpolationGapMs`.
Interpolate XYZ and confidence; never interpolate flags or identities. Do not
extrapolate before the first or after the last reliable pose without an explicit edit.

Absent players stay absent until reacquisition. Recording/finalization must add
explicit discontinuity events for source silence, including the 500 ms freshness
boundary used by the current adapter; compilation cannot infer continuity merely
because two nonempty samples exist on opposite sides of a heartbeat-only interval.
Intervals without usable references are marked unscorable and visibly reviewed.

`provenance` contains source hashes/kinds/models where known, alignment methods
and uncertainties, project revision, compiler version/settings hash, quality-policy
version, and per-track quality summaries. Include markers as
`{id, songTimeMs, kind, label}`, with kind `beat`, `phrase`, or `note`.

### Integrity and catalog

`checksums.json` has `schema: "aerodance.checksums"`, `schemaVersion: 1`, and
`files: [{path,bytes,sha256}]` for every other bundle file; it does not hash itself.
Paths are relative to the bundle root with `/` separators, no traversal/absolute
paths, no query strings, and no external URLs. Validate hashes before installation.
The catalog can pin the hash of `song.json` for a particular published revision.

Example catalog entry compatible with the existing outer version:

```json
{
  "version": 1,
  "songs": [
    {
      "id": "glass-sky",
      "title": "Glass Sky",
      "artist": "Example Artist",
      "durationMs": 183420,
      "difficulty": "normal",
      "supportedPlayerCounts": [1, 2],
      "bundleRevision": 1,
      "bundle": "glass-sky/song.json",
      "cover": "glass-sky/cover.webp"
    }
  ]
}
```

Catalog paths resolve relative to `songs/manifest.json`; asset paths in song.json
resolve relative to song.json. Catalog metadata is a summary; song.json is
authoritative. Install the complete directory before atomically adding/updating its
catalog entry. A revision increments when any runtime content changes; the song ID
stays stable. Pin one loaded revision for a play session, and invalidate cached
assets using its revision/hash. Publishing remains a separate explicit action from
editing/exporting; the studio does not silently deploy to production.

## Shared Frutiger playback and mirror convention

Refactor `motion.js` into a finite recorded sampler, calibration builder, and
`applyPoseToCharacter(model, pose, calibration, options)`. This function accepts
the shared Android-shaped pose. It must not require a whole recorded clip to
apply one pose. Editor, runtime reference actors, and live player panels all use it.
Keep one independently cloned skeleton per actor.

The seven-bone asset maps hips, shoulders, face, wrists, and ankles to stylized
root/body/head/hands/feet. It cannot show articulated elbows/knees. The skeleton
editor still exposes those joints because they matter for choreography and scoring.
Relative depth remains damped/clamped for appearance, not converted into room-scale
3D. Keep visual smoothing separate from edited/scoring coordinates.

The game samples at the audible song position using bounded interpolation, stops
at `playableEndMs`, and does not use the demo's modulo clock or final 0.35-second
seam crossfade. Editor looping seeks its transport; it does not alter the samples.

`coachMode: "mirror-player"` means viewers copy the coach as a mirror. Keep the
stored intended player pose canonical. Reflect only the coach visualization for
that view; compare live anatomical landmarks to the stored intended pose. A
display-only reflection does not swap landmark labels or player IDs.

An authoring command that **mirrors the actual dance target** is different: set
`x'=1-x`, preserve Y and relative Z, and swap all anatomical left/right pairs:
`1↔4, 2↔5, 3↔6, 7↔8, 9↔10, 11↔12, 13↔14, 15↔16, 17↔18,
19↔20, 21↔22, 23↔24, 25↔26, 27↔28, 29↔30, 31↔32`.
Swap confidence/quality alongside coordinates; nose 0 is unchanged. Mirror the
calibration frame as well. IDs 0/1 remain their destination track identities.
Never choose mirrored/unmirrored targets opportunistically while scoring.

## Migrating the current demo

Provide an importer for its version-1 `times[]` / `poses[frame][person][joint]`
format. Convert seconds to milliseconds and array person indices to explicit IDs.
Convert XYZ tuples into object landmarks. The fourth tuple component is
`min(visibility,presence)` and cannot recover the two original scores: use
`visibility: null`, `presence: null`, and retain `legacyConfidence` in authoring
provenance per joint/sample. The shared pose payload remains unchanged.

Treat those unknown-confidence references as unscorable until reviewed. If the
original raw diagnostic data exists, import its gaps/confidence too; the smoothed
JSON alone cannot reconstruct all raw absence or repair history. Mark that limit
in the take. Existing source hashes, dimensions, model settings, and timestamps
remain provenance. Require music and alignment to turn the silent demo into a
song; do not manufacture playable-song metadata from the preview.

Keep the old demo loader during migration because the menu currently imports its
assets directly. Migrate the menu/demo consumers and tests before removing the
tuple reader. New exports use only the shared pose object structure.

## Compilation, validation, and implementation order

Compile a pinned project revision in this order: validate sources → map source
times/clips into song time → resolve identities → normalize source geometry →
apply ordered coordinate/repair/filter edits → resample with explicit gaps →
compute fixed calibration and quality masks → assemble bundle → validate/hash.
Operations carry a phase and order; do not let a coordinate edit accidentally run
before the identity/geometry it was authored against. Keyframe positions use the
normalized destination frame. Source-sample overrides identify their take/sequence;
song-time overrides identify track/time. Export resolves them in their declared phase.

Pin compiler, schema, and policy versions, settings, and source hashes. Stable JSON
key ordering and number rounding make identical inputs/settings reproduce identical
runtime bytes. Publication timestamps are fixed inputs for a release; changing them
changes its hash. Record ZIP packaging timestamps consistently for reproducible ZIPs.

Block publication for missing audio/assets, hash mismatch, unsupported schemas,
invalid IDs/landmark counts, non-finite coordinates, invalid confidence ranges,
unordered/duplicate times, inconsistent duration/bounds, missing required tracks,
unresolved identities, incomplete selected takes, unreviewed long gaps, unresolved
alignment/rights, or incompatible coordinate/rig profiles. Permit reviewed visual
repairs and exclusions, and report their durations and coverage per track. A
selected valid prefix of an interrupted take may be used only through an explicit
reviewed clip selection; it does not make the original take complete.

Validate full playable-range coverage of **timeline state**, including explicit
absence. Also validate eligible scoring coverage against a documented publication
policy; a song consisting entirely of exclusions must fail. Freeze that policy
with scoring research rather than inventing a quality percentage here. Compiler
reports should distinguish measured, resampled, edited, repaired, absent, and
excluded duration, plus source cadence, timing uncertainty, and join warnings.

Implement in these increments:

1. Shared object pose schema/validators, project/bundle JSON Schemas, fixtures,
   legacy importer, and finite sampler. Keep Android protocol v2 unchanged.
2. Shared character calibration/application and bundle preview using the game loader.
3. Docker website, file persistence, audio transport, take recorder, and record-level
   adapter subscription. Manual alignment works before the Android timing extension.
4. Timeline/landmark editing, undo/redo, replacements, quality review, deterministic
   compiler, and runtime/backup exports. Add optional video import afterward.
5. Android clock capability and measured capture alignment, then catalog installation
   and actual game playback/scoring integration per the integration plan.

Acceptance requires recording a real two-person song, replaying both Frutiger
characters with music, correcting a landmark and an identity/phrase problem,
saving/reopening after container restart, reproducing export, and loading it in
both game modes. Verify left/right gestures, source gaps, failed uploads, clock
discontinuities, pause/resume/seek, finite endpoints, and track-0 equivalence across
player counts. Test compiler/validator failure cases and a shared deterministic
fixture through both editor and game; visual review must accompany numerical checks.

This design supplies the authoring and bundle contract. Existing code does not yet
implement scored song playback; the integration plan's timing, scoring evaluation,
and deployed-device acceptance gates still apply.
