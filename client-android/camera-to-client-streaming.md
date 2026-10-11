# Camera-to-client streaming specification

> Protocol version 2 and game-selected one/two-player capture are implemented.
> See [implementation and validation](docs/two-player-capture.md) for board
> observations and remaining manual checks. Extended performance benchmarks
> and deployed HTTPS validation are deferred.

This is the connection and protocol specification for the Open-Q 624A Android Things pose app. See [ARCHITECTURE.md](ARCHITECTURE.md) for component boundaries and [the hardware inspection](docs/hardware/open-q-624a.md) for device constraints. The endpoints below deliver live camera Lite GPU results on port 1337. A [local HTTP test page](pose-test-site/README.md) is implemented in this repo at the user’s request. Deployed HTTPS browser validation is deferred.

## Design

Use an **HTTP streaming server inside the Android app**. The HTTPS game page opens a connection over the LAN and uses pose results locally as soon as they arrive. Backend forwarding uses the game's existing connection independently of local processing.

```text
Android app                    HTTPS game page                  Game backend
HTTP server on LAN             Running on computer              Internet
      │                               │                              │
      │◄──── GET /v1/stream ──────────│                              │
      │──── NDJSON data stream ──────►│──── existing WSS / HTTPS ───►│
```

**The browser initiates the connection; Android pushes data through the open response.** Android never needs WAN access. No certificate or separate desktop bridge is required in the validated Chrome setup described below.

Start with **desktop Chrome with Local Network Access support**. Record the version that passes the deployed-site test; validate Firefox separately before advertising support.

