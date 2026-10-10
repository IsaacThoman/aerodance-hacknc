import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { noise } from '../../shared/glsl.js';
import { COLORS, FOG, SUN } from './layout.js';

// The bay: planar reflections of the skyline, turquoise body color with
// caustics in the foreground, foam along the seawall, boat wakes and
// twinkling sun sparkles that feed the bloom.

export const MAX_BOATS = 8;
export const waterUniforms = {
  uTime: { value: 0 },
  uBoats: { value: Array.from({ length: MAX_BOATS }, () => new THREE.Vector4(0, 0, 0, 0)) },
};

export const LAYER_NO_REFLECT = 2;

const WaterShader = {
  name: 'EcoWater',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uSun: { value: new THREE.Vector3() },
    uCam: { value: new THREE.Vector3() },
    uFog: { value: new THREE.Color() },
    uBoats: { value: [] },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUvR;
    varying vec3 vWorld;
    varying float vDepth;
    void main() {
      vUvR = textureMatrix * vec4(position, 1.0);
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vec4 mv = viewMatrix * w;
      vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    ${noise}
    #define FOG_NEAR ${FOG[0].toFixed(1)}
    #define FOG_FAR ${FOG[1].toFixed(1)}
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec3 uSun;
    uniform vec3 uCam;
    uniform vec3 uFog;
    uniform vec4 uBoats[${MAX_BOATS}];
    varying vec4 vUvR;
    varying vec3 vWorld;
    varying float vDepth;

    float smoothS(float e0, float e1, float x) { return smoothstep(e0, e1, x); }
    float shoreZ(float x) {
      return 46.0 + 7.0 * sin(0.012 * x + 0.6) + 190.0 * smoothS(360.0, 600.0, x) + 170.0 * smoothS(-380.0, -640.0, x);
    }

    vec2 waveGrad(vec2 p, float t) {
      vec2 g = vec2(0.0);
      // A few long swells plus shorter chop, each with analytic slope.
      vec4 W[6];
      W[0] = vec4(normalize(vec2(0.3, 1.0)), 0.045, 0.9);
      W[1] = vec4(normalize(vec2(-0.6, 1.0)), 0.07, 1.1);
      W[2] = vec4(normalize(vec2(1.0, 0.2)), 0.11, 1.4);
      W[3] = vec4(normalize(vec2(-1.0, 0.45)), 0.17, 1.7);
      W[4] = vec4(normalize(vec2(0.2, -1.0)), 0.29, 2.3);
      W[5] = vec4(normalize(vec2(0.8, -0.7)), 0.43, 2.9);
      float amp[6];
      amp[0] = 0.5; amp[1] = 0.36; amp[2] = 0.22; amp[3] = 0.15; amp[4] = 0.08; amp[5] = 0.05;
      for (int i = 0; i < 6; i++) {
        float ph = dot(W[i].xy, p) * W[i].z + t * W[i].w;
        g += W[i].xy * W[i].z * amp[i] * cos(ph);
      }
      return g;
    }

    void main() {
      vec2 p = vWorld.xz;
      float t = uTime;
      vec3 toCam = uCam - vWorld;
      float dist = length(toCam);
      vec3 v = toCam / dist;
      float near = 1.0 - smoothstep(120.0, 700.0, dist);

      vec2 g = waveGrad(p, t) * mix(0.35, 1.0, near);
      // Fine ripples from noise (finite differences).
      float e = 0.6;
      vec2 rp = p * 0.18 + vec2(t * 0.25, -t * 0.18);
      float r0 = snoise(rp);
      vec2 rg = vec2(snoise(rp + vec2(e, 0.0)) - r0, snoise(rp + vec2(0.0, e)) - r0) / e;
      g += rg * 0.09 * near;
      vec3 n = normalize(vec3(-g.x, 1.0, -g.y));

      float cosT = clamp(dot(n, v), 0.0, 1.0);
      float fres = 0.06 + 0.94 * pow(1.0 - cosT, 4.0);
      fres = mix(fres, 1.0, 0.1);

      vec2 ruv = vUvR.xy / vUvR.w + n.xz * vec2(0.022, 0.035);
      vec3 refl = texture2D(tDiffuse, ruv).rgb;

      // Body color: turquoise lagoon in front, deeper blue toward the city.
      vec3 shallow = vec3(0.0, 0.40, 0.50);
      vec3 deep = vec3(0.0, 0.2, 0.38);
      float depthMix = smoothstep(260.0, 60.0, p.y) * 0.75 + 0.25 * (1.0 - near);
      vec3 body = mix(shallow, deep, depthMix);
      // Soft caustic web visible through the clear foreground water.
      vec2 cp = p * 0.07;
      float w1 = snoise(vec3(cp + snoise(cp * 0.5 + t * 0.05) * 0.6, t * 0.18));
      float caustic = pow(1.0 - abs(w1), 7.0);
      body += vec3(0.25, 0.55, 0.5) * caustic * 0.22 * near * (1.0 - depthMix);
      float sss = pow(max(dot(n, normalize(vec3(-uSun.x, 0.4, -uSun.z))), 0.0), 3.0);
      body += vec3(0.0, 0.18, 0.15) * sss * 0.3;

      vec3 col = mix(body, refl, fres);

      // Sun glitter and sparkles (HDR so the bloom catches them).
      vec3 hv = normalize(uSun + v);
      float spec = pow(max(dot(n, hv), 0.0), 600.0) * 30.0;
      vec2 cell = floor(p / 2.4);
      float rnd = hash12(cell);
      vec2 f = fract(p / 2.4) - 0.5 - (hash22(cell) - 0.5) * 0.6;
      float tw = sin(t * (2.0 + rnd * 4.0) + rnd * 60.0);
      float spark = smoothstep(0.16, 0.0, length(f)) * step(0.975, rnd) * smoothstep(0.75, 1.0, tw);
      spark *= (1.0 - smoothstep(140.0, 520.0, dist));
      col += vec3(1.0, 0.98, 0.9) * (spec + spark * 9.0) * mix(0.4, 1.0, fres);

      // Foam along the seawall and beaches.
      float dShore = p.y - shoreZ(p.x);
      float lap = 1.2 + 0.8 * sin(t * 1.4 + p.x * 0.21) + snoise(p * 0.3 + t * 0.3) * 0.6;
      float foam = smoothstep(lap + 0.8, lap - 0.4, dShore) * smoothstep(-2.0, 0.0, dShore);
      foam *= 0.55 + 0.45 * snoise(p * 0.9 + t * 0.5);

      // Boat wakes: a Kelvin "V" plus a churned trail.
      for (int i = 0; i < ${MAX_BOATS}; i++) {
        vec4 b = uBoats[i];
        if (b.w <= 0.0) continue;
        vec2 dir = vec2(cos(b.z), sin(b.z));
        vec2 d = p - b.xy;
        float along = -dot(d, dir);
        float side = dot(d, vec2(-dir.y, dir.x));
        if (along < -6.0 || along > 45.0) continue;
        float decay = exp(-max(along, 0.0) / 13.0);
        float arm = abs(abs(side) - along * 0.36 - 1.0);
        float v1 = smoothstep(1.2, 0.0, arm) * step(0.0, along) * (0.6 + 0.4 * snoise(vec2(along * 0.5 - t * 1.5, side * 0.5)));
        float trail = smoothstep(2.0 + along * 0.06, 0.0, abs(side)) * smoothstep(-1.0, 2.0, along) * (0.5 + 0.5 * snoise(vec2(along * 0.4 - t * 2.0, side)));
        float bow = smoothstep(4.5, 2.0, length(d - dir * 1.5)) * 0.6;
        foam += (v1 * 0.6 + trail * 0.8 + bow) * decay * b.w;
      }
      col = mix(col, vec3(0.92, 0.98, 1.0), clamp(foam, 0.0, 1.0) * 0.85);

      float fogF = smoothstep(FOG_NEAR, FOG_FAR, vDepth);
      col = mix(col, uFog, fogF);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function Water() {
  const camera = useThree((s) => s.camera);
  const reflector = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(6000, 4000, 1, 1);
    const r = new Reflector(geometry, {
      textureWidth: 640,
      textureHeight: 480,
      clipBias: 0.002,
      multisample: 0,
      shader: WaterShader,
    });
    r.rotation.x = -Math.PI / 2;
    r.position.set(0, 0, 1000);
    const u = r.material.uniforms;
    u.uSun.value.copy(SUN);
    u.uFog.value.set(COLORS.fog);
    u.uBoats.value = waterUniforms.uBoats.value;
    return r;
  }, []);
  useEffect(
    () => () => {
      reflector.geometry.dispose();
      reflector.dispose();
    },
    [reflector],
  );

  useFrame((state) => {
    const u = reflector.material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uCam.value.copy(state.camera.position);
    // Small details skip the reflection pass.
    const rc = reflector.getReflectionCamera(state.camera);
    rc.layers.mask = state.camera.layers.mask;
    rc.layers.disable(LAYER_NO_REFLECT);
  });

  useEffect(() => {
    camera.layers.enable(LAYER_NO_REFLECT);
    return () => camera.layers.disable(LAYER_NO_REFLECT);
  }, [camera]);

  return <primitive object={reflector} />;
}
