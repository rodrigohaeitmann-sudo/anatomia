import { modelStructures, structureGroups, type ModelStructureConfig } from "@/lib/modelConfig";
import type { StructureVisibility } from "@/lib/viewerTypes";

type StructureToggleListProps = {
  visibility: StructureVisibility;
  onToggle: (id: string) => void;
  embedded?: boolean;
  /** structures of the step-by-step sequence on screen: listed first, in their own group */
  steps?: string[];
  /** which of the other structures are listed (default: all) */
  allow?: (id: string) => boolean;
};

const byId = new Map(modelStructures.map((structure) => [structure.id, structure]));

export function StructureToggleList({ visibility, onToggle, embedded = false, steps = [], allow = () => true }: StructureToggleListProps) {
  const row = (structure: ModelStructureConfig) => (
    <label key={structure.id} title={`Fonte: ${structure.sources.join(", ")}`} className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl bg-surface-alt px-3 py-2 text-sm text-ink">
      <span className="flex items-center gap-2">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: structure.color }} />
        <span>
          {structure.label}
          {structure.schematic && <span className="ml-1.5 rounded bg-amber-tint px-1 py-px align-middle text-[10px] font-semibold text-amber-deep">esquemático</span>}
          {structure.plan && <span className="ml-1.5 rounded bg-sage-tint px-1 py-px align-middle text-[10px] font-semibold text-sage-deep">plano</span>}
        </span>
      </span>
      <input type="checkbox" checked={visibility[structure.id] ?? false} onChange={() => onToggle(structure.id)} className="h-4 w-4 accent-[#221C20]" />
    </label>
  );
  const stepRows = steps.map((id) => byId.get(id)).filter((structure): structure is ModelStructureConfig => Boolean(structure));
  return (
    <section className={embedded ? "" : "rounded-card border border-line bg-surface p-4"}>
      <p className="text-[11.5px] font-semibold uppercase tracking-[1.5px] text-muted">Estruturas</p>
      <div className={embedded ? "mt-2 space-y-3" : "mt-3 max-h-[70vh] space-y-3 overflow-y-auto pr-1"}>
        {stepRows.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[1.5px] text-rose-deep">Passo a passo: esta técnica</p>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-1">{stepRows.map(row)}</div>
          </div>
        )}
        {structureGroups
          .filter((group) => modelStructures.some((structure) => structure.group === group && structure.listed && allow(structure.id)))
          .map((group) => (
            <div key={group}>
              <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[1.5px] text-muted">{group}</p>
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-1">{modelStructures.filter((structure) => structure.group === group && structure.listed && allow(structure.id)).map(row)}</div>
            </div>
          ))}
      </div>
    </section>
  );
}