Chrome documents permission-gated HTTP access from secure pages and mixed-content exemptions for private IP literals and `.local` names. Use a private IPv4 literal initially. This is browser-specific behavior: permission, CORS, and site policy must all pass. See [Chrome's LNA guidance](https://developer.chrome.com/blog/local-network-access).

> Scope: Stream MediaPipe pose landmarks as replaceable state. Raw camera video is outside this plan. HTTP/TCP is the initial transport; benchmark freshness and packet-loss behavior before claiming it is the fastest possible transport.

## 1. Shared protocol

Agree on this before implementing either side.

### Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /v1/status` | Identify the device and verify connectivity |
| `GET /v1/stream` | Open the continuous data stream |
| `POST /v1/config` | Select one or two players, including during an open stream |
| `GET /v1/time` | Clock-synchronization exchange on the pose-record clock (capability `timeSync`) |

Example status response:

```json
{
  "protocolVersion": 2,
  "deviceId": "controller-01",
  "sessionId": "session-abc",
  "deviceName": "Open-Q 624A Pose Controller",
  "pipelineState": "running",
  "playerCount": 1,
  "capabilities": {
    "supportedPlayerCounts": [1, 2],
    "poseModel": "pose_landmarker_lite",
    "maxPoses": 2,
    "landmarksPerPose": 33,
    "worldLandmarks": false,
    "sensorTimestampSource": "unknown",
    "timeSync": true
  }
}
```

`timeSync: true` advertises `GET /v1/time`. It is an additive protocol-2
capability: clients must check the flag rather than infer support from
`protocolVersion` alone, and must ignore unknown capability fields.

### Clock synchronization

`GET /v1/time` returns one JSON object and closes the connection:

```json
{"protocolVersion":2,"sessionId":"session-abc","receivedTimeMs":81234,"sentTimeMs":81235}
```

- `receivedTimeMs` (`a1`) is sampled once the request headers have been fully
  read; `sentTimeMs` (`a2`) is sampled immediately before the body is serialized
  and written. `a1 <= a2`.
- Both use the **same clock and units** as pose `frameReceivedTimeMs`/`resultTimeMs`
  and heartbeat `producerTimeMs`: Android `SystemClock.elapsedRealtime()` in
  integer milliseconds (monotonic since boot, including deep sleep). They are not
  wall-clock times. A changed `sessionId` invalidates any previous mapping.
- The route is read-only and independent of the stream slot: it works with or
  without an open stream, never receives the single-stream `409`, and never starts
  camera capture or inference. It costs two clock reads and one small string;
  it does not take the publication lock or wait on the pipeline.
- CORS matches `/v1/status`: approved or absent `Origin`, route-specific
  `OPTIONS` allowing `GET`, `405` for other methods, `Cache-Control: no-store`.
  Requests share the four fixed HTTP workers; a request beyond capacity is closed
  and may be retried.

For browser send/receive times `b0`/`b3` (`performance.now()`), estimate
`androidMinusBrowser = ((a1 - b0) + (a2 - b3)) / 2` and
`roundTrip = (b3 - b0) - (a2 - a1)`. Take several samples, prefer the lowest round
trips, and treat half the round trip as the uncertainty. Each request opens a new
TCP connection, so `b0`→`a1` includes connection setup; the minimum-round-trip
filter limits that asymmetry. See the
[game integration plan](../docs/android-game-integration-plan.md#required-android-timing-extension).

### Streaming format

Use **newline-delimited JSON (NDJSON)**: one JSON object per line.

```jsonl
{"protocolVersion":2,"type":"pose","sessionId":"session-abc","seq":1,"frameReceivedTimeMs":1250,"resultTimeMs":1284,"playerCount":1,"input":{"width":480,"height":640,"mirrored":false},"poses":[]}
{"protocolVersion":2,"type":"pose","sessionId":"session-abc","seq":2,"frameReceivedTimeMs":1283,"resultTimeMs":1318,"playerCount":1,"input":{"width":480,"height":640,"mirrored":false},"poses":[]}
{"protocolVersion":2,"type":"heartbeat","sessionId":"session-abc","producerTimeMs":6320,"lastPoseSeq":2,"pipelineState":"running"}
```

Rules:

- Each message ends with `\n`.
- `sessionId` changes whenever the server/pipeline restarts, including camera/model configuration changes. Player-count changes preserve the session, camera, model and stream. Reconnecting the browser alone does not change it; on-demand camera/GPU release and recreation preserve the session and sequence counter.
- Assign `seq` to completed pose results before publishing; it increases within a session. Replacement may create gaps. Heartbeats use `lastPoseSeq` (null before the first result), without consuming pose sequence numbers.
- On reconnect, a fresh snapshot may repeat the latest sequence. Reset per-connection duplicate handling, then ignore out-of-order/duplicate poses within that connection.
- Send a heartbeat after five seconds without a record. It proves transport liveness, not successful camera capture or pose freshness.
- Limit each UTF-8 record to 16 KiB excluding the newline. Reject oversized or invalid records; do not let the browser's incomplete-line buffer grow beyond the limit.

### Pose payload

The two example pose records above demonstrate **no person detected**, not a working skeleton. A detected pose contains exactly 33 landmarks in MediaPipe index order. Every pose record carries `playerCount: 1` or `2`; `poses` contains at most that many entries, each with an explicit integer `playerId`. Each landmark has this shape:

```json
{"x":0.52,"y":0.31,"z":-0.08,"visibility":0.99,"presence":0.98}
```

`poses` therefore contains objects shaped as `{ "playerId": 0, "landmarks": [33 landmark objects] }`. The text in that shape description is explanatory, not JSON to transmit. The codec includes a complete 33-landmark detected-person fixture in [Protocol.kt](shared/src/commonMain/kotlin/tech/aerodance/androidclient/protocol/Protocol.kt). Synthetic mode advertises `poseModel: "synthetic"` in status; the Lite capability applies after camera/model integration.

- Coordinates refer to the upright inference input after rotation, with dimensions given by `input`. Start unmirrored even though this board's sensor orientation is 90 degrees. UI mirroring is a separate display transform; anatomical left/right labels keep MediaPipe's meaning.
- `x`/`y` are image-normalized coordinates; preserve finite out-of-image estimates rather than clamping. `z` is relative depth, not meters. If negotiated through status, optional `worldLandmarks` uses the same index order with meter-valued coordinates. See [MediaPipe output coordinates](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/android).
- Encode optional unavailable visibility/presence scores as null. Reject NaN/infinity; never serialize invalid JSON numbers.
- Send `poses: []` for every completed inference with no pose. Do not silently retain the last detected person.
- `frameReceivedTimeMs` is arrival at the Android capture callback; `resultTimeMs` is callback completion from inference. Both use the same Android monotonic clock. They are not wall-clock timestamps or proven sensor exposure times.
- This sensor reports an unknown clock source. Optional `sensorTimestampNs`, if added, must be a decimal string to avoid JavaScript integer precision loss, with its clock relationship explicitly documented.
- Status/heartbeat `pipelineState` is one of `starting`, `running`, `error`, or `stopping`. While idle, `running` means ready to accept a stream. Opening a live stream changes it to `starting` until the first successful inference, then `running`. Accept `starting` heartbeats during initialization. Config snapshots are withheld during initialization; the first streamed pose proves inference readiness even when `poses: []`. Disconnect restores idle server readiness.
- Protocol version 2 is required for both live and synthetic output. Reject other versions explicitly; route names retain `/v1`.

**Pose results are state; delivery favors freshness:**

- **State**, such as the latest pose: replace older samples when a consumer falls behind.
- **Events**, such as a button press: delivery may need acknowledgment, replay, and deduplication. An open HTTP stream alone does not guarantee end-to-end delivery.

### Player assignment and live configuration

Create one Lite GPU LIVE_STREAM task with `setNumPoses(2)` for both modes. The
selected count controls output selection; it never recreates the task.

Single-player output contains at most one pose, always ID `0` anywhere in frame.
Select the highest mean of available visibility/presence scores, with zero when
all scores are absent. Break ties by usable torso X, or mean landmark X when
no torso is usable. No torso confidence filter applies in single-player mode.

For two players, use the unmirrored inference image: torso X `<0.5` gives ID `0`,
otherwise ID `1`. Torso X is the midpoint of hips 23/24 if both have visibility
and presence at least `0.5`; otherwise use shoulders 11/12 with the same checks.
Omit detections without either usable pair. Arms crossing the center do not
change assignment. When detections share a half, choose the torso nearest that
half’s center (`0.25`/`0.75`), then highest mean torso visibility/presence, then
lowest torso X. Remaining exact ties use landmark geometry for deterministic
selection independent of result order. Never fill the opposite slot from the
same half. IDs describe regions: a person crossing center changes IDs.

Send ordinary CORS JSON:

```http
POST /v1/config HTTP/1.1
Origin: https://game.example.com
Content-Type: application/json
Content-Length: 17

{"playerCount":2}
```

Example `200` response:

```json
{"playerCount":2,"sessionId":"session-abc","effectiveFromSeq":42}
```

The control grammar accepts exactly the `playerCount` field with integer literal
`1` or `2`, and whitespace. Unknown/duplicate fields, other values, malformed JSON
and unsupported request framing receive `400`. Require JSON (optional UTF-8
charset), explicit Content-Length, no Transfer-Encoding/Content-Encoding/Expect,
a body at most 1 KiB (`413` otherwise), and a two-second total header/body budget.
Unsupported media types receive `415`; wrong methods receive `405`; missing or
unapproved origins receive `403`. Invalid controls do not mutate configuration.
HTTP work uses four fixed workers with no queued requests; concurrent valid
updates serialize under a short publication lock. Requests exceeding worker
capacity are closed and can be retried.

A changed count publishes an empty new-mode snapshot at `effectiveFromSeq`.
An identical request returns the existing mode boundary without publishing or
consuming a sequence number. The launch default has boundary `1`. Startup accepts
controls while status is `starting`; browser disconnection does not reset mode.
Activity foreground return preserves mode within the process; a new process
starts at one player.

Publication owns sequence allocation, mode selection and the empty switch snapshot
under one lock. Subsequent inference completions map using the current mode,
including callbacks for inputs submitted before the switch. A single stream writer
writes records in sequence order. A previously selected old-mode record may arrive
before the boundary even after the HTTP control reply. Use sequence and record
`playerCount`, never response timing, to recognize the transition. Replaceable
snapshots can skip the empty boundary record; every later record is still a
complete new-mode snapshot and clears any omitted player.

For a right-only result, `playerCount` is `2` and the sole pose has `playerId: 1`.
Look up players by ID, never array index. IDs must be unique, valid for the selected
count and serialized in ascending order. Every record replaces all current player
state: `[0,1]`, `[0]`, `[1]` or `[]`. Omission clears immediately; stale timeout
clears both. Keep both side labels and skeletons aligned when mirroring a display.

## 2. Website implementation

### A. Connection UI

Add a small controller panel containing:

- Android IP address.
- **Connect** and **Disconnect** buttons.
- Connection status.
- Last received sample time.
- Separate backend connection status.

Suggested states:

```text
Disconnected → Connecting → Streaming → Reconnecting
                       ↘ Permission/network error
```

The IP can be entered manually or supplied through your existing game configuration.

### B. Initial connection

When the user clicks **Connect**:

1. Validate the IP and use a fixed port, such as `1337`.
2. Fetch `http://<android-ip>:1337/v1/status`.
3. Let Chrome display its local-network permission prompt.
4. Require `protocolVersion: 2` and the advertised player-count capability.
5. POST the game’s selected count to `/v1/config`. Reapply it on every connection.
6. Require status `running` (server ready), polling if necessary with cancellation and explicit errors.
7. Open `/v1/stream` with an AbortController-managed lifetime. This starts camera/GPU initialization; allow up to 90 seconds for the first pose, with heartbeats proving transport liveness during startup. Later count changes use POST on this same open stream. Status/config requests alone leave capture off. Disconnect releases capture/inference resources once the server detects socket closure or a failed/timed-out write.

Show “Camera starting…” after the stream opens. Keep a separate 90-second
first-pose deadline, reset for each connection/reconnect; heartbeats must not
extend it. Mark the camera ready only after an accepted pose matching the selected
mode/config boundary. Keep recording disabled until readiness and required player
detections. Cancel must close the initializing stream so Android can release it.

Use ordinary CORS requests, with cookies omitted. Do **not** use `mode: "no-cors"`; JavaScript would be unable to read the response.

### C. Stream reader

Use `fetch()` and a streaming response reader:

- Decode UTF-8 incrementally.
- Buffer incomplete lines between chunks.
- Parse complete lines as JSON.
- Validate each message.
- Update latest local pose immediately; rendering can use `requestAnimationFrame` without pacing stream reads.
- Forward to the backend through a separate bounded path.
- Replace both player states on every pose snapshot, clearing omitted IDs immediately, and after 500 ms without a fresh pose result. Make this initial stale threshold configurable.
- Treat 12 seconds without any record as a stalled connection and reconnect. An ongoing heartbeat must not reset the pose-age timer.
- Track receipt with browser `performance.now()`. Compare device durations on the device clock; do not subtract Android uptime from browser time without clock calibration (`GET /v1/time`, when status advertises `timeSync`).

**Network chunks are not message boundaries:** one chunk can contain several messages or only part of one.

Use an `AbortController` to stop both connection attempts and the stream when the user disconnects.

### D. Backend forwarding

Reuse the game’s existing authenticated backend connection.

Associate samples with the game session/player **in the browser or backend**, rather than making Android manage game credentials.

Handle backpressure deliberately:

- For state updates, keep the newest sample or send at a fixed rate.
- For events, use a bounded queue and define retry/deduplication behavior.
- Do not accumulate an unlimited backlog while the backend is unavailable.

### E. Reconnection

On stream failure:

- Reconnect with capped backoff, such as 1, 2, 4, then 8 seconds.
- Stop retrying when the user disconnects.
- Detect a changed Android `sessionId`.
- For state data, send a fresh snapshot if available; otherwise wait for the next result without replaying old state.

Do not retry aggressively forever after permission denial. Explain how to restore the site’s local-network permission.

Browser errors may not reliably distinguish permission denial, CORS failure, and an unreachable device; provide a practical troubleshooting message.

### F. Website configuration

Check the game’s response headers:

- **CSP `connect-src`** must permit the Android HTTP endpoint as well as the backend.
- **`upgrade-insecure-requests`** must not silently upgrade that endpoint to HTTPS.
- If the game is embedded in an iframe, verify applicable permission-policy and embedding restrictions.

Bypass service-worker caching and any proxy/compression path that buffers the response. Validate on the deployed HTTPS origin, not only a development page. Do not weaken unrelated site policies blindly to pass this check.

## 3. Android implementation

Although it is your Android “client” application, it acts as the **LAN server** for this connection.

### A. Embedded HTTP server

Use an Android-compatible embedded server that supports **incremental, flushed responses**, not just buffered response bodies.

Configure it to:

- Listen on the LAN-accessible interface, not only `127.0.0.1`.
- Use a fixed port, such as `1337`.
- Serve `/v1/status`, `/v1/stream`, `/v1/config` and `/v1/time`.
- Limit simultaneous streaming connections—one is sufficient for the initial design.
- Reject an additional streaming client with a clear `409` response. Status, config and time requests remain available.
- Prove bounded output and cancellation of a blocked socket write before selecting the server library.

### B. Android permissions and lifecycle

- Declare the Android `INTERNET` permission; it is needed for network sockets even without internet connectivity.
- Declare/request `CAMERA`, and add network-state access for LAN address updates. Verify permission handling on this Things image.
- The inspected board runs API 27. On Android 17 with target SDK 37, declare/request `ACCESS_LOCAL_NETWORK` before accepting LAN connections; gate newer permission logic by OS version. See [Android local-network protections](https://developer.android.com/privacy-and-security/local-network-permission).
- Start the server when the user enables streaming.
- Stop it explicitly when streaming is disabled.
- If streaming must continue while the app is backgrounded, implement an appropriate foreground service and visible notification, subject to Android’s service restrictions.

No outbound WAN connection belongs in this component.

The initial app is activity-owned and stops capture/server when it leaves that lifecycle. Verify unattended service/boot-launch behavior on the board as a separate milestone.

### C. CORS handling

For the website’s approved origin, return:

```http
Access-Control-Allow-Origin: https://game.example.com
Vary: Origin
```

For the stream, also return:

```http
Content-Type: application/x-ndjson
Cache-Control: no-store
```

If you add custom request headers or other preflight-triggering behavior, support `OPTIONS` with the corresponding allowed methods and headers.

Support route-specific `OPTIONS`: `GET` for status/stream/time and `POST` with `Content-Type` for config, without credentials. Config mutations require a configured allowed Origin; a missing Origin is rejected. Read-only status/stream/time remain usable by native LAN diagnostics without Origin. Apply CORS headers to errors for approved origins as well. Validate the request origin against a configured allowlist; never reflect arbitrary origins. The example origin must be replaced by the actual game's origin before browser testing.

**Browser local-network permission and CORS are separate:** both must permit the request.

### D. Data production

Keep data collection separate from HTTP handling:

```text
Camera2 → MediaPipe producer
        ↓
One replaceable latest pose
        ↓
HTTP stream writer
```

The stream writer should:

- Send a snapshot only if the latest pose result is less than 250 ms old; otherwise send a heartbeat immediately and wait for fresh inference.
- Write complete NDJSON records.
- Flush promptly.
- Send idle heartbeats.
- Detect disconnected clients.
- Release resources on disconnect.
- Avoid blocking the Android UI thread.
- Serialize and flush each completed result as soon as the socket is writable, without a fixed-rate sender or intentional batching.
- Keep one pending pose, disable response compression, and bound library/socket buffering. Try `TCP_NODELAY` if exposed and measure its effect.
- Use a cancellable write deadline (initially 250 ms), and close when an unsent pose is over 250 ms old, measured from `resultTimeMs`, rather than continuing to write stale state. Discard pending old-session results on restart.

For live controller state, prefer dropping stale samples over increasing latency.

Conflating application state cannot remove bytes already in TCP buffers. Watch completed write latency and browser age; close/reconnect on sustained stalls. TCP retransmission can still delay delivery on a lossy LAN.

### E. Android UI

Display:

- Current LAN IP.
- Port.
- Streaming enabled/disabled.
- Browser connected/disconnected.
- Basic error information.

The IP can change when Wi-Fi changes, so update the display and restart/rebind the server as needed.

## 4. Acceptance tests

- Android has LAN connectivity but no WAN access.
- First connection prompts for local-network permission.
- Allowing permission starts streaming without a certificate.
- Denying permission produces a useful error.
- Disconnect immediately closes the stream.
- Wi-Fi loss, Android restart, and page reload recover cleanly.
- Backend outages do not cause unbounded buffering.
- Backgrounding Android behaves as intended.
- Multiple or partial NDJSON records are parsed correctly.
- Wi-Fi client isolation does not prevent device-to-device traffic.
- Model loads and runs on the API 27 `armeabi-v7a` firmware without WAN access.
- No-pose results and stale clearing remove the skeleton; heartbeat-only traffic does not preserve it.
- Slow readers, thermal throttling, and backend outages do not grow a stale backlog.
- A changed session resets sequence handling; dropped pose sequences and reconnect snapshots are handled correctly.
- Rotated input and anatomical left/right match the actual camera view.
- Extended sustained-performance checks are deferred by user acceptance. Use a short real-board two-person and live-switch check for this feature; performance goals remain provisional until measured.

## 5. Minimal security boundary

Plain HTTP is consistent with the requirements. Still, restrict access to the intended website origin and expose only the necessary endpoints. CORS is **not authentication** against other LAN applications; add a simple pairing token later if needed.

## References

- [Chrome: Local Network Access permission and HTTP mixed-content exceptions](https://developer.chrome.com/blog/local-network-access)
- [Chrome: Local Network Access shipping status](https://chromestatus.com/feature/5152728072060928)
- [Firefox: Personal device and local-network permissions](https://support.mozilla.org/en-US/kb/control-personal-device-local-network-permissions-firefox)
