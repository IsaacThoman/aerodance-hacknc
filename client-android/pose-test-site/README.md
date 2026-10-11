# Local pose test page

Buildless HTML/JS, with no CDN, game backend, domain, or HTTPS dependency. Connects directly to the board on port **1337**, validates bounded NDJSON records, and draws up to two current 33-landmark poses. Empty results clear immediately; the last pose clears after 500 ms without another result. Heartbeats keep transport alive without preserving the skeleton.

From the repository root:

```bash
python3 -m http.server 8081 --bind 0.0.0.0 --directory client-android/pose-test-site/dist
```

Open **http://localhost:8081** on this computer. Alternatively, from this folder:

```bash
docker compose up -d
# Stop with: docker compose down
```

Docker serves the same static files. The Compose configuration is provided but has not been run on the development host.

1. Prepare camera continuous mode and install/start Android using the [Android instructions](../README.md).
2. Set the Android allowed origin to the exact origin printed on the page, normally `http://localhost:8081`, then press **Start**.
3. Leave Android in the foreground. Enter the board IP (normally `192.168.43.1`) on the page and click **Connect**.
4. Stand in view with shoulders, hips, and feet visible. Player 0 is green and player 1 is blue; **Mirror display** moves skeletons and camera-side labels together.

On another computer, use `http://<hosting-computer-LAN-IP>:8081` and set Android to that exact origin. `localhost`, `127.0.0.1`, and LAN IPs have different origins. Allow local-network access if Chrome asks. Run only one streaming browser at a time. Disconnect releases its slot; Android continues capture and inference independently.

The page caps reconnect delays at 8 seconds and stops after five consecutive failed reconnects. Initial connection failures require pressing Connect again; this prevents a permission-denial retry loop. The controller IP is remembered locally. No backend forwarding is implemented.

Readouts distinguish result receipt age (browser clock), result count/rate, and device arrival-to-result processing time (Android clock). The latter excludes network transit; it is not capture-to-browser latency. A live pipeline can return empty poses when nobody is visible. Synthetic mode is explicitly labeled.

## Verification

```bash
node --test
```

Nine tests cover arbitrary chunk boundaries and UTF-8, record limits, invalid data, stale and empty clearing, heartbeat semantics, session/sequence handling, IP validation, explicit player IDs and mode changes. Node 24.21.0 was used for the current protocol tests; runtime serving needs only Python or Docker.

Connecting starts Android capture and GPU initialization. The page shows
“Camera starting…” until the first pose result, allowing up to 90 seconds after
the stream opens. Startup heartbeats keep transport alive but do not mark the
camera ready or extend that deadline. Disconnect releases capture to save battery;
each reconnect can take about 35 seconds to initialize again.

With Playwright available, run the local HTTP startup fixture from the repository
root with `node client-android/pose-test-site/startup.browser.mjs`. It verifies
startup messaging, empty-result readiness, reconnect and cancellation without
using the board. Ports 8081 and 1337 must be free.

Chromium 153.0.8010.12 was checked with Playwright. Protocol-v2 synthetic
skeletons, live count changes on one stream, reconnect mode reapplication,
mirrored camera-side labels, disconnect and a 390-pixel layout passed without
script errors. Automation granted local-network permission; its interactive
prompt and deployed HTTPS policies remain untested. The live GPU board emitted
empty, left-only, right-only and two-player snapshots. See
[feature validation](../docs/two-player-capture.md) for measurements and remaining
physical checks.

## Protocol v2 player control

Choose one or two players before Connect. The viewer applies the mode with
`POST /v1/config`, waits up to 90 seconds for initial GPU/camera readiness, then
opens the stream. Change the selector while streaming to update the mode on that
same connection. Reconnect reapplies the selected count.

Green is player 0, blue is player 1. Camera-left/right refer to the unmirrored
inference image; mirror display moves both labels and skeletons together. With
two players, occupy separate halves. ID 0 is the right half, ID 1 the left half;
a lone left-side player remains ID 1;
single-player output always uses ID 0 anywhere in frame. Missing/empty/stale
snapshots clear player state. IDs represent regions, not persistent people.

The production game must adopt [the version-2 contract](../camera-to-client-streaming.md)
before using this feature. Actual game changes belong in its separate repository.
