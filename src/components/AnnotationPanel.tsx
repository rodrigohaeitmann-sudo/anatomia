import type { SurgicalStep } from "@/data/procedures";
import { modelStructures } from "@/lib/modelConfig";

type AnnotationPanelProps = { step: SurgicalStep; };

export function AnnotationPanel({ step }: AnnotationPanelProps) {
  const labels = step.visibleStructures.map((id) => modelStructures.find((structure) => structure.id === id)?.label ?? id);

  return (
    <aside className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-pink-300">Etapa atual</p>
      <h2 className="mt-3 text-xl font-bold text-white">{step.title}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">{step.shortDescription}</p>
      <p className="mt-4 text-sm leading-6 text-slate-400">{step.detailedDescription}</p>
      <h3 className="mt-6 text-sm font-semibold text-white">Estruturas relevantes</h3>
      <div className="mt-3 flex flex-wrap gap-2">{labels.map((label) => <span key={label} className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200">{label}</span>)}</div>
      <h3 className="mt-6 text-sm font-semibold text-white">Anotações</h3>
      <ul className="mt-3 space-y-3">{step.annotations.map((annotation) => <li key={annotation.id} className="rounded-2xl bg-slate-900 p-3 text-sm text-slate-300"><strong className="text-white">{annotation.label}</strong><br />{annotation.description}</li>)}</ul>
    </aside>
  );
}
