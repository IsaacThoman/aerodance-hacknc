# Packaged pose model

- Model: Google MediaPipe Pose Landmarker Lite, float16, version **1**.
- Source: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
- SHA-256: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`
- License: Apache License 2.0; included in `pose_landmarker_lite.LICENSE`.
- License evidence/model card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf
- Runtime: pinned `com.google.mediapipe:tasks-vision:0.10.21`.

The model is packaged for offline use. The compatibility probe uses GPU, up to two
poses, IMAGE mode, and no segmentation. Production uses GPU LIVE_STREAM with a two-pose detection limit in both
game modes, one inference input in flight and native libyuv camera conversion.
