# Implementation plan

## Outcome

Build an offline-capable Android Things pose producer on the Open-Q 624A. A browser on the LAN receives fresh results promptly and uses them locally, optionally forwarding through the game's existing backend connection.

Keep the existing modules and follow [ARCHITECTURE.md](ARCHITECTURE.md). Canonical endpoints, schema, and browser behavior live in [camera-to-client-streaming.md](camera-to-client-streaming.md).

## 1. Prove board compatibility

- [x] Inspect OS, ABI, and camera service; record [findings](docs/hardware/open-q-624a.md).
- [x] Add a script to list/stop current camera owners.
- [ ] Release the competing owner with `scripts/release-camera.sh --stop` during capture setup; check for restart.
- [x] Assemble/install the starter and verify Compose on the API 27 low-RAM image.
- [x] Choose a pinned MediaPipe version supporting API 27 and `armeabi-v7a`. Inspect AAR/APK libraries and load it on the board.
- [x] Add Lite with source, version, license, and checksum; run CPU inference on a known image.
- [x] Smoke-test Camera2: camera `0`, 640×480 YUV, `[30,30]`, advancing images/timestamps.
- [ ] Verify content, orientation, row/pixel strides, permissions, and actual capture rate.

**Done when:** this APK installs, real frames arrive, and GPU inference returns plausible landmarks. Advertised settings and current zero frame counters do not satisfy this gate. If the selected Tasks artifact lacks 32-bit libraries, choose a compatible pinned release or evaluate a custom build before integrating the pipeline.

## 2. Prove browser connectivity with synthetic poses

This can proceed independently of camera work after the starter runs.

- [x] Add common models/fixtures for status, 33-landmark pose, empty pose, and heartbeat.
- [x] Implement a small embedded HTTP server; verify incremental delivery, bounded output, blocked-write cancellation, and API 27 compatibility.
- [x] Serve `/v1/status` and `/v1/stream` on `1337`, including origin checks and `OPTIONS`.
- [x] Stream synthetic pose state at 30 Hz.
- [ ] Connect from the deployed HTTPS game in Chrome using a private IP literal; verify permission, CORS, CSP, and mixed-content behavior.
- [x] Parse/render in the temporary local test site before backend forwarding (user-authorized subfolder; game integration remains open).

**Done when:** records arrive incrementally without a certificate/desktop bridge, and slow readers cannot grow queues indefinitely. Record browser version, site headers, payload size, and inter-arrival timing.

## 3. Connect camera and MediaPipe

- [x] Implement capture/conversion and timestamp correlation behind the adapters.
- [x] Add LIVE_STREAM inference with one in-flight input and one pending latest frame.
- [x] Close replaced/rejected images; handle task errors and stuck callbacks.
- [x] Publish normalized immutable landmarks immediately, including `poses: []` on absence.
- [x] Connect latest results to the writer without an extra timer or UI dependency.
- [x] Show Start/Stop, LAN address, connection, errors, and counters.
- [x] Keep preview and world landmarks disabled unless needed for validation.

**Done when:** the browser follows real movement with correct rotation/left-right, absence clears poses, and capture/inference continue independently of a slow/disconnected browser.

## 4. Measure and tune sustained latency

The [performance review](docs/performance-review.md) maps reviewed bottlenecks,
implemented allocation/scheduling fixes and short board comparisons. Sustained
acceptance checks below remain separate from that review.

- [ ] Instrument arrival, conversion, inference, serialization/write, browser receive/render.
- [ ] Measure Lite GPU sustained performance and stability (CPU support removed at the user’s request).
- [ ] Compare supported capture sizes, conversion, preview on/off, and exposure behavior.
- [ ] Benchmark native libyuv through JNI against the Kotlin YUV converter on the board: pin the source revision/license, build for API 27 and `armeabi-v7a` with ARM NEON support, read Camera2 plane buffers with their actual positions/strides, and write directly into inference-owned bitmap storage where supported. Preserve one input in flight and storage ownership through callback/task shutdown. Validate color/channel order, limited-range YUV, odd dimensions, padding and rotations against reference fixtures; measure conversion p50/p95/p99, allocations and end-to-end GPU pose rates in comparable scenes. GPU/libyuv is the sole production path at the user’s request; sustained acceptance remains open. The Kotlin short-probe baseline is approximately 50 ms conversion; initial native comparisons below do not complete the sustained benchmark gate.
  - Native backend, pinned source/license, JNI bitmap output, debug reference fixtures and GPU live probe are implemented; see [libyuv conversion](docs/libyuv-conversion.md). The Kotlin converter and CPU inference option have been removed.
