# How scores are calculated

This is the scoring decision document the [integration plan](android-game-integration-plan.md)
asks for. It describes scorer version 1 (`SCORER_VERSION` in
[`packages/score/scorer.js`](../packages/score/scorer.js)). Any change that would move
scores must bump that version; best scores are saved per version.

## In one paragraph

Every 100 ms of song time, each player's live pose is compared with their own
choreography track (player 1 with track 0, player 2 with track 1). The comparison uses
the directions of their limbs as seen by the camera, plus how those limbs are moving.
The player gets the best match within ±150 ms of the beat, with a small penalty beyond
±50 ms. Each 100 ms interval is worth an equal share of 1,000,000 points. Every second
the intervals are grouped into a judgement (Perfect, Good, OK, Miss or Lost tracking),
which drives the pop-ups and the combo.

## Inputs

- **Reference.** The bundle's choreography, sampled with `sampleSong` (bounded
  interpolation, never across gaps over 200 ms). Joints the authoring tools marked
  ineligible (`quality.scoreEligible`) and the track's `unscorableIntervals` never count.
- **Live poses.** Every pose record from the pose source, placed at the song position
  that was audible when the camera captured it, not when the pose arrived:
  - Android with clock sync (`GET /v1/time`, `capabilities.timeSync`): the frame time
    `frameReceivedTimeMs` mapped onto the browser clock, less `CAPTURE_DELAY_MS`
    ([`client/src/pose/clockSync.js`](../client/src/pose/clockSync.js)).
  - Android without clock sync: arrival time, less Android's processing time
    (`resultTimeMs - frameReceivedTimeMs`), a 15 ms network allowance and
    `CAPTURE_DELAY_MS`.
  - The browser time then goes through the song player's audible clock (`songTimeAt`,
    from `AudioContext.getOutputTimestamp`, or `currentTime - outputLatency`).
- **Late arrivals.** Intervals are scored 750 ms behind the song (`LATE_ALLOWANCE_MS`),
  so poses delayed by Wi-Fi or processing still count. The results wait for the same
  allowance after the song ends.

## Features

[`packages/score/features.js`](../packages/score/features.js) turns a pose into unit
direction vectors, in image space corrected for aspect ratio, for ten limbs:

| Limb | Joints (MediaPipe pose-33) | Weight |
| --- | --- | --- |
| Upper arms, forearms (left and right) | 11-13, 13-15, 12-14, 14-16 | 1.0 each |
| Thighs, shins (left and right) | 23-25, 25-27, 24-26, 26-28 | 0.7 each |
| Torso | shoulder midpoint to hip midpoint | 0.6 |
| Shoulder line | 11-12 | 0.4 |

Directions don't depend on height, distance from the camera or where the player stands,
so no torso scaling or calibration is needed. Arms carry the most weight because they
carry most of the choreography and are tracked most reliably. A live joint counts only
at a confidence (min of visibility and presence) of at least 0.5. Players compare
directly with the stored, unmirrored pose: the coach is only mirrored on screen
(`coachMode: "mirror-player"`), and dancing the mirror image loses points.

## One interval (100 ms)

For interval time `t`, the live directions at `t` (interpolated between samples up to
350 ms apart, or the nearest sample within 120 ms) are compared with the reference at
`t + shift`, for shifts of 0, ±50, ±100 and ±150 ms:

- **Pose match.** For each reference limb, `exp(-(θ / 0.8)²)`, where θ is the angle in
  radians between the live and reference directions (15° → 0.90, 30° → 0.66,
  60° → 0.18). The weighted mean is taken over the reference limbs; a limb the player's
  camera can't see scores 0.
- **Movement match.** For reference limbs whose direction changed by at least 0.2
  (about 11°) over the previous 300 ms: `max(0, 1 - |Δlive - Δref| / |Δref|)`. Holding
  still while the coach moves scores 0 here. When moving limbs weigh at least 1, the
  interval score is 60% pose and 40% movement.
- **Timing.** Shifts beyond ±50 ms are multiplied down linearly, to 0.85 at ±150 ms.
  The best shifted score is kept, and its shift feeds the average timing offset
  (`meanOffsetMs`, the battle's `sync`).

An interval is **scorable** when the reference shows at least half of the total limb
weight. This is decided from the reference alone, so missing live tracking never shrinks
the possible score. An interval where the player shows less than 30% of the reference's
limb weight is **lost**: it scores 0.

## Points, judgements and grades

- **Points.** Each scorable interval is worth `1,000,000 / scorable intervals`. Its
  share is `(score - 0.3) / (0.85 - 0.3)`, clamped to 0..1. That means 0.85 or better
  earns full points and 0.3 or less earns none. The total is rounded to a whole number.
- **Judgements.** Ten intervals make one judgement. Perfect needs a mean of 0.8 or more,
  Good 0.65, OK 0.45, and anything lower is a Miss. A second with at least 60% of its
  intervals lost is **Lost tracking**.
- **Combo.** Consecutive judgements other than Miss and Lost tracking.
- **Grade.** From accuracy (points earned out of 1,000,000): S 90%, A 80%, B 65%,
  C 50%, otherwise F.
- **Coverage.** The share of scored intervals where the player was tracked. Below 80%,
  the results screen says so.

## Battles

A battle reports each seat's `score`, `pops` (Perfect judgements), `sync` (1 minus the
mean timing offset over 150 ms, from 0 to 1) and `flair` (best combo). The highest
score wins. A seat with no result reports zero so the battle settles straight away.

## Evidence and limits

[`packages/score/tests/scorer.test.js`](../packages/score/tests/scorer.test.js) uses the
shipped routine's real tracking data. It checks these orderings:

| Attempt (both tracks) | Scorer v1 |
| --- | --- |
| Copying the routine exactly, at 5, 9 or 30 poses/s | 99–100%, S |
| 100 ms late | about 99%, with the offset measured |
| 200 ms late | 83–94% |
| 400 ms late | 48–77% |
| Mirror image of the routine | 71–81% |
| Holding one pose throughout | 32–53% |
| Half the song out of view | about 49% |
| Nobody in view | 0 |

The tests also check that frame rate, duplicate records and out-of-order delivery leave
the score unchanged, and that one-player mode scores player 1 exactly as two-player
mode does.

These numbers come from synthetic attempts built out of the reference itself. The
thresholds (σ, the points curve, the judgement cut-offs) have **not yet been tuned
against people dancing**: no human-labelled set of attempts exists yet, which is the
next step the integration plan calls for. Play with `?record` in the URL to download
each song's live poses as a recording. Replay one with
`?input=recording&recording=<url>`, and score a batch of recordings to compare against
human rankings. `CAPTURE_DELAY_MS` (33 ms) is a working estimate for the board's camera
until it is measured with an external timing test. It must never be tuned to raise
scores.
