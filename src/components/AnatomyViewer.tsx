"use client";

import { OrbitControls, Html } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import type { SurgicalStep } from "@/data/procedures";
import { modelStructures } from "@/lib/modelConfig";
import type { StructureVisibility, ViewMode } from "@/lib/viewerTypes";

type AnatomyViewerProps = { step: SurgicalStep; visibility: StructureVisibility; clippingEnabled: boolean; viewMode: ViewMode; resetSignal: number; };

function PlaceholderAnatomy({ visibility, viewMode }: Pick<AnatomyViewerProps, "visibility" | "viewMode">) {
  const surgical = viewMode === "surgical";
  const visible = (id: string) => visibility[id] ?? false;

  return (
    <group rotation={[0, -0.35, 0]}>
      {visible("chest-wall") && <mesh position={[0, -0.65, 0]} scale={[2.2, 0.18, 1.25]}><boxGeometry /><meshStandardMaterial color="#64748b" transparent opacity={0.45} /></mesh>}
      {visible("breast") && <mesh position={[0.62, 0.1, 0.42]} scale={[0.75, 0.55, 0.45]}><sphereGeometry args={[1, 32, 32]} /><meshStandardMaterial color={surgical ? "#f472b6" : "#f9a8d4"} transparent opacity={0.78} /></mesh>}
      {visible("latissimus-dorsi") && <mesh position={[-0.75, 0.18, -0.22]} rotation={[0.2, 0.25, -0.5]} scale={[0.42, 1.75, 0.12]}><capsuleGeometry args={[0.35, 1.3, 12, 24]} /><meshStandardMaterial color={surgical ? "#dc2626" : "#ef4444"} /></mesh>}
      {visible("skin") && <mesh position={[-0.7, 0.28, -0.48]} rotation={[0.15, 0.15, -0.55]} scale={[0.52, 1.35, 0.04]}><boxGeometry /><meshStandardMaterial color="#f8c7b8" transparent opacity={0.5} /></mesh>}
      {visible("subcutaneous") && <mesh position={[-0.68, 0.28, -0.39]} rotation={[0.15, 0.15, -0.55]} scale={[0.45, 1.2, 0.035]}><boxGeometry /><meshStandardMaterial color="#facc15" transparent opacity={0.42} /></mesh>}
      {visible("thoracodorsal-vessels") && <mesh position={[-0.28, 0.45, -0.05]} rotation={[0.25, 0.4, -0.65]} scale={[0.045, 1.45, 0.045]}><capsuleGeometry args={[0.55, 1.2, 8, 16]} /><meshStandardMaterial color="#38bdf8" emissive="#075985" /></mesh>}
      {visible("axilla") && <mesh position={[-0.08, 0.55, 0.12]} scale={[0.35, 0.35, 0.35]}><sphereGeometry args={[1, 24, 24]} /><meshStandardMaterial color="#a78bfa" transparent opacity={0.5} /></mesh>}
      {visible("serratus-anterior") && <mesh position={[0.02, -0.15, -0.12]} rotation={[0, 0, 0.7]} scale={[0.28, 1.15, 0.08]}><capsuleGeometry args={[0.4, 1, 8, 16]} /><meshStandardMaterial color="#f97316" transparent opacity={0.8} /></mesh>}
    </group>
  );
}

export function AnatomyViewer({ step, visibility, clippingEnabled, viewMode, resetSignal }: AnatomyViewerProps) {
  const activeLabels = step.visibleStructures.map((id) => modelStructures.find((structure) => structure.id === id)?.label ?? id);

  return (
    <div className="viewer-shell relative min-h-[520px] overflow-hidden rounded-3xl border border-slate-800 bg-slate-950">
      <Canvas key={resetSignal} camera={{ position: step.camera?.position ?? [4, 3, 6], fov: 45 }} shadows>
        <color attach="background" args={["#020617"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[4, 6, 4]} intensity={1.8} castShadow />
        <gridHelper args={[5, 10, "#334155", "#1e293b"]} position={[0, -1, 0]} />
        <PlaceholderAnatomy visibility={visibility} viewMode={viewMode} />
        {clippingEnabled && <mesh position={[0.15, 0, 0]} rotation={[0, 0, Math.PI / 2]}><planeGeometry args={[3.2, 2.4]} /><meshBasicMaterial color="#38bdf8" transparent opacity={0.18} /></mesh>}
        <Html position={[-1.55, 1.45, 0]} className="pointer-events-none"><div className="rounded-xl bg-slate-900/90 px-3 py-2 text-xs text-white shadow-xl">Placeholder 3D preparado para GLB/GLTF</div></Html>
        <OrbitControls target={step.camera?.target ?? [0, 0.5, 0]} makeDefault enableDamping />
      </Canvas>
      <div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-white/10 bg-slate-950/75 p-3 text-xs text-slate-300 backdrop-blur">Estruturas da etapa: {activeLabels.join(" • ")}</div>
    </div>
  );
}
