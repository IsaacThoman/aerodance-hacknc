# Native libyuv conversion

All camera conversion uses JNI libyuv, and all MediaPipe tasks use the GPU
delegate. The CPU delegate option, saved delegate switch, and Kotlin pixel
converter have been removed at the user’s request. The debug live probe uses
the same GPU/libyuv path as production.

## Build and ownership

Vendored libyuv revision `eeb06a6451ba2e21f8ff272c7b42fc62b9faecc5`
(2026-10-08) is pinned in
[the source record](../androidApp/src/main/cpp/third_party/libyuv/README.aerodance.md).
BSD license, AUTHORS, PATENTS and upstream-file SHA-256 manifest are retained;
license and patent text also ship in the APK's assets. Builds use no libyuv
network fetch. NDK `27.2.12479018` and CMake `3.22.1` are pinned in the version
catalog. All four existing MediaPipe ABIs build for the app's API 27 minimum.
Upstream CMake compiles ARMv7 NEON separately and uses runtime CPU dispatch.
Optional ARM64 SME is disabled due to incomplete NDK r27 C++ compiler support.

`YuvToBitmap` reads Camera2 direct buffers with slices beginning
at their actual positions and ending at their limits. Bounds/strides are checked
before native access. Full-frame YUV_420_888 is required; cropped input is
rejected. The board's adjacent interleaved chroma and planar I420 use libyuv
directly. Other pixel strides use reusable packed I420 scratch, avoiding
libyuv's general-case per-call chroma weave allocation.

For 0° input, `Android420ToABGR` writes RGBA bytes straight into a newly allocated
mutable ARGB_8888 bitmap via AndroidBitmap_lockPixels. Android's bitmap byte order
requires libyuv ABGR, rather than its ARGB output. Rotated input first converts
to reusable RGBA scratch and uses ARGBRotate (which preserves byte channel order).
The destination bitmap never aliases reusable scratch. It remains owned by the
one admitted inference input through callback or task shutdown. Camera images
close after conversion; shutdown closes the task before freeing input storage
and converter scratch. One input and one pending image remain the bounds.

libyuv uses limited-range BT.601, including a signed luma offset for Y below 16.
Native fixtures check against an independent signed-luma BT.601 formula with a
three-level channel tolerance, including below-black and above-white samples.
This reference formula is validation code; production conversion uses libyuv.

## Reproduce on the board

Run host tests and assemble, then install the APK. Avoid rebuilding an APK while
ADB is streaming that same file; install a stable copy if rebuilding concurrently.

```bash
./gradlew :shared:testAndroidHostTest :androidApp:assembleDebug
adb install -r androidApp/build/outputs/apk/debug/androidApp-debug.apk
adb shell am start -n tech.aerodance.androidclient/.diagnostics.LibyuvCompatibilityActivity
adb shell run-as tech.aerodance.androidclient cat files/libyuv-compatibility.txt
```

The fixture probe exercises native loading and bitmap channel order, planar and
separate/interleaved chroma, positioned buffers, padding, exact final-row limits,
odd sizes, SIMD widths, all four rotations, and truncated-plane rejection.
It runs on a worker and owns its storage until completion even if the activity exits.

For live validation, release camera ownership and inspect/apply the documented
vendor continuous/indoor setup before capture. Start a fresh probe activity for each run
(e.g. `am force-stop tech.aerodance.androidclient` between completed probes).
This is the project app; the vendor owner's root-based release procedure is unchanged.

```bash
scripts/release-camera.sh
scripts/prepare-camera.sh --apply --indoor
adb shell am start -n tech.aerodance.androidclient/.diagnostics.CameraCompatibilityActivity \
  --ez livePose true --el durationMs 60000
adb shell run-as tech.aerodance.androidclient cat files/camera-compatibility.txt
```

The report labels the fixed GPU delegate and libyuv converter and gives
conversion p50/p95/p99 (nearest rank,
milliseconds), mean conversion/inference, capture FPS, result/replacement counts
and maximum arrival-to-result age. It includes initialization/first-input costs;
inference startup can occupy a large portion of short GPU probes. The live probe
defaults to 60 seconds to allow GPU initialization. Conversion
samples are bounded by the 120-second diagnostic window; production accumulates
no sample history. These probes do not measure browser latency or allocations.

## Historical conversion comparison

The comparison below preceded removal of CPU inference and Kotlin conversion.
Those options and their diagnostic launch flags are no longer supported.

Host tests and debug assembly passed with all four native ABIs. The packaged
ARMv7 library exports the expected NEON conversion kernels and the APK includes
the libyuv license. All 11 host tests passed. On 2026-10-10, the API 27
`armeabi-v7a` board passed all 80 native fixtures, with maximum reference channel
error 2/255. The final fixture run used the same APK as the live comparisons.

Short live results on that board, unmirrored 640×480, 0° input, `[30,30]` capture
and 30 ms indoor exposure ceiling:

| Delegate / converter | Window | Conversion p50/p95/p99 ms | Mean inference ms | Results (detected) | Results / window second |
|---|---:|---:|---:|---:|---:|
| CPU / Kotlin | 30 s | 49 / 51 / 145 | 257 | 92 (2) | 3.07 |
| CPU / libyuv | 30 s | 3 / 4 / 6 | 262 | 107 (1) | 3.57 |
| GPU / Kotlin | 60 s | 50 / 53 / 58 | 89 | 193 (139) | 3.22 |
| GPU / libyuv | 60 s | 2 / 4 / 4 | 79 | 335 (329) | 5.58 |

Capture remained approximately 30 FPS. Maximum arrival-to-result age was
572/529 ms in the CPU pair and 359/220 ms in the GPU pair. Camera and inference
resources closed after the completed probes; the main activity was restored.
The 30-second GPU attempts completed zero results because initialization occupied
the whole window; both were repeated at 60 seconds. All reports, including those
inconclusive attempts, are retained in [raw probe results](hardware/libyuv-short-probes.json).

These results establish native loading, correctness on these fixtures, callback
delivery with both delegates, and a large short-run conversion reduction. Scene
content was not controlled; detected fractions differ and reported rates include
initialization. They do not establish sustained person throughput, browser
latency, allocation counts, or thermal/lifecycle acceptance. Those checks remain
open as sustained-performance acceptance checks. GPU/libyuv is now the sole
production path at the user’s request.


## GPU/libyuv-only validation

After removing CPU selection and Kotlin conversion, all 8 remaining host tests
and debug assembly passed. The board again passed all 80 native fixtures. The
known-image GPU probe returned one pose and 33 finite landmarks, with 33,086 ms
initialization and 302 ms inference.

The 60-second live probe using the fixed GPU/libyuv path captured 1,799 frames
at 30.08 FPS and completed 300 results (34 detected, 266 empty). Conversion
p50/p95/p99 was 2/4/4 ms; mean inference was 88 ms and maximum arrival-to-result
age was 186 ms. Rates include startup and the scene was not controlled.
See [raw validation reports](hardware/gpu-libyuv-only-validation.json).

The final installed main app reported running and streamed 33 live pose records
over approximately three seconds after GPU initialization, with 640×480
unmirrored input. The main app was left running on the board.
