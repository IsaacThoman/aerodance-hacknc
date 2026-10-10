import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDisposable } from '../../shared/hooks.js';
import { causticsGLSL, hash, simplex, waterGLSL } from './shaders.js';
import { makeNoise3 } from './geometry.js';
import { Bubbles, GodRays, Plankton, Reef, buildReef } from './Reef.jsx';
import { Creatures } from './Creatures.jsx';

const VENTS = [
  { x: -7.3, y: -4.4, z: -13.9 },
  { x: 8.3, y: -4.4, z: -16.9 },
  { x: 1.4, y: -4.0, z: -26.6 },
  { x: -4.6, y: -6.2, z: -9.0 },
];

export const FLOOR_Y = -6.6;

/** Seafloor height (dunes + gentle slope away from the camera). */
export function makeFloorHeight() {
  const noise = makeNoise3(42);
  return (x, z) => {
    let y = FLOOR_Y;
    y += 0.7 * noise(x * 0.045, z * 0.045, 1.0);
    y += 0.25 * noise(x * 0.14, z * 0.14, 2.0);
    y -= Math.max(0, -z - 30) * 0.035;
    y += Math.max(0, Math.abs(x) - 20) * 0.03;
    return y;
  };
}

function WaterBackground({ shared, camera }) {
  const mesh = useRef();
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...shared },
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uUnderSun;
          uniform float uTime;
          ${waterGLSL}
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            vec3 c = waterBg(d.y);
            float s = max(dot(d, -uUnderSun), 0.0);
            c += vec3(0.55, 0.95, 1.0) * pow(s, 5.0) * 0.4;
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
  );
  useFrame(() => mesh.current.position.copy(camera.position));
  return (
    <mesh ref={mesh} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[200, 32, 16]} />
    </mesh>
  );
}

const floorFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uUnderSun;
uniform vec3 uUnderSunColor;
uniform vec3 uUnderSky;
uniform vec3 uUnderGround;
${waterGLSL}
${causticsGLSL}
${hash}
${simplex}
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  vec2 p = vWorld.xz;
  float dist = length(cameraPosition - vWorld);
  // Wind-blown sand ripples, faded with distance to avoid shimmer.
  float fade = 1.0 - smoothstep(8.0, 34.0, dist);
  vec2 rd = normalize(vec2(0.35, 1.0));
  float warp = snoise(p * 0.12) * 2.4;
  float ph = dot(p, rd) * 3.4 + warp;
  float slope = cos(ph) * 0.45 * fade;
  n = normalize(n + vec3(rd.x * slope, 0.0, rd.y * slope));
  float crest = smoothstep(0.6, 1.0, sin(ph)) * fade;
  float patchN = snoise(p * 0.07) * 0.5 + 0.5;
  vec3 sand = mix(vec3(0.86, 0.76, 0.56), vec3(0.97, 0.91, 0.76), patchN);
  sand *= 0.92 + 0.12 * crest;
  float speck = hash12(floor(p * 9.0));
  sand *= 0.94 + 0.08 * speck * fade;
  vec3 L = -uUnderSun;
  float depth = max(-vWorld.y, 0.0);
  vec3 sunC = uUnderSunColor * exp(-depth * vec3(0.11, 0.035, 0.02));
  float diff = max(dot(n, L), 0.0);
  vec3 col = sand * (mix(uUnderGround, uUnderSky, n.y * 0.5 + 0.5) + sunC * diff * 0.75);
  vec2 cp = vWorld.xz + vWorld.y * (uUnderSun.xz / uUnderSun.y);
  float c = causticPattern(cp * 0.21, uTime * 0.42 + 23.0);
  c += 0.5 * causticPattern(cp * 0.13 + 0.37, uTime * 0.31 + 11.0);
  c = mix(c, 0.32, smoothstep(14.0, 45.0, dist));
  col += sand * sunC * c * 1.5;
  col = underwaterFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}
`;

function SandFloor({ shared, floorHeight }) {
  const geometry = useDisposable(() => {
    const g = new THREE.PlaneGeometry(240, 170, 150, 110);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -70);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, floorHeight(x, z));
    }
    g.computeVertexNormals();
    return g;
  });
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { ...shared },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          varying vec3 vN;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            vN = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: floorFragment,
      }),
  );
  return <mesh geometry={geometry} material={material} />;
}

export function BelowWorld({ shared, camera, floorHeight }) {
  const reef = useDisposable(() => buildReef(floorHeight), [floorHeight]);
  return (
    <>
      <WaterBackground shared={shared} camera={camera} />
      <SandFloor shared={shared} floorHeight={floorHeight} />
      <Reef shared={shared} reef={reef} />
      <Creatures shared={shared} />
      <GodRays shared={shared} />
      <Bubbles shared={shared} vents={VENTS} />
      <Plankton shared={shared} />
    </>
  );
}
