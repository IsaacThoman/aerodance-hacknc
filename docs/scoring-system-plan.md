# Scoring system plan

Prepared 2026-10-11. This is the proposed scoring design, not an implemented
engine. It refines the [game integration plan](android-game-integration-plan.md)
and uses the existing [song bundle contract](game-song-bundles.md).
The user's five requirements take precedence over the earlier scoring candidates.
Weights and thresholds below are starting values to validate on real attempts.

## Requirements and decisions

| Requirement | Proposed decision |
| --- | --- |
| Camera distance and player size must not determine the score. | Compare aspect-corrected, hip-centered coordinates divided by each pose's own torso size. |
| Score throughout the game; perfect total is 10,000. | Fixed song-time intervals with a duration-based budget totaling 10,000 per player; separate immediate feedback. |
| Ignore elbows/knees; group hands, feet, head, possibly body. | Six groups: left hand, right hand, left foot, right foot, head, torso. Elbows/knees have no role in features, normalization, confidence, or coverage. |
| Account for Android delay. | Map capture callback time to browser time, subtract measured pre-callback capture delay, then map to the audible song timeline. |
| Interpolate reference poses for accurate timing. | Sample at exact comparison times using bounded interpolation and authoritative quality/absence boundaries. |

The browser owns scoring. Player 0 compares with track 0; player 1 with track 1.
The same player-0 input must produce the same result in either player mode.
Pin song revision, scorer version, settings, and calibration for reproducibility.

## Current implementation and prerequisites

- [AndroidPoseSource](../client/src/pose/AndroidPoseSource.js) already exposes
  `subscribeRecords`, with accepted records and browser receipt timestamps.
  Use it for history; UI subscriptions repeat state and are unsuitable for scoring.
- [sampleSong](../packages/pose/song.js) already provides finite, player-keyed
  reference sampling, interpolation limits, and authored exclusions.
  Its shared sampler conservatively intersects endpoint eligibility masks.
  Scoring must additionally check confidence at both endpoints; coordinate
  interpolation by itself does not establish reliable evidence.
- Choreography supplies input dimensions per track, quality masks, and song times.
  Live records supply effective inference dimensions and Android timestamps.
- Android has no advertised clock-exchange capability yet. `GET /v1/time`,
  browser/device clock mapping, residual capture calibration, a gameplay audio
  transport, and the scorer remain work to implement.
- Current song preview uses an HTML audio element. Scored gameplay needs the
  audible-clock transport described below, rather than a render-delta clock.

## Pose normalization and grouped features

Use unmirrored anatomical landmarks. Coach mirroring affects rendering only;
never choose whichever mirror gives the player a better score.

For each reference or live pose independently, using that source's dimensions:

```text
p[j] = (landmark[j].x * inputWidth / inputHeight, landmark[j].y)
H = (p[23] + p[24]) / 2       # hip center
S = (p[11] + p[12]) / 2       # shoulder center
s = length(S - H)            # apparent torso length
n[j] = (p[j] - H) / s
```

Require reliable shoulders and hips and a nondegenerate torso before using this
transform. Under uniform image scaling and translation, numerator and denominator
scale together, so the normalized pose is unchanged. A small reference dancer
and a large live dancer are therefore compared in the same units. Do not compare
raw pixel distances, bounding-box sizes, or distance from the camera.

Use the current reliable pose's scale for scoring, independently of the fixed
character-rendering calibration. A fixed scale alone would penalize a player who
moves closer during the song. Keep display smoothing separate. Start without
score-input smoothing; evaluate torso jitter before adding any filter, and test
that its lag and scale behavior do not break the distance requirement.

This removes uniform size differences; it does not recover geometry hidden by
perspective, body turns, or foreshortening. Test real near/far captures, forward
lean, crouches, and different body proportions separately. Torso normalization
does not fully remove arm/leg proportion differences. If these produce material
bias, evaluate calibrated shoulder-to-hand and hip-to-foot reach normalization
without introducing elbows/knees. Do not stretch X/Y independently or rotate
the torso upright, because those operations can hide real pose mistakes.

Use XY in the first scoring version. Android's relative Z is not metric depth
and world landmarks are not currently streamed. Any later depth feature must
pass the same near/far tests. MediaPipe documents the coordinate meanings in its
[Android guide](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/android).

