import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { noise } from '../../shared/glsl.js';
import { SKY, SUN_DIR } from './palette.js';

// Shared golden-hour sky gradient. Used by the dome, the environment map and
// the cloud sea (so the horizon haze matches the sky exactly).
export const skyUniformsDecl = /* glsl */ `
  uniform vec3 uZenith, uUpper, uLilac, uPink, uPeach, uGold, uSunCol, uSunDir, uHaze;
`;

export const skyFunction = /* glsl */ `
  vec3 skyGradient(vec3 d) {
    float h = d.y;
    float hh = max(h, 0.0);
    vec2 dh = normalize(d.xz + vec2(1e-5));
    vec2 sh = normalize(uSunDir.xz);
    float az = dot(dh, sh) * 0.5 + 0.5;
    // Bands sit lower on the side facing the sun.
    float k = mix(1.2, 0.85, az);
    vec3 col = mix(uPeach, uPink, smoothstep(0.0, 0.055 * k, hh));
    col = mix(col, uLilac, smoothstep(0.04 * k, 0.13 * k, hh));
    col = mix(col, uUpper, smoothstep(0.1 * k, 0.22 * k, hh));
    col = mix(col, uZenith, smoothstep(0.2, 0.52, hh));
    float warm = pow(az, 4.0) * (1.0 - smoothstep(0.0, 0.22, hh));
    col = mix(col, uGold, warm * 0.85);
    col = mix(col, uHaze, smoothstep(0.0, 0.06, -h));
    return col;
  }
  vec3 sunLight(vec3 d, float discAmt) {
    float s = max(dot(d, uSunDir), 0.0);
    float disc = smoothstep(0.99955, 0.99975, s);
    vec3 glowCol = uSunCol * vec3(1.0, 0.82, 0.6);
    return uSunCol * (disc * discAmt + pow(s, 300.0) * 0.9) + glowCol * (pow(s, 50.0) * 0.3 + pow(s, 10.0) * 0.06);
  }
`;

export function makeSkyUniforms() {
  return {
    uZenith: { value: new THREE.Color(SKY.zenith) },
    uUpper: { value: new THREE.Color(SKY.upper) },
    uLilac: { value: new THREE.Color(SKY.lilac) },
    uPink: { value: new THREE.Color(SKY.pink) },
    uPeach: { value: new THREE.Color(SKY.peach) },
    uGold: { value: new THREE.Color(SKY.gold) },
    uSunCol: { value: new THREE.Color(SKY.sun) },
    uHaze: { value: new THREE.Color(SKY.haze) },
    uSunDir: { value: SUN_DIR.clone() },
  };
}

/** Golden-hour dome with a low sun and slow pink cirrus streaks. */
export function GoldenSky({ radius = 3000 }) {
  const mesh = useRef();
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { ...makeSkyUniforms(), uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          ${skyUniformsDecl}
          varying vec3 vDir;
          ${noise}
          ${skyFunction}
          void main() {
            vec3 d = normalize(vDir);
            vec3 col = skyGradient(d);
            float h = d.y;
            // High cirrus streaks lit pink and gold from below.
            if (h > 0.015) {
              vec2 p = d.xz / (h + 0.06);
              p = mat2(0.94, -0.34, 0.34, 0.94) * p;
              p.x += uTime * 0.012;
              float n = fbm(p * vec2(0.22, 1.1) + vec2(3.0, 7.0));
              float n2 = fbm(p * vec2(0.5, 2.6) + vec2(11.0, 2.0) + n * 0.6);
              float c = smoothstep(0.05, 0.55, n * 0.7 + n2 * 0.45);
              c *= smoothstep(0.03, 0.12, h) * (1.0 - smoothstep(0.3, 0.62, h));
              float az = dot(normalize(d.xz), normalize(uSunDir.xz)) * 0.5 + 0.5;
              vec3 lit = mix(vec3(1.0, 0.62, 0.78), vec3(1.25, 0.95, 0.7), pow(az, 4.0));
              col = mix(col, lit, c * 0.5);
            }
            col += sunLight(d, 7.0);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
  );

  useFrame((state) => {
    mesh.current.position.copy(state.camera.position);
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh ref={mesh} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[radius, 64, 32]} />
    </mesh>
  );
}

/**
 * Pre-filtered environment map of the golden sky over a bright cloud floor,
 * used for chrome / pearl / glossy reflections. Returns a PMREM texture.
 */
export function useSkyEnvironment() {
  const gl = useThree((s) => s.gl);
  const [texture, setTexture] = useState(null);
  // Generated in an effect (not a memo) so StrictMode's mount/unmount/mount
  // cycle can't leave us holding a disposed render target.
  useEffect(() => {
    const scene = new THREE.Scene();
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: makeSkyUniforms(),
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        ${skyUniformsDecl}
        varying vec3 vDir;
        ${skyFunction}
        void main() {
          vec3 d = normalize(vDir);
          vec3 col = skyGradient(d);
          // Sunlit cloud floor below the horizon.
          float below = smoothstep(0.0, -0.08, d.y);
          float az = dot(normalize(d.xz + vec2(1e-5)), normalize(uSunDir.xz)) * 0.5 + 0.5;
          vec3 floorCol = mix(vec3(0.62, 0.55, 0.78), vec3(0.95, 0.72, 0.6), az * az);
          col = mix(col, floorCol, below);
          col += sunLight(d, 4.0) * 1.2;
          // A couple of soft studio-style highlights for crisp chrome reflections.
          col += vec3(1.2, 1.1, 1.25) * smoothstep(0.92, 0.97, dot(d, normalize(vec3(-0.6, 0.7, 0.4))));
          col += vec3(1.0, 0.8, 1.1) * 0.8 * smoothstep(0.95, 0.985, dot(d, normalize(vec3(0.7, 0.35, 0.6))));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), material);
    scene.add(sphere);
    const pmrem = new THREE.PMREMGenerator(gl);
    const target = pmrem.fromScene(scene, 0.015);
    pmrem.dispose();
    sphere.geometry.dispose();
    material.dispose();
    setTexture(target.texture);
    return () => {
      setTexture(null);
      target.dispose();
    };
  }, [gl]);
  return texture;
}
