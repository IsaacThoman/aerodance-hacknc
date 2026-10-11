# Plan: finishing aerodance as a playable game

Prepared 2026-10-11 from the repository on `main` (4c3133e). This plan turns the
[Android/game integration plan](android-game-integration-plan.md) and the
[authoring workflow](song-dance-authoring-workflow.md) into an ordered path to a
shippable game. It refers to those documents for detailed design rather than
repeating it.

## Progress (2026-10-11)

The first implementation pass (branch `feat/playable-game`) built M0–M5 in code:

| Milestone | Built | Still open |
| --- | --- | --- |
| M0 Foundations | GitHub Actions CI (web, Docker browser flow, Android); the client no longer imports from `temp/`; `ReplayPoseSource` (autoplay ghost and recording replay) and pose recordings (`?record`). | Record real sessions on the board as the fixture set. |
| M1 Gameplay loop | Ready check, scheduled countdown, pause/resume, finishing allowance, results with Play again / Song select, best scores; browser flow covers a whole scored song. | — |
| M2 Live characters | Live calibration, held joints, display smoothing, corner panels on every stage. | Manual check of left/right, crossed arms, crouch, foot lifts with people on the board. |
| M3 Timing | `GET /v1/time` on Android, browser clock sync, audible-clock mapping, capture-time placement, 750 ms late allowance. | Measure the board's camera delay (`CAPTURE_DELAY_MS` is an estimate); have Dance Studio's recorder use the clock sync. |
| M4 Scoring | `packages/score` (scorer v1), HUD judgements and combo, deterministic tests, [docs/scoring.md](scoring.md). | Tune thresholds against human-ranked recordings. |
| M5 Battles | Battles play a real song and report real scores; phones follow `danceMs`; the fake dance is gone. | A real two-person battle end to end. |

M6–M8 are untouched apart from best scores. Two decisions changed after review: the
webcam source is out of scope here because Austin is building it, and the shipped
"Rockefeller Street Bad Test" song stays in the catalog.

## Where the game stood

When this plan was written, the parts on either side of gameplay already worked. The
gameplay in the middle had not been built.

| Area | State |
| --- | --- |
| Menus, Settings, player count, Song Select, song preview on six stages | Done, drawn in-engine, mouse/touch/keyboard/phone-remote input. |
| Android pose capture (two players, protocol v2, bounded reconnects) | Done. About 9 poses/s with gaps up to 505 ms in two-player mode. GPU startup takes 13–35 s. |
| Browser pose transport (`client/src/pose/`) | Done. Live poses only decide whether a Song Select slot reads "Detected". |
| Dance Studio (record, edit, compile, export bundles) | Done, except video upload and calibrated timing. |
| Song bundles and verified loading | Done. **One song** ships, titled as a test, 28 s long, with uncalibrated timing. |
| Audio-clock song playback (`client/src/audio/songPlayer.js`) | Done for preview. No scheduled start and no game-level pause. |
| Battles, phones, Solana receipts, NFTs, iMessage agent | Done, but scores come from `client/src/battle/fakeDance.js` (a 5 s timer reporting random scores). |
| Countdown, gameplay screen, pause, results | **Missing.** The results screens exist only as a mock in `temp/win-screens/`. |
| Live player characters | **Missing.** `createPoseApplier` already accepts any pose; there is no live calibration and no live panels. |
| Clock sync (`GET /v1/time`) | **Missing** on Android and in the browser. |
| Scoring | **Missing.** No code exists; the integration plan has a proposed design (lines 147–173). |
| Fixture/replay pose source | **Missing.** Development needs the physical board. |
| CI | **None.** No `.github/`; the Docker test stages run by hand. |
| Deployed HTTPS play | **Blocked.** An https page cannot fetch the board's plain-http stream. |

## Definition of "finished"

Version 1 is finished when a player can do this on the production deployment:

1. Pair the pose source, choose One or Two Players, and pick from a catalog of
   at least five real songs.
2. Pass a short "stand in your spot" check, then see 3, 2, 1, with music and
   reference dancers starting exactly at zero.
3. Watch their own character copy them live in a corner panel while dancing,
   with running score and Perfect/Good/OK/Miss feedback.
4. Pause and resume without the song and scoring drifting apart.
5. Finish on a results screen (solo or P1/P2/tie) with a score, grade, best
   score, Retry and Song Select.
