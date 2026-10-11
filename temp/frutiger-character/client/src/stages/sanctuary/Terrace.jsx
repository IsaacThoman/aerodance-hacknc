import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { beat, useDisposable } from '../shared/hooks.js';
import { noise } from '../shared/glsl.js';
import { COLORS } from './layout.js';
import { stageUniforms } from './materials.js';
import {
  CANOPY,
  DAIS_R,
  DECK_Y,
  FOUNTAIN,
  WIND_FLOWERS,
  flowerSpots,
  makeChromeGeometry,
  makeDeckGeometry,
  makeGlassGeometry,
  makeGlowGeometry,
  makeLawnGeometry,
  makeLeafGeometry,
  makePetalGeometry,
  makePoolGeometry,
  makeRotorGeometry,
  makeWhiteGeometry,
} from './terraceGeometry.js';

// The rooftop dance terrace: glossy dais with glowing rings, deck, infinity
// pool, fountain basin, planters with topiary and flowers, petal canopy,
// wind flowers and glass balustrades.

function makeFloorMaterial(envMap) {
  const mat = new THREE.MeshPhysicalMaterial({ color: '#cfdee5', roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, envMap });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = stageUniforms.uTime;
    shader.uniforms.uBeat = stageUniforms.uBeat;
    shader.uniforms.uBeatPhase = stageUniforms.uBeatPhase;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFloor;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFloor = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime, uBeat, uBeatPhase;
        varying vec2 vFloor;
        float ringLine(float r, float at, float w, float fw) {
          return 1.0 - smoothstep(w * 0.5 - fw, w * 0.5 + fw, abs(r - at));
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float r = length(vFloor);
        float ang = atan(vFloor.y, vFloor.x);
        float fw = max(fwidth(r), 1e-4);
        // Pearl white warming to pale aqua toward the rim.
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.8, 0.95, 0.97), smoothstep(2.0, 6.2, r));
        // Glass inlay in the middle with fine concentric etching.
        float inlay = 1.0 - smoothstep(1.85 - fw, 1.85 + fw, r);
        vec3 inlayCol = mix(vec3(0.38, 0.85, 1.0), vec3(0.8, 0.96, 1.0), smoothstep(0.0, 1.85, r));
        float etch = ringLine(fract(r / 0.42) * 0.42, 0.21, 0.03, fw) * inlay;
        diffuseColor.rgb = mix(diffuseColor.rgb, inlayCol, inlay * 0.9);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.75, 0.95), etch * 0.5);
        // Pale aqua spokes between the rings.
        float seg = 6.2831853 / 24.0;
        float spokeD = abs(mod(ang + seg * 0.5, seg) - seg * 0.5) * r;
        float spoke = (1.0 - smoothstep(0.025, 0.025 + fwidth(spokeD) * 1.5, spokeD)) * step(1.95, r) * step(r, 5.8);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.7, 0.9, 0.95), spoke * 0.55);
        // Inset glowing rings; each lights up in turn on the beat like a ripple.
        float rings = 0.0;
        float glow = 0.0;
        for (int i = 0; i < 4; i++) {
          float at = 1.9 + float(i) * 1.3;
          float w = i == 0 || i == 3 ? 0.17 : 0.12;
          float m = ringLine(r, at, w, fw);
          float pulse = exp(-max(uBeatPhase - float(i) * 0.07, 0.0) * 5.0) * step(float(i) * 0.07, uBeatPhase);
          rings = max(rings, m);
          glow += m * (0.9 + 1.6 * pulse);
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.85, 0.95), rings);
        // Soft aqua wave sweeping outward each beat.
        float wave = exp(-pow((r - uBeatPhase * 7.0) * 2.2, 2.0)) * (1.0 - uBeatPhase) * step(r, 6.1);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.25, 0.95, 1.0) * glow * 1.8 + vec3(0.2, 0.7, 0.85) * wave * 0.22 + vec3(0.25, 0.7, 0.9) * inlay * 0.12;`,
      );
  };
  mat.customProgramCacheKey = () => 'sanctuary-floor';
  return mat;
}

function makeDeckMaterial(envMap) {
  const mat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.45, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2, envMap });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vDeck;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDeck = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vDeck;\n${noise}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Pale honey decking laid in rings around the dais, with staggered plank ends.
        float r = length(vDeck);
        float ang = atan(vDeck.y, vDeck.x);
        float rr = r / 0.55;
        float plank = floor(rr);
        float fr = fwidth(rr);
        float seam = 1.0 - smoothstep(0.04, 0.04 + fr * 1.5, 0.5 - abs(fract(rr) - 0.5));
        float len = 2.4 / max(r, 1.0);
        float ea = ang / len + hash11(plank) * 7.0;
        float ed = (0.5 - abs(fract(ea) - 0.5)) * len * r;
        float endJoint = 1.0 - smoothstep(0.03, 0.03 + fwidth(ed) * 1.5, ed);
        float fade = 1.0 - smoothstep(0.3, 0.7, fr);
        float tone = hash11(plank * 3.1 + floor(ea) * 1.7);
        float grain = snoise(vec2(ang * r * 0.6, rr * 4.0)) * 0.5 + 0.5;
        vec3 wood = mix(vec3(0.4, 0.24, 0.12), vec3(0.64, 0.44, 0.24), tone * 0.7 + grain * 0.3);
        diffuseColor.rgb = wood * (1.0 - max(seam, endJoint) * 0.35 * fade);`,
      );
  };
  mat.customProgramCacheKey = () => 'sanctuary-deck';
  return mat;
}

