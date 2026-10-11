# Browser webcam support for the game and Dance Studio

Draft prepared 2026-10-11. This extends the
[game integration plan](android-game-integration-plan.md) and
[authoring workflow](song-dance-authoring-workflow.md).

Implementation now includes the shared source/controller, locally served pinned
models, worker inference, camera/model controls in both apps, real game readiness,
Studio live view and webcam capture/finalization, frame/audio alignment, and model
provenance. Software WebGL selects CPU inference with the chosen model retained.
Studio also collects reliable full-body stance samples, offers **Recalibrate
body**, and compensates for apparent body-size changes as a webcam dancer moves
farther away. Webcam-only tracks export calibration profile 2 with
`cameraScaleMode: "body-relative"` and `bodyTorsoLength`; profile 1 remains
supported. Frame dimensions and image-width depth are accounted for. This is
body-based framing compensation, not an optical distortion calibration. Zoom
controls were explicitly excluded by the user.
Automated checks use the actual models and synthetic camera input; real duet,
hardware performance, and the full browser/device matrix remain manual acceptance
work. The sections below retain the design and acceptance reference.

## Proposed behavior

Add one shared webcam pose source that runs MediaPipe locally in the browser.
Both applications offer **Android / Webcam**, a camera picker, and a **Lite /
Full / Heavy** model picker. Default to Lite; remember camera and model preferences
per origin. Opening either application or choosing Webcam does not request camera
permission: **Start camera** does. Camera frames remain in the browser; Dance
Studio saves pose records and capture metadata through its existing API.

| Model choice | Proposed UI description |
| --- | --- |
| Lite (default) | Fastest option; start here for live play. |
| Full | Balanced option; compare tracking quality and speed. |
| Heavy | More demanding option; try on a capable computer. |

Google supplies all three Pose Landmarker bundles. The descriptions above are
selection guidance; validate actual cadence and tracking quality on supported
hardware before making performance or accuracy claims.
[MediaPipe model overview](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker).

The game replaces its dummy webcam readiness with real tracking for one or two
players. Dance Studio can preview and record two-player webcam takes using the
same countdown, music, editing, review, backup, and export workflow as Android.
The Studio keeps its existing two-track publication requirements; a missing
second dancer remains missing and requires review or another take.

Current game playback is a routine preview, and battles still report fake scores.
Webcam support supplies real input and a live setup preview; countdown gameplay,
scoring, and ranked results remain the work in the game integration plan.

## Current integration points

| Area | Existing behavior and planned change |
| --- | --- |
| `client/src/App.jsx` | Owns one `AndroidPoseSource` and constructs a synthetic `dummy` connection for Webcam. Replace this branch with an active source controller. |
| `client/src/connect/ConnectionPanel.jsx`, `layout.js` | Canvas UI currently closes the webcam card without starting anything. Add camera/model choices, Start/Stop, setup preview, and loading/error states. |
| `client/src/game/SongSelect.jsx` | Reads pose IDs for readiness, but grants Webcam dummy preview readiness. Use fresh poses from either real source. |
| `client/src/pose/AndroidPoseSource.js`, `protocol.js` | Already expose UI subscriptions, record subscriptions, lifecycle, and 500 ms freshness. Preserve Android wire validation and configuration boundaries. |
| `tools/choreography/web/App.jsx` | Constructs Android directly and builds live calibration from session/sequence/input. Subscribe to the selected source and reset calibration at source boundaries. |
| `tools/choreography/web/recorder.js` | Hardcodes protocol v2, Android session fields, two players, geometry, and processing-delay timing. Add source-aware recording. |
| `tools/choreography/server/index.js`, `core.js` | Batch validation accepts Android wire records; `takeFromRecords` always creates an Android take. Dispatch validation/finalization by capture kind. |
| `packages/pose`, `packages/character` | Reuse pose validation, quality masks, calibration, and character mapping. Keep the song/choreography runtime format compatible. |

