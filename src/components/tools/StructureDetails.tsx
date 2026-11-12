"use client";

import { anatomyDetails, type AnatomyDetail } from "@/data/anatomyDetails";
import { literatureByStructure, references } from "@/data/literature";
import { partDetails, regionDetail } from "@/data/partDetails";
import { manipulations } from "@/data/surgicalSpaces";
import { attachmentsFor, fibreStructures, kindLabel, partById, partsOf } from "@/lib/anatomyLayers";
import { modelMeshes, modelStructures } from "@/lib/modelConfig";
import type { DissectionState } from "@/lib/viewerTypes";

const proximityGroups = new Set(["Nervos", "Vasos"]);

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
  /** selected portion (mesh part or computed region) */
  part?: string | null;
  onPart?: (part: string | null) => void;
  /** attachment areas of this muscle are on screen (muscle see-through, bones shown) */
  attachmentsShown?: boolean;
  onAttachments?: (structure: string | null) => void;
  fibresShown?: boolean;
  onFibres?: () => void;
  proximityShown?: boolean;
  onProximity?: (structure: string | null) => void;
  dissection: DissectionState;
  onDissection: (next: DissectionState) => void;
  onIsolate: (structure: string) => void;
  onHide: (structure: string) => void;
  onShowAll: () => void;
  onFocus: (structure: string) => void;
  onClose: () => void;
};

function References({ ids }: { ids: string[] }) {
  return (
    <span className="mt-1 block text-[11px] text-slate-400">
      {ids.map((id, index) => {
        const ref = references[id];
        if (!ref) return null;
        return (
          <span key={id}>
            {index > 0 ? " · " : ""}
            <a href={ref.url} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-sky-300">
              {ref.label}
            </a>
            {ref.evidence === "resumo" ? " (resumo)" : ref.evidence === "fonte secundária" ? " (fonte secundária)" : ""}
          </span>
        );
      })}
    </span>
  );
}

