"use client";

import { manipulations, surgicalSpaces } from "@/data/surgicalSpaces";
import { modelStructures } from "@/lib/modelConfig";
import { dissectionLayers, type DissectionState, type SkinWindow } from "@/lib/viewerTypes";

const labelOf = new Map(modelStructures.map((structure) => [structure.id, structure.label]));
const wallColors = ["#22d3ee", "#a3e635", "#f472b6", "#facc15", "#fb923c", "#a78bfa"];
const windows: { id: SkinWindow; label: string }[] = [
  { id: "none", label: "Pele íntegra" },
  { id: "anterior", label: "Remover pele anterior" },
  { id: "posterior", label: "Remover pele posterior" },
  { id: "lateral", label: "Remover pele lateral" },
];

export function DissectionPanel({ dissection, onChange }: { dissection: DissectionState; onChange: (next: DissectionState) => void }) {
  const space = surgicalSpaces.find((item) => item.id === dissection.space);
  const pill = (active: boolean) => `rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? "border-pink-300 bg-pink-500/25 text-white" : "border-white/15 bg-white/5 text-slate-200"}`;

  return (
    <div className="space-y-4">
      <section>
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-sky-300">Profundidade da dissecção</h4>
        <input type="range" min={0} max={dissectionLayers.length - 1} step={1} value={dissection.layer} onChange={(event) => onChange({ ...dissection, layer: Number(event.target.value) })} className="mt-2 h-8 w-full accent-sky-400" />
        <p className="text-xs text-slate-300">{dissectionLayers[dissection.layer].label}</p>
      </section>
      <section>
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-sky-300">Janela de pele</h4>
        <div className="mt-2 flex flex-wrap gap-2">
          {windows.map((item) => (
            <button key={item.id} className={pill(dissection.skinWindow === item.id)} onClick={() => onChange({ ...dissection, skinWindow: item.id })}>
              {item.label}
            </button>
          ))}
        </div>
      </section>
      <section className="space-y-1">
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-sky-300">Rebater / transpor estruturas</h4>
        {manipulations
          .filter((m) => m.kind !== "retract")
          .map((m) => (
            <label key={m.id} className="block text-xs text-slate-300" title={m.hint}>
              {m.label}
              <input type="range" min={0} max={1} step={0.01} value={dissection.manipulations[m.id] ?? 0} onChange={(event) => onChange({ ...dissection, manipulations: { ...dissection.manipulations, [m.id]: Number(event.target.value) } })} className="h-7 w-full accent-pink-400" />
            </label>
          ))}
        <p className="text-[11px] text-slate-500">Transformações rígidas em torno de dobradiças anatômicas reais: as estruturas não são deformadas.</p>
      </section>
      <section>
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-sky-300">Espaços e planos cirúrgicos</h4>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className={pill(!dissection.space)} onClick={() => onChange({ ...dissection, space: null })}>Nenhum</button>
          {surgicalSpaces.map((item) => (
            <button key={item.id} className={pill(dissection.space === item.id)} onClick={() => onChange({ ...dissection, space: item.id })}>
              {item.label}
            </button>
          ))}
        </div>
        {space && (
          <div className="mt-3 space-y-2 rounded-xl bg-slate-900/80 p-3 text-sm text-slate-200">
            <p>{space.description}</p>
            <ul className="space-y-1">
              {space.walls.map((wall, index) => (
                <li key={wall.label}>
                  <span style={{ color: wallColors[index % wallColors.length] }}>■</span> <b>{wall.label}:</b> {wall.structures.map((id) => labelOf.get(id) ?? id).join(", ")}
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-300"><b>Conteúdo:</b> {space.contents.map((id) => labelOf.get(id) ?? id).join(", ")}</p>
            <ul className="list-disc pl-4 text-xs text-slate-300">{space.pearls.map((pearl) => <li key={pearl}>{pearl}</li>)}</ul>
          </div>
        )}
      </section>
      <button className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-slate-200" onClick={() => onChange({ layer: 0, skinWindow: "none", manipulations: {}, retracted: {}, space: null })}>
        Restaurar anatomia
      </button>
    </div>
  );
}