## Shared source and model assets

Introduce framework-independent modules under `packages/pose/browser/` for the
webcam source, worker, model registry, camera lifecycle, and player-slot mapping.
Keep the browser/MediaPipe imports out of server-safe pose validators.
Add a source controller/Android adapter around the existing Android implementation
so consumers share these operations:

- `subscribe(listener)` for connection state and latest normalized snapshot.
- `subscribeRecords(listener)` for each accepted pose or lifecycle event once.
- `connect(options)`, `disconnect()`, and `setPlayerCount(1 | 2)`.
- Source capabilities and configuration, including the selected model and actual
  inference dimensions. Camera/model reconfiguration is explicit.

A normalized snapshot carries `sourceKind`, a source session ID, increasing frame
ID, `playerCount`, `input: {width,height,mirrored:false}`, and the existing
`poses: [{playerId,landmarks:[{x,y,z,visibility,presence}]}]` payload. Timing identifies
its clock and separates frame time, result time, and browser receipt time. The
Android adapter retains the original record for capture; webcam records have their
own schema and never masquerade as Android protocol v2.

Share the 500 ms freshness policy while also rejecting webcam results whose frame
age is already too old when inference completes. Publish empty snapshots for
successful inference with no people. Transport/model readiness and dancer detection
are separate: a completed empty inference can make the camera ready, but cannot
make a player detected. Lifecycle events clear poses and calibration immediately.

Add an exact, tested version of `@mediapipe/tasks-vision` to the lockfile and
lazy-load it only when starting Webcam. Maintain one registry with IDs `lite`,
`full`, `heavy`, labels, versioned upstream URLs, byte counts, SHA-256 hashes, and
license/notice information. Self-host the selected release's WASM files and all
three `.task` models under a versioned asset path in both builds; fetch only the
chosen model at runtime. Use a shared preparation script for the game and Studio
Vite builds and Docker builds. Verify downloads against committed hashes and
cache the resulting assets. Model preparation must fail visibly on a mismatch.

Keep JS and WASM versions matched. Test production asset URLs/MIME types, worker
bundling, and deployment base paths. Browser caching should reuse versioned models
on later connections; no service worker or automatic preloading of every model
is required for this feature.

## Camera and inference lifecycle

