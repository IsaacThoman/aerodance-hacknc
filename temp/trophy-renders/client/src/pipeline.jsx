import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GradeShader, post } from '../../../../packages/stages/shared/post.jsx';
import { tickBeat } from '../../../../packages/stages/shared/hooks.js';

// Hides what `skip` picks for the length of one render, then puts it back.
function withHidden(scene, skip, draw) {
  const hidden = [];
  scene.traverse((o) => {
    if (o.visible && skip(o)) {
      o.visible = false;
      hidden.push(o);
    }
  });
  try {
    draw();
  } finally {
    hidden.forEach((o) => { o.visible = true; });
  }
}

// Depth of field that leaves out objects marked userData.noDepth (the light column, floor
// glow and glints): they are see-through glows, and their depth would pin a sharp band of
// background behind them.
class TrophyBokehPass extends BokehPass {
  render(...args) {
    withHidden(this.scene, (o) => o.userData.noDepth, () => super.render(...args));
  }
}

// The trophy's silhouette (the group marked userData.trophy, minus its glows and anything
// marked userData.noMask, like the floating bubbles) in white on black, at a quarter of the
// frame: the backdrop pass feathers it into a soft spotlight.
class TrophyMaskPass extends Pass {
  constructor(scene, camera, width, height) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(Math.ceil(width / 4), Math.ceil(height / 4));
    this.material = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  }

  render(renderer) {
    const { scene } = this;
    const outside = (o) => o.parent === scene && !o.userData.trophy;
    withHidden(scene, (o) => outside(o) || o.userData.noDepth || o.userData.noMask, () => {
      const background = scene.background;
      const clear = renderer.getClearColor(new THREE.Color());
      const alpha = renderer.getClearAlpha();
      scene.background = null;
      scene.overrideMaterial = this.material;
      renderer.setClearColor(0x000000, 1);
      renderer.setRenderTarget(this.target);
      renderer.clear();
      renderer.render(scene, this.camera);
      scene.overrideMaterial = null;
      scene.background = background;
      renderer.setClearColor(clear, alpha);
    });
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
  }
}

// Dims and desaturates everything but the trophy, feathered from its mask, so it stands
// clear of bright, busy stages.
const BackdropShader = {
  uniforms: {
    tDiffuse: { value: null },
    tMask: { value: null },
    uSpread: { value: 0.012 },
    uDim: { value: 0.28 },
    uDesaturate: { value: 0.3 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tMask;
    uniform float uSpread;
    uniform float uDim;
    uniform float uDesaturate;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float m = 0.0;
      for (int x = -3; x <= 3; x++) {
        for (int y = -3; y <= 3; y++) m += texture2D(tMask, vUv + vec2(float(x), float(y)) * uSpread).r;
      }
      float behind = 1.0 - smoothstep(0.0, 0.45, m / 49.0);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(c.rgb, vec3(l), uDesaturate * behind) * (1.0 - uDim * behind);
      gl_FragColor = c;
    }
  `,
};

/**
 * The game's pipeline (packages/stages/shared/post.jsx: stage -> bloom -> grade -> ACES)
 * with a depth of field and a dimmed backdrop in front of the bloom, so the trophy stays
 * sharp and clear while the stage behind it goes soft, like a product shot.
 *   focus: distance from the camera to keep sharp; aperture: blur per unit away from it;
 *   maxblur: the most blur, as a fraction of the frame
 */
export function TrophyPipeline({ width, height, aspect, focus, drawFrame, aperture = 0.0009, maxblur = 0.011 }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  const fx = useMemo(() => {
    // Both targets keep MSAA and depth: the extra passes change which one the scene lands in.
    const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(gl, target);
    composer.setPixelRatio(1);
    composer.setSize(width, height);
    const render = new RenderPass(scene, camera);
    const bokeh = new TrophyBokehPass(scene, camera, { focus, aperture, maxblur });
    const mask = new TrophyMaskPass(scene, camera, width, height);
    const backdrop = new ShaderPass(BackdropShader);
    backdrop.uniforms.tMask.value = mask.target.texture;
    const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.5, 0.5, 0.8);
    const grade = new ShaderPass(GradeShader);
    const output = new OutputPass();
    for (const pass of [render, bokeh, mask, backdrop, bloom, grade, output]) composer.addPass(pass);
    return { composer, render, bokeh, mask, bloom, grade };
  }, [gl, width, height]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    fx.composer.dispose();
    fx.mask.dispose();
  }, [fx]);

  useFrame((state, delta) => {
    tickBeat(Math.min(delta, 0.1));
    // Simulate the whole stage at the usual timestep; only rasterize frames being captured.
    if (drawFrame && !drawFrame.current) return;
    const { composer, render, bokeh, mask, bloom, grade } = fx;
    render.scene = bokeh.scene = mask.scene = state.scene;
    render.camera = bokeh.camera = mask.camera = state.camera;
    bokeh.uniforms.focus.value = focus;
    bokeh.uniforms.aspect.value = aspect;
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
    composer.render(delta);
  }, 1);

  return null;
}
