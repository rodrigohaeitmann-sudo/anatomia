import { modelStructures, structureGroups } from "@/lib/modelConfig";
import type { StructureVisibility } from "@/lib/viewerTypes";

type StructureToggleListProps = { visibility: StructureVisibility; onToggle: (id: string) => void; };

export function StructureToggleList({ visibility, onToggle }: StructureToggleListProps) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-300">Estruturas</p>
      <div className="mt-3 max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        {structureGroups.map((group) => (
          <div key={group}>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">{group}</p>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
              {modelStructures
                .filter((structure) => structure.group === group)
                .map((structure) => (
                  <label key={structure.id} title={`Fonte: ${structure.sources.join(", ")}`} className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl bg-slate-900/80 px-3 py-2 text-sm text-slate-200">
                    <span className="flex items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: structure.color }} />{structure.label}</span>
                    <input type="checkbox" checked={visibility[structure.id] ?? false} onChange={() => onToggle(structure.id)} className="h-4 w-4 accent-sky-400" />
                  </label>
                ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