- [ ] If native CPU conversion remains material, evaluate GPU conversion feeding inference without CPU readback; verify compatibility with the pinned Tasks API before changing the pipeline. Prefer libyuv for the first benchmark; the archived RenderScript replacement toolkit requires YUV layout adaptation and is a lower-priority option.
- [ ] Remove avoidable batching, compression buffering, and fixed sender delays.
- [ ] Run a 30-minute thermal/memory test and deliberately slow-reader test.
- [ ] Record achieved FPS, p50/p95/p99 age/stage timings, replacements, and bytes/result.

**Initial goals:** approach 30 FPS capture; produce as many usable results as the board sustains; aim for p95 callback-arrival-to-browser receipt <100 ms and p95 result-to-write completion <10 ms on a healthy LAN. Calibrate clocks or use external visual measurement before claiming capture-to-browser latency. Adjust targets from measurements if this board cannot meet them.

**Done when:** chosen settings/limitations are documented, queues stay bounded, and throttling reduces fresh-result rate rather than building delay.

## 5. Browser integration and recovery

- [ ] Separate connection health, pose age, and backend status in the game UI.
- [ ] Add explicit disconnect, stale clearing, and capped reconnection backoff.
- [ ] Reset sequence handling on new sessions; accept gaps without old-state replay.
- [ ] Forward current poses through the existing authenticated backend connection with bounded buffering.
- [ ] Test reload, permission denial/revocation, Wi-Fi loss, IP change, restart, and backend outage.
- [ ] Verify Android works without WAN and the LAN has no client isolation.

**Done when:** local gameplay remains responsive during backend failure; stale poses clear and reconnect resumes fresh state.

## 6. Appliance lifecycle and deployment

- [ ] Verify release through repeated Start/Stop and activity transitions.
- [ ] Check this Things image's launcher and any appliance launch intent requirements.
- [ ] If capture without an active activity is needed, implement/test a service with appropriate notification/permissions.
- [ ] Test boot, screen-off, camera contention/failure, port conflict, and low-memory recovery.
- [ ] Document ADB deployment, supported firmware/browser versions, and recovery.

**Done when:** deployment/recovery are reproducible. Do not depend on the retired Things console or modify vendor drivers to bypass failed capture tests.

## Verification and scope

Host tests cover schema, session/sequence rules, timestamp correlation, bounded replacement, and shutdown. Browser checks cover partial/multiple NDJSON records, size limits, and stale state. Device checks cover native loading, live capture, release, delegates, and sustained performance. Run relevant tests and `:androidApp:assembleDebug` after implementation changes.

Production game integration belongs in the web-client repository and requires its code and deployed configuration. The user authorized a temporary local HTTP test website in this repo on 2026-10-10, deferring HTTPS tests. Raw video, multi-person tracking, smoothing, and backend redesign are outside the initial scope.

## Progress — 2026-10-10

The synthetic streaming slice is installed and tested on the board. Port is **1337**. See [device validation](docs/hardware/synthetic-stream-validation.md) for measured delivery and remaining acceptance checks. Initial setup requires the exact game origin and Start; later launches and foreground returns start automatically with the saved origin. Streaming stops when the activity leaves the foreground. Camera/MediaPipe work and the deployed HTTPS browser test remain open.

