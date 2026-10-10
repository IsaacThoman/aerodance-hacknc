# Synthetic stream validation

Observed 2026-10-10 over the LAN on the inspected Open-Q 624A (`192.168.43.1:5555`, API 27, `armeabi-v7a`). This validates the synthetic slice, not camera or native inference compatibility.

## Build and UI

- `./gradlew :shared:testAndroidHostTest :androidApp:assembleDebug` passed. Four protocol tests cover detected/empty fixtures, validation, finite values, escaping, heartbeat sequence semantics, and the UTF-8 record-size cap.
- APK installed using `adb install -r` and launched with `am start`.
- Initial Compose startup failed with a null Typeface. This image contains only six font files while `/system/etc/fonts.xml` references many absent files. Loading the installed `/system/fonts/Roboto-Regular.ttf` explicitly for the app typography resolved the observed crash; the Compose controls and LAN address were visible through UI Automator. No system files were changed.
- Test origin entered through the UI: `https://game.example.com`. This is a placeholder used to exercise HTTP CORS, not an actual deployed browser test. Replace it with the real game origin in the app before connecting.

## LAN server

Ran:

```bash
python3 scripts/check-stream.py 192.168.43.1 --origin https://game.example.com
```

Observed first run:

| Check | Result |
|---|---|
| Status and JSON capabilities | Passed; model explicitly `synthetic` |
| Approved/disallowed origins | Approved origin echoed; other origin 403 without allow-origin |
| OPTIONS | GET allowed; POST preflight rejected |
| Unknown path / unsupported method | 404 / 405 |
| Incremental NDJSON | 327 pose records in about 11 seconds |
| Received rate | Approximately 29.6 Hz |
| Median record inter-arrival | 32.8 ms |
| Maximum observed record including newline | 2,434 bytes |
| Landmark schema | Exactly 33 landmarks per detected pose; upright 480×640, unmirrored |
| Empty pose | Received during periodic synthetic absence |
| Second streaming reader | 409 while first reader connected |
| Disconnect and reconnect | Passed |
| Slow reader with 1 KiB requested receive buffer | Stream slot available again in approximately 0.48 seconds |
| UI Stop | Listener closed; `--expect-stopped` passed |
| Activity backgrounded with Home | Listener closed; `--expect-stopped` passed |
| Stop → Start rebind | Full script passed again: 332 poses, approximately 30.1 Hz, median 32.9 ms, slow-reader recovery 0.49 seconds |

The server uses a fixed four-worker pool and no request queue. Latest pose storage is one atomic replaceable record. Each socket's read/write deadline is checked by a separate watchdog, which closes blocked sockets; normal writes have a 250 ms budget with up to 25 ms watchdog scheduling granularity. Request headers have an 8 KiB cap and two-second total deadline. These are implementation bounds, not guarantees about TCP delivery or browser pose age.

## Remaining acceptance checks

- Deployed HTTPS game in Chrome: permissions, CSP, mixed-content policy, parsing/rendering, and stale clearing. The web-client repository/site configuration is not supplied here.
- Idle heartbeat delivery with production stopped; continuous synthetic generation does not exercise the five-second idle path on the board.
- Camera capture, content/orientation/strides, native MediaPipe loading and model licensing/checksum.
- Restart stress, Wi-Fi changes, port contention, boot/screen-off behavior, and thermal/memory tests.
- Clocks were not calibrated. Inter-arrival measurements are host-local receive intervals; no capture-to-browser latency was measured.
