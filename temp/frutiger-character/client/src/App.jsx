import { Component, useEffect, useLayoutEffect, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { PCFShadowMap } from "three";
import Scene from "./Scene.jsx";
import { validateMotion } from "../../../../packages/character/motion.js";
import motionUrl from "../../../../packages/character/assets/dance.json?url";

function FixedRenderResolution() {
  const { gl, size } = useThree();
  useLayoutEffect(() => {
    gl.setSize(640, 480, false);
  }, [gl, size.width, size.height]);
  return null;
}

class SceneBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="alert">The dance scene could not load. Reload to try again.</p>
    ) : (
      this.props.children
    );
  }
}

export default function App() {
  const [motion, setMotion] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(motionUrl, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Capture unavailable");
        return response.json();
      })
      .then((data) => setMotion(validateMotion(data)))
      .catch((e) => {
        if (e.name !== "AbortError") setError(true);
      });
    return () => controller.abort();
  }, []);
  return (
    <main
      className="canvas-frame"
      aria-label="Two Frutiger characters dancing to the captured choreography"
    >
      {error ? (
        <p role="alert">
          The dance capture could not load. Reload to try again.
        </p>
      ) : !motion ? (
        <p role="status">Loading dance…</p>
      ) : (
        <SceneBoundary>
          {/* Stages project at 16:9 into the 640x480 buffer, which the frame stretches back out. */}
          <Canvas
            dpr={1}
            shadows={{ type: PCFShadowMap }}
            camera={{ position: [0, 4.2, 13.5], fov: 40, aspect: 16 / 9 }}
            gl={{ antialias: false, alpha: false, powerPreference: "high-performance" }}
          >
            <FixedRenderResolution />
            <Scene motion={motion} />
          </Canvas>
        </SceneBoundary>
      )}
    </main>
  );
}
