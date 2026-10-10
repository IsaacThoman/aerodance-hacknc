# Local pose test page

Buildless HTML/JS, with no CDN, game backend, domain, or HTTPS dependency. Connects directly to the board on port **1337**, validates bounded NDJSON records, and draws the latest 33-landmark pose. Empty results clear immediately; the last pose clears after 500 ms without another result. Heartbeats keep transport alive without preserving the skeleton.

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
4. Stand in view with shoulders, hips, and feet visible. Anatomical left is green, right is blue; **Mirror display** changes only presentation.

On another computer, use `http://<hosting-computer-LAN-IP>:8081` and set Android to that exact origin. `localhost`, `127.0.0.1`, and LAN IPs have different origins. Allow local-network access if Chrome asks. Run only one streaming browser at a time. Disconnect releases its slot; Android continues capture and inference independently.

The page caps reconnect delays at 8 seconds and stops after five consecutive failed reconnects. Initial connection failures require pressing Connect again; this prevents a permission-denial retry loop. The controller IP is remembered locally. No backend forwarding is implemented.

Readouts distinguish result receipt age (browser clock), result count/rate, and device arrival-to-result processing time (Android clock). The latter excludes network transit; it is not capture-to-browser latency. A live pipeline can return empty poses when nobody is visible. Synthetic mode is explicitly labeled.

## Verification

```bash
node --test
```

Seven tests cover arbitrary chunk boundaries and UTF-8, record limits, invalid data, stale and empty clearing, heartbeat semantics, session/sequence handling, and IP validation. Node 22.14.0 was used; runtime serving needs only Python or Docker.

Chromium 153.0.8010.12 was checked with Playwright: known-fixture skeleton rendering, mirror control, empty/stale clearing, disconnect, and a 390-pixel layout passed without script errors. The actual page at `http://localhost:8081` also received live Lite CPU results from `192.168.43.1`. Automation granted local-network permission; its interactive prompt and deployed HTTPS policies remain untested. The live scene returned no person, so real-person orientation/left-right remains open. See [live validation](../docs/hardware/live-pose-validation.md).
