import * as THREE from 'three';
import { noise } from '../../shared/glsl.js';
import { env, LIGHTING } from './state.js';

/**
 * Lit material for props: per-vertex color (aColor) + emissive amount (aEmit),
 * optional snow on upward faces. Works for meshes and InstancedMesh.
 */
export function makeLitMaterial({ snow = 0, snowColor = '#c9d6ee', wrap = 0.25, side = THREE.FrontSide, haze = 1 } = {}) {
  return new THREE.ShaderMaterial({
    side,
    uniforms: {
      ...env,
      uSnow: { value: snow },
      uSnowColor: { value: new THREE.Color(snowColor) },
      uWrap: { value: wrap },
      uHazeMul: { value: haze },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aEmit;
      varying vec3 vColor;
      varying float vEmit;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = m * instanceMatrix;
        #endif
        vec4 wp = m * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(m) * normal);
        vColor = aColor;
        vEmit = aEmit;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uSnow;
      uniform vec3 uSnowColor;
      uniform float uWrap;
      uniform float uHazeMul;
      varying vec3 vColor;
      varying float vEmit;
      varying vec3 vWorld;
      varying vec3 vNormal;
      ${noise}
      ${LIGHTING}
      void main() {
        vec3 N = normalize(vNormal);
        if (!gl_FrontFacing) N = -N;
        float n = snoise(vWorld.xz * 1.3) * 0.5 + snoise(vWorld.xz * 4.1) * 0.25;
        float snow = uSnow * smoothstep(0.55, 0.8, N.y + n * 0.25);
        vec3 albedo = mix(vColor, uSnowColor, snow);
        vec3 col = shade(albedo, N, vWorld, uWrap);
        col = mix(col, vColor, clamp(vEmit, 0.0, 1.0)) + vColor * max(vEmit - 1.0, 0.0);
        col = applyHaze(col, vWorld, uHazeMul);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/** Build a merged-ready geometry: assigns aColor / aEmit attributes to a geometry. */
export function paint(geometry, color, emit = 0) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const em = new Float32Array(n);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    em[i] = emit;
  }
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aEmit', new THREE.BufferAttribute(em, 1));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
