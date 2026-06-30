"use client";

import { Suspense, useEffect, useMemo } from "react";
import { Html, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import type { SurgicalStep } from "@/data/procedures";
import { modelStructures, zAnatomyTorsoModel } from "@/lib/modelConfig";
import type { StructureVisibility, ViewMode } from "@/lib/viewerTypes";

type AnatomyViewerProps = {
  step: SurgicalStep;
  visibility: StructureVisibility;
  clippingEnabled: boolean;
  viewMode: ViewMode;
  resetSignal: number;
  modelPath: string;
};

const structureById = new Map(modelStructures.map((structure) => [structure.id, structure]));
const structureByMeshName = new Map(modelStructures.flatMap((structure) => structure.meshNames.map((meshName) => [meshName, structure.id])));

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

function createStructureMaterial(structureId: string, active: boolean, viewMode: ViewMode) {
  const structure = structureById.get(structureId);
  const color = new THREE.Color(structure?.color ?? "#94a3b8");
  const baseOpacity = structure?.opacity ?? 1;
  const opacity = viewMode === "surgical" && !active ? Math.min(baseOpacity, 0.26) : baseOpacity;

  return new THREE.MeshStandardMaterial({
    color,
    emissive: viewMode === "surgical" && active ? color.clone().multiplyScalar(0.18) : new THREE.Color("#000000"),
    roughness: 0.68,
    metalness: 0.02,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: opacity >= 0.45,
  });
}

function ZAnatomyModel({ modelPath, step, visibility, viewMode }: Pick<AnatomyViewerProps, "modelPath" | "step" | "visibility" | "viewMode">) {
  const gltf = useGLTF(modelPath);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  const activeStructures = useMemo(() => new Set(step.visibleStructures), [step.visibleStructures]);

  useEffect(() => {
    const materialCache = new Map<string, THREE.MeshStandardMaterial>();

    scene.traverse((object) => {
      if (!isMesh(object)) return;

      const structureId = structureByMeshName.get(object.name);
      object.visible = Boolean(structureId && visibility[structureId]);
      object.castShadow = true;
      object.receiveShadow = true;

      if (!structureId) return;

      const materialKey = `${structureId}-${activeStructures.has(structureId)}-${viewMode}`;
      const cachedMaterial = materialCache.get(materialKey);

      if (cachedMaterial) {
        object.material = cachedMaterial;
        return;
      }

      const material = createStructureMaterial(structureId, activeStructures.has(structureId), viewMode);
      materialCache.set(materialKey, material);
      object.material = material;
    });
  }, [activeStructures, scene, viewMode, visibility]);

  return <primitive object={scene} />;
}

function ProceduralSurgicalLayers({ visibility, viewMode }: Pick<AnatomyViewerProps, "visibility" | "viewMode">) {
  if (!visibility["subcutaneous"]) return null;

  return (
    <group position={[-0.18, 0.12, 0.15]} rotation={[0.08, -0.18, -0.12]}>
      <mesh scale={[0.62, 1.05, 0.045]}>
        <boxGeometry />
        <meshStandardMaterial color="#facc15" transparent opacity={viewMode === "surgical" ? 0.48 : 0.32} depthWrite={false} />
      </mesh>
    </group>
  );
}

function LoadingModel() {
  return (
    <Html center className="pointer-events-none">
      <div className="rounded-xl bg-slate-900/90 px-4 py-3 text-xs font-semibold text-white shadow-xl">Carregando Z-Anatomy...</div>
    </Html>
  );
}

export function AnatomyViewer({ step, visibility, clippingEnabled, viewMode, resetSignal, modelPath }: AnatomyViewerProps) {
  const activeLabels = step.visibleStructures.map((id) => modelStructures.find((structure) => structure.id === id)?.label ?? id);

  return (
    <div className="viewer-shell relative h-[620px] min-h-[520px] overflow-hidden rounded-3xl border border-slate-800 bg-slate-950">
      <Canvas key={resetSignal} camera={{ position: step.camera?.position ?? [4, 3, 6], fov: 45 }} shadows>
        <color attach="background" args={["#020617"]} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[4, 6, 4]} intensity={2} castShadow />
        <directionalLight position={[-3, 2, -2]} intensity={0.75} />
        <gridHelper args={[5, 10, "#334155", "#1e293b"]} position={[0, -1.4, 0]} />
        <Suspense fallback={<LoadingModel />}>
          <ZAnatomyModel modelPath={modelPath} step={step} visibility={visibility} viewMode={viewMode} />
        </Suspense>
        <ProceduralSurgicalLayers visibility={visibility} viewMode={viewMode} />
        {clippingEnabled && (
          <mesh position={[0.15, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <planeGeometry args={[3.2, 2.4]} />
            <meshBasicMaterial color="#38bdf8" transparent opacity={0.18} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        )}
        <OrbitControls target={step.camera?.target ?? [0, 0.5, 0]} makeDefault enableDamping />
      </Canvas>
      <div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-white/10 bg-slate-950/75 p-3 text-xs text-slate-300 backdrop-blur">Z-Anatomy CC BY-SA 4.0 · Estruturas da etapa: {activeLabels.join(" • ")}</div>
    </div>
  );
}

useGLTF.preload(zAnatomyTorsoModel.modelPath);
