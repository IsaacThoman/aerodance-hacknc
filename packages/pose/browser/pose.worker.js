import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
let landmarker;
let sessionId;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'initialize') {
      sessionId = data.sessionId;
      if (!await FilesetResolver.isSimdSupported()) throw Error('Webcam tracking requires a browser with WebAssembly SIMD support. Update your browser or use Android.');
      const files = await FilesetResolver.forVisionTasks(data.wasmUrl, true);
      const response = await fetch(data.modelUrl);
      if (!response.ok) throw Error(`Model download failed (HTTP ${response.status})`);
      const buffer = await response.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), n => n.toString(16).padStart(2, '0')).join('');
      if (hash !== data.modelHash) throw Error('Model checksum mismatch');
      let delegate = 'GPU';
      let fallback = '';
      // Software WebGL can initialize successfully but make Heavy unusably slow.
      // Keep the chosen model and prefer CPU inference on such renderers.
      const probe = new OffscreenCanvas(1, 1).getContext('webgl2');
      if (probe) {
        const debug = probe.getExtension('WEBGL_debug_renderer_info');
        const renderer = debug ? probe.getParameter(debug.UNMASKED_RENDERER_WEBGL) : '';
        if (/swiftshader|llvmpipe|software/i.test(renderer)) { delegate = 'CPU'; fallback = 'Software GPU detected'; }
        probe.getExtension('WEBGL_lose_context')?.loseContext();
      }
      const create = delegate => PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetBuffer: new Uint8Array(buffer), delegate },
        canvas: new OffscreenCanvas(1, 1), runningMode: 'VIDEO', numPoses: data.playerCount,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
      try { landmarker = await create(delegate); }
      catch (error) {
        if (delegate === 'CPU') throw error;
        fallback = error.message; delegate = 'CPU'; landmarker = await create(delegate);
      }
      self.postMessage({ type: 'ready', sessionId, delegate, fallback });
    } else if (data.type === 'frame') {
      try {
        const start = performance.now();
        const result = landmarker.detectForVideo(data.bitmap, data.timestampMs);
        self.postMessage({ type: 'result', sessionId, seq: data.seq, landmarks: result.landmarks,
          inferenceMs: performance.now() - start });
      } finally { data.bitmap.close(); }
    } else if (data.type === 'close') { landmarker?.close(); self.close(); }
  } catch (error) {
    self.postMessage({ type: 'error', sessionId, message: error.message || 'Pose inference failed' });
  }
};
