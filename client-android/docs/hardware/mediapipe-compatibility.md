# MediaPipe CPU compatibility

## Artifacts

Inspected on 2026-10-10. Pinned `com.google.mediapipe:tasks-vision:0.10.21`
from [Google Maven](https://dl.google.com/dl/android/maven2/com/google/mediapipe/tasks-vision/0.10.21/tasks-vision-0.10.21.aar).
Its manifest declares minSdk 24; this app retains minSdk 27. The AAR contains
`jni/armeabi-v7a/libmediapipe_tasks_vision_jni.so` (7,984,040 bytes), as well as
arm64-v8a and x86 libraries. AAR SHA-256:
`5f685c7a57dd1c50dbfa9cf7bf2ad461950a95837993c424d8f44675928ba0d1`.

The packaged [Lite model metadata](../../androidApp/src/main/assets/pose_landmarker_lite.md)
records source, version, license, and checksum. Implementation follows the
[official Android task guide](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/android).

## Observed board result

Installed the debug APK successfully on `192.168.43.1:5555`, API 27,
`armeabi-v7a,armeabi`. The APK contains the same 7,984,040-byte 32-bit native
library inspected in the AAR. On 2026-10-10 the probe reported:

```text
PASS CPU Lite: 1 pose, 33 finite landmarks; input=1000x667; loadMs=1575; inferenceMs=491; nose=(0.46573305,0.423972,-0.14737888)
```

The host protocol/server tests and `:androidApp:assembleDebug` passed. These are
single cold-load/first-inference measurements, not sustained FPS or latency.

## Reproduce on the board

If ADB is disconnected, use the [reconnect sequence](../../README.md) first.
Build and install the debug APK, then provide Google's known pose image to the
debug-only activity. The fixture is downloaded on the host, not by the board:

```bash
./gradlew :shared:testAndroidHostTest :androidApp:assembleDebug
adb install -r androidApp/build/outputs/apk/debug/androidApp-debug.apk
curl -fL -o /tmp/aerodance-pose.jpg https://storage.googleapis.com/mediapipe-assets/pose.jpg
sha256sum /tmp/aerodance-pose.jpg
adb push /tmp/aerodance-pose.jpg /data/local/tmp/aerodance-pose.jpg
adb shell run-as tech.aerodance.androidclient mkdir -p files
adb shell run-as tech.aerodance.androidclient cp /data/local/tmp/aerodance-pose.jpg files/pose.jpg
adb shell am start -n tech.aerodance.androidclient/.diagnostics.PoseCompatibilityActivity
adb shell run-as tech.aerodance.androidclient cat files/pose-compatibility.txt
adb logcat -d -s PoseCompatibility:I
```

Fixture SHA-256: `c8a830ed683c0276d713dd5aeda28f415f10cd6291972084a40d0d8b934ed62b`.
The fixture is not redistributed in the repository or APK.

The probe creates and closes one CPU task on a worker, checks one detected pose
with 33 finite landmarks and an upright nose/hip/ankle ordering, and reports model
load and single-image inference durations. The debug activity is absent from
release builds. Return to `.MainActivity` to use the synthetic stream.

This check does not establish Camera2 capture, LIVE_STREAM callback behavior,
GPU support, sustained performance, WAN-disabled operation, or browser latency.
