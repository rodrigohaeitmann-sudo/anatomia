"use client";

import type { SectionReport } from "@/components/AnatomyViewer";
import type { SectionAxis } from "@/lib/sectioning";
import type { CutState } from "@/lib/viewerTypes";
import { SectionView2D } from "./SectionView2D";

const axes: { id: SectionAxis; label: string; hint: string }[] = [
  { id: "transverse", label: "Transversal", hint: "Plano axial, visto dos pés (direita da paciente à esquerda da imagem)" },
  { id: "sagittal", label: "Sagital", hint: "Visto do lado operado (anterior à esquerda)" },
  { id: "coronal", label: "Coronal", hint: "Visto de frente" },
];

type Props = {
  cut: CutState;
  onChange: (cut: CutState) => void;
  report: SectionReport;
  selected: string | null;
  onSelect: (structure: string | null) => void;
};

export function CutPanel({ cut, onChange, report, selected, onSelect }: Props) {
  const button = "rounded-full border px-3 py-2 text-xs font-semibold transition";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button className={`${button} ${cut.axis === null ? "border-sky-300 bg-sky-500/30 text-white" : "border-white/15 bg-white/5 text-slate-200"}`} onClick={() => onChange({ ...cut, axis: null })}>
          Sem corte
        </button>
        {axes.map((axis) => (
          <button key={axis.id} title={axis.hint} className={`${button} ${cut.axis === axis.id ? "border-sky-300 bg-sky-500/30 text-white" : "border-white/15 bg-white/5 text-slate-200"}`} onClick={() => onChange({ ...cut, axis: axis.id, absolute: null })}>
            {axis.label}
          </button>
        ))}
      </div>
      {cut.axis && (
        <>
          <label className="block text-xs text-slate-300">
            Posição do plano
            <input type="range" min={0} max={1} step={0.002} value={cut.position} onChange={(event) => onChange({ ...cut, position: Number(event.target.value), absolute: null })} className="mt-2 h-8 w-full accent-sky-400" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className={`${button} border-white/15 bg-white/5 text-slate-200`} onClick={() => onChange({ ...cut, flip: !cut.flip })}>
              Inverter lado mantido
            </button>
            <button className={`${button} ${cut.scope === "superficial" ? "border-pink-300 bg-pink-500/25 text-white" : "border-white/15 bg-white/5 text-slate-200"}`} onClick={() => onChange({ ...cut, scope: cut.scope === "all" ? "superficial" : "all" })}>
              {cut.scope === "all" ? "Cortando todas as camadas" : "Cortando só pele, mama e fáscias"}
            </button>
          </div>
          <SectionView2D report={report} selected={selected} onSelect={onSelect} />
        </>
      )}
      {!cut.axis && <p className="text-xs text-slate-400">Escolha um plano. O corte transversal mostra a relação entre as estruturas no mesmo nível (como uma TC); toque no corte para identificar cada estrutura.</p>}
    </div>
  );
}
