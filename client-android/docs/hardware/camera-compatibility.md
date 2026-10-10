# Camera2 capture compatibility

## Probe

The debug-only `CameraCompatibilityActivity` opens camera `0`, creates one
640×480 `YUV_420_888` ImageReader (`maxImages = 3`), and requests automatic
controls with `[30,30]` FPS and `TEMPLATE_RECORD`, matching the guide’s day path. It acquires the latest image on one camera worker and
closes each acquired image with `use`, including inspection/conversion failures.
It allows a 12-second capture window (normally snapshots at 11 seconds) and has a 20-second setup/capture timeout.
The measurement is saved before resource closure because HAL teardown can stall.

The report includes frame count, arrival/sensor interval rates, non-increasing
sensor timestamps, actual plane row/pixel strides, and sensor orientation. Rates
use intervals within each clock independently; no sensor-to-arrival latency is
claimed for this sensor's unknown timestamp source. A PASS requires at least 30
images and positive, strictly advancing sensor timestamps; it does not establish
30 FPS or plausible pose inference.

After at least 30 frames and 11 seconds of capture, the probe converts one image using actual plane strides, rotates it
by the advertised sensor orientation without mirroring, and saves
`files/camera-upright.png` privately for visual inspection. This local diagnostic
snapshot is absent from release builds and is never streamed. Content, color,
and rotation require inspecting this image; metadata alone cannot verify them.

## Reproduce

Use the [ADB reconnect instructions](../../README.md) if necessary. Run from
`client-android`:

```bash
./gradlew :shared:testAndroidHostTest :androidApp:assembleDebug
./scripts/release-camera.sh
./scripts/release-camera.sh --stop
./scripts/prepare-camera.sh --indoor
./scripts/prepare-camera.sh --indoor --apply
adb install -r androidApp/build/outputs/apk/debug/androidApp-debug.apk
adb shell pm grant tech.aerodance.androidclient android.permission.CAMERA
adb shell am start -S -W -n tech.aerodance.androidclient/.diagnostics.CameraCompatibilityActivity
# After the 12-second capture window (teardown may take longer):
adb shell run-as tech.aerodance.androidclient cat files/camera-compatibility.txt
adb logcat -d -s CameraCompatibility:I Camera3-Device:E
./scripts/release-camera.sh
```

The explicit ADB grant makes unattended capture reproducible. The activity also
requests CAMERA when absent; interactive grant/denial behavior is unverified on
this Things image. The probe activity remains debug-only; CAMERA is now declared in the main
manifest for the live pipeline.

The launch uses `-S` to restart this project's app before each probe, ensuring a
fresh activity even when an earlier probe is still in its task stack. It does not
stop the vendor camera service. For the advertised
variable-rate diagnostic alternative, add `--ei fpsMin 2 --ei fpsMax 30` to the
probe launch. This does not change the production configuration. To retrieve a
snapshot after successful capture:

```bash
adb exec-out run-as tech.aerodance.androidclient cat files/camera-upright.png > /tmp/aerodance-camera-upright.png
```

The user confirmed that stopping the competing camera service requires existing
root access. The release script retains `su 0 kill -9`; do not substitute
`am force-stop`. Vendor apps can restart; check ownership before and after tests.

## Board observations — 2026-10-10

The debug APK installed on the API 27 `armeabi-v7a` board. CAMERA was granted
using ADB. No competing camera owner was active when capture began, so
`release-camera.sh --stop` performed no kill in this session.

The first baseline run opened camera `0` under this app's UID (`10026`), configured
640×480 YUV, and submitted `[30,30]` repeating requests. It delivered **zero
images** during the 12-second window:

```text
FAIL camera=0 YUV=640x480 requestedFps=[30,30]; frames=0; arrivalFps=0.0; sensorFps=0.0; sensorFirstNs=0 sensorLastNs=0 nonIncreasing=0; arrivalIntervalMs=0.0..0.0; planeRowPixelStrides=[]; rotation=90; no snapshot
```

During capture, `dumpsys media.camera` showed this app as the sole active client,
zero produced frames, timestamp zero, and three in-flight requests lacking both
metadata and returned buffers. Shutdown reported
`waitUntilDrainedLocked: ... Connection timed out (-110)` and a leaked stream
reference in the camera service; ownership subsequently cleared. This is a
failed capture test, not merely an interpretation of vendor counters.

Vendor logs during the run included `Invalid cam_format`,
`sensor_set_frame_duration: ... frame_duration 0`, and buffer allocation errors.
These are diagnostic observations, not an established root cause. Historical
logs also show drain timeouts for the previous vendor camera owner.

