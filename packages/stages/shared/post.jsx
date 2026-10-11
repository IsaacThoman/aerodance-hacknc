import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { tickBeat } from './hooks.js';

export const RENDER_WIDTH = 640;
export const RENDER_HEIGHT = 480;

// The glass dancers were tuned under ACES, so every stage keeps it. Bloom runs on
// linear HDR before tone mapping: lit surfaces brighter than the threshold glow too.
export const POST_DEFAULTS = {
  bloomStrength: 0.3,
  bloomRadius: 0.45,
  bloomThreshold: 2.0,
  exposure: 1,
  toneMapping: THREE.ACESFilmicToneMapping,
  vignette: 0.2,
  saturation: 1.08,
  tint: [1, 1, 1],
};

// Live post-processing settings. Stages may mutate these every frame
// (for example to pulse bloom on the beat); the host resets them per stage.
export const post = { ...POST_DEFAULTS };

export function resetPost(overrides = {}) {
  Object.assign(post, POST_DEFAULTS, overrides);
}

// Exported so offline renders (temp/trophy-renders) grade exactly like the game.
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.2 },
    uAspect: { value: 16 / 9 },
    uSaturation: { value: 1 },
    uTint: { value: new THREE.Color(1, 1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uAspect;
    uniform float uSaturation;
    uniform vec3 uTint;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      d.x *= uAspect;
      float v = smoothstep(1.05, 0.3, length(d));
      c.rgb *= mix(1.0, v, uVignette);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = max(mix(vec3(l), c.rgb, uSaturation), 0.0) * uTint;
      gl_FragColor = c;
    }
  `,
};

/**
 * Takes over rendering: stage -> bloom -> grade -> tone mapping, then the HUD
 * layer (optional) on top without post-processing so its text stays crisp.
 * width/height: the render buffer; aspect: the frame it is displayed at.
 * It renders the scene and camera of the store it is mounted in, so inside a
 * createPortal it draws that portal's stage.
 */
export function RenderPipeline({ hudScene, hudCamera, width = RENDER_WIDTH, height = RENDER_HEIGHT, aspect = 16 / 9 }) {
  const gl = useThree((s) => s.gl);

  const fx = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    const composer = new EffectComposer(gl, target);
    // RenderPass draws the scene into rt2 with 4x MSAA and depth. Grade writes
    // only a fullscreen quad into rt1; grade + output swap twice, so the scene
    // keeps rt2 every frame. rt1 needs neither MSAA nor a depth attachment.
    composer.renderTarget1.samples = 0;
    composer.renderTarget1.depthBuffer = false;
    composer.setPixelRatio(1);
    composer.setSize(width, height);
    const render = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.5, 0.5, 0.8);
    const grade = new ShaderPass(GradeShader);
    const output = new OutputPass();
    composer.addPass(render);
    composer.addPass(bloom);
    composer.addPass(grade);
    composer.addPass(output);
    return { composer, render, bloom, grade, output };
  }, [gl, width, height]);

  useEffect(
    () => () => {
      fx.composer.dispose();
      fx.bloom.dispose();
      fx.grade.dispose();
      fx.output.dispose();
    },
    [fx],
  );

  useFrame((state, delta) => {
    tickBeat(Math.min(delta, 0.1));
    const { composer, render, bloom, grade } = fx;
    render.scene = state.scene;
    render.camera = state.camera;
    bloom.enabled = post.bloomStrength > 0;
    bloom.strength = post.bloomStrength;
    bloom.radius = post.bloomRadius;
    bloom.threshold = post.bloomThreshold;
    grade.uniforms.uVignette.value = post.vignette;
    grade.uniforms.uAspect.value = aspect;
    grade.uniforms.uSaturation.value = post.saturation;
    grade.uniforms.uTint.value.setRGB(...post.tint);
    gl.toneMapping = post.toneMapping;
    gl.toneMappingExposure = post.exposure;
    gl.info.autoReset = false;
    gl.info.reset();
    composer.render(delta);
    if (import.meta.env.DEV) {
      window.__aeroStats = {
        ...gl.info.render,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
      };
    }

    if (hudScene) {
      gl.autoClear = false;
      gl.clearDepth();
      gl.render(hudScene, hudCamera);
    }
    gl.autoClear = true;
  }, 1);

  return null;
}
