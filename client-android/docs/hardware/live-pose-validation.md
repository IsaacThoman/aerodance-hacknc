# Live camera pose validation — 2026-10-10

The main app now captures camera `0` at 640×480 YUV and runs the pinned MediaPipe
Lite task on CPU in `LIVE_STREAM` mode. Following the user's mounting correction,
it now processes raw **640×480 without rotation or mirroring**. The historical
measurements below used 90° clockwise rotation and 480×640 input.
It does not display or stream camera images. World landmarks and
segmentation masks are not published.

`LivePoseEstimator` keeps one inference input and one replaceable pending camera
image. Camera acquisition runs on its own worker. Conversion uses bulk plane
copies, actual row/pixel strides, and direct rotation into ARGB. Every replaced
or rejected image closes. Submitted MPImage/Bitmap storage remains owned until
the matching callback or native task shutdown. Task timestamp keys strictly
increase; wire timestamps preserve capture-callback arrival on Android's
monotonic clock, independent of the unknown sensor clock domain.

Results are copied to immutable protocol values and published immediately,
including `poses: []`; the HTTP writer waits for notification rather than a
producer timer. The activity UI polls counters but does not pace inference or
network output. Both camera silence and missing inference callbacks have
5-second watchdogs. Errors close the pipeline and surface a message; recovery
requires Start or a later foreground entry. Watchdog/error injection is still
an acceptance check. Shutdown releases pending images, drains the native task,
then closes the ImageReader. Normal Start/Stop releases are serialized before
the next start.

## Debug probe

From `client-android`, after continuous-mode setup and with no competing owner:

```bash
./gradlew :shared:testAndroidHostTest :androidApp:assembleDebug
adb install -r androidApp/build/outputs/apk/debug/androidApp-debug.apk
adb shell pm grant tech.aerodance.androidclient android.permission.CAMERA
adb shell am start -S -W -n tech.aerodance.androidclient/.diagnostics.CameraCompatibilityActivity --ez livePose true
# After its 12-second window:
adb shell run-as tech.aerodance.androidclient cat files/camera-compatibility.txt
adb shell run-as tech.aerodance.androidclient cat files/camera-live-pose.json
```

This mode saves only the final landmark record and counters privately, with no
snapshot or preview. Omitting `--ez livePose true` retains the original capture
probe and its single diagnostic snapshot.

The first live test used per-pixel direct ByteBuffer access: 355 camera frames,
30.08 FPS, 3 empty results, mean conversion 2,530 ms, mean inference 483 ms,
maximum arrival-to-result 3,170 ms, and 350 pending replacements. It established
callback delivery and bounded admission, but was too slow for useful control.

Bulk plane copies and direct ARGB rotation produced this second 12-second run:

```text
PASS camera=0 YUV=640x480 requestedFps=[30, 30]; frames=355;
arrivalFps=30.08457596530606; sensorFps=30.079701818835037;
nonIncreasing=0; arrivalIntervalMs=27.851042..38.550886;
planeRowPixelStrides=[640/1, 640/2, 640/2]; rotation=90;
LIVE_STREAM results=24 detected=0 empty=24 replacements=329;
meanConversionMs=63; meanInferenceMs=358; maxArrivalToResultMs=642;
upright=480x640 unmirrored
```

These averages are over completed results and include startup effects. They are
short CPU tests, not a 30-minute benchmark or achievement of the latency targets.
The scene contained no detected person. Plausible landmark output on the known
image remains established by the [CPU compatibility probe](mediapipe-compatibility.md).
Actual person orientation, left/right, motion, and detected-to-empty transitions
still require a person in view.

## Local browser

Per the user's direction, [pose-test-site](../../pose-test-site/README.md) is an
HTTP-only test site in this repository. Deployed HTTPS testing is deferred.
Chromium **153.0.8010.12** at `http://localhost:8081` fetched the board's status
and streamed real Lite CPU records using the matching CORS origin. The page
observed advancing sequence 36, 3 records in the preceding second, empty pose,
480×640 input, and 575 ms Android arrival-to-result processing time. There were
no page script errors. This proves direct browser incremental delivery of live
results, not real skeleton rendering in the camera scene.

Playwright granted `local-network-access`; the interactive permission prompt
was not tested. No security-disabling flags, certificate, proxy, or desktop
bridge were used. The static server supplies no CSP or upgrade policy. Chrome
permission denial/revocation, an actual game's headers, HTTPS mixed-content,
WAN isolation, and other browsers remain open checks.

Separate known-fixture browser tests verified visible skeleton rendering,
mirror display, immediate empty clearing, clearing after 500 ms without a pose,
explicit disconnect, and no horizontal overflow at 390-pixel width. Seven Node
protocol/state tests and the Android host tests passed; debug assembly passed.
Docker configuration was added but not exercised.

## Final APK regression and activity transitions

The final debug APK retains opt-in synthetic diagnostics. Running the existing
`check-stream.py` with `http://localhost:8081` passed CORS, OPTIONS, JSON,
periodic absence, the single-client limit, disconnect, and blocked-write
recovery: 330 records at 29.9 Hz, median interval 32.4 ms, maximum record
2,433 bytes. The slow-reader stream slot released in 0.33 seconds.

After returning to real capture, two HOME → MainActivity foreground cycles
closed the listening socket, left no active camera owner, and resumed live
Lite results with new session IDs. The process was not killed between these
cycles. This verifies the initial activity-owned path; boot, screen-off,
permission denial, camera contention, low memory, and sustained operation
remain separate lifecycle checks.
