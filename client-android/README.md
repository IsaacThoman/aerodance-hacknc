# Aerodance Android pose client

A small Android Things app for the Open-Q 624A: camera input → local MediaPipe pose estimation → fresh landmarks streamed to a computer browser over the LAN.

The app streams live camera poses over LAN HTTP on port **1337**, using MediaPipe Lite CPU with bounded frame replacement. Start/Stop, the exact origin allowlist, connection status, capture/result counters, and processing timings are shown on Android. Short board tests sustain approximately 30 FPS capture and 2–3 CPU results/second; real-person orientation and sustained performance remain open. A [local test website](pose-test-site/README.md) renders the landmarks without a domain or HTTPS.

## Project documents

- [PLAN.md](PLAN.md): milestones and acceptance criteria.
- [ARCHITECTURE.md](ARCHITECTURE.md): components, planned packages, lifecycle, latency.
- [camera-to-client-streaming.md](camera-to-client-streaming.md): endpoints, pose schema, browser integration.
- [AGENTS.md](AGENTS.md): guidance for future changes.
- [Open-Q 624A inspection](docs/hardware/open-q-624a.md): observed firmware/camera baseline.
- [MediaPipe compatibility](docs/hardware/mediapipe-compatibility.md): pinned artifacts, board CPU result, and probe instructions.
- [Camera2 compatibility](docs/hardware/camera-compatibility.md): debug capture probe, vendor setup, measured capture rate, and image validation.

## Existing modules

`androidApp` owns Android lifecycle and the bounded HTTP server. `shared` contains the UI, protocol validation/encoding, and synthetic fixtures. Camera, conversion, MediaPipe, and pipeline adapters live in `androidApp`.

```bash
./gradlew :androidApp:assembleDebug
./gradlew :shared:testAndroidHostTest
```

The wrapper requests JDK 21; configure the Android SDK locally. Native loading, capture, and performance must be checked on the board.

## Release a competing camera app

If the board is disconnected, enable ADB before reconnecting:

```bash
curl --request PUT --url http://192.168.43.1:8080/api/v1/system/adb/enable
adb connect 192.168.43.1
adb devices -l
```

```bash
./scripts/release-camera.sh                 # list owners; no mutation
./scripts/release-camera.sh --stop          # kill current owners using su
./scripts/release-camera.sh --serial <device-serial> --stop
```

Defaults to the board at `192.168.43.1:5555`; use `--serial` for another device or address. The target must already be connected through ADB. `--stop` requires working `su` on the device and uses `su 0 kill -9`. No apps are disabled or uninstalled; processes may restart.

## Validate camera capture

The original Flock HAL retains motion-triggered mode and a short plate exposure
limit even after its camera owner exits. Configure it before direct capture:

```bash
./scripts/release-camera.sh --stop
./scripts/prepare-camera.sh --indoor             # inspect only
./scripts/prepare-camera.sh --indoor --apply     # continuous mode, indoor AEC ceiling
adb shell am start -S -W -n tech.aerodance.androidclient/.diagnostics.CameraCompatibilityActivity
```

Install the debug APK and grant CAMERA first, as described in
[Camera2 compatibility](docs/hardware/camera-compatibility.md). Preparation uses
existing device `su`, requires no active camera owner, and verifies the property
writes. `--indoor` raises the exposure ceiling from the observed 0.75 ms plate
setting to 30 ms; omit it to preserve the existing AEC limit. These settings
configure capture, without changing firmware or drivers. Reapply after reboot
or after a vendor app resets them. The main app uses these settings for live capture; it does not change root/vendor properties itself.

## Try live streaming

Build, install, and launch:

```bash
./gradlew :shared:testAndroidHostTest :androidApp:assembleDebug
adb install -r androidApp/build/outputs/apk/debug/androidApp-debug.apk
adb shell am start -n tech.aerodance.androidclient/.MainActivity
```

On first use, enter the exact website origin (for example `https://game.example.com`, without a trailing slash) and press **Start**. The origin is saved; subsequent launches and returns to the foreground start streaming automatically. **Stop** keeps streaming paused while the app remains in the foreground. Use the LAN address shown by the app:

```bash
curl http://192.168.43.1:1337/v1/status
curl -N http://192.168.43.1:1337/v1/stream
```

For local rendering, follow [pose-test-site/README.md](pose-test-site/README.md): serve on port 8081, set the Android origin to `http://localhost:8081`, and connect the browser. The debug APK also accepts `--es testOrigin http://localhost:8081` on its MainActivity launch. Normal launches use the saved origin. Allow CAMERA when requested; ADB `pm grant` remains available for unattended tests.

The server has four request workers with no request queue, one latest result, one streaming client, an 8 KiB/2-second request-header limit, and a 250 ms write deadline checked every 25 ms. It flushes each NDJSON record with compression disabled. Leaving the activity stops the server; returning starts a new session automatically using the saved origin.

The board-specific font fallback loads the installed `Roboto-Regular.ttf` directly because this firmware references missing system fonts. Other images fall back to the normal font family if that file is unavailable. No firmware files are modified.

See [live validation](docs/hardware/live-pose-validation.md). Local Chromium streaming is verified; deployed HTTPS permission/policy testing is deferred.

## Synthetic server regression test

The debug APK retains synthetic mode for independent HTTP validation. It does not open the camera and is labeled in the UI and capabilities:

```bash
adb shell am start -S -W -n tech.aerodance.androidclient/.MainActivity --es testOrigin http://localhost:8081 --ez synthetic true
python3 scripts/check-stream.py 192.168.43.1 --origin http://localhost:8081
```

Run with no browser connected. The check covers CORS, preflight, incremental JSON, periodic absence, the one-client limit, reconnect, and slow-reader cancellation. After Stop, add `--expect-stopped` to verify listener closure. Restart without the `synthetic` extra to return to live capture. Release builds ignore both diagnostic extras. Historical measurements are in [synthetic validation](docs/hardware/synthetic-stream-validation.md).
