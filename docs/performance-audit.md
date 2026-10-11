# Performance audit — 2026-10-10

Baseline: `main` at `f766e1f`. Scope: the display and phone Aero world, captured dancers, all six `/dance/` stages, and the six `/menu-mocks/` scenes.

## Implemented wins

| Change | Before | After | Fidelity check |
| --- | --- | --- | --- |
| Lake normal-map generation | 158.25 ms; 12,582,912 cosine evaluations | 24.65 ms; 98,304 sine/cosine evaluations | All 1,048,576 texture bytes match |
| One dancer's pose update | 0.00438 ms; 54 matrix compositions | 0.00287 ms; 36 matrix compositions | Zero bone matrix error across both full tracks at 60 Hz |
| Fullscreen grading target, dance and menu mocks | 4× MSAA color/depth attachments; 3 framebuffer resolves per frame with bloom | Single-sample color, no depth; 2 resolves | Zero differing pixels in all 12 scenes |

Lake generation uses separable trigonometry while retaining the original wave coefficients, Float32 accumulation order, resolution, and normal-map encoding. This removes roughly 134 ms of synchronous work when constructing a world in the recorded CPU run. A browser comparison at the lake portion of the flight measured world construction dropping from 672.5 to 568.4 ms at high quality and 567.7 to 455.5 ms at low quality. Both rendered comparisons had zero differing pixels and identical draw/triangle counts.

Retargeting updates the rig and its ancestors once before converting hand and foot targets with the current matrices. The per-dancer time saving is small; it eliminates redundant work without changing the choreography. The regression test also covers moving, rotated, nonuniformly scaled ancestor groups.

Only the grading buffer loses MSAA/depth. The scene buffer retains 4× MSAA, HDR, depth, shadows, reflection passes, bloom, grading, tone mapping, and the existing render resolution. The eliminated multisampled attachments were observed as 640×480 RGBA16F and DEPTH_COMPONENT24 buffers with four samples (about 12.9 MiB of nominal attachment storage, before driver padding). With bloom disabled, resolves drop from two to one and the output still matches. Grade and OutputPass each swap once, so RenderPass consistently uses the multisampled scene buffer; revisit this assignment if the pass sequence changes.

## Validation and reproduction

```sh
npm ci
npm test
npm test --prefix temp/frutiger-character
npm run bench:performance
npm run build
```

The benchmark uses the actual character GLB, capture, and seeded production lake waves. It loads the previous retargeter from the baseline Git revision, checks output equivalence, warms up twice, and reports the median of seven measurements. Each pose timing sample runs 20,000 updates. An alternate baseline can be supplied with `npm run bench:performance -- <revision>`; retain the audited revision in Git history to reproduce the default run.

Recorded CPU environment: macOS arm64, Node v26.4.0. These are local subsystem measurements, not an end-to-end FPS guarantee. Timing varies with host load and hardware.

Browser checks used the collaborative browser at a 1280×800 CSS viewport and the existing 640×480 render buffer. For each dance stage and menu scene, animation state was held fixed, the actual grading target was switched between its original and optimized settings, and framebuffer RGBA bytes were compared. Reflection targets and the scene's antialiasing remained unchanged. Measurements used 5 warm-up frames and 30 measured renders with `gl.finish()`, and instrumented multisample allocations and framebuffer blits. Grading-target comparisons generally saved about 0.1–0.2 ms of local render submission/completion time; some scenes were below timer resolution. All six dance stages, all six menu scenes, and the bloom-disabled path had zero differing pixels.

All 13 automated tests and all three production builds passed. Production browser smoke checks cover the display menu, the portrait phone entry screen, dance stage navigation/pause, and menu-mock navigation. No screenshots, recordings, or temporary browser instrumentation are committed.

## Other findings

- The app already uses fixed render buffers, instanced foliage, merged city geometry, cached world shadows, and a 15 FPS cached phone background. Lowering those settings would change fidelity or motion, so they were retained.
- Spatially splitting the woodland batches reduced submitted triangles by roughly 18–27%, but increased draw calls enough to slow most measured frames. That experiment was discarded.
- The production bundles remain large (approximately 396 KB gzipped for the display, 338 KB for the dance runtime, and 525 KB for menu mocks), and the character GLB is approximately 1.8 MB. Route-level loading and lossless asset compression are future candidates; they need separate network/loading validation.