export function StructureDetails({ structure, part = null, onPart, attachmentsShown, onAttachments, fibresShown, onFibres, proximityShown, onProximity, dissection, onDissection, onIsolate, onHide, onShowAll, onFocus, onClose }: Props) {
  if (!structure) {
    return <p className="text-sm text-slate-400">Toque em uma estrutura no modelo (ou no corte 2D) para ver origem, inserção, vascularização, inervação e marcos cirúrgicos.</p>;
  }
  const info = modelStructures.find((item) => item.id === structure);
  const partInfo = part ? partById.get(part) : undefined;
  const detail: AnatomyDetail | undefined = (part && (partDetails[part] ?? regionDetail(part, partInfo?.label ?? ""))) || anatomyDetails[structure];
  const parts = partsOf(structure);
  const attachments = attachmentsFor(structure, part);
  const literature = literatureByStructure[structure];
  const meshes = modelMeshes.filter((mesh) => mesh.structure === structure);
  const related = manipulations.filter((m) => m.kind !== "retract" && m.structures.includes(structure));
  const retract = dissection.retracted[structure] ?? 0;
  const chip = "rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/15";

  return (
    <article className="space-y-3">
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">{partInfo ? info?.label : info?.group}</p>
          <h3 className="text-lg font-bold text-white">{partInfo?.label ?? info?.label ?? structure}</h3>
        </div>
        <button onClick={onClose} className="rounded-full bg-white/10 px-2 py-1 text-xs text-slate-200" aria-label="Fechar ficha">✕</button>
      </header>
      <div className="flex flex-wrap gap-2">
        <button className={chip} onClick={() => onFocus(structure)}>Focar</button>
        <button className={chip} onClick={() => onIsolate(structure)}>Isolar</button>
        <button className={chip} onClick={() => onHide(structure)}>Ocultar</button>
        <button className={chip} onClick={onShowAll}>Mostrar etapa</button>
        {attachments.length > 0 && onAttachments && (
          <button className={`${chip} ${attachmentsShown ? "border-sky-300/50 bg-sky-500/25" : ""}`} onClick={() => onAttachments(attachmentsShown ? null : structure)}>
            {attachmentsShown ? "Ocultar fixações" : "Ver fixações"}
          </button>
        )}
        {fibreStructures.has(structure) && onFibres && (
          <button className={`${chip} ${fibresShown ? "border-sky-300/50 bg-sky-500/25" : ""}`} onClick={onFibres}>
            {fibresShown ? "Ocultar fibras" : "Fibras"}
          </button>
        )}
        {info && proximityGroups.has(info.group) && onProximity && (
          <button className={`${chip} ${proximityShown ? "border-amber-300/50 bg-amber-500/25" : ""}`} onClick={() => onProximity(proximityShown ? null : structure)}>
            {proximityShown ? "Desligar mapa de distância" : "Mapa de distância"}
          </button>
        )}
      </div>
      {info?.schematic && (
        <p className="rounded-xl border border-amber-300/30 bg-amber-400/10 p-2 text-xs leading-snug text-amber-100">
          <span className="font-bold">Estrutura esquemática.</span> Não vem de exame nem de atlas 3D: foi traçada pela literatura sobre marcos das malhas reais do modelo (costelas, vasos de origem, parede, pele, mamilo). Mostra o trajeto típico, não a anatomia de uma pessoa.
        </p>
      )}
      {info?.plan && (
        <p className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 p-2 text-xs leading-snug text-emerald-100">
          <span className="font-bold">Plano cirúrgico.</span> Marcação, peça ou passo gerado sobre a mama do modelo (ptose grau II com hipertrofia moderada), em pé. Serve para estudar a técnica; não substitui o planejamento do caso nem prevê o resultado de uma paciente.
        </p>
      )}
      {parts.length > 0 && onPart && (
        <section>
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-violet-300">Porções</h4>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button onClick={() => onPart(null)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${!part ? "bg-violet-400/30 text-white" : "bg-white/5 text-slate-300"}`}>
              Músculo inteiro
            </button>
            {parts.map((item) => (
              <button key={item.id} onClick={() => onPart(item.id)} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${part === item.id ? "bg-violet-400/30 text-white" : "bg-white/5 text-slate-300"}`}>
                {item.label.split(" · ")[1] ?? item.label}
              </button>
            ))}
          </div>
        </section>
      )}
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
      {attachments.length > 0 && (
        <section>
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-sky-300">Fixações no modelo</h4>
          <ul className="mt-1 space-y-1">
            {attachments.map((item) => (
              <li key={item.id} className="flex items-center gap-2 rounded-xl bg-slate-900/80 px-2 py-1.5 text-sm text-slate-100">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.kind === "origin" ? "bg-red-500" : "bg-blue-500"}`} />
                <span className="min-w-0 flex-1">
                  {kindLabel[item.kind]} · {item.bone}
                  {item.part && !part && partById.get(item.part) ? <span className="text-slate-400"> · {partById.get(item.part)!.label.split(" · ")[1]}</span> : null}
                </span>
                <span className="shrink-0 text-[11px] text-slate-400">{item.areaMm2.toLocaleString("pt-BR")} mm²</span>
                {item.source !== "Z-Anatomy" && <span className="shrink-0 text-[10px] font-semibold text-amber-200">calculado</span>}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-slate-400">Áreas do Z-Anatomy transferidas para os ossos do modelo; &ldquo;calculado&rdquo; = contato entre as malhas do músculo e do osso.</p>
        </section>
      )}
      {literature?.comparisons?.length ? (
        <section>
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-amber-300">Modelo × literatura</h4>
          <div className="mt-1 space-y-1.5">
            {literature.comparisons.map((row) => (
              <div key={row.label} className="rounded-xl bg-slate-900/80 p-2 text-sm text-slate-100">
                <p className="text-xs font-semibold text-slate-300">{row.label}</p>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <span>
                    <span className="block text-[10px] uppercase tracking-wide text-slate-400">Modelo</span>
                    {row.model ?? "—"}
                  </span>
                  <span>
                    <span className="block text-[10px] uppercase tracking-wide text-slate-400">Literatura</span>
                    {row.literature}
                  </span>
                </div>
                {row.note && <p className="mt-1 text-[11px] text-slate-400">{row.note}</p>}
                <References ids={row.refs} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {literature?.variations?.length ? (
        <section>
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-emerald-300">Variações e dados populacionais</h4>
          <div className="mt-1 space-y-1.5">
            {literature.variations.map((row) => (
              <div key={row.label} className="rounded-xl bg-slate-900/80 p-2 text-sm text-slate-100">
                <p className="text-xs font-semibold text-slate-300">{row.label}</p>
                <p className="mt-0.5 leading-relaxed">{row.text}</p>
                <References ids={row.refs} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
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
