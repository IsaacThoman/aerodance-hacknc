# Aerodance Android pose client

A small Android Things app for the Open-Q 624A: camera input → local MediaPipe pose estimation → fresh landmarks streamed to a computer browser over the LAN.

The app streams live camera poses over LAN HTTP on port **1337**, using MediaPipe Lite GPU and native libyuv conversion with bounded frame replacement. Protocol version 2 supports game-selected one/two-player output and live mode changes on the existing stream. Start/Stop, the exact origin allowlist, connection status, capture/result counters, and processing timings are shown on Android. Short board tests show approximately 30 FPS capture and 2 ms median libyuv conversion; real-person orientation and sustained performance remain open. A [local test website](pose-test-site/README.md) renders the landmarks without a domain or HTTPS.

## Project documents

- [ARCHITECTURE.md](ARCHITECTURE.md): components, source layout, lifecycle, latency.
- [One/two-player capture](docs/two-player-capture.md): player assignment, live mode changes, and validation.
- [camera-to-client-streaming.md](camera-to-client-streaming.md): endpoints, pose schema, browser integration.
- [AGENTS.md](AGENTS.md): guidance for future changes.
- [Open-Q 624A inspection](docs/hardware/open-q-624a.md): observed firmware/camera baseline.
- [Native conversion](docs/libyuv-conversion.md): pinned libyuv, bitmap ownership, native fixtures, and short board measurements.
- [MediaPipe compatibility](docs/hardware/mediapipe-compatibility.md): pinned artifacts, historical board CPU result, and GPU probe instructions.
- [Camera2 compatibility](docs/hardware/camera-compatibility.md): debug capture probe, vendor setup, measured capture rate, and image validation.

## Existing modules

`androidApp` owns Android lifecycle and the bounded HTTP server. `shared` contains the UI, protocol validation/encoding, and synthetic fixtures. Camera, conversion, MediaPipe, and pipeline adapters live in `androidApp`.

```bash
./gradlew :androidApp:assembleDebug
./gradlew :shared:testAndroidHostTest
```

The wrapper requests JDK 21; configure the Android SDK locally. Native loading, capture, and performance must be checked on the board.

## Set up, build, and deploy in one command

From the repository root:

```bash
./client-android/scripts/deploy.sh              # preview; no changes
./client-android/scripts/deploy.sh --apply      # build and deploy this checkout
./client-android/scripts/deploy.sh --apply --origin https://game.example.com
```

Install Java (JDK 21 recommended) and Android SDK command-line tools once. The
script uses `--sdk PATH`, `ANDROID_HOME`/`ANDROID_SDK_ROOT`, `local.properties`,
or `~/Android/Sdk`, in that order. It installs missing platform-tools, the
compile SDK, NDK, and CMake versions from the Gradle version catalog using
`sdkmanager`, prompting for SDK licenses when needed. Gradle provisions its
pinned JDK and resolves build tools and dependencies. Package downloads need
network access; the SDK must be writable. The selected SDK is saved in the
ignored `local.properties` without removing other settings.

The script runs host tests and builds the debug APK before changing the board.
It reconnects ADB through the board's enable API if needed, stops the previous
Aerodance activity, releases camera owners with the existing root helper,
configures continuous capture and the 30 ms indoor exposure ceiling, installs
the APK while preserving app data, grants CAMERA, and checks activity launch.
Use `--outdoor` to preserve the existing exposure ceiling. `--serial DEVICE`
selects a different ADB device; `--board-host HOST` selects its reconnect API.
See `--help` for all options.

“Latest” means the current checkout, including uncommitted changes. The script
does not fetch Git changes. `--origin` sets and saves the exact website origin
through the debug app's existing launch extra. Otherwise the saved origin is
used; on first use enter it in the app and press **Start**. Launch success does
not verify pose inference: camera/GPU work starts when a stream client connects.

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
curl http://192.168.43.1:1337/v1/time
curl -N http://192.168.43.1:1337/v1/stream
```

For local rendering, follow [pose-test-site/README.md](pose-test-site/README.md): serve on port 8081, set the Android origin to `http://localhost:8081`, and connect the browser. The debug APK also accepts `--es testOrigin http://localhost:8081` on its MainActivity launch. Normal launches use the saved origin. Allow CAMERA when requested; ADB `pm grant` remains available for unattended tests.

The server has four request workers with no request queue, one latest result, one streaming client, an 8 KiB/2-second request-header limit, and a 250 ms write deadline checked every 25 ms. It flushes each NDJSON record with compression disabled. To save battery, camera capture and pose inference run only while `/v1/stream` has a client. Disconnect detection releases the camera and GPU task; reconnect recreates them automatically, preserving the session and selected player count. Status/config/time requests leave capture off and remain available while a stream is open. While idle, `running` indicates server readiness; opening a live stream changes it to `starting` until the first successful inference. Startup heartbeats keep the stream alive, and config snapshots are withheld until inference is ready. The game, authoring tool and test viewer show camera initialization and allow 90 seconds after opening each stream for its first pose result. Leaving the activity stops the server; returning starts a new session automatically using the saved origin.

With the live app running and no other stream consumer, verify idle shutdown and
reconnect (including disconnect during GPU initialization):

```bash
python3 scripts/check-idle-capture.py 192.168.43.1 --origin https://game.example.com
```

Use the exact origin configured in the app. This checks real camera ownership and
capture/inference worker release over ADB, fresh poses after reconnect, and
session/player-count continuity. It leaves the server idle with one player selected.

Board checks on 2026-10-10 confirmed capture stayed off after status/config
requests, fresh poses resumed across two connect/disconnect cycles, and an early
disconnect during GPU startup followed by an immediate reconnect recovered with
the same session, advancing sequences and two-player output. Camera/inference
workers released in 0.58–0.68 seconds after active streaming disconnected. GPU
startup took about 35 seconds per ordinary connection; reconnect during startup
took about 63 seconds while the previous task finished initialization and closed.
These checks verify resource shutdown; battery life was not measured.

The board-specific font fallback loads the installed `Roboto-Regular.ttf` directly because this firmware references missing system fonts. Other images fall back to the normal font family if that file is unavailable. No firmware files are modified.

See [live validation](docs/hardware/live-pose-validation.md). Local Chromium streaming is verified; deployed HTTPS permission/policy testing is deferred.

## Synthetic server regression test

The debug APK retains synthetic mode for independent HTTP validation. It does not open the camera and is labeled in the UI and capabilities:

```bash
adb shell am start -S -W -n tech.aerodance.androidclient/.MainActivity --es testOrigin http://localhost:8081 --ez synthetic true
python3 scripts/check-stream.py 192.168.43.1 --origin http://localhost:8081
```

Run with no browser connected. The check covers CORS, preflight, incremental JSON, periodic absence, the one-client limit, reconnect, and slow-reader cancellation. After Stop, add `--expect-stopped` to verify listener closure. Restart without the `synthetic` extra to return to live capture. Release builds ignore both diagnostic extras. Historical measurements are in [synthetic validation](docs/hardware/synthetic-stream-validation.md).
