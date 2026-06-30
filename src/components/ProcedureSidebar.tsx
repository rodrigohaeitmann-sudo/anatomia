import type { SurgicalProcedure } from "@/data/procedures";

type ProcedureSidebarProps = {
  procedures: SurgicalProcedure[];
  activeProcedureId: string;
  onSelectProcedure: (id: string) => void;
};

export function ProcedureSidebar({ procedures, activeProcedureId, onSelectProcedure }: ProcedureSidebarProps) {
  return (
    <aside className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-300">Procedimentos</p>
      <div className="mt-4 space-y-3">
        {procedures.map((procedure) => (
          <button key={procedure.id} onClick={() => onSelectProcedure(procedure.id)} className={`w-full rounded-2xl border p-4 text-left transition ${activeProcedureId === procedure.id ? "border-sky-400 bg-sky-400/10" : "border-slate-800 bg-slate-900/60 hover:border-slate-600"}`}>
            <span className="block text-sm font-semibold text-white">{procedure.title}</span>
            <span className="mt-2 block text-xs text-slate-400">{procedure.specialty}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
