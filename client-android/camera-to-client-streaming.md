# Camera-to-client streaming plan

This is the connection and protocol specification for the Open-Q 624A Android Things pose app. See [PLAN.md](PLAN.md) for implementation order, [ARCHITECTURE.md](ARCHITECTURE.md) for component boundaries, and [the hardware inspection](docs/hardware/open-q-624a.md) for device constraints. The endpoints below are implemented for synthetic poses on port 1337. Real camera inference and deployed browser validation remain pending.

## Proposed design

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

Example status response:

```json
{
  "protocolVersion": 1,
  "deviceId": "controller-01",
  "sessionId": "session-abc",
  "deviceName": "Open-Q 624A Pose Controller",
  "pipelineState": "running",
  "capabilities": {
    "poseModel": "pose_landmarker_lite",
    "maxPoses": 1,
    "landmarksPerPose": 33,
    "worldLandmarks": false,
    "sensorTimestampSource": "unknown"
  }
}
```

### Streaming format

Use **newline-delimited JSON (NDJSON)**: one JSON object per line.

```jsonl
{"protocolVersion":1,"type":"pose","sessionId":"session-abc","seq":1,"frameReceivedTimeMs":1250,"resultTimeMs":1284,"input":{"width":480,"height":640,"mirrored":false},"poses":[]}
{"protocolVersion":1,"type":"pose","sessionId":"session-abc","seq":2,"frameReceivedTimeMs":1283,"resultTimeMs":1318,"input":{"width":480,"height":640,"mirrored":false},"poses":[]}
{"protocolVersion":1,"type":"heartbeat","sessionId":"session-abc","producerTimeMs":6320,"lastPoseSeq":2,"pipelineState":"running"}
```

Rules:

- Each message ends with `\n`.
- `sessionId` changes whenever the producer restarts, including camera/model configuration changes. Reconnecting the browser alone does not change it.
- Assign `seq` to completed pose results before publishing; it increases within a session. Replacement may create gaps. Heartbeats use `lastPoseSeq` (null before the first result), without consuming pose sequence numbers.
- On reconnect, a fresh snapshot may repeat the latest sequence. Reset per-connection duplicate handling, then ignore out-of-order/duplicate poses within that connection.
- Send a heartbeat after five seconds without a record. It proves transport liveness, not successful camera capture or pose freshness.
- Limit each UTF-8 record to 16 KiB excluding the newline. Reject oversized or invalid records; do not let the browser's incomplete-line buffer grow beyond the limit.

### Pose payload

The two example pose records above demonstrate **no person detected**, not a working skeleton. A detected pose contains one element in `poses`, with exactly 33 landmarks in MediaPipe index order. Each landmark has this shape:

```json
{"x":0.52,"y":0.31,"z":-0.08,"visibility":0.99,"presence":0.98}
```

`poses` therefore contains objects shaped as `{ "landmarks": [33 landmark objects] }`. The text in that shape description is explanatory, not JSON to transmit. The codec includes a complete 33-landmark detected-person fixture in [Protocol.kt](shared/src/commonMain/kotlin/tech/aerodance/androidclient/protocol/Protocol.kt). Synthetic mode advertises `poseModel: "synthetic"` in status; the Lite capability applies after camera/model integration.

- Coordinates refer to the upright inference input after rotation, with dimensions given by `input`. Start unmirrored even though this board's sensor orientation is 90 degrees. UI mirroring is a separate display transform; anatomical left/right labels keep MediaPipe's meaning.
- `x`/`y` are image-normalized coordinates; preserve finite out-of-image estimates rather than clamping. `z` is relative depth, not meters. If negotiated through status, optional `worldLandmarks` uses the same index order with meter-valued coordinates. See [MediaPipe output coordinates](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/android).
- Encode optional unavailable visibility/presence scores as null. Reject NaN/infinity; never serialize invalid JSON numbers.
- Send `poses: []` for every completed inference with no pose. Do not silently retain the last detected person.
- `frameReceivedTimeMs` is arrival at the Android capture callback; `resultTimeMs` is callback completion from inference. Both use the same Android monotonic clock. They are not wall-clock timestamps or proven sensor exposure times.
- This sensor reports an unknown clock source. Optional `sensorTimestampNs`, if added, must be a decimal string to avoid JavaScript integer precision loss, with its clock relationship explicitly documented.
- Status/heartbeat `pipelineState` is one of `starting`, `running`, `error`, or `stopping`. A running pipeline can legitimately return no pose.
- Protocol version 1 is implemented by the synthetic Android producer. Keep these field names stable during browser integration.

