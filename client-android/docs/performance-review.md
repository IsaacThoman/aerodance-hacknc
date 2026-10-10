# Performance review — 2026-10-10

Scope: production Android capture, conversion, inference, lifecycle/UI and LAN
streaming, plus the local browser viewer. This is a code review and short board
regression, not a sustained thermal benchmark.

## Bottleneck map

| Area | Finding / impact | Change or remaining work |
| --- | --- | --- |
| YUV scratch allocation | Every admitted 640×480 frame allocated three plane arrays (about 614 KB with this board's interleaved chroma) and a 1.23 MB ARGB array. Repeated large allocations can add GC pressure on the low-RAM board. | One converter per estimator now reuses exact-sized plane arrays and the ARGB destination. Bitmap storage still has a separate lifetime through callback/task shutdown; scratch reuse cannot overwrite native input. |
| YUV arithmetic | Rotation selection and chroma contribution arithmetic repeated per pixel. | Rotation selects a row start and increment; each horizontal pixel pair shares chroma calculations. Strides, odd dimensions, all four rotations and output values are covered by reference-based tests. |
| MediaPipe | CPU inference dominated the measured service time; GPU initialization can take tens of seconds. | GPU remains the saved/default option. One task and one input in flight remain enforced. Faster native conversion and model/delegate tuning require measured compatibility and accuracy on this API 27/32-bit ARM board. |
| Activity address refresh | Every 500 ms added an interface-enumeration job to the lifecycle executor, including while release was blocked. | Refresh at most every five seconds with at most one refresh outstanding. Main-thread result updates are suppressed when inactive. Counter polling remains independent of inference. |
| Landmark validation | Two temporary lists and boxed float values for every landmark. | Direct finite/range checks preserve validation without those lists. |
| HTTP request parsing | Unbuffered byte reads plus temporary tail strings for each header byte. | Buffered reads and a rolling four-byte delimiter; existing 8 KB and two-second header limits remain. |
| Stream output | Serialization allocates strings and performs a size-validation UTF-8 pass before the final encoding. Current payloads are only a few KB. | Lower priority than conversion/inference. Serialization stays on the writer, behind one replaceable result; optimize only if stage profiling shows material cost. |
| Socket pressure | A blocked browser could otherwise hold workers or accumulate delayed output. | Existing fixed four workers, no request queue, one stream, latest result, 250 ms write deadline and stale-result check are retained and regression-tested. TCP/kernel buffering still needs end-to-end latency measurement. |
| Hidden browser tab | The receive-rate array was pruned only during animation frames, which pause in hidden tabs. | Prune on receipt too and cap at 1,000 samples. Hidden rendering cannot cause this array to grow indefinitely. |
| Browser rendering | The test viewer redraws and updates several DOM counters every animation frame. | Acceptable for this diagnostic viewer; profile before using it as a game renderer. One latest pose and a bounded NDJSON decoder are retained. |
| Camera/HAL and thermals | Capture cadence, exposure, other camera owners and thermal throttling can limit results regardless of queue policy. | Continuous-mode setup is already required. Confirm settings after vendor apps run; sustained memory/thermal testing and real-person accuracy remain open. |

## Short board comparison

Consecutive 30-second CPU probes on the same board, 640×480, rotation 0:

| APK | Capture FPS | Completed results | Detected / empty | Mean conversion | Mean inference | Max arrival-to-result |
| --- | --- | --- | --- | --- | --- | --- |
| Before | 30.08 | 87 | 7 / 80 | 59 ms | 266 ms | 554 ms |
| Conversion changes | 30.08 | 89 | 5 / 84 | 50 ms | 268 ms | 561 ms |

Conversion mean fell about 15% in this short comparison. Inference still dominates
CPU output; this does not establish a sustained FPS increase or improved tail
latency. The scene was not controlled and most results were empty. The allocation
reduction follows from buffer sizes/code; GC frequency was not profiled.

A final 60-second GPU probe passed: 1,796 camera frames at 30.05 FPS, 189 results
(85 detected / 104 empty), mean conversion 49 ms, mean inference 97 ms and maximum
arrival-to-result 426 ms. Camera/task resources closed after completion. The
whole-window rate of 3.15 results/s includes startup; it is not a steady-state
rate. The earlier GPU run in the linked hardware report used an empty scene,
so its inference timings are not a controlled comparison with this run.

## Verification and next measurements

Host tests and debug APK assembly passed. The YUV test compares a reused output
buffer with the original conversion equations using odd dimensions and padded,
interleaved planes at every supported rotation. Seven browser protocol/state
tests and JavaScript syntax validation passed using the locally installed Node
22 executable (Node/npm are absent from the shell PATH).

The final APK was installed on the board. The synthetic stream regression passed
CORS, OPTIONS, JSON, empty poses, single-client enforcement, disconnect and
blocked-write recovery: 326 poses at 29.5 Hz, median interval 32.7 ms, maximum
record 2,433 bytes; the slow-reader slot released in 0.69 seconds.

Before claiming the latency targets, measure real-person CPU/GPU steady-state
rates and stage p50/p95/p99, native/Java memory and thermals over 30 minutes.
Capture-callback arrival and browser receipt use different clocks; use calibration
or an external visual test. See [the plan](../PLAN.md) and
[earlier board measurements](hardware/live-pose-validation.md).