| Group | Feature | Initial weight |
| --- | --- | ---: |
| Left hand | Wrist 15, normalized relative to hip center | 0.20 |
| Right hand | Wrist 16, normalized relative to hip center | 0.20 |
| Left foot | Ankle 27, normalized relative to hip center | 0.20 |
| Right foot | Ankle 28, normalized relative to hip center | 0.20 |
| Head | Center of nose 0, outer eyes 3/6, ears 7/8 | 0.10 |
| Torso | Direction of shoulder center from hip center | 0.10 |

Treat wrists and ankles as stable group anchors initially. They match the
Frutiger rig and avoid scoring finger placement, hand rotation, or toe direction.
Evaluate palm centers (15/17/19/21 and 16/18/20/22) and foot centers
(27/29/31 and 28/30/32) as alternatives, then freeze one definition per scorer
version. Do not switch anchor definitions when a landmark becomes occluded.

For head center, choose the reliable, eligible reference members before gameplay;
require at least three members, including evidence from both sides of the face.
Use the same member set and equal weights for live and reference. If a required
live member is missing, that group's evidence is unavailable; do not move its
center by silently averaging a different subset.

The torso center alone would become almost constant after centering/scaling.
Instead, score the angle of `S-H` in camera coordinates, preserving left/right
lean. No rotation alignment is applied. Root translation across the camera frame
is omitted initially: camera placement would otherwise affect the result.
This means pure whole-body translation with unchanged relative pose is not
distinguished in this version; lateral-travel scoring needs a separate validated
feature. Crouch/foot placement can still change the normalized endpoint features.

## Confidence and reference coverage

Provisional live reliability requires both visibility and presence at least 0.5;
null values are unavailable. Reference eligibility follows published
`scoreEligible` masks and the documented review policy; explicitly reviewed
references can be accepted despite unavailable original confidence.
Normalization anchors must also be eligible/reliable, even though their individual
positions do not each receive a separate score.

Compile a reference-only eligibility schedule before gameplay. A proposed usable
reference instant requires normalization anchors, both hands, both feet, and
at least one of head/torso. Normalize weights over those reference-eligible
groups in advance. Unusable reference instants receive no budget and must be
reported to the author. Require at least 90% usable reference duration per track
as a provisional publication target, replacing Studio's current nonempty-coverage
check when scoring is integrated. Validate this target before freezing it.

Live evidence never changes the possible-point denominator or reference weights.
A missing live group earns zero for its fixed weight; missing torso anchors make
the entire instant unavailable. This prevents hiding a difficult limb from raising
the score. Report tracking coverage independently from dance accuracy, and show
“Tracking lost” instead of a dance judgment when coverage is insufficient.

## Capture time and audible song time

Implement the additive Android `GET /v1/time` capability proposed in the
integration plan, with request-received/response-prepared Android monotonic times
and session ID. For browser send/receive times `b0/b3` and Android times `a1/a2`:

```text
androidMinusBrowser = ((a1 - b0) + (a2 - b3)) / 2
networkRoundTrip = (b3 - b0) - (a2 - a1)
captureBrowserTime = frameReceivedTimeMs - androidMinusBrowser - captureDelayMs
poseSongTime = audibleSongTimeAt(captureBrowserTime)
```

Take a bounded set of exchanges, prefer low-RTT samples, reject outliers, and
refresh periodically to estimate clock drift. Keep uncertainty and mapping validity
ranges. Freeze mappings for finalized intervals; later drift estimates must not
rewrite previously awarded points. Inference/network delays affect arrival time,
but must not move the pose's comparison time. Never use `resultTimeMs` or browser
receipt time as the dance instant, and never subtract unrelated clocks directly.

Measure `captureDelayMs` using an external visual synchronization test; the sensor
clock relationship is currently unknown. This delay precedes the camera callback
and is not measured by callback-to-result processing duration. Keep device latency
calibration independent of the player's dance performance.