**Pose results are state; delivery favors freshness:**

- **State**, such as the latest pose: replace older samples when a consumer falls behind.
- **Events**, such as a button press: delivery may need acknowledgment, replay, and deduplication. An open HTTP stream alone does not guarantee end-to-end delivery.

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
4. Check `protocolVersion`.
5. Open `/v1/stream` with a separate AbortController-managed lifetime.

Use ordinary CORS requests, with cookies omitted. Do **not** use `mode: "no-cors"`; JavaScript would be unable to read the response.

### C. Stream reader

Use `fetch()` and a streaming response reader:

- Decode UTF-8 incrementally.
- Buffer incomplete lines between chunks.
- Parse complete lines as JSON.
- Validate each message.
- Update latest local pose immediately; rendering can use `requestAnimationFrame` without pacing stream reads.
- Forward to the backend through a separate bounded path.
- Clear the pose immediately on `poses: []`, and after 500 ms without a fresh pose result. Make this initial stale threshold configurable.
- Treat 12 seconds without any record as a stalled connection and reconnect. An ongoing heartbeat must not reset the pose-age timer.
- Track receipt with browser `performance.now()`. Compare device durations on the device clock; do not subtract Android uptime from browser time without clock calibration.

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
- Serve `/v1/status` and `/v1/stream`.
- Limit simultaneous streaming connections—one is sufficient for the initial design.
- Reject an additional streaming client with a clear `409` response. Status requests remain available.
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

Initially support `OPTIONS` for `GET` and the approved origin without credentials or custom headers. Apply CORS headers to errors for approved origins as well. Validate the request origin against a configured allowlist; never reflect arbitrary origins. The example origin must be replaced by the actual game's origin before browser testing.

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

## 4. Implementation order

1. Validate camera capture and 32-bit MediaPipe loading on the board.
2. **Android:** implement `/v1/status` and flushed synthetic poses.
3. **Website:** connect from the actual HTTPS game, verify permissions/policies, and display synthetic poses without backend forwarding.
4. Connect Camera2 → MediaPipe → latest pose → stream writer.
5. Measure freshness/throughput; tune conversion, delegate, resolution, and buffering.
6. Add backend forwarding, reconnection, bounded buffering, and lifecycle handling.
7. Verify appliance deployment and document tested browser versions; evaluate Firefox separately.

**Do the deployed-site test early.** Hardware and browser feasibility checks can proceed independently; both must pass before full integration. [PLAN.md](PLAN.md) provides the detailed milestone checklist.

## 5. Acceptance tests

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
- Record sustained FPS, p50/p95/p99 stage timings, and browser freshness over 30 minutes. Performance goals in the architecture remain provisional until measured.

## 6. Minimal security boundary

Plain HTTP is consistent with the requirements. Still, restrict access to the intended website origin and expose only the necessary endpoints. CORS is **not authentication** against other LAN applications; add a simple pairing token later if needed.

## References

- [Chrome: Local Network Access permission and HTTP mixed-content exceptions](https://developer.chrome.com/blog/local-network-access)
- [Chrome: Local Network Access shipping status](https://chromestatus.com/feature/5152728072060928)
- [Firefox: Personal device and local-network permissions](https://support.mozilla.org/en-US/kb/control-personal-device-local-network-permissions-firefox)