function makeLawnMaterial(envMap) {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, envMap });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLawn;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLawn = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vLawn;\n${noise}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Bright mown lawn: soft mottling plus curved mowing stripes.
        float n = snoise(vLawn * 0.6) * 0.5 + snoise(vLawn * 2.3) * 0.25;
        float stripe = step(0.5, fract(length(vLawn) / 1.1));
        diffuseColor.rgb = mix(vec3(0.2, 0.55, 0.08), vec3(0.42, 0.78, 0.14), 0.55 + 0.35 * n) * (0.92 + 0.12 * stripe);`,
      );
  };
  mat.customProgramCacheKey = () => 'sanctuary-lawn';
  return mat;
}

function makeWaterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: stageUniforms.uTime,
      uBeat: stageUniforms.uBeat,
      uSun: stageUniforms.uSunDir,
      uTop: { value: new THREE.Color(COLORS.skyTop) },
      uHorizon: { value: new THREE.Color(COLORS.skyHorizon) },
      uFountain: { value: new THREE.Vector3(FOUNTAIN.x, FOUNTAIN.z, FOUNTAIN.r) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${noise}
      uniform float uTime, uBeat;
      uniform vec3 uSun, uTop, uHorizon, uFountain;
      varying vec3 vWPos;
      float height(vec2 p) {
        float h = snoise(p * 0.9 + vec2(uTime * 0.25, uTime * 0.12)) * 0.5 + snoise(p * 2.3 - vec2(uTime * 0.4, -uTime * 0.2)) * 0.25;
        float d = length(p - uFountain.xy);
        h += sin(d * 9.0 - uTime * 7.0) * 0.5 * exp(-d * 0.5) * step(d, uFountain.z);
        return h;
      }
      void main() {
        vec2 p = vWPos.xz;
        vec3 V = normalize(cameraPosition - vWPos);
        float e = 0.06;
        float h0 = height(p);
        vec3 N = normalize(vec3(-(height(p + vec2(e, 0.0)) - h0) / e * 0.06, 1.0, -(height(p + vec2(0.0, e)) - h0) / e * 0.06));
        vec3 R = reflect(-V, N);
        vec3 sky = mix(uHorizon, uTop, pow(clamp(R.y, 0.0, 1.0), 0.55));
        float sun = pow(max(dot(R, normalize(uSun)), 0.0), 420.0) * 2.2;
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        // Bright pool body: aqua tiles with dancing caustics.
        vec2 cp = p * 1.3;
        float c1 = 1.0 - abs(snoise(cp + vec2(uTime * 0.35, uTime * 0.2)));
        float c2 = 1.0 - abs(snoise(cp * 1.7 - vec2(uTime * 0.25, -uTime * 0.3) + 4.0));
        float caustic = pow(c1, 8.0) + pow(c2, 8.0) * 0.7;
        vec2 tile = abs(fract(p * 1.4) - 0.5);
        float grout = smoothstep(0.46, 0.49, max(tile.x, tile.y));
        vec3 body = mix(vec3(0.0, 0.24, 0.5), vec3(0.02, 0.46, 0.68), smoothstep(-0.4, 0.6, snoise(p * 0.2)));
        body = mix(body, vec3(0.5, 0.9, 0.95), grout * 0.25);
        body += vec3(0.4, 0.9, 1.0) * caustic * (0.35 + 0.15 * uBeat);
        vec3 col = mix(body, sky, clamp(fres * 0.7, 0.0, 1.0)) + vec3(1.0, 0.95, 0.85) * sun;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function makePetalMaterial(envMap) {
  const mat = new THREE.MeshPhysicalMaterial({ color: '#f6fbfd', roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1, side: THREE.DoubleSide, envMap });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBeat = stageUniforms.uBeat;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPetal;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvPetal = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPetal;\nuniform float uBeat;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float edge = smoothstep(0.9, 0.97, abs(vPetal.y - 0.5) * 2.0);
        // Upper side carries solar cells; the underside stays white and glows softly.
        if (gl_FrontFacing) {
          vec2 g = vec2(vPetal.x * 22.0, vPetal.y * 7.0);
          vec2 f = abs(fract(g) - 0.5);
          float grid = smoothstep(0.42, 0.47, max(f.x, f.y));
          diffuseColor.rgb = mix(mix(vec3(0.05, 0.25, 0.62), vec3(0.85, 0.92, 0.96), grid), vec3(1.0), smoothstep(0.82, 0.9, abs(vPetal.y - 0.5) * 2.0));
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.3, 0.95, 1.0) * edge * (1.2 + 1.0 * uBeat) + (gl_FrontFacing ? vec3(0.0) : vec3(0.32, 0.36, 0.38));`,
      );
  };
  mat.customProgramCacheKey = () => 'sanctuary-petal';
  return mat;
}