Use Web Audio output timestamp pairs to map browser monotonic time to audible
audio position. Include scheduled start, playable offset, and pause/resume segments
in this mapping. Measure a fallback and its uncertainty when output timestamps
are unavailable. Output-route changes trigger recalibration. The timestamp pair
is defined in the [Web Audio specification](https://www.w3.org/TR/webaudio-1.1/#dom-audiocontext-getoutputtimestamp).

Initial operating values: two seconds of pose history and 750 ms late-arrival
allowance. Finalize an instant only after its deadline, allowing a following live
sample for interpolation. Reject later arrivals for that finalized instant.
Tune the allowance from measured full-song latency tails. Keep it distinct from
the interpolation gap limit and any human timing tolerance.

Version one compares exact corrected song times. Do not search nearby target
times, use DTW, or optimize latency from dance similarity. Small spatial dead zones
provide initial noise tolerance while deliberate early/late attempts remain
measurably different. Evaluate bounded human timing tolerance only if needed,
with an explicit displacement penalty and fixed versioned limits.

Pause audio/reference/scoring together on extended transport failure, invalid clock
mapping, or hidden tab. Close the old transport segment, preserve already finalized
points, and retain its pre-pause pending intervals until their normal deadlines.
Resume after readiness/countdown with a new segment and cleared live history;
never interpolate across the pause or device sessions. A source without calibrated
timing can preview/rehearse but does not meet scored gameplay acceptance.

## Interpolation rules

At each requested song time `t`, locate neighboring reference samples `t0/t1`:

```text
alpha = (t - t0) / (t1 - t0)
landmark(t) = (1 - alpha) * landmark(t0) + alpha * landmark(t1)
```

Interpolate source coordinates first, then compute normalization and groups.
Interpolate confidence only when both endpoints provide it. Require both endpoints
to be eligible/reliable for each contributing landmark; never interpolate boolean
flags or player identities. Reviewed reference permission remains authoritative.
Exact knots use their own state. Respect exclusions as half-open intervals.

Use the bundle's maximum gap, capped at 200 ms. Never cross explicit absence,
quality/exclusion discontinuities, take joins marked discontinuous, or session
changes, and never extrapolate outside reliable samples. A terminal sample at
`playableEndMs` can anchor interpolation just before the end; it earns no points.

Apply equivalent bounded interpolation to timestamped live history, initially
also capped at 200 ms. Empty snapshots and per-player disappearance break
continuity immediately; heartbeats do not supply poses. Sequence gaps alone do
not prove disappearance, but long time gaps cannot be bridged. At the observed
roughly 9 Hz rate, normal neighboring samples may be interpolated; the existing
500 ms UI freshness threshold does not authorize 500 ms of scoring interpolation.
Record explicit source-silence boundaries rather than resurrecting stale poses.

## Instant quality and a 10,000-point total

For each valid hand/foot/head group, calculate Euclidean distance in normalized
torso units. For torso, calculate the wrapped angular difference in radians.
Map each group's error to quality in `[0,1]`:

```text
groupQuality(e) = 1                             when e <= perfectTolerance
                = 0                             when e >= missTolerance
                = 1 - (e-perfectTolerance) /
                      (missTolerance-perfectTolerance) otherwise
q(t) = sum(referenceWeight[g] * liveGroupQuality[g])
```

Provisional positional tolerances: 0.10 torso units for perfect and 0.80 for miss.
Provisional torso tolerances: 5 degrees for perfect and 45 degrees for miss.
Unavailable live groups contribute zero. Freeze validated tolerances with the
scorer profile rather than presenting these values as researched thresholds.

Divide the playable interval into 100 ms scoring intervals, splitting at authored
eligibility/exclusion boundaries and retaining a shorter final interval. Integrate
quality at deterministic 30 Hz song-time cells, splitting those cells at the same
boundaries and evaluating their midpoints. This is independent of render FPS,
packet count, and the reference's original capture cadence.

Before gameplay, let `D` be the total reference-scorable duration for that track.
For every scorable cell `k` with duration `dt[k]`:

```text
budget[k] = 10000 * dt[k] / D
earned[k] = budget[k] * q(midpoint[k])
finalScore = round(sum(earned[k]))
```

Require `D > 0`; normalize budgets so their numerical sum is exactly 10,000.
Keep fractional points internally and round only cumulative displayed totals and
the final score, clamped to `[0,10000]`. Assign any floating-point budget residual
to the final scorable cell. Never round and sum individual interval awards.
All `q=1` yields exactly 10,000. If a 120-second fully scorable routine averages
`q=0.8`, its score is 8,000; a perfect ten seconds earns about 833.33 points.
Countdown, pauses, excluded reference duration, and the terminal endpoint add none.

The denominator is fixed before play. Missing live tracking or packets beyond the
deadline earn zero for their cells; never remove these cells from `D`. Duplicate
records, reconnects, retries within a session, and extra render frames cannot award
a cell twice. Track a finalized song-time cursor and transport/session boundaries.
Keep scores independent for both players, each with a maximum of 10,000.

Full-song pose comparison already penalizes holding a static pose during moving
targets. Verify that explicitly. Evaluate endpoint velocity/direction as a later
feature only if static/wrong-motion attempts still score too well; derivative noise
at the live source's low cadence needs measurement before adding weight.

## Immediate feedback and results

Use the same quality function on each newly received usable live pose against
the reference at its corrected capture time. Feedback therefore describes the
latest observed movement; it necessarily appears after capture/inference/delivery.
It need not wait for finalized 100 ms interval points. Show a short song-time
average, initially 150 ms, with hysteresis to avoid rapidly flashing labels.

| Quality | Label |
| --- | --- |
| `q >= 0.90` | Excellent |
| `0.75 <= q < 0.90` | Great |
| `0.50 <= q < 0.75` | Good |
| `q < 0.50` | Bad |

These feedback thresholds are provisional. During exclusions show “Unscored”;
on insufficient evidence show “Tracking lost”; on stale feedback clear the label.
Expose immediate quality separately from the committed cumulative score so delayed
interval finalization does not cause the total to move backward.

At the authored endpoint stop music/reference playback, retain input collection
through the final allowance, finalize once, then show score, tracking coverage,
timing status, and completion status. An initial completion policy requires 90%
live group-weighted coverage over reference-scorable duration plus usable timing;
validate and version this threshold. Incomplete attempts can show earned points
but must not appear as comparable ranked results.

## Implementation order and acceptance

1. Implement pure normalization/group/error functions and a versioned scorer
   profile under `packages/pose/`; build deterministic fixture replay first.
2. Build reference eligibility schedules, fixed budgets, and scoring-aware sampling
   around the shared sampler. Integrate publication coverage reports into Studio.
3. Add Android time capability, clock mapping/capture calibration, bounded history,
   and the Web Audio song transport. Validate timing independently of scoring.
4. Add interval finalization, immediate labels, independent player totals, pause/
   resume handling, and results to gameplay. Keep display retargeting separate.
5. Validate on human-rated real attempts; tune on one subset and evaluate on a
   separate held-out subset. Record scorer version and measured limitations.

Required evidence:

- Uniform scale/translation of every input pose leaves quality unchanged, including
  changing scale during a routine. Aspect-ratio changes representing the same
  image geometry give the same result. Real near/far trials stay within a measured
  tolerance; report perspective/occlusion failures rather than claiming invariance.
- Arbitrarily changing elbows 13/14 and knees 25/26, including their confidence,
  has exactly no effect. Wrong hands/feet, swapped anatomy, and lean still matter.
- Identical timestamped reference/live replay earns exactly 10,000; zero quality
  earns zero. Odd song lengths, exclusions, partial tracking, and rounding preserve
  the fixed budget. No-reference songs fail before gameplay.
- Equivalent evidence delivered at different render rates and with duplicates,
  clock offsets/drift, and injected delay/jitter scores identically within the
  deadline. Changed capture times representing early/late dancing lower scores.
- Interpolated target times are correct at knots/midpoints; no crossing of absence,
  eligibility boundaries, long gaps, pauses, or sessions. End anchors work without
  awarding endpoint points. Low-confidence reference endpoints cannot gain trust
  through interpolated confidence.
- Track 0 is identical across one/two-player modes; right-only player 1 never shifts
  into track 0. Missing evidence cannot improve quality by reweighting groups.
- Good attempts outrank wrong/mirrored/held/off-beat attempts in held-out human
  review. Test actual live Lite output against authored references, varied body
  sizes, clothing/lighting, two people, crouches, and turns over complete songs.

Documentation is the deliverable here. Implementing the scorer, hardware timing,
and measured acceptance are subsequent work; the starting thresholds above are
not yet validated game behavior.
