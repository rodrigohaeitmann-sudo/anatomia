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

function GuideLabel({ position, children }: { position: [number, number, number]; children: React.ReactNode }) {
  return (
    <Html position={position} className="pointer-events-none">
      <div className="max-w-36 rounded-xl border border-white/10 bg-slate-950/85 px-2 py-1 text-[10px] font-semibold leading-tight text-white shadow-xl backdrop-blur">{children}</div>
    </Html>
  );
}

function OverlayBox({ color, opacity = 0.72, position, rotation = [0, 0, 0], scale }: { color: string; opacity?: number; position: [number, number, number]; rotation?: [number, number, number]; scale: [number, number, number] }) {
  return (
    <mesh position={position} rotation={rotation} scale={scale}>
      <boxGeometry />
      <meshStandardMaterial color={color} transparent opacity={opacity} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function OverlaySphere({ color, opacity = 0.72, position, scale }: { color: string; opacity?: number; position: [number, number, number]; scale: [number, number, number] }) {
  return (
    <mesh position={position} scale={scale}>
      <sphereGeometry args={[1, 32, 20]} />
      <meshStandardMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

function OverlayTorus({ color, opacity = 0.85, position, rotation = [Math.PI / 2, 0, 0], scale }: { color: string; opacity?: number; position: [number, number, number]; rotation?: [number, number, number]; scale: [number, number, number] }) {
  return (
    <mesh position={position} rotation={rotation} scale={scale}>
      <torusGeometry args={[1, 0.045, 12, 72]} />
      <meshStandardMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

function SurgicalGuideOverlay({ step }: { step: SurgicalStep }) {
  const preset = step.overlayPreset;
  const showPaddle = [
    "skin-marking",
    "lateral-decubitus",
    "inferior-incision",
    "inferolateral-dissection",
    "upper-incision",
    "trapezius-plane",
    "islanded-flap",
    "deepithelialization",
  ].includes(preset);
  const showPedicle = ["pedicle-anatomy", "pedicle-isolation", "islanded-flap", "axillary-tunnel", "anterior-flap", "muscle-coverage"].includes(preset);
  const showAnteriorPocket = ["breast-pocket", "prepectoral-pocket", "sizer", "irrigation", "implant", "pocket-closure", "muscle-coverage"].includes(preset);

  return (
    <group>
      {showPaddle && <OverlayTorus color="#a855f7" position={[0.28, 0.08, 0.5]} scale={[0.48, 0.2, 0.07]} />}
      {preset === "inferior-incision" && <OverlayBox color="#a855f7" position={[0.28, -0.2, 0.52]} rotation={[0, 0, -0.15]} scale={[0.82, 0.026, 0.026]} />}
      {preset === "upper-incision" && <OverlayBox color="#a855f7" position={[0.18, 0.48, 0.52]} rotation={[0, 0, -0.15]} scale={[0.82, 0.026, 0.026]} />}
      {["inferior-incision", "inferolateral-dissection"].includes(preset) && <OverlayBox color="#facc15" opacity={0.32} position={[0.16, -0.02, 0.44]} rotation={[0.15, -0.25, -0.45]} scale={[0.76, 0.04, 0.34]} />}
      {["inferolateral-dissection", "trapezius-plane"].includes(preset) && <OverlaySphere color="#ef4444" opacity={0.26} position={[-0.04, 0.84, 0.24]} scale={[0.34, 0.24, 0.16]} />}
      {preset === "trapezius-plane" && <OverlayBox color="#22c55e" opacity={0.5} position={[0.04, 0.68, 0.36]} rotation={[0.12, -0.2, 0.42]} scale={[0.54, 0.03, 0.24]} />}
      {preset === "free-anterior-border" && <OverlayBox color="#38bdf8" opacity={0.72} position={[0.55, 0.02, 0.32]} rotation={[0, 0, -0.18]} scale={[0.04, 0.8, 0.04]} />}
      {preset === "superior-limit" && <OverlayBox color="#f59e0b" opacity={0.72} position={[0.45, 0.66, 0.26]} rotation={[0, 0, 0.55]} scale={[0.62, 0.035, 0.035]} />}
      {["inferior-limit", "inferior-muscle-release"].includes(preset) && <OverlayBox color="#a855f7" opacity={0.76} position={[-0.22, -0.55, 0.32]} rotation={[0, 0, -0.18]} scale={[0.76, 0.035, 0.035]} />}
      {preset === "deep-plane-clean" && <OverlayBox color="#22c55e" opacity={0.35} position={[0.12, 0.05, 0.26]} rotation={[0.1, -0.25, -0.2]} scale={[0.88, 0.035, 0.52]} />}
      {showPedicle && (
        <group>
          <OverlayBox color="#ef4444" opacity={0.9} position={[0.5, 0.42, 0.32]} rotation={[0.15, 0.1, -0.62]} scale={[0.035, 0.72, 0.035]} />
          <OverlayBox color="#38bdf8" opacity={0.9} position={[0.56, 0.42, 0.3]} rotation={[0.15, 0.1, -0.62]} scale={[0.03, 0.66, 0.03]} />
          <OverlaySphere color="#60a5fa" opacity={0.72} position={[0.48, 0.5, 0.33]} scale={[0.11, 0.11, 0.11]} />
        </group>
      )}
      {preset === "axillary-tunnel" && <OverlayBox color="#38bdf8" opacity={0.35} position={[0.55, 0.08, 0.42]} rotation={[0, 0.2, -0.78]} scale={[0.22, 1.18, 0.16]} />}
      {preset === "donor-closure" && <OverlayBox color="#e2e8f0" opacity={0.82} position={[0.12, 0.02, 0.53]} rotation={[0, 0, -0.14]} scale={[0.88, 0.045, 0.045]} />}
      {preset === "supine-reposition" && <OverlayBox color="#3b82f6" opacity={0.22} position={[0.1, 0.02, 0.55]} scale={[1.35, 0.72, 0.035]} />}
      {showAnteriorPocket && <OverlaySphere color="#f9a8d4" opacity={0.26} position={[0.22, -0.08, 0.54]} scale={[0.52, 0.42, 0.22]} />}
      {preset === "sizer" && <OverlaySphere color="#93c5fd" opacity={0.48} position={[0.2, -0.08, 0.57]} scale={[0.42, 0.35, 0.2]} />}
      {preset === "irrigation" && <OverlaySphere color="#bae6fd" opacity={0.34} position={[0.2, -0.08, 0.57]} scale={[0.44, 0.35, 0.18]} />}
      {preset === "implant" && <OverlaySphere color="#dbeafe" opacity={0.62} position={[0.2, -0.08, 0.57]} scale={[0.45, 0.36, 0.22]} />}
      {preset === "pocket-closure" && <OverlayTorus color="#a855f7" opacity={0.72} position={[0.2, -0.08, 0.61]} scale={[0.34, 0.24, 0.06]} />}
      {preset === "muscle-coverage" && <OverlayBox color="#ef4444" opacity={0.5} position={[0.2, -0.02, 0.63]} rotation={[0, 0, 0.2]} scale={[0.66, 0.22, 0.04]} />}
      {preset === "deepithelialization" && <OverlayBox color="#fb7185" opacity={0.62} position={[0.15, -0.01, 0.65]} rotation={[0, 0, 0.2]} scale={[0.42, 0.16, 0.035]} />}
      {preset === "final-suture" && <OverlayTorus color="#f8fafc" opacity={0.76} position={[0.2, -0.04, 0.66]} scale={[0.4, 0.3, 0.04]} />}
      {preset === "drain" && (
        <group>
          <OverlayBox color="#dbeafe" opacity={0.7} position={[0.48, -0.32, 0.62]} rotation={[0, 0, -0.75]} scale={[0.035, 0.82, 0.035]} />
          <OverlaySphere color="#dbeafe" opacity={0.48} position={[0.76, -0.62, 0.58]} scale={[0.14, 0.2, 0.08]} />
        </group>
      )}
      {preset === "dressing" && (
        <group>
          <OverlayBox color="#f8fafc" opacity={0.86} position={[0.2, -0.04, 0.68]} rotation={[0, 0, 0.16]} scale={[0.68, 0.44, 0.045]} />
          <OverlayBox color="#dbeafe" opacity={0.7} position={[0.62, -0.34, 0.62]} rotation={[0, 0, -0.72]} scale={[0.035, 0.76, 0.035]} />
        </group>
      )}
      {step.annotations.map((item) => item.position && <GuideLabel key={item.id} position={item.position}>{item.label}</GuideLabel>)}
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
  const sceneRotation = step.orientation === "anterior" ? [0, Math.PI, 0] as [number, number, number] : step.orientation === "axillary-closeup" ? [0, -0.42, 0] as [number, number, number] : [0, 0.18, 0] as [number, number, number];

  return (
    <div className="viewer-shell relative h-[620px] min-h-[520px] overflow-hidden rounded-3xl border border-slate-800 bg-slate-950">
      <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2">
        <span className="rounded-full border border-pink-300/20 bg-pink-500/15 px-3 py-1 text-xs font-bold text-pink-100">{step.code}</span>
        <span className="rounded-full border border-sky-300/20 bg-sky-500/15 px-3 py-1 text-xs font-semibold text-sky-100">{step.patientPosition}</span>
      </div>
      <Canvas key={resetSignal} camera={{ position: step.camera?.position ?? [4, 3, 6], fov: 45 }} shadows>
        <color attach="background" args={["#020617"]} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[4, 6, 4]} intensity={2} castShadow />
        <directionalLight position={[-3, 2, -2]} intensity={0.75} />
        <gridHelper args={[5, 10, "#334155", "#1e293b"]} position={[0, -1.4, 0]} />
        <group rotation={sceneRotation}>
          <Suspense fallback={<LoadingModel />}>
            <ZAnatomyModel modelPath={modelPath} step={step} visibility={visibility} viewMode={viewMode} />
          </Suspense>
          <ProceduralSurgicalLayers visibility={visibility} viewMode={viewMode} />
          <SurgicalGuideOverlay step={step} />
          {clippingEnabled && (
            <mesh position={[0.15, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <planeGeometry args={[3.2, 2.4]} />
              <meshBasicMaterial color="#38bdf8" transparent opacity={0.18} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
          )}
        </group>
        <OrbitControls target={step.camera?.target ?? [0, 0.5, 0]} makeDefault enableDamping />
      </Canvas>
      <div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-white/10 bg-slate-950/75 p-3 text-xs text-slate-300 backdrop-blur">Z-Anatomy CC BY-SA 4.0 · Estruturas da etapa: {activeLabels.join(" • ")}</div>
    </div>
  );
}

useGLTF.preload(zAnatomyTorsoModel.modelPath);
