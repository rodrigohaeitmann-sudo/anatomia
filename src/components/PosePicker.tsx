"use client";

import { PersonStanding, X } from "lucide-react";
import { armPoseById, armPoses } from "@/lib/armPoses";
import { layerParts } from "@/lib/anatomyLayers";
import { modelMeshes, modelStructures } from "@/lib/modelConfig";

const structureLabel = new Map(modelStructures.map((item) => [item.id, item.label]));
const partLabelByMesh = new Map(layerParts.flatMap((part) => part.meshNames.map((name) => [name, part.label] as const)));
const meshBySource = new Map(modelMeshes.map((mesh) => [mesh.sourceName, mesh]));

/** Muscles that change length the most in a pose (computed by build_poses.py on the model). */
export function stretchSummary(poseId: string, limit = 6) {
  const pose = armPoseById.get(poseId);
  if (!pose) return [];
  return Object.entries(pose.muscleStretch)
    .map(([source, stretch]) => {
      const mesh = meshBySource.get(source);
      const label = (mesh && partLabelByMesh.get(mesh.name)) || (mesh && structureLabel.get(mesh.structure)) || source;
      return { label, change: Math.round((stretch - 1) * 100) };
    })
    .filter((item) => Math.abs(item.change) >= 3)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, limit);
}

type Props = {
  pose: string | null;
  settled: string | null;
  onPose: (pose: string | null) => void;
  variant: "floating" | "inline";
  bottom?: number;
  onClose?: () => void;
};

/** Upper-limb position: anatomical or one of the surgical positions (deformed muscles, vessels, nerves). */
export function PosePicker({ pose, settled, onPose, variant, bottom = 0, onClose }: Props) {
  const active = pose ? armPoseById.get(pose) : undefined;
  const floating = variant === "floating";
  // phones: a compact card (two lines of description, four muscles) that leaves the model visible
  const summary = settled ? stretchSummary(settled, floating ? 4 : 6) : [];
  const chip = (id: string | null, label: string) => (
    <button
      key={id ?? "anatomica"}
      type="button"
      onClick={() => onPose(id)}
      aria-pressed={pose === id}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition ${pose === id ? "border-transparent bg-white text-slate-950" : "border-white/10 bg-white/5 text-slate-200"}`}
    >
      {label}
    </button>
  );
  const body = (
    <>
      <div className="flex items-center gap-2">
        <PersonStanding size={18} className="shrink-0 text-sky-300" />
        <p className="flex-1 text-sm font-bold text-white">Posição do membro superior</p>
        {onClose && (
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-xl text-slate-400 active:bg-white/10" aria-label="Fechar">
            <X size={18} />
          </button>
        )}
      </div>
      <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {chip(null, "Anatômica")}
        {armPoses.map((item) => chip(item.id, item.short))}
      </div>
      <p className={`mt-2 text-xs leading-snug text-slate-300 ${floating ? "line-clamp-2" : ""}`}>
        {active ? active.description : "Braço pendente ao lado do corpo, como no modelo original."}
      </p>
      {active && settled === active.id && summary.length > 0 && (
        <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
          No modelo:{" "}
          {summary.map((item, index) => (
            <span key={item.label}>
              {index > 0 ? " · " : ""}
              {item.label} <span className={item.change > 0 ? "text-sky-300" : "text-amber-300"}>{item.change > 0 ? `+${item.change}` : item.change}%</span>
            </span>
          ))}
        </p>
      )}
      {active && !floating && <p className="mt-1.5 text-[11px] text-slate-500">Músculos, vasos e nervos são deformados (não só girados); a pele do tronco não acompanha e fica oculta.</p>}
    </>
  );
  if (variant === "inline") return <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3">{body}</div>;
  return (
    <div className="fixed inset-x-3 z-30 rounded-[22px] border border-sky-300/20 bg-slate-950/[0.92] p-3 shadow-2xl backdrop-blur-xl" style={{ bottom }} role="dialog" aria-label="Posição do membro superior">
      {body}
    </div>
  );
}