MediaPipe `0.10.21` and Lite float16 version 1 now pass native loading and
known-image CPU inference on the API 27 `armeabi-v7a` board: one pose, 33 finite
landmarks, 1,575 ms load and 491 ms first inference. See
[compatibility validation](docs/hardware/mediapipe-compatibility.md) for artifacts,
checksums, license, and the debug-only probe. Camera capture, LIVE_STREAM, and
sustained throughput remain unverified; milestone 1 is still open. Reconnect
instructions now enable ADB through the board's HTTP API before `adb connect`.

Added and installed a debug-only Camera2 probe for camera `0`, 640×480 YUV,
automatic controls, and a 12-second capture window. The board accepts the
configuration and repeating requests but delivers zero images at both `[30,30]`
and `[2,30]`; shutdown reports a HAL drain timeout. No competing owner was
active, so `release-camera.sh --stop` had nothing to kill; ownership cleared after
the probe and no competing restart was observed. The script's authorized
root-based behavior is unchanged. See [capture validation](docs/hardware/camera-compatibility.md).
Capture/content/stride/orientation checkboxes remain open. Resolve real frame
delivery before integrating LIVE_STREAM; the deployed HTTPS browser gate also
remains open.


Camera frame delivery is now verified using the Ciroc camera guide. The HAL
retained `persist.sys.camera.motion.en=1` and timeout `2000` after the vendor
camera owner exited; setting both to `0` restored continuous frames. Added
`scripts/prepare-camera.sh` (inspection by default, explicit `--apply`, owner
check, property readback), with optional `--indoor` to raise the retained plate
AEC exposure ceiling from 0.75 ms to 30 ms. Real 640×480 YUV images have advancing
timestamps and row/pixel strides 640/1, 640/2, 640/2. The visible color snapshot
is rotated 90° to 480×640 without mirroring. The debug probe now follows the
record/day request controls and saves one diagnostic image after its capture
measurement. Repeated opens and closes deliver frames and release ownership.
See [camera validation](docs/hardware/camera-compatibility.md) for rates and setup.
Actual person orientation/left-right and live-frame inference remain open;
main-app streaming is still synthetic. No competing owner was present, so the
authorized root owner-kill step is still unexercised.

Final capture check: 332 frames over approximately 11 seconds, 30.08 FPS,
strictly increasing timestamps, 29.16..37.35 ms callback intervals, and visible
color content. Debug snapshot saving is excluded from the measurement. Final
APK installed; host tests, assembly, setup-script checks, and ownership release
passed. This verifies short capture throughput, not sustained inference or
thermal performance.


## Live pipeline and local test site — 2026-10-10

The user requested a temporary website in a subfolder with HTTPS testing later.
Added [pose-test-site](pose-test-site/README.md), a buildless local HTTP skeleton
viewer with optional Docker serving, exact-origin setup, bounded NDJSON parsing,
empty/stale clearing, disconnect, and capped reconnection. The main Android app
now streams camera `0` → Lite CPU LIVE_STREAM → immutable records directly to
the existing writer. Capture/inference continue without a browser. Synthetic
mode is retained as a debug-only launch option for server regression checks.

One inference input and one latest pending image are retained; task timestamps
match callbacks, replaced/rejected images close, and five-second camera/task
watchdogs stop failures. Shutdown drains inference before closing ImageReader.
No preview/video endpoint or world-landmark publishing was added. UI shows
Start/Stop, origin, LAN address, browser, errors, counts, and last stage timings;
capture/result *rate summaries* remain to be added.

Bulk plane conversion reduced mean conversion from 2,530 to 63 ms. The second
12-second probe captured 355 images at 30.08 FPS and completed 24 empty results,
with 358 ms mean inference and 642 ms maximum arrival-to-result time. Chromium
153.0.8010.12 read real records directly from the board at the local page;
fixture rendering, empty/stale clearing, disconnect, and mobile layout passed.
See [live validation](docs/hardware/live-pose-validation.md).

Host tests, debug assembly, and seven Node tests passed. Local-network permission
was granted by automation; its interactive prompt and deployed HTTPS headers/
policies remain untested. The live scene returned no person. Real-person
orientation/left-right, actual movement rendering, fault injection, sustained
performance/delegates, backend integration, and appliance lifecycle remain open.
These implementation checks do not complete milestone 3's movement acceptance
gate or establish the provisional latency targets.

