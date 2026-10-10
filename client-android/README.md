# Aerodance Android pose client

A small Android Things app for the Open-Q 624A: camera input → local MediaPipe pose estimation → fresh landmarks streamed to a computer browser over the LAN.

The app currently streams synthetic poses over LAN HTTP on port **1337**, with Start/Stop, an editable origin allowlist, connection status, and result counters. Camera capture and MediaPipe inference are the next milestone. Synthetic mode is explicitly identified in the UI and status capabilities.

## Project documents

- [PLAN.md](PLAN.md): milestones and acceptance criteria.
- [ARCHITECTURE.md](ARCHITECTURE.md): components, planned packages, lifecycle, latency.
- [camera-to-client-streaming.md](camera-to-client-streaming.md): endpoints, pose schema, browser integration.
- [AGENTS.md](AGENTS.md): guidance for future changes.
- [Open-Q 624A inspection](docs/hardware/open-q-624a.md): observed firmware/camera baseline.

## Existing modules

`androidApp` owns Android lifecycle and the bounded HTTP server. `shared` contains the UI, protocol validation/encoding, and synthetic fixtures. Camera and MediaPipe adapters will live in `androidApp`.

```bash
./gradlew :androidApp:assembleDebug
./gradlew :shared:testAndroidHostTest
```

The wrapper requests JDK 21; configure the Android SDK locally. Native loading, capture, and performance must be checked on the board.

## Release a competing camera app

```bash
./scripts/release-camera.sh                 # list owners; no mutation
./scripts/release-camera.sh --stop          # kill current owners using su
./scripts/release-camera.sh --serial <device-serial> --stop
```

Defaults to the board at `192.168.43.1:5555`; use `--serial` for another device or address. The target must already be connected through ADB. `--stop` requires working `su` on the device and uses `su 0 kill -9`. No apps are disabled or uninstalled; processes may restart.

## Try synthetic streaming

Build, install, and launch:

```bash
./gradlew :shared:testAndroidHostTest :androidApp:assembleDebug
adb install -r androidApp/build/outputs/apk/debug/androidApp-debug.apk
adb shell am start -n tech.aerodance.androidclient/.MainActivity
```

Enter the exact website origin (for example `https://game.example.com`, without a trailing slash) and press **Start**. Use the LAN address shown by the app:

```bash
curl http://192.168.43.1:1337/v1/status
curl -N http://192.168.43.1:1337/v1/stream
python3 scripts/check-stream.py 192.168.43.1 --origin https://game.example.com
```

The check script exercises CORS, preflight, incremental JSON, empty poses, the one-client limit, reconnect, and slow-reader cancellation. Run it with no browser already connected. After Stop, add `--expect-stopped` to verify the listener closes.

Synthetic poses move at approximately 30 Hz and clear for one second every ten seconds. The server has four request workers with no request queue, one latest result, one streaming client, an 8 KiB/2-second request-header limit, and a 250 ms write deadline checked every 25 ms. It flushes each NDJSON record with compression disabled. Leaving the activity stops the server; returning requires pressing Start.

The board-specific font fallback loads the installed `Roboto-Regular.ttf` directly because this firmware references missing system fonts. Other images fall back to the normal font family if that file is unavailable. No firmware files are modified.

See [device validation](docs/hardware/synthetic-stream-validation.md). Deployed HTTPS browser permissions/policies and real camera inference have not been validated yet.