The `[2,30]` alternative and a fresh-process `[30,30]` retry both also delivered
zero images in their 12-second windows. Both emitted `Camera resources closed`
after approximately five additional seconds of HAL teardown, and the release
script then found no active owners. No competing restart was observed. The root
release behavior is preserved, but this session did not exercise killing a
competing owner because none was active.

`:shared:testAndroidHostTest` and `:androidApp:assembleDebug` passed. Host checks
validate existing shared behavior; real capture validation failed as described
above. The new stride conversion and snapshot path could not be exercised on
the board because no images arrived.

Content, strides, actual orientation, achieved capture FPS, and real-frame
inference remain unverified. No firmware, driver, or vendor service changes were
made. Milestone 1 remains open; resolve real image delivery before live pipeline
integration.


## Camera guide bring-up — 2026-10-10

Following `/home/nap/Documents/Flock Workspace/decomp-ciroc/CAMERA_GUIDE.md`,
readback showed retained motion mode `1`, timeout `2000`, multimode `1`, and
vendor AEC maximum exposure `0.75` ms. No competing camera owner was active.
Changing **only** motion enable and timeout to `0` restored frames even with the
original preview request: 266 frames, 22.58 FPS including diagnostic conversion,
strictly advancing sensor timestamps, and clean shutdown. This isolates retained
motion configuration as the cause of the previous zero-frame runs; no driver or
firmware change was necessary. Multimode and motion.mode were left as observed.

The camera was initially face down on a table (confirmed by the user). After
repositioning, the 0.75 ms AEC ceiling still produced a very dark scene. Raising
`vendor.flock.chromatix.max_exposure_time_ms` to `30` and setting
`vendor.flock.chromatix.apply=true` produced a visible color scene, with luma
11..208, mean 139.91 in the first indoor snapshot. The vendor gain limit remains
`8`. This is an exposure ceiling, not a fixed shutter request. Motion properties
persist; vendor AEC properties should be reapplied after reboot. To restore the
observed original setup with no active camera owner:

```bash
adb shell su 0 setprop persist.sys.camera.motion.en 1
adb shell su 0 setprop persist.sys.camera.motion.timeout_ms 2000
adb shell su 0 setprop vendor.flock.chromatix.max_exposure_time_ms 0.75
adb shell su 0 setprop vendor.flock.chromatix.apply true
```

`scripts/prepare-camera.sh` provides inspection by default and explicit `--apply`
with readback verification and an active-owner guard. `--indoor` enables the
30 ms ceiling. It does not stop owners; use the existing release script first.
The probe now uses record template, AF off, AE on, AWB auto, and antibanding off.
Ciroc's byte-valued night-mode and histogram keys are checked against available
request keys. Neither is advertised on this board, so both are skipped.

The first passing reports included a roughly 3-second gap caused by conversion
and PNG compression on the acquisition worker at frame 30. The probe now saves
its single snapshot at the end of the measurement so this diagnostic cost does
not reduce the reported capture rate. This is a debug artifact only, not a live
preview or video endpoint. Actual planes are row/pixel strides `640/1`, `640/2`,
`640/2`; advertised rotation is 90°, producing an unmirrored 480×640 snapshot.
The image shows real scene/color content; an upright person and anatomical
left/right still need validation before inference integration.


Final installed-probe measurement (snapshot cost excluded):

```text
PASS camera=0 YUV=640x480 requestedFps=[30, 30]; frames=332;
arrivalFps=30.081517457934936; sensorFps=30.079750367631892;
sensorFirstNs=5364620521056 sensorLastNs=5375624601740 nonIncreasing=0;
arrivalIntervalMs=29.159636..37.354479;
planeRowPixelStrides=[640/1, 640/2, 640/2]; rotation=90;
Y min=4 max=209 mean=131.03561197916667; upright=480x640 unmirrored
```

This is approximately 11 seconds of capture, not sustained/thermal validation.
The image shows a close object and background with visible color. The final
probe saves exactly one snapshot and drains queued callbacks without extending
the measurement. Resource closure completed about 259 ms after the report, and
the release script found no owner afterward. Several preceding reopen runs also
returned frames and closed cleanly. The APK containing the final probe is
installed. Host tests and debug assembly passed; shell syntax, inspection-only
behavior, successful apply/readback, and rejection while a camera owner was
active were exercised. No competing owner needed killing. These observations
supersede the earlier zero-frame failure and unknown stride/rate conclusions;
live inference and person orientation checks remain pending.

For the subsequent live Camera2 → MediaPipe CPU tests, see
[live pose validation](live-pose-validation.md).