The final APK also passed the existing synthetic CORS/slow-reader regression
(330 records, 29.9 Hz, slot released in 0.33 s). Two foreground-return cycles
closed the listener and released camera ownership, then resumed live inference
with new sessions. Full lifecycle and fault acceptance checks remain open.

Mounting correction: the user confirmed that raw camera frames should enter
MediaPipe without rotation. Live capture and the live diagnostic probe now use
0° rotation, unmirrored 640×480 input; previous 480×640 measurements above are
historical. The original capture-only snapshot probe still reports/applies the
sensor's advertised orientation for its separate diagnostic image.

## User validation and performance work — 2026-10-10

The user confirms live detection works with a person, but reports high latency
and low pose results per second. Real-person detection is now user-verified;
anatomical left/right, absence transitions, sustained performance, and fault
acceptance still need explicit checks. Performance tuning is the current focus.

Added capture FPS and pose results/second to the Android UI, alongside conversion
and inference timings. Added a selectable CPU/GPU debug probe and configurable
12–120 second capture window; task creation, invocation, and shutdown stay on
the same inference worker. GPU is now the production default at the user’s request; explicit saved CPU
selections are preserved.

GPU completes live callbacks on this board: a 60-second corrected-input probe
produced 180 empty results, with 61 ms mean conversion and 90 ms mean inference
versus 63/261 ms in the 12-second CPU follow-up (32 results, one detected).
GPU initialization exceeds the original 12-second window. These are different
short runs, mostly empty scenes, and do not prove sustained person throughput
or browser latency. The UI now exposes a saved CPU/GPU selection, changeable
while stopped; GPU is the default at the user’s request. See the performance follow-up in
[live validation](docs/hardware/live-pose-validation.md).


## Native conversion support — 2026-10-10

Added opt-in libyuv through JNI, pinned source/license/checksums, API 27 builds
for all existing ABIs including ARMv7 NEON, and direct conversion into the
inference-owned bitmap. Kotlin remains the production default. Debug probes
select either converter and report conversion p50/p95/p99 without changing
one-input/one-pending-image ownership.

The board passed 80 reference fixtures covering channels, signed limited-range
BT.601, buffer positions/limits, strides/padding, odd dimensions, rotations and
truncation rejection. All 11 host tests and APK assembly passed. Short CPU
conversion p50/p95 fell from 49/51 ms to 3/4 ms; GPU from 50/53 ms to 2/4 ms.
CPU completed 92 versus 107 results in 30 seconds. GPU completed 193 versus 335
results in 60 seconds, including 139 versus 329 detected poses. GPU startup
exceeded the first 30-second windows; those runs yielded no results and were
repeated at 60 seconds. Scene content varied and counts include initialization.

See [implementation, reproduction and measurements](docs/libyuv-conversion.md).
Allocation profiling, controlled person-scene comparisons, sustained thermal
runs and broader lifecycle acceptance remain open before switching the default.


## GPU/libyuv only — 2026-10-10

At the user’s request, all camera conversion now uses libyuv, and all MediaPipe
tasks use GPU. Removed CPU delegate plumbing, the saved CPU/GPU switch and launch
options, the Kotlin YUV-to-ARGB implementation and its obsolete host tests.
The capture-only PNG probe also uses libyuv; native reference fixtures remain.
Previous comparisons above are historical. Sustained, allocation and thermal
acceptance work remains open, without blocking this requested switch.


GPU/libyuv-only checks: all 8 remaining host tests and debug assembly passed;
the board passed all 80 native fixtures and GPU known-image inference (one pose,
33 finite landmarks). The 60-second live check captured 1,799 frames at 30.08 FPS
and completed 300 results, with conversion p50/p95/p99 2/4/4 ms. See
[validation](docs/libyuv-conversion.md). The live diagnostic now defaults to a
60-second window to accommodate GPU startup.
