# Frutiger dance capture

Two independently cloned glass characters replay the two foreground dancers from the supplied “Movie on 10-10-26 at 2.14 PM.mov”. The studio, menus, free-roam controls, and socket connection have been removed from this app's runtime. The garden and original seven-bone GLB are retained.

The canvas fills the available screen inside black 16:9 letterboxing. Like the main app, it uses a **640×480 drawing buffer stretched to 16:9**, DPR 1, and pixelated scaling. No backend, webcam, Python, or inference service is needed for playback.

## View

From the repository root:

```sh
npm ci
npm run build
# Includes the original main app and this demo at dist/dance/.
# npm start serves both with the normal database setup.
# Or inspect both builds without a backend:
python3 -m http.server 8080 --directory dist
```

Open http://localhost:8080/dance/. The normal production/PR preview also serves `/dance/`.

The main app's title menu also shows these dancers (`client/src/menu/MenuDancers.jsx`). It imports `Character.jsx`, `motion.js`, the GLB and `dance.json` straight from this folder, so move them before deleting `temp/`.

For standalone development:

```sh
npm --prefix temp/frutiger-character ci
npm --prefix temp/frutiger-character run dev
```

Open http://localhost:5174. Playback loops automatically. Space pauses/resumes the dancers; reduced-motion preferences start them paused. For reproducible visual comparisons, append `?t=6` to hold the characters at six seconds (the garden bubbles still move). Remove the query to resume normal playback.

## Capture another video

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) (this capture used **0.13.0**). The project pins Python **3.12.15** and locks all Python dependencies and wheel hashes in `scripts/pose/uv.lock`. `uv` downloads the Python runtime if needed. Tested on Linux x86-64, CPU only. OpenCV uses its headless distribution, so a display server/libGL is not required. No Blender rebuild is required.

From the repository root, with your input file outside the public directory:

```sh
# Reproduce the committed routine: the first 14 seconds of the supplied MOV.
temp/frutiger-character/scripts/track-dance.sh \
  "/absolute/path/to/Movie on 10-10-26 at 2.14 PM.mov" \
  --start 0 --end 14

# A future recording; omit --end to process through the last decoded frame.
temp/frutiger-character/scripts/track-dance.sh \
  "/absolute/path/to/another-dance.mov" \
  --start 2 --end 20 \
  --output /tmp/another-dance.json \
  --diagnostics /tmp/another-dance-review
```

The wrapper works from any working directory and preserves relative input paths. Defaults are:

- Output: `client/public/motion/dance.json` (replaces the current choreography).
- Review files: ignored `tracking-output/` with `overlay.mp4`, `raw.npz`, and `report.json`.
- Sampling: at most 30 FPS, image width 960, landmark confidence 0.5, Gaussian sigma 0.045 seconds.
- Model: Google's versioned [MediaPipe Pose Landmarker Full float16 v1](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task), downloaded once into ignored `scripts/pose/.cache/`. Its SHA-256 is verified on every run. `--model /path/to/model.task` supports a pre-downloaded copy, with the same checksum requirement.

Run the wrapper with `--help` for all flags. Downloads are needed only for initial Python/dependency/model setup; capture then runs locally. Source video and diagnostic overlays are never copied to the public app or committed. The output JSON is an `aerodance.take` schema-version-1 file with millisecond sample timestamps and Android-shaped `{playerId, landmarks}` pose objects. It retains source/model/settings/report provenance and separate original visibility/presence. Absent dancers remain omitted; smoothed/interpolated joints require author review before scoring. The migrated committed capture preserves its old combined confidence separately, with visibility/presence set to null. See [pose migration and bundle support](../../docs/game-song-bundles.md). Check that provenance when comparing runs. The locked CPU pipeline produced identical raw landmarks on two runs in this environment; floating-point differences are possible on other platforms.

The OpenCV diagnostic video uses MPEG-4 Part 2. If your browser/player needs H.264, convert it with FFmpeg:

```sh
ffmpeg -i temp/frutiger-character/tracking-output/overlay.mp4 \
  -c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart \
  /tmp/dance-overlay-browser.mp4
```

Keep both dancers visible and reasonably separated, with full bodies and a fixed camera. Initialize with the two intended dancers as the largest people in frame. Review the entire overlay before shipping a new capture: cyan is the initially left dancer, magenta the initially right dancer. When changing the clip, regenerate, run the checks below, rebuild, and compare `/dance/?t=...` against the overlay at the same relative time.

## Tracking and retargeting

