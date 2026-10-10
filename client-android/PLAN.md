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
- [ ] Smoke-test Camera2: camera `0`, 640×480 YUV, `[30,30]`, advancing images/timestamps.
- [ ] Verify content, orientation, row/pixel strides, permissions, and actual capture rate.

**Done when:** this APK installs, real frames arrive, and CPU inference returns plausible landmarks. Advertised settings and current zero frame counters do not satisfy this gate. If the selected Tasks artifact lacks 32-bit libraries, choose a compatible pinned release or evaluate a custom build before integrating the pipeline.

## 2. Prove browser connectivity with synthetic poses

This can proceed independently of camera work after the starter runs.

- [x] Add common models/fixtures for status, 33-landmark pose, empty pose, and heartbeat.
- [x] Implement a small embedded HTTP server; verify incremental delivery, bounded output, blocked-write cancellation, and API 27 compatibility.
- [x] Serve `/v1/status` and `/v1/stream` on `1337`, including origin checks and `OPTIONS`.
- [x] Stream synthetic pose state at 30 Hz.
- [ ] Connect from the deployed HTTPS game in Chrome using a private IP literal; verify permission, CORS, CSP, and mixed-content behavior.
- [ ] Parse/render locally in the web-client repo before backend forwarding.

**Done when:** records arrive incrementally without a certificate/desktop bridge, and slow readers cannot grow queues indefinitely. Record browser version, site headers, payload size, and inter-arrival timing.

## 3. Connect camera and MediaPipe

- [ ] Implement capture/conversion and timestamp correlation behind the adapters.
- [ ] Add LIVE_STREAM inference with one in-flight input and one pending latest frame.
- [ ] Close replaced/rejected images; handle task errors and stuck callbacks.
- [ ] Publish normalized immutable landmarks immediately, including `poses: []` on absence.
- [ ] Connect latest results to the writer without an extra timer or UI dependency.
- [ ] Show Start/Stop, LAN address, connection, errors, and counters.
- [ ] Keep preview and world landmarks disabled unless needed for validation.

**Done when:** the browser follows real movement with correct rotation/left-right, absence clears poses, and capture/inference continue independently of a slow/disconnected browser.

## 4. Measure and tune sustained latency

- [ ] Instrument arrival, conversion, inference, serialization/write, browser receive/render.
- [ ] Compare Lite CPU/GPU sustained performance and stability.
- [ ] Compare supported capture sizes, conversion, preview on/off, and exposure behavior.
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

Website implementation belongs in the web-client repository. This repo defines its contract and acceptance checks; implementation there requires its code and deployed site configuration. Raw video, multi-person tracking, smoothing, and backend redesign are outside the initial scope.

## Progress — 2026-10-10

The synthetic streaming slice is installed and tested on the board. Port is **1337**. See [device validation](docs/hardware/synthetic-stream-validation.md) for measured delivery and remaining acceptance checks. The app requires the exact game origin before Start and stops when the activity leaves the foreground. Camera/MediaPipe work and the deployed HTTPS browser test remain open.

MediaPipe `0.10.21` and Lite float16 version 1 now pass native loading and
known-image CPU inference on the API 27 `armeabi-v7a` board: one pose, 33 finite
landmarks, 1,575 ms load and 491 ms first inference. See
[compatibility validation](docs/hardware/mediapipe-compatibility.md) for artifacts,
checksums, license, and the debug-only probe. Camera capture, LIVE_STREAM, and
sustained throughput remain unverified; milestone 1 is still open. Reconnect
instructions now enable ADB through the board's HTTP API before `adb connect`.
