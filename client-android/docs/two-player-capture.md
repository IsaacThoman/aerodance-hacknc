# Game-selected one/two-player capture

## Code implementation

The implementation follows these steps, in dependency order:

1. Upgrade the canonical streaming contract and common wire models to protocol 2.
   `Pose` has `playerId`; `PoseRecord` has `playerCount`, validates unique IDs in
   ascending order, and retains the 16 KiB UTF-8 record limit. Status separates
   active count from the fixed two-pose capability. Synthetic fixtures cover both
   player counts and periodic absence.
2. Implement `assignPlayers` in common `PlayerAssignment.kt`. Single-player
   selection uses mean available confidence and always outputs ID 0. Two-player
   selection uses confident hips/shoulders and fixed camera halves, resolving
   same-half collisions without filling the opposite slot. Exact ties receive a
   deterministic geometry tie-break.
3. Keep one `LivePoseEstimator` GPU task with `setNumPoses(2)`, one inference input
   in flight and one pending latest image. Callbacks deliver immutable common
   `InferenceResult` values; the estimator no longer assigns wire sequences.
4. Let the existing server publication path own `PlayerOutput` under its short
   publication lock. `publish` selects the current mode and assigns a sequence.
   `configure` publishes an empty snapshot at a new sequence boundary. The same
   lock serializes callbacks and mode changes; no HTTP worker waits for native
   initialization/inference. The one stream writer preserves record order.
5. Add bounded `/v1/config` parsing, exact Origin checks and route-specific POST
   preflight. Fixed HTTP workers and the existing watchdog bound header/body work
   to two seconds; bodies are at most 1 KiB. Reject ambiguous transfer framing,
   unsupported media types, malformed/unknown/duplicate fields and invalid counts.
6. Keep activity/process mode state and show the active count in Android. Status
   stays `starting` until the first successful inference, so camera setup alone
   cannot announce GPU readiness. The viewer applies configuration before opening
   a stream, permits up to 90 seconds for startup and changes mode on the existing
   stream. It renders IDs with distinct colors, a center divider and camera-side
   labels that mirror with the skeletons.
7. Verify host logic, browser protocol/rendering and the real Android server. Keep
   physical two-person departure/reentry and visual camera-side acceptance explicit.

A switch changes output selection only. Camera, task, session and stream stay
alive. A callback for a frame submitted before a switch is mapped using the mode
active when it is published. Latest-state replacement can skip an empty switch
record; subsequent complete snapshots still clear omitted IDs. A previously
selected old-mode record can arrive before the first new-mode record. Clients
recognize switches using sequence and `playerCount`, not control-response timing.

## Verification observed on 2026-10-10

- `:shared:testAndroidHostTest` and `:androidApp:assembleDebug` pass. The host suite
  includes six assignment/control tests covering missing players, center and
  confidence boundaries, shoulder fallback, shuffled detections, collisions,
  single-player selection, switch clearing, idempotence and invalid wire IDs.
- Nine Node 24.21.0 browser protocol tests pass, including complete two-person records,
  duplicate/out-of-mode IDs, mode changes, omissions and stale clearing.
- Real-board synthetic server: 20 alternating switches and concurrent controls on
  one open stream pass with the same session. Malformed bodies, CORS/preflight,
  missing Origin/length, size/media/framing rejection are exercised by
  `scripts/check-player-config.py`. A run observed 101 pose records with both IDs,
  ID 0 and empty snapshots; maximum control round-trip was 122.5 ms on this LAN.
- Chromium 153.0.8010.12: live synthetic selector changes retain one stream;
  reconnect reapplies the selected count; both skeletons and mirrored side labels
  render; the mobile layout fits; no page errors. Automation granted local-network
  permission, so permission prompting and deployed HTTPS behavior remain untested.
  A final fixture check also covers initial readiness polling, a right-only
  snapshot, omissions/empty/stale clearing and reconnection after live mode changes.
- Existing synthetic slow-reader test passes: 328 records, 29.8 Hz, median interval
  32.6 ms; the stalled stream slot released in 0.33 seconds. No clock calibration.
- Real Lite/GPU board run: config accepted while status was `starting`; first
  successful inference made status `running` after 13.42 seconds of polling.
  A subsequent 60.08-second run received 546 pose records (about 9.1/s), with 473
  empty snapshots, 59 right-only, nine left-only and five two-player snapshots.
  Largest record was 6,440 bytes; mean device arrival-to-result time was 126.0 ms,
  and maximum observed inter-arrival gap was 505.4 ms. This proves two-pose native
  output on the board, not human-confirmed accuracy, sustained performance or
  correct camera-side labels. Many empty records depend on the scene in view.

Final live Lite/GPU checks passed malformed-body, framing, CORS and two-second
trickle deadline validation, then 20 alternating switches plus concurrent
controls on one open stream with an unchanged session. That run received 32
empty snapshots and observed a maximum control round-trip of 42.0 ms. A final
Chromium live check received player 0, advancing sequences and GPU results at
640×480 without page errors. The user disconnected the viewer to provide the
exclusive stream slot for these checks.

## Repeatable checks

Run the host suite and APK build from `client-android`:

```bash
./gradlew :shared:testAndroidHostTest :androidApp:assembleDebug
```

Run Node tests from `pose-test-site`:

```bash
node --test
```

With Android already running and the exact allowed origin configured:

```bash
python scripts/check-player-config.py 192.168.43.1 --origin http://localhost:8081
```

The control check accepts live or synthetic pipelines and leaves one-player mode
selected. It checks a trickling body against the total request deadline, repeated
mode changes, idempotent requests, concurrent controls, sequence ordering and
valid IDs on one stream. Run other stream consumers separately because the server
allows one stream at a time. `scripts/check-stream.py` specifically requires the
synthetic producer in one-player mode.

## Acceptance and follow-up

The user reported that the feature works on 2026-10-10. Detailed steps were not
separately reported, so the following checks remain a repeatable manual checklist.

Have two people occupy opposite camera halves; confirm visual side labels and
plausible skeletons. Have each leave and return, keep a lone person on the right,
reach arms across center and switch 1→2→1 while streaming. Confirm ID 1 for a lone
right-side person in two-player mode and ID 0 anywhere in single-player mode.
Native output has included all four ID sets, but the observations above do not
substitute for this human-confirmed sequence. Confirm usability with two people
and departure/reentry, and foreground-return mode preservation on the board.
Extended profiling/thermal benchmarks remain deferred. Production-game changes
require its separate repository; its request/response contract is documented in
[the streaming specification](../camera-to-client-streaming.md).