6. Play the same flow as a battle, where the real scores settle the battle,
   the receipt, the texts and the trophy.

Scores must reward better matching, distinguish being off-beat, refuse to reward
a held pose through a moving phrase, and not depend on frame rate or network
delay. The integration plan's acceptance evidence (line 173) is the bar.

## Decisions to make first

Each has a recommended default; the plan below assumes the default.

| Decision | Recommendation | Why |
| --- | --- | --- |
| How players reach the game from HTTPS | **Add an in-browser webcam pose source** (MediaPipe Pose Landmarker in a worker) as a supported input, alongside Android. Austin is building it separately. | The board needs root setup and is blocked from https pages. A webcam source makes the deployed game playable by anyone. It should expose `AndroidPoseSource`'s surface, including `captureBrowserTimeMs` on each record, so the game and scorer need no changes. |
| Scoring ambition for v1 | **Ship a versioned heuristic scorer, then tune it** with a small labelled set. | The full research programme in the integration plan would block the game for weeks. A version field lets scores be recalibrated later without confusion. |
| Song licensing | **Keep "Rockefeller Street Bad Test" in the catalog** (decided 2026-10-11); new songs should still use music licensed for this use. | Its audio is a commercial track, so licensing for new songs is still worth settling before M6. |
| Battles and Solana in v1 | **Keep in scope**, since the backend is done and only needs real scores. | Low cost: it is mostly removing the fake dance. |
| Target browsers | **Desktop Chrome and Safari on macOS**, matching current support. | Mobile phones remain the battle controller, not the dance screen. |

## Milestones

Each milestone ends in something playable or testable. Milestones 1–4 are the
critical path; 5–8 can overlap once milestone 2 lands.

### M0 — Foundations (unblocks everything else)

- **CI.** Add a GitHub Actions workflow running `npm test`,
  `npm run studio:test`, the root build, and the Docker `test` stage on every PR.
  Add Playwright as a devDependency and run `client/tests/ui-flow.browser.mjs`
  in CI. Run the Android host tests (`./gradlew :shared:testAndroidHostTest`)
  when `client-android/` changes.
- **PoseSource interface.** Extract the shape `AndroidPoseSource` already
  exposes (status, snapshot, `subscribeRecords`, player count, dispose) into a
  documented interface in `client/src/pose/`. Gameplay and scoring may only
  depend on this interface.
- **Recording and replay adapter.** Save a live Android stream (records with
  their original timestamps) to NDJSON, and add a `ReplayPoseSource` that plays
  one back against a song clock. Record a few real sessions per song: a good
  attempt, a bad one, an off-beat one, a held pose, and a two-player run. This
  becomes the test fixture set for retargeting, timing and scoring.
- **Stop importing from `temp/`.** Move the menu dancers' `dance.json` and the
  Flock camera model into `packages/` or `client/` so `temp/` can be deleted later.

Done when CI is green on a PR and the game can run on recorded input with no board.

### M1 — Gameplay loop on replayed input

A new game screen in `client/src/game/` driven by a small state machine:
`loading → ready check → countdown → playing ⇄ paused → finishing → results`.

- **Loading:** reuse `loadBundle`. Decode audio and prepare characters before
  the countdown starts.
- **Ready check:** each selected player must be detected and inside their half
  for about 1 s. Show a "step into your spot" overlay with live status.
- **Countdown:** schedule audio to start three seconds ahead on the
  AudioContext clock and draw 3, 2, 1 from that scheduled time, never from frame
  deltas (integration plan line 116). Extend `songPlayer.js` with
  `startAt(contextTime)`.
- **Playing:** the reference dancers on the song's stage, reusing `StageView`
  and `Dancers`. One-player mode uses track 0, centred.
- **Pause:** Escape, the phone remote's B button, or a hidden tab pauses audio,
  reference time and scoring together. Resume with a short countdown at the
  preserved position, discarding pose samples received while paused.
- **Finishing:** at the authored end, wait for the late-arrival allowance, then
  finalise.
- **Results:** promote `temp/win-screens/` into `client/src/game/Results.jsx`,
  reusing `WinHud`, `WinStage` and `winnerOf`. Add Retry and Song Select.
  Until M4 lands, show the placeholder score with a visible "unscored" label.