const FLOWER_COLORS = ['#ff6fb5', '#ffe14a', '#ffffff', '#e64fd0', '#ff8a5c', '#b98cff'];

function Flowers({ envMap }) {
  const geometry = useDisposable(() => new THREE.IcosahedronGeometry(0.12, 1));
  const material = useDisposable(() => new THREE.MeshStandardMaterial({ roughness: 0.45, envMap }), [envMap]);
  const mesh = useMemo(() => {
    const spots = flowerSpots();
    const m = new THREE.InstancedMesh(geometry, material, spots.length);
    const mat = new THREE.Matrix4();
    const c = new THREE.Color();
    spots.forEach(([x, y, z, ci], i) => {
      m.setMatrixAt(i, mat.makeTranslation(x, y, z));
      m.setColorAt(i, c.set(FLOWER_COLORS[ci]));
    });
    m.castShadow = false;
    return m;
  }, [geometry, material]);
  useEffect(() => () => mesh.dispose(), [mesh]);
  return <primitive object={mesh} />;
}

function Canopy({ material }) {
  const geometry = useDisposable(() => makePetalGeometry());
  const petals = [-35, 18, 70, 125, 185, 245, 300];
  return (
    <group position={[CANOPY.x, DECK_Y + CANOPY.h - 1.6, CANOPY.z]}>
      {petals.map((deg, i) => (
        <mesh key={deg} geometry={geometry} material={material} rotation={[0, THREE.MathUtils.degToRad(deg), (i % 2 ? 0.08 : -0.04)]} scale={i % 2 ? 0.86 : 1} castShadow />
      ))}
    </group>
  );
}

