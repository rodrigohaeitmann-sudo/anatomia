import type { SurgicalStep } from "@/data/procedures";

type StepTimelineProps = { steps: SurgicalStep[]; activeStepIndex: number; onSelectStep: (index: number) => void; };

export function StepTimeline({ steps, activeStepIndex, onSelectStep }: StepTimelineProps) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-300">Timeline</p>
        <p className="text-sm text-slate-400">Etapa {activeStepIndex + 1} de {steps.length}</p>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {steps.map((step, index) => (
          <button key={step.id} onClick={() => onSelectStep(index)} className={`min-w-48 rounded-2xl border p-3 text-left ${index === activeStepIndex ? "border-pink-300 bg-pink-400/10" : "border-slate-800 bg-slate-900/60"}`}>
            <span className="text-xs font-bold text-slate-400">{String(index + 1).padStart(2, "0")}</span>
            <span className="mt-2 block text-sm font-semibold text-white">{step.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
