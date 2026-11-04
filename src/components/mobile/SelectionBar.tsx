"use client";

import { Focus, Info, X } from "lucide-react";
import { modelStructures } from "@/lib/modelConfig";

const byId = new Map(modelStructures.map((structure) => [structure.id, structure]));

/** Floating chip for the selected structure: name only, details on demand (no card over the model). */
export function SelectionBar({ structure, bottom, onDetails, onIsolate, onClose }: { structure: string; bottom: number; onDetails: () => void; onIsolate: () => void; onClose: () => void }) {
  const info = byId.get(structure);
  if (!info) return null;
  return (
    <div className="fixed inset-x-3 z-30 flex items-center gap-2 rounded-[22px] border border-amber-200/20 bg-slate-950/85 p-1.5 pl-3 shadow-2xl backdrop-blur-xl" style={{ bottom, transition: "bottom 320ms cubic-bezier(0.22, 1, 0.36, 1)" }}>
      <span className="h-3 w-3 shrink-0 rounded-full ring-2 ring-amber-200/60" style={{ backgroundColor: info.color }} />
      <button type="button" onClick={onDetails} className="min-w-0 flex-1 text-left leading-tight">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-amber-200/80">{info.group}</span>
        <span className="line-clamp-2 block text-sm font-bold leading-tight text-white">{info.label}</span>
      </button>
      <button type="button" onClick={onIsolate} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/5 text-slate-200 active:bg-white/15" aria-label="Isolar estrutura">
        <Focus size={18} />
      </button>
      <button type="button" onClick={onDetails} className="flex h-10 shrink-0 items-center gap-1.5 rounded-2xl bg-sky-500/25 px-3 text-sm font-semibold text-sky-50 active:bg-sky-500/40" aria-label="Abrir ficha">
        <Info size={16} />
        <span className="hidden min-[380px]:inline">Ficha</span>
      </button>
      <button type="button" onClick={onClose} className="grid h-10 w-9 place-items-center rounded-2xl text-slate-400 active:bg-white/10" aria-label="Desmarcar">
        <X size={18} />
      </button>
    </div>
  );
}
