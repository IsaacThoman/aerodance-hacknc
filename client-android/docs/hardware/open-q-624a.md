# Open-Q 624A inspection

Inspected over ADB on 2026-10-10. The user identified an Open-Q 624A Development Kit running Android Things. Observations describe this installed image, not all board configurations.

## Platform

| Item | Observation |
|---|---|
| Board | `OPENQ_624A` |
| Product/model | `msm8953_32` |
| Android / SDK | `8.1.0` / `27` |
| ABIs | `armeabi-v7a,armeabi`; no `arm64-v8a` |
| Hardware | `qcom` |
| Build | `qcom/msm8953_32/msm8953_32:8.1.0/OPM1.171019.026/2020000:userdebug/test-keys` |
| Low-RAM | `ro.config.low_ram=true` |
| Kernel-visible RAM | `MemTotal: 1860348 kB`, approximately 1.77 GiB |
| Advertised GLES | `0x30002` (3.2); GPU inference untested |

The current `minSdk = 27` matches this OS. MediaPipe's general baseline is SDK 24+, which does not prove a particular native artifact/delegate works here. Verify the APK ABI and load it on the board. See the [MediaPipe setup guide](https://ai.google.dev/edge/mediapipe/solutions/setup_android).

## Camera service

| Item | Observation |
|---|---|
| Logical cameras | One normal camera, ID `0` |
| Provider | `legacy/0`, HAL 2.4 |
| Camera2 device | `device@3.3/legacy/0`, HAL 3.3 |
| Hardware level | Value `3` (`LEVEL_3`) |
| Facing / orientation | Back / 90 degrees |
| YUV | `YUV_420_888`, including 640×480 and 1024×768 |
| FPS ranges | Includes `[15,15]`, `[20,20]`, `[24,24]`, `[2,30]`, `[30,30]` |
| 640×480 YUV minimum frame duration | 33,333,333 ns, approximately 30 FPS |
| Sensor timestamp source | `UNKNOWN` |
| Current owner | `com.flocksafety.android.ciroc` |
| Configured streams | 2304×1728 JPEG and 1024×768 YUV |
| Dynamic counters | Both reads showed zero produced frames/timestamp zero |
| Error traces | None reported by `dumpsys` |

The provider's Camera1 and Camera2 entries refer to the same logical camera. Feature flags advertise a front camera, but enumeration shows only the back camera; select from actual enumeration.

The owner's current request uses manual controls and a 100 ms frame duration. Those are its settings, not this project's configuration or measured throughput. Zero counters may reflect stalled capture or vendor reporting; inspect real images before concluding.

Vendor library names were visible, including `camera.msm8953.so` and `android.hardware.camera.provider@2.4-impl.so`; shell metadata access was denied. No binaries were inspected, no root was requested, and no firmware/camera settings were changed.

## Reproduce and release ownership

```bash
adb devices -l
adb -s <device-serial> shell getprop ro.build.version.sdk
adb -s <device-serial> shell getprop ro.product.cpu.abilist
adb -s <device-serial> shell dumpsys media.camera
./scripts/release-camera.sh --serial <device-serial>
./scripts/release-camera.sh --serial <device-serial> --stop
```

The script defaults to the inspected board's ADB address, `192.168.43.1:5555`; `--serial` overrides it. The target must already be connected through ADB. It reads **Active Camera Clients**, excluding historical logs. Default mode is a dry run. `--stop` resolves each package's process IDs and uses `su 0 kill -9`, then rechecks ownership. This requires existing working `su` on the device. It does not uninstall/disable packages; supervised/vendor processes may reacquire the camera.

## Remaining checks

- Capture under this project's UID after releasing ownership.
- Content, color, orientation, delivery rate, and sensor clock relationship.
- MediaPipe `armeabi-v7a` loading and CPU/GPU performance.
- HTTP streaming, browser latency, thermal stability, and appliance launch.

Driver availability is established at the service/metadata level. A functioning pose pipeline is not established by this inspection.