Request video only, initially preferring 640×480 at 30 fps without stretching the
actual image. Record the actual dimensions and any aspect-preserving preprocessing
transform. Refresh the camera list after permission so names become available;
handle a remembered camera disappearing by presenting the available choices.
Permission and device enumeration require secure contexts, so local development
uses localhost and remote/LAN use requires HTTPS.
[Camera access](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
[device enumeration](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices).

Use a muted, `playsInline` video element for capture. Schedule new frames with
`requestVideoFrameCallback`; use a deduplicated `requestAnimationFrame` fallback
where needed. Transfer frame images to a worker with at most one frame in flight;
skip incoming frames while busy rather than accumulating latency. Close transferred
images after processing and cancellation.
[Video frame callbacks](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).

Create `PoseLandmarker` in `VIDEO` mode, set `numPoses` to the selected player
count, disable segmentation masks, and initially use confidence thresholds of
0.5. `detectForVideo` is synchronous, so keep inference in a worker. Prototype
the selected package's worker loading and GPU/CPU delegates with both Vite builds
before committing to the final worker implementation.
[MediaPipe web configuration and inference](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js).

Try GPU inference in the worker, then CPU in the worker if GPU initialization
fails. Show the active fallback and measured tracking rate. If neither works,
explain the failure and offer retry/model selection. Do not silently change the
chosen model. Automatic model switching and a main-thread inference fallback are
outside the initial implementation.

Changing camera, model, or player count clears tracking, cancels pending work,
resets inference history/calibration, and starts a new configuration session.
Use generation tokens across permission prompts, model loads, and worker messages
so old completions cannot restore a stopped camera. Stop tracks returned by a
permission request that completes after cancellation.

On Stop, source switch, unmount, pagehide, or fatal failure: stop every camera
track, detach video, cancel callbacks, close the landmarker, terminate its worker,
and clear snapshots. When the tab becomes hidden, interrupt Studio recording and
release webcam capture; returning shows an explicit Resume/Start action. Handle
permission denial, unavailable/busy cameras, unplugged cameras, track termination,
asset-load failures, and inference/context failures as distinct actionable states.

## Coordinates and two-player slots

Use MediaPipe's image landmarks in full-frame, unmirrored coordinates with the
existing 33-landmark anatomical ordering. Preserve finite coordinates and measured
confidence; represent a missing confidence value as null. World landmarks are
not substitutes for the existing image-coordinate contract. Mirror only the
setup video/skeleton display, with slot labels transformed to match that view.

For one player, assign the selected pose to ID 0. For two players, use full-frame
`numPoses: 2` results and map reliable hip centers to the unmirrored image's left
slot (ID 0) and right slot (ID 1). Do not use MediaPipe result-array order as an
identity. Slots describe camera regions, as in the existing authoring contract.

Specify and test a small center dead band and short assignment hysteresis. If
two candidates compete for one slot or torso evidence is unreliable, omit the
ambiguous slot and show a repositioning cue. Once a dancer clearly crosses sides,
the destination region determines the ID. Do not fabricate the missing player,
renumber the remaining dancer, or claim persistent identity across crossings.
Show a divider and labeled placement zones in the setup preview.

Full-frame multipose inference is the initial design choice. Phase 1 must compare
its two-person detection and slot behavior with Android fixtures. If separate
half-image inference is needed, define the full-frame XYZ remapping and measure
the cost before adopting it; a cropped pose cannot be passed straight to the
existing calibration code.

## Recording and audio alignment

Give webcam capture a versioned raw record schema, for example
`aerodance.webcam-record` version 1. Store source session/frame IDs, player count,
geometry, poses, model ID/hash, package version, delegate, thresholds, frame media
timestamp, browser frame timestamp, result/receipt timestamps, and timing method.
Store model/configuration once in capture metadata and reference it from records.
Include explicit source-silence/interruption events. Keep the immutable raw records
and existing durable, idempotent upload batches and interrupted-prefix recovery.

Stamp frames on the main thread before worker submission. Preserve the video media
timestamp for frame order/deltas and a corresponding main-thread monotonic time
for audio alignment. Worker timestamps must include their time origin or be mapped
explicitly; do not subtract unrelated `performance.now()` values. A frame-callback
timestamp is an observation, not a guaranteed sensor exposure time.

Add an audio-clock anchor to `AudioTransport`: song position at browser time `t`
is `anchorSongMs + (t - anchorBrowserMs) * playbackRate`. Anchor the scheduled
countdown/music start using the audio context and browser clock, retaining enough
information to assess mapping uncertainty. Align webcam samples at frame time,
not inference-result arrival. Drop frames before the scheduled song start and
preserve variable inference latency without shifting movement intervals. Review
start/end alignment manually because camera buffering and audio output delay
remain outside this estimate.

Update recorder guards and batch/finalization validation to dispatch on trusted
capture metadata: Android retains its existing wire records and timing path;
webcam uses its own validator and frame-to-audio mapping. Reject mixed-source,
session, model, player-mode, or geometry changes within a take. Disable source,
camera, and model controls throughout recording and countdown. On involuntary
changes, stop and retain the acknowledged prefix with an interruption reason.

Finalized webcam takes still use `aerodance.take` version 1, with `source:
"webcam"`, normal samples, and additive provenance. Preserve existing project,
take, Android NDJSON, legacy import, backup, and runtime bundle readers. Export
model/timing provenance while excluding browser device IDs and labels from runtime
bundles. Keep gap/confidence review and publication gates intact.

## Application UI

**Game:** Expand the existing canvas connection card with a scrollable camera
picker, three model buttons, Start/Stop, model-loading status, camera setup preview,
slot detection, and tracking cadence. Keep keyboard, touch, mouse, and phone-remote
navigation through `useCanvasUI`. Browser permission still occurs on the display
device. Source/model changes outside capture clear readiness until fresh results
arrive. Remove all dummy readiness/messages and update browser-flow fixtures.
Keep routine preview available independently of camera readiness as it is today.

**Dance Studio:** Add a source selector to the capture panel. Android keeps its
IP/origin controls; Webcam shows camera/model controls, setup preview, and Start/
Stop. Existing Live view and Skeleton/Frutiger/Both previews consume the selected
source. Clear the current 20-frame calibration history at configuration boundaries.
Show the selected model and measured capture cadence on new takes. Use source-aware
connection and timing messages throughout countdown, capture, and review.

## Implementation sequence and completion checks

1. **Prove the browser runtime and assets.** Pin the dependency/assets; prototype
   every model, worker GPU/CPU initialization, full-frame two-person inference,
   and asset serving in both production builds. Measure with a rendered stage
   active. This resolves the largest compatibility and contention risks first.
2. **Implement the shared source.** Add normalization/controller, webcam lifecycle,
   worker backpressure, timing, slot assignment, and diagnostics. Regression-check
   Android startup, reconnect, player-mode boundaries, and freshness.
3. **Connect the game.** Replace dummy mode, add selectors/setup preview, and use
   real detection in Song Select. Validate one- and two-player mode changes and
   all existing canvas navigation methods.
4. **Connect Studio capture.** Add source UI, frame/audio anchors, raw schema,
   server validation/finalization, provenance, and recovery. Record a real duet,
   edit/save/reopen it, back it up, export it, and load the bundle in the game.
5. **Validate and document.** Update both run guides and the integration reference
   with camera permissions, model choices, measured browser support, timing limits,
   and source behavior. Complete the checks below before declaring support.

Targeted unit tests should cover empty detections, invalid landmarks, reversed
result order, missing dancers, center ambiguity/crossings, stale results, duplicate
frame callbacks, one frame in flight, old worker generations, late permissions,
and cleanup. Inject delayed inference and audio anchors to verify that frame timing
and take alignment stay unchanged. Test webcam upload validation, failed/retried
batches, recovery, metadata round trips, and old Android captures/backups.

Add browser flows using fake camera media for Start/Stop, permission/error states,
camera/model persistence, model switching, real readiness, live preview, and
record/export. Include at least one integration run using the actual bundled
MediaPipe runtime and a known human-motion fixture; mocks alone do not validate
model/WASM loading. Inspect production builds and Docker serving for both apps.

Manually exercise current Chrome/Edge, Firefox, and Safari on desktop; test mobile
Safari/Chrome where camera access is offered. Validate every model on a capable
computer, GPU failure/CPU fallback, camera unplugging, hidden tabs, left/right
gestures, two-person occlusion/crossings, and browser camera release. Record
achieved pose Hz, inference p50/p95, dropped frames, frame age, loading time,
memory, and game render performance per model/delegate/device.

Provisional targets on the chosen baseline machine: Lite sustains at least 15
accepted pose updates/second with the game stage rendering, and frame-to-result
p95 stays below 200 ms. Confirm the baseline and thresholds in phase 1. Slower
Full/Heavy configurations remain selectable with a visible performance warning;
the future scorer must evaluate model-dependent quality and timing before claiming
comparable ranked scores.

Run `npm test`, `npm run studio:test`, `npm run build`, `npm run studio:build`,
and the existing game/Studio browser checks after implementation. A successful
delivery includes selectable Lite/Full/Heavy in both apps, camera selection,
real one-/two-player game input, a recoverable webcam Studio recording that exports
through the existing pipeline, and passing Android compatibility checks.
