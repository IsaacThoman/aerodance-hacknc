# Repository instructions

## Purpose

Build a small Android Things app for the Open-Q 624A Development Kit: camera input, local MediaPipe pose estimation, and fresh landmarks delivered directly to a computer browser over the LAN.

Read [ARCHITECTURE.md](ARCHITECTURE.md), [PLAN.md](PLAN.md), and [camera-to-client-streaming.md](camera-to-client-streaming.md) before changing the pipeline. The streaming document owns the protocol, the architecture owns component boundaries, and the plan tracks implementation milestones.

## Hardware baseline

- The inspected board runs Android 8.1/API 27 with `armeabi-v7a` userspace. Keep `minSdk = 27` unless deployment requirements change.
- Verify native dependencies contain compatible 32-bit ARM libraries. A 64-bit-capable chip does not make this firmware capable of running an arm64-only APK.
- Camera `0` advertises Camera2 HAL 3.3, YUV, 640×480, and a 30 FPS range. Advertised capabilities do not establish successful capture or pose throughput.
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

Use read-only ADB diagnostics first. [scripts/release-camera.sh](scripts/release-camera.sh) lists current camera owners by default; `--stop` force-stops those packages. The user has authorized stopping competing camera apps for this project. Do not disable, uninstall, root, flash, or modify vendor drivers as part of ordinary camera setup.

## Verification

For implementation changes, run relevant host tests and assemble the APK:

```bash
./gradlew :shared:testAndroidHostTest :androidApp:assembleDebug
```

Use a real board for native loading, capture, delegate performance, lifecycle, and thermal checks. Use the deployed HTTPS client for browser permissions, CORS, and stream latency. Existing template arithmetic tests do not validate this app.

For documentation, check links, protocol examples, and consistency; a Gradle build is unnecessary. For shell changes, run `bash -n` and verify the default dry run before exercising device mutations. Report checks actually performed; distinguish observations from proposed targets.