- Turn the song preview's Play into "Dance", which enters this flow.
- Extend `ui-flow.browser.mjs` to cover menu → song → countdown → play → pause
  → resume → results → retry, on `ReplayPoseSource`.

Done when a full song plays start to finish with the correct transitions and
the browser test covers them.

### M2 — Live player characters

Follows integration plan lines 84–103.

- **Live calibration:** a rolling window of reliable torso/ankle samples gives
  scale, hip baseline and floor. Lock it during play; reacquire after sustained
  absence or a source/session change.
- **Live panels:** a smaller Frutiger character top-left for player 0, and
  top-right for player 1 in two-player mode only, each with its own skeleton,
  label and tracking-status light.
- **Missing data:** briefly hold an unreliable joint, then fade toward neutral.
  Clear a panel when its player is missing instead of freezing it.
- **Smoothing:** display-only, conservative interpolation between samples (the
  board's output is about 9 poses/s). No long extrapolation.
- **Mirror convention:** mirrored "coach" view by default, with one documented
  mirror transform that also swaps left/right landmark pairs.
- Verify raised left/right hands, crossed arms, lateral steps, lean, crouch and
  foot lifts against recorded input.

Done when both panels follow replayed and live poses with no left/right mixups.

### M3 — Timing and clock sync

Follows integration plan lines 114–145.

- **Android:** add `GET /v1/time` returning the session ID plus request-received
  and response-prepared times on the same monotonic clock as pose records.
  Advertise it in `/v1/status` capabilities, with CORS and tests.
- **Browser:** a clock-sync module taking several exchanges, preferring
  low-round-trip ones, rejecting outliers, tracking uncertainty, refreshing
  periodically for drift, and resetting on session change. Map each record's
  `frameReceivedTimeMs` to browser time, then to the audible song time.
- **Audible time:** use `AudioContext.getOutputTimestamp()` where available,
  keeping the existing `outputLatency` path as the fallback.
- **Capture delay:** measure the board's residual camera delay once with an
  external visual timing test (for example a flashing screen filmed by the
  board) and store it as a device constant. Never tune it from dance scores.
- **Late arrivals:** a 750 ms allowance before a score interval is final.
- **Dance Studio:** have the recorder use the same clock mapping, so new takes
  record a measured `timingUncertaintyMs` instead of null.
- For the webcam source (M7), frames are timestamped on the browser clock
  directly, so only capture delay applies.

Done when replayed input with injected offset, drift, jitter and duplicated
packets maps to the same song times within a stated tolerance.

### M4 — Scoring

A new `packages/score/` with no rendering or transport dependencies, so the
game, Dance Studio and tests share it.

- **Features (v1):** hip-centred, torso-scaled image landmarks. Compare limb
  direction vectors for upper arms, forearms, thighs and shins, plus torso
  lean, weighted by both reference and live confidence. Respect the bundle's
  `scoreEligible` masks and `unscorableIntervals`, which `sampleSong` already
  applies.
- **Motion term:** compare the change in limb directions over about 300 ms, so
  holding one pose through a moving phrase scores poorly.
- **Timing:** search a ±100 ms window for the best match, with a penalty that
  grows with the offset. Being consistently late must still cost points.
- **Intervals:** one score per 100 ms of song time, computed from interpolated
  live samples. Do not bridge gaps over about 300 ms. Totals are then
  independent of frame rate and duplicate packets.
- **Judgements:** group intervals into about 1 s windows (or beats, once songs
  carry a BPM) and map each window's error to Perfect / Good / OK / Miss through
  a versioned curve. Missing tracking awards nothing and shows as "Lost
  tracking", but the maximum possible score never shrinks.
- **Output:** a 0–1,000,000 score, accuracy percentage, judgement counts, max
  combo, tracking coverage and a letter grade, all stamped with `scorerVersion`.
- **Gameplay HUD:** running score and judgement pop-ups beside each live panel,
  plus a combo counter.
- **Evaluation harness:** a script that scores every fixture recording and
  prints a table, with human rankings stored beside them. Tests assert:
  good > bad > held pose; an off-beat attempt scores lower; identical input
  scores the same across frame rates, duplicates and injected delay; track 0
  scores the same in one- and two-player mode.
- Write the "scoring decision document" the integration plan asks for, as
  `docs/scoring.md`, recording the chosen features, weights, curve and
  thresholds for each `scorerVersion`. This is the doc that describes how scores
  are calculated.

Done when the harness rankings agree with the human rankings on a held-out set,
and results screens show real scores.

### M5 — Battles use real scores

- The battle's "playing" phase enters the M1 game screen instead of
  `fakeDance.js`. Map seat 0/1 to player 0/1 and run in two-player mode.
- At results, call `reportResult` for each seat with `score` and map `sync`,
  `pops` and `flair` to scorer outputs (timing accuracy, Perfect count, best
  combo), or drop those fields from the API.
- Phones follow the real song length instead of the 5 s timer.
- Delete `fakeDance.js`. Keep `DebugPanel` only behind `?debug` in development.

Done when a real two-person battle settles with real scores and the receipt,
texts and trophy go out.

### M6 — Content and progression

- **Songs:** author at least five licensed songs of 60–120 s in Dance Studio,
  each with two real dancers and calibrated timing (after M3), spread across
  easy/medium/hard and across the six stages. Add `bpm`, `difficulty`, a cover
  and a preview window to each `song.json`.
- **Song Select:** show difficulty, length, stage and best score/grade.
- **Best scores:** store per song, mode and `scorerVersion` in localStorage,
  and in the player profile on the server when one is linked.

### M7 — Input sources and hardware

- **Webcam source:** a `WebcamPoseSource` running MediaPipe Pose Landmarker
  (Lite) in a Web Worker, with two-player assignment by screen halves to match
  Android, and the same protocol shape. Replace "Webcam (dummy)" with it. This
  is what makes the https deployment playable.
- **Android:**
  - a foreground service and launch on boot, so the app need not stay open
  - a pairing token in addition to the CORS origin check
  - the 30-minute thermal and memory run
  - the manual two-person checks still open in `two-player-capture.md`
  - throughput work toward 15+ poses/s in two-player mode
  - fix the outdated CPU/GPU-toggle notes in `docs/hardware/live-pose-validation.md`
- Decide how venues with the board reach the game: a local http deploy, or the
  board serving HTTPS with a certificate the display trusts.

### M8 — Polish and release

- **First-run help:** a short how-to-play card before the first song, plus
  camera framing guidance ("make sure your feet are visible").
- **Settings:** an audio output latency offset (a tap test, not a score tweak),
  show/hide live panels, and reduced-motion for the background.
- **Performance:** route-level code splitting and GLB compression from
  `docs/performance-audit.md`. Measure the frame rate during two-player
  gameplay with four characters on the slowest target machine.
- **Clean up:** delete `temp/menu-mocks/` and the `/win-screens/` mock app once
  promoted, and update the README's "still to come" notes.
- **Playtest:** at least five sessions with new players across both modes and
  a battle. Fix what confuses them, then tune the scoring curve on the recordings.
- **Release:** tag v1, deploy to aerodance.tech, and verify the full flow on
  production with both a webcam and the board (local http).

## Order and parallel work

```text
M0 ─► M1 ─► M2 ─┐
       │        ├─► M4 ─► M5
       └─► M3 ──┘     │
                      ├─► M6 (content authoring can begin after M3)
M7 (webcam) can begin after M0; Android items any time
M8 last
```

The critical path is M0 → M1 → M3 → M4. Live characters (M2) and the webcam
source (M7) are the main independent tracks. Song authoring should wait for
M3, so new takes are recorded with calibrated timing and don't need re-timing.

## Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Board throughput stays around 9 poses/s with 500 ms gaps | Jumpy live characters and noisy scores. | Interpolate between samples, score per 100 ms interval with gap limits, and judge on about 1 s windows. The webcam source is a second option. |
| A 2D-only heuristic scorer feels unfair | Players stop trusting the score. | Show per-limb feedback, tune on recorded human-ranked attempts, and version the scorer. |
| The capture delay cannot be measured precisely | A constant timing bias. | Measure it once per device, report the uncertainty, and widen the timing tolerance by that amount. |
| Webcam pose estimation is too slow on modest laptops | No playable https option. | Use the Lite model in a worker at reduced resolution, and test early in M7 before committing to it as the main path. |
| Song licensing | Cannot publish the catalog. | Settle the sources before authoring in M6. |
