import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * Reflection/IBL environment for a stage, prefiltered with PMREM.
 * The glass dancers get most of their gloss from this, so match it to the stage.
 *
 *   preset="room": three's neutral studio (the original look)
 *   otherwise a gradient sphere (top/horizon/bottom) plus emissive light panels:
 *   lights: [{ position: [x, y, z], color, intensity, size: [w, h] }]
 *   intensity: scene.environmentIntensity
 */
export function StageEnvironment({
  preset,
  top = '#5fb8ff',
  horizon = '#e8fbff',
  bottom = '#3e7f73',
  lights = [],
  intensity = 1,
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const key = JSON.stringify({ preset, top, horizon, bottom, lights });

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    let source;
    const owned = [];
    if (preset === 'room') {
      source = new RoomEnvironment();
    } else {
      source = new THREE.Scene();
      const sky = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          uTop: { value: new THREE.Color(top) },
          uHorizon: { value: new THREE.Color(horizon) },
          uBottom: { value: new THREE.Color(bottom) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop, uHorizon, uBottom;
          varying vec3 vDir;
          void main() {
            float h = normalize(vDir).y;
            vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.6)) : mix(uHorizon, uBottom, pow(-h, 0.4));
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      });
      const sphere = new THREE.SphereGeometry(50, 32, 16);
      source.add(new THREE.Mesh(sphere, sky));
      owned.push(sky, sphere);
      const panel = new THREE.PlaneGeometry(1, 1);
      owned.push(panel);
      for (const l of lights) {
        const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(l.color ?? '#ffffff').multiplyScalar(l.intensity ?? 4), side: THREE.DoubleSide });
        owned.push(m);
        const mesh = new THREE.Mesh(panel, m);
        mesh.position.set(...l.position);
        mesh.scale.set(...(l.size ?? [8, 8]), 1);
        mesh.lookAt(0, 0, 0);
        source.add(mesh);
      }
    }
    const target = pmrem.fromScene(source, 0.04);
    scene.environment = target.texture;
    if (preset === 'room') source.dispose();
    owned.forEach((o) => o.dispose());
    pmrem.dispose();
    return () => {
      if (scene.environment === target.texture) scene.environment = null;
      target.dispose();
    };
  }, [gl, scene, key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scene.environmentIntensity = intensity;
    return () => {
      scene.environmentIntensity = 1;
    };
  }, [scene, intensity]);

  return null;
}