1. OpenCV decodes the video and supplies presentation timestamps; the MOV is slightly variable-rate. Sampling skips duplicate time buckets instead of assuming an exact source frame rate. `--start/--end` select the interval, and output times are relative to `--start`.
2. [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/python) runs in VIDEO mode, requesting up to four poses with 33 landmarks each. The initial pair is selected by torso size and ordered screen-left to screen-right.
3. Detection order is **not** treated as identity. Every frame uses a global one-to-one assignment against the previous torso centers and sizes. Distance/scale gates reject unlikely jumps and background-sized people; missing detections remain explicit gaps. This is geometric tracking, not face recognition or appearance re-identification. Full occlusions, dancers crossing at the same location, strong perspective changes, or camera movement can defeat it.
4. Joints below the minimum of presence/visibility 0.5 are interpolated between reliable samples. Leading/trailing gaps hold the nearest valid sample. A symmetric Gaussian smooths XYZ without introducing a causal time lag. Original confidence is retained. Processing fails if a joint has fewer than two reliable samples or a whole-person gap exceeds one second. Individual occluded joints may have longer interpolated spans: confidence is a review aid, not an accuracy guarantee.
5. Browser playback interpolates timestamped samples on one shared clock for both actors. Independent skeleton clones prevent one character's pose from overwriting the other's. A median torso length sets each actor's scale; image aspect corrects horizontal coordinates. Hips drive lateral movement/bounce, shoulders drive torso lean/limited yaw, face landmarks drive head yaw/roll, wrists drive floating hand centers, and ankles drive feet with a stage-height floor. Bone-pivot offsets and parent transforms are accounted for.
6. This is **stylized camera-space 2.5D retargeting**, not calibrated 3D motion capture. MediaPipe relative depth is damped/clamped for stable hand/foot depth; there is no inferred room trajectory, finger animation, elbow/knee rig, or physically solved foot contact. The model intentionally has only a body, detached head, two hands, and two feet. Anatomical right maps to the asset's screen-left limb for a frontal recording. The original stock “Dance” clip is not played.
7. The final 0.35 seconds crossfade into the first pose with smoothstep for a continuous loop. This alters only the seam. Playback is silent; source audio is not packaged. Hidden-tab/long-stall deltas are capped at 0.1 seconds to prevent large jumps on resume.

## Supplied capture and validation

Source SHA-256: `30e427b8185d7b4c80693007bbeca43e911f6c54520b7aabaf7f542d40389857`.

The source is 1620×1080, approximately 16.5 seconds. The committed interval is **0–14 seconds**, excluding the final walk toward the camera. It has 420 samples:

| Measure | Initially left / blue | Initially right / violet |
| --- | ---: | ---: |
| Reliable joint samples | 95.66% | 99.00% |
| Frames without assigned person | 8 | 3 |
| Longest whole-person gap | 5 frames (~0.17 s) | 3 frames (~0.10 s) |

These are confidence/coverage measurements, not measured pose accuracy. The overlay was reviewed across the routine, including background people passing behind the dancers. Browser playback was recorded and inspected through a loop; hand gestures, steps, independent tracks, and the seam were checked. Production `/dance/` loaded the model and capture successfully. At 1280×800 the frame measured 1280×720 with 40-pixel bars; portrait and wide viewport resizing preserved 16:9 and the 640×480 buffer. A 600-frame browser sample measured 16.7 ms median / 16.9 ms p95 (~60 FPS) on the test browser; this is not a guarantee for other hardware.

```sh
npm --prefix temp/frutiger-character test
uv run --locked --project temp/frutiger-character/scripts/pose \
  python -m unittest discover -s temp/frutiger-character/scripts/pose -p 'test_*.py'
npm run build
```

Tests cover identity association with reordered detections/background people, missing-person interpolation, JSON/timestamp integrity, sampling and loop continuity, independent real GLB skeletons, finite transforms, and grounded feet. Existing asset tests still check the exported model/stock clips. Builds emit the existing large Three.js bundle warning; browser diagnostics include Three.js/Fiber's `Clock` deprecation warning and a GPU shader precision warning, without playback errors.

The editable Blender source and deterministic generator remain in `assets/aero-character.blend` and `scripts/build-character.py`. `npm --prefix temp/frutiger-character run character:build` rebuilds them when Blender is installed. The retained appearance/movement helpers and stock animations are asset/prototype utilities; they do not run in the dance screen.

The production build was also verified using only the root `node_modules`, matching Docker's dependency installation. A Docker image build could not run in the development environment because access to `/var/run/docker.sock` was denied; container startup/database integration was not exercised for this change.
