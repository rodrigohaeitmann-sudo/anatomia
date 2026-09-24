"use client";

import { anatomyDetails, type AnatomyDetail } from "@/data/anatomyDetails";
import { manipulations } from "@/data/surgicalSpaces";
import { modelMeshes, modelStructures } from "@/lib/modelConfig";
import type { DissectionState } from "@/lib/viewerTypes";

const fields: { key: keyof AnatomyDetail; label: string }[] = [
  { key: "origin", label: "Origem" },
  { key: "insertion", label: "Inserção" },
  { key: "course", label: "Trajeto" },
  { key: "branches", label: "Ramos" },
  { key: "innervation", label: "Inervação" },
  { key: "vascularization", label: "Vascularização" },
  { key: "drainage", label: "Drenagem" },
  { key: "action", label: "Ação" },
];

/** Presents source names on the displayed (right) side: the model is the reflected source left side. */
function displayName(name: string) {
  return name.replace(/\bLeft\b/g, "Right").replace(/\bleft\b/g, "right").replace(/_/g, " ");
}

type Props = {
  structure: string | null;
  dissection: DissectionState;
  onDissection: (next: DissectionState) => void;
  onIsolate: (structure: string) => void;
  onHide: (structure: string) => void;
  onShowAll: () => void;
  onFocus: (structure: string) => void;
  onClose: () => void;
};

export function StructureDetails({ structure, dissection, onDissection, onIsolate, onHide, onShowAll, onFocus, onClose }: Props) {
  if (!structure) {
    return <p className="text-sm text-slate-400">Toque em uma estrutura no modelo (ou no corte 2D) para ver origem, inserção, vascularização, inervação e marcos cirúrgicos.</p>;
  }
  const info = modelStructures.find((item) => item.id === structure);
  const detail = anatomyDetails[structure];
  const meshes = modelMeshes.filter((mesh) => mesh.structure === structure);
  const related = manipulations.filter((m) => m.kind !== "retract" && m.structures.includes(structure));
  const retract = dissection.retracted[structure] ?? 0;
  const chip = "rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/15";

  return (
    <article className="space-y-3">
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">{info?.group}</p>
          <h3 className="text-lg font-bold text-white">{info?.label ?? structure}</h3>
        </div>
        <button onClick={onClose} className="rounded-full bg-white/10 px-2 py-1 text-xs text-slate-200" aria-label="Fechar ficha">✕</button>
      </header>
      <div className="flex flex-wrap gap-2">
        <button className={chip} onClick={() => onFocus(structure)}>Focar</button>
        <button className={chip} onClick={() => onIsolate(structure)}>Isolar</button>
        <button className={chip} onClick={() => onHide(structure)}>Ocultar</button>
        <button className={chip} onClick={onShowAll}>Mostrar etapa</button>
      </div>
      {detail ? (
        <>
          <p className="text-sm leading-relaxed text-slate-200">{detail.summary}</p>
          <dl className="space-y-2">
            {fields.map(({ key, label }) =>
              detail[key] ? (
                <div key={key} className="rounded-xl bg-slate-900/80 p-2">
                  <dt className="text-[11px] font-bold uppercase tracking-wide text-sky-300">{label}</dt>
                  <dd className="text-sm text-slate-200">{detail[key] as string}</dd>
                </div>
              ) : null,
            )}
          </dl>
          {detail.landmarks?.length ? (
            <section>
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-emerald-300">Marcos anatômicos</h4>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-slate-200">{detail.landmarks.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
          ) : null}
          {detail.surgical?.length ? (
            <section>
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-pink-300">Relevância cirúrgica</h4>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-slate-200">{detail.surgical.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-slate-400">Sem ficha descritiva para esta estrutura.</p>
      )}
      <section className="space-y-2 rounded-xl border border-white/10 p-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-300">Manipular</h4>
        {related.map((m) => (
          <label key={m.id} className="block text-xs text-slate-300">
            {m.label}
            <input type="range" min={0} max={1} step={0.01} value={dissection.manipulations[m.id] ?? 0} onChange={(event) => onDissection({ ...dissection, manipulations: { ...dissection.manipulations, [m.id]: Number(event.target.value) } })} className="h-7 w-full accent-pink-400" />
          </label>
        ))}
        <label className="block text-xs text-slate-300">
          Afastar (vista explodida)
          <input type="range" min={0} max={1} step={0.01} value={retract} onChange={(event) => onDissection({ ...dissection, retracted: { ...dissection.retracted, [structure]: Number(event.target.value) } })} className="h-7 w-full accent-pink-400" />
        </label>
      </section>
      <details className="text-xs text-slate-400">
        <summary className="cursor-pointer">Fonte das malhas ({meshes.length})</summary>
        <ul className="mt-1 space-y-0.5">
          {meshes.map((mesh) => (
            <li key={mesh.name}>
              {displayName(mesh.sourceName)} · {mesh.source}
              {mesh.fma ? ` · ${mesh.fma}` : ""} · {mesh.triangles.toLocaleString("pt-BR")} triângulos
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
