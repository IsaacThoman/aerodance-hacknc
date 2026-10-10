# Repository instructions

## Purpose

Build a small Android Things app for the Open-Q 624A Development Kit: camera input, local MediaPipe pose estimation, and fresh landmarks delivered directly to a computer browser over the LAN.

Read [ARCHITECTURE.md](ARCHITECTURE.md), [PLAN.md](PLAN.md), and [camera-to-client-streaming.md](camera-to-client-streaming.md) before changing the pipeline. The streaming document owns the protocol, the architecture owns component boundaries, and the plan tracks implementation milestones.

## Hardware baseline

- The inspected board runs Android 8.1/API 27 with `armeabi-v7a` userspace. Keep `minSdk = 27` unless deployment requirements change.
- Verify native dependencies contain compatible 32-bit ARM libraries. A 64-bit-capable chip does not make this firmware capable of running an arm64-only APK.
- Camera `0` advertises Camera2 HAL 3.3, YUV, 640×480, and a 30 FPS range. Real frame delivery is verified with continuous-mode vendor setup; see [camera validation](docs/hardware/camera-compatibility.md). Short Lite CPU live tests produce approximately 2–3 results/second; sustained pose throughput remains unverified. See [live validation](docs/hardware/live-pose-validation.md).
- See [the hardware report](docs/hardware/open-q-624a.md) for observations and remaining checks.

## Layout and dependencies

- `androidApp`: Android entry points, permissions, camera, MediaPipe adapter, pipeline lifecycle, embedded HTTP server, and device diagnostics.
- `shared/src/commonMain`: platform-independent protocol models, validation, configuration, and the existing Compose UI.
- Keep Android camera and MediaPipe types out of common code and wire models.
- Keep the existing two modules. Add packages as features are implemented; avoid empty classes, extra modules, or a dependency-injection framework for the initial app.
- Pin versions in `gradle/libs.versions.toml`. Record the model URL, license, version, and SHA-256 when adding its asset. Do not use `latest.release`.

## Pipeline rules

- Optimize freshness and sustained throughput. Never accumulate an unbounded frame, result, socket, or backend queue.
- Use one camera acquisition worker and one MediaPipe instance. Keep one inference in flight and at most one pending latest frame.
- Close every acquired image on success, rejection, error, and shutdown. Do not reuse inference storage before the selected API has finished using it.
- Run capture, conversion, inference, serialization, and writes off the main thread. A slow browser must not block inference.
- Publish every completed result immediately, including an empty pose when no person is detected. UI redraw and backend forwarding must not pace Android output.
- Use monotonic timestamps. The sensor reports an unknown timestamp source: never subtract sensor timestamps from Android or browser clocks without calibration.
- Stream landmarks only. Video, recording, WAN calls, extra smoothing, and multiple-person tracking require an explicit scope change.
- Treat LAN HTTP and an origin allowlist as the initial deployment boundary. CORS is not authentication.

## Device operations

If the board is absent from `adb devices`, run these in order, then verify `adb devices -l`:

```bash
curl --request PUT --url http://192.168.43.1:8080/api/v1/system/adb/enable
adb connect 192.168.43.1
adb devices -l
```

This is the user-provided reconnect procedure for this board. On 2026-10-10 the PUT returned `{"status":"adb connected"}`, and ADB confirmed a connection to `192.168.43.1:5555`.

Use read-only ADB diagnostics first. [scripts/release-camera.sh](scripts/release-camera.sh) lists current camera owners by default; `--stop` resolves their PIDs and uses the board's existing `su 0 kill -9`. The user has authorized stopping competing camera apps for this project.

User clarification (2026-10-10): stopping the competing camera service on this board requires root. Preserve the script's existing `su 0 kill -9` behavior; do not replace it with `am force-stop`. Using the existing `su` for this authorized operation is permitted. Do not disable or uninstall apps, newly root the device, flash firmware, or modify vendor drivers as part of ordinary camera setup.

Before direct capture, inspect `scripts/prepare-camera.sh` and run `--apply` with
no active camera owner. The original HAL's retained motion mode can suppress all
frames: continuous capture needs `persist.sys.camera.motion.en=0` and
`persist.sys.camera.motion.timeout_ms=0`. Optional `--indoor` sets the vendor AEC
exposure ceiling to 30 ms and applies it; the inherited 0.75 ms plate limit is too
dark indoors. This setup uses existing root for vendor properties, not a
privileged app installation. Vendor apps may reset properties; recheck them.

## Verification

For implementation changes, run relevant host tests and assemble the APK:

```bash
./gradlew :shared:testAndroidHostTest :androidApp:assembleDebug
```

Use a real board for native loading, capture, delegate performance, lifecycle, and thermal checks. Use the deployed HTTPS client for browser permissions, CORS, and stream latency. Existing template arithmetic tests do not validate this app.

For documentation, check links, protocol examples, and consistency; a Gradle build is unnecessary. For shell changes, run `bash -n` and verify the default dry run before exercising device mutations. Report checks actually performed; distinguish observations from proposed targets.
