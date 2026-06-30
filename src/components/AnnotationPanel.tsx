import type { SurgicalStep } from "@/data/procedures";
import { modelStructures } from "@/lib/modelConfig";

type AnnotationPanelProps = { step: SurgicalStep; };

export function AnnotationPanel({ step }: AnnotationPanelProps) {
  const labels = step.visibleStructures.map((id) => modelStructures.find((structure) => structure.id === id)?.label ?? id);

  return (
    <aside className="max-h-[calc(100vh-2rem)] overflow-y-auto rounded-3xl border border-slate-800 bg-slate-950/80 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-pink-500/20 px-3 py-1 text-xs font-bold text-pink-200">{step.code}</span>
        <span className="rounded-full bg-sky-500/15 px-3 py-1 text-xs font-semibold text-sky-200">{step.phase}</span>
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.25em] text-pink-300">Etapa atual</p>
      <h2 className="mt-2 text-xl font-bold text-white">{step.title}</h2>
      <p className="mt-2 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs font-semibold text-slate-200">{step.patientPosition}</p>
      <p className="mt-3 text-sm leading-6 text-slate-300">{step.shortDescription}</p>
      <p className="mt-4 text-sm leading-6 text-slate-400">{step.detailedDescription}</p>
      {step.comparison && (
        <div className="mt-5 grid gap-2">
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
            <strong>Correto</strong>
            <p className="mt-1 text-emerald-100/80">{step.comparison.correct}</p>
          </div>
          <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-100">
            <strong>Armadilha</strong>
            <p className="mt-1 text-rose-100/80">{step.comparison.pitfall}</p>
          </div>
        </div>
      )}
      <h3 className="mt-6 text-sm font-semibold text-white">Estruturas relevantes</h3>
      <div className="mt-3 flex flex-wrap gap-2">{labels.map((label) => <span key={label} className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200">{label}</span>)}</div>
      <h3 className="mt-6 text-sm font-semibold text-white">Referências que devem aparecer</h3>
      <ul className="mt-3 space-y-2">{step.references.map((reference) => <li key={reference.label} className="rounded-2xl bg-slate-900 p-3 text-sm text-slate-300"><strong className="text-white">{reference.label}</strong><br />{reference.detail}</li>)}</ul>
      <h3 className="mt-6 text-sm font-semibold text-white">Dicas práticas</h3>
      <ul className="mt-3 space-y-2">{step.practicalTips.map((tip) => <li key={tip} className="rounded-2xl bg-cyan-950/50 p-3 text-sm text-cyan-100">{tip}</li>)}</ul>
      <h3 className="mt-6 text-sm font-semibold text-white">Pontos de atenção</h3>
      <ul className="mt-3 space-y-2">{step.attentionPoints.map((point) => <li key={point} className="rounded-2xl bg-amber-950/50 p-3 text-sm text-amber-100">{point}</li>)}</ul>
      <h3 className="mt-6 text-sm font-semibold text-white">Marcadores 3D</h3>
      <ul className="mt-3 space-y-3">{step.annotations.map((annotation) => <li key={annotation.id} className="rounded-2xl bg-slate-900 p-3 text-sm text-slate-300"><strong className="text-white">{annotation.label}</strong><br />{annotation.description}</li>)}</ul>
    </aside>
  );
}
