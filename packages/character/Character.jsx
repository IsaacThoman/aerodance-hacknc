import { useEffect, useMemo } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import {
  AnimationMixer,
  MeshPhysicalMaterial,
  MeshBasicMaterial,
  Color,
  BufferAttribute,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createRetargeter } from "./motion.js";
import { createPoseApplier } from "./retarget.js";
import { LivePoseFilter } from './livePoseFilter.js';
import { clone } from "three/addons/utils/SkeletonUtils.js";
import modelUrl from "./assets/aero-character.glb?url";

export default function Character({
  appearance,
  animation = "Idle",
  motion,
  person = 0,
  playback,
  poseRef,
  calibration,
  live = false,
  url = modelUrl,
}) {
  const gltf = useLoader(GLTFLoader, url);
  const model = useMemo(() => clone(gltf.scene), [gltf]);
  const retarget = useMemo(
    () => (motion ? createRetargeter(model, motion, person) : null),
    [model, motion, person],
  );
  const applyPose = useMemo(() => calibration ? createPoseApplier(model, calibration, {smoothDistance:live}) : null, [model, calibration, live]);
  const poseFilter=useMemo(()=>new LivePoseFilter(),[model,calibration,live]);
  const invalidate=useThree(state=>state.invalidate);
  const mixer = useMemo(() => new AnimationMixer(model), [model]);
  const ink = useMemo(() => new MeshBasicMaterial({ color: "#020611" }), []);
  const gel = useMemo(() => {
    const material = new MeshPhysicalMaterial({
      name: "AquaGel",
      color: "#078fff",
      vertexColors: true,
      metalness: 0.7,
      roughness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      envMapIntensity: 1.4,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader =
        "attribute float gelHeight; varying float vGelHeight;\n" +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvGelHeight = gelHeight;",
      );
      shader.fragmentShader =
        "varying float vGelHeight;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * exp(-pow((vGelHeight - 0.19) / 0.16, 2.0)) * pow(max(dot(normal, normalize(vViewPosition)), 0.0), 5.0) * 4.5;",
      );
    };
    return material;
  }, []);
  useEffect(() => {
    const ownedGeometries = [];
    model.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (obj.material.name === "AquaGel") {
          const geo = obj.geometry.clone();
          ownedGeometries.push(geo);
          geo.computeBoundingBox();
          const pos = geo.attributes.position;
          const colors = new Float32Array(pos.count * 3);
          const heights = new Float32Array(pos.count);
          const min = geo.boundingBox.min.y;
          const range = geo.boundingBox.max.y - min;
          for (let i = 0; i < pos.count; i++) {
            const h = (pos.getY(i) - min) / range;
            const brightness = 0.065 + 0.935 * Math.pow(1 - h, 1.35);
            heights[i] = h;
            colors.set(
              [brightness, brightness * 0.8, brightness * (1 - 0.8 * h * h)],
              i * 3,
            );
          }
          geo.setAttribute("color", new BufferAttribute(colors, 3));
          geo.setAttribute("gelHeight", new BufferAttribute(heights, 1));
          obj.geometry = geo;
          obj.material = gel;
        }
        if (obj.material.name === "Ink") obj.material = ink;
      }
    });
    return () => {
      ownedGeometries.forEach((geo) => geo.dispose());
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      gel.dispose();
      ink.dispose();
    };
  }, [model, mixer, gel, ink]);
  useEffect(() => {
    gel.color = new Color(appearance.color);
    gel.roughness = 0.36 - appearance.gloss * 0.0029;
    gel.clearcoat = 0.4 + appearance.gloss * 0.006;
    gel.opacity = appearance.opacity ?? 0.72;
    model.traverse((obj) => {
      if (obj.name.startsWith("acc_"))
        obj.visible = obj.name.startsWith(
          `acc_${appearance.accessory.toLowerCase()}_`,
        );
    });
  }, [appearance, model, gel]);
  useEffect(() => {
    if (retarget || applyPose) return;
    const clip = gltf.animations.find((c) => c.name === animation);
    if (!clip) return;
    const action = mixer.clipAction(clip).reset().fadeIn(0.25).play();
    return () => {
      action.fadeOut(0.25);
    };
  }, [animation, gltf, mixer, retarget, applyPose]);
  useFrame((_, delta) => {
    if (applyPose) {
      applyPose(live ? poseFilter.update(poseRef.current,delta) : poseRef.current,delta);
      if(live && (poseFilter.settling || applyPose.settling)) invalidate();
    }
    else if (retarget) retarget(playback.current);
    else mixer.update(Math.min(delta, 0.05));
  });
  return <primitive object={model} dispose={null} />;
}