function WindFlowers({ envMap }) {
  const geometry = useDisposable(() => makeRotorGeometry());
  const material = useDisposable(() => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, envMap }), [envMap]);
  const refs = useRef([]);
  useFrame((_, delta) => {
    refs.current.forEach((m, i) => {
      if (m) m.rotation.z += WIND_FLOWERS[i].speed * Math.min(delta, 0.1);
    });
  });
  // Rotors face the camera, slightly turned toward the terrace middle.
  return WIND_FLOWERS.map((W, i) => (
    <group key={i} position={[W.x, DECK_Y + W.h + 0.25, W.z + 0.2]} rotation={[0, -0.35 - i * 0.12, 0]} scale={W.r}>
      <mesh ref={(m) => (refs.current[i] = m)} geometry={geometry} material={material} castShadow />
    </group>
  ));
}

export function Terrace({ envMap }) {
  const deck = useDisposable(() => makeDeckGeometry());
  const pools = useDisposable(() => makePoolGeometry());
  const whiteGeo = useDisposable(() => makeWhiteGeometry());
  const chromeGeo = useDisposable(() => makeChromeGeometry());
  const glassGeo = useDisposable(() => makeGlassGeometry());
  const glowGeo = useDisposable(() => makeGlowGeometry());
  const leafGeo = useDisposable(() => makeLeafGeometry());
  const lawnGeo = useDisposable(() => makeLawnGeometry());
  const floorGeo = useDisposable(() => new THREE.CircleGeometry(DAIS_R, 96).rotateX(-Math.PI / 2));

  const floorMat = useDisposable(() => makeFloorMaterial(envMap), [envMap]);
  const deckMat = useDisposable(() => makeDeckMaterial(envMap), [envMap]);
  const waterMat = useDisposable(() => makeWaterMaterial());
  const lawnMat = useDisposable(() => makeLawnMaterial(envMap), [envMap]);
  const petalMat = useDisposable(() => makePetalMaterial(envMap), [envMap]);
  const whiteMat = useDisposable(() => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.08, envMap }), [envMap]);
  const chromeMat = useDisposable(() => new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 1, roughness: 0.12, envMap }), [envMap]);
  const glassMat = useDisposable(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#bff3ff',
        roughness: 0.04,
        metalness: 0.1,
        transparent: true,
        opacity: 0.3,
        envMap,
        envMapIntensity: 1.4,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [envMap],
  );
  const glowMat = useDisposable(() => new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.5, 2.5, 2.5) }));
  const leafMat = useDisposable(() => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.35, envMap }), [envMap]);

  useFrame(() => {
    glowMat.color.setScalar(2.2 + beat.pulse * 1.6);
  });

  return (
    <group>
      <mesh geometry={floorGeo} material={floorMat} receiveShadow />
      <mesh geometry={deck} material={deckMat} receiveShadow />
      <mesh geometry={pools} material={waterMat} />
      <mesh geometry={lawnGeo} material={lawnMat} receiveShadow />
      <mesh geometry={whiteGeo} material={whiteMat} castShadow receiveShadow />
      <mesh geometry={chromeGeo} material={chromeMat} />
      <mesh geometry={glowGeo} material={glowMat} />
      <mesh geometry={leafGeo} material={leafMat} castShadow receiveShadow />
      <mesh geometry={glassGeo} material={glassMat} renderOrder={5} />
      <Flowers envMap={envMap} />
      <Canopy material={petalMat} />
      <WindFlowers envMap={envMap} />
    </group>
  );
}
