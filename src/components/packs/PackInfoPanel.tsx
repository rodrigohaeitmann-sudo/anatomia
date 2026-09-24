"use client";

import type { Pack, PackView } from "@/data/packs";
import { surgicalSpaces } from "@/data/surgicalSpaces";
import { modelStructures } from "@/lib/modelConfig";

const byId = new Map(modelStructures.map((structure) => [structure.id, structure]));

type Props = { groupTitle: string; pack: Pack; view: PackView; viewIndex: number; selected: string | null; onSelect: (structure: string) => void };

export function PackInfoPanel({ groupTitle, pack, view, viewIndex, selected, onSelect }: Props) {
  const space = surgicalSpaces.find((item) => item.id === view.space);
  const shown = [...new Set([...view.structures, ...(space ? [...space.walls.flatMap((wall) => wall.structures), ...space.contents] : [])])].filter((id) => !space?.hide?.includes(id));
  return (
    <aside className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-sky-300">{groupTitle}</p>
        <h2 className="text-xl font-bold text-white">{pack.title}</h2>
        <p className="mt-1 text-sm text-slate-400">{pack.summary}</p>
      </div>
      <div className="rounded-2xl border border-pink-300/20 bg-pink-500/5 p-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-pink-300">Vista {viewIndex + 1} de {pack.views.length}</p>
        <h3 className="text-base font-bold text-white">{view.title}</h3>
        <p className="mt-1 text-sm text-slate-300">{view.description}</p>
      </div>
      <section>
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-emerald-300">Relações espaciais</h4>
        <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-slate-200">{view.relations.map((item) => <li key={item}>{item}</li>)}</ul>
        {space && <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-300">{space.pearls.map((item) => <li key={item}>{item}</li>)}</ul>}
      </section>
      <section>
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-300">Estruturas nesta vista</h4>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {shown.map((id) => {
            const structure = byId.get(id);
            if (!structure) return null;
            return (
              <button key={id} onClick={() => onSelect(id)} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${id === selected ? "bg-amber-300/25 text-amber-100" : view.focus?.includes(id) ? "bg-pink-500/20 text-pink-100" : "bg-slate-800 text-slate-300"}`}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: structure.color }} />
                {structure.label}
              </button>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
