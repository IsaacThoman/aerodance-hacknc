import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { beat, useDisposable } from '../../shared/hooks.js';
import { hash, simplex } from '../../shared/glsl.js';
import { CLOUD_Y, show } from './palette.js';
import { makeSkyUniforms, skyFunction, skyUniformsDecl } from './GoldenSky.jsx';

/**
 * Endless sea of cumulus tops: a height field of packed hemispherical puffs
 * (three octaves), lit by the low sun with lilac shadows, silver-lined edges
 * when looking toward the sun, and haze that melts into the sky gradient.
 */
export function CloudSea({ y = CLOUD_Y, size = 9000 }) {
  const mesh = useRef();
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...makeSkyUniforms(),
          uTime: { value: 0 },
          uLit: { value: new THREE.Color('#ffd0b0') },
          uShade: { value: new THREE.Color('#8a80d2') },
          uDeep: { value: new THREE.Color('#6a70c0') },
          uGlowCol: { value: new THREE.Color('#ffd9a0') },
          uStageGlow: { value: new THREE.Color() },
          uStagePulse: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime, uStagePulse;
          uniform vec3 uLit, uShade, uDeep, uGlowCol, uStageGlow;
          ${skyUniformsDecl}
          varying vec3 vWorld;
          ${hash}
          ${simplex}
          ${skyFunction}

          float smax(float a, float b, float k) {
            float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
            return mix(b, a, h) + k * h * (1.0 - h);
          }

          float puffs(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            float h = 0.0;
            for (int y = -1; y <= 1; y++) {
              for (int x = -1; x <= 1; x++) {
                vec2 g = vec2(float(x), float(y));
                vec2 c = i + g;
                vec2 r = g + 0.15 + hash22(c) * 0.7 - f;
                float rad = 0.6 + 0.45 * hash12(c + 17.3);
                float dome = sqrt(max(rad * rad - dot(r, r), 0.0));
                h = smax(h, dome, 0.22);
              }
            }
            return h;
          }

          float field(vec2 p, float lod1, float lod2) {
            float macro = snoise(p * 0.09 + vec2(0.0, uTime * 0.004)) * 0.5 + 0.5;
            float h = puffs(p) * (0.35 + 0.9 * macro);
            h += puffs(p * 2.3 + vec2(5.2, 1.3) + vec2(uTime * 0.012, 0.0)) * 0.38 * lod1 * (0.5 + 0.5 * macro);
            h += puffs(p * 5.1 + vec2(1.7, 9.2) - vec2(0.0, uTime * 0.02)) * 0.14 * lod2;
            return h;
          }

          void main() {
            vec3 toCam = cameraPosition - vWorld;
            float dist = length(toCam);
            vec3 V = toCam / dist;
            vec2 p = vWorld.xz * 0.04 + vec2(uTime * 0.035, uTime * 0.008);
            float lod1 = 1.0 - smoothstep(160.0, 560.0, dist);
            float lod2 = 1.0 - smoothstep(60.0, 240.0, dist);
            float e = 0.035 + dist * 0.00012;
            float h = field(p, lod1, lod2);
            float hx = field(p + vec2(e, 0.0), lod1, lod2);
            float hz = field(p + vec2(0.0, e), lod1, lod2);
            vec3 n = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
            // Flatten normals in the distance to avoid shimmer.
            n = normalize(mix(n, vec3(0.0, 1.0, 0.0), smoothstep(260.0, 950.0, dist)));

            float ndl = dot(n, uSunDir);
            float wrap = clamp((ndl + 0.55) / 1.4, 0.0, 1.0);
            wrap = pow(wrap, 1.4);
            vec3 col = mix(uShade, uLit, wrap);
            float cavity = smoothstep(0.0, 1.1, h);
            col = mix(uDeep, col, 0.35 + 0.65 * cavity);
            // Sky light from above on upward-facing tops.
            col += vec3(0.07, 0.07, 0.15) * max(n.y, 0.0) * cavity;

            // Forward scattering: silver/golden lining toward the sun.
            float toward = max(dot(-V, uSunDir), 0.0);
            float edge = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 2.0);
            col += uGlowCol * pow(toward, 10.0) * (0.15 + edge * 1.2) * (0.6 + 0.4 * cavity);
            col += uGlowCol * pow(toward, 4.0) * 0.08;

            // Colored light pool from the stage hovering above.
            float r2 = dot(vWorld.xz, vWorld.xz);
            col += uStageGlow * exp(-r2 / 260.0) * (0.35 + 0.35 * uStagePulse) * (0.4 + 0.6 * cavity);

            // Foreground sits a little deeper so the bright stage pops.
            col *= mix(0.8, 1.0, smoothstep(25.0, 140.0, dist));
            // Haze into the horizon, matching the sky dome.
            vec3 hd = normalize(vec3(-V.x, 0.0, -V.z));
            vec3 horizon = skyGradient(vec3(hd.x, 0.004, hd.z)) + sunLight(normalize(vec3(-V.x, 0.02, -V.z)), 0.0) * 0.6;
            float fog = 1.0 - exp(-pow(dist * 0.0016, 1.6));
            col = mix(col, horizon, clamp(fog, 0.0, 1.0));
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
  );

  useFrame((state) => {
    const u = material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uStageGlow.value.copy(show.colors[0]).lerp(show.colors[2], 0.35);
    u.uStagePulse.value = beat.pulse;
    // Keep the plane centered under the camera so it reads as endless.
    mesh.current.position.set(state.camera.position.x, y, state.camera.position.z);
  });

  return (
    <mesh ref={mesh} material={material} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false}>
      <planeGeometry args={[size, size]} />
    </mesh>
  );
}
