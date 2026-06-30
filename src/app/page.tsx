"use client";

import { useMemo, useState } from "react";
import { AnatomyViewer } from "@/components/AnatomyViewer";
import { AnnotationPanel } from "@/components/AnnotationPanel";
import { ProcedureSidebar } from "@/components/ProcedureSidebar";
import { StepTimeline } from "@/components/StepTimeline";
import { StructureToggleList } from "@/components/StructureToggleList";
import { ViewerToolbar } from "@/components/ViewerToolbar";
import { procedures } from "@/data/procedures";
import { modelStructures } from "@/lib/modelConfig";
import type { StructureVisibility, ViewMode } from "@/lib/viewerTypes";

const defaultVisibility = Object.fromEntries(modelStructures.map((structure) => [structure.id, structure.defaultVisible])) as StructureVisibility;

export default function Home() {
  const [activeProcedureId, setActiveProcedureId] = useState(procedures[0].id);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [visibility, setVisibility] = useState<StructureVisibility>(defaultVisibility);
  const [clippingEnabled, setClippingEnabled] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("anatomical");
  const [resetSignal, setResetSignal] = useState(0);

  const activeProcedure = useMemo(() => procedures.find((procedure) => procedure.id === activeProcedureId) ?? procedures[0], [activeProcedureId]);
  const activeStep = activeProcedure.steps[activeStepIndex] ?? activeProcedure.steps[0];

  function selectProcedure(id: string) {
    setActiveProcedureId(id);
    setActiveStepIndex(0);
  }

  function toggleStructure(id: string) {
    setVisibility((current) => ({ ...current, [id]: !current[id] }));
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#1e3a8a55,transparent_35%),radial-gradient(circle_at_top_right,#be185d44,transparent_30%),#020617] p-4 md:p-8">
      <header className="mx-auto mb-6 max-w-7xl rounded-3xl border border-slate-800 bg-slate-950/80 p-6 shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-sky-300">Atlas cirúrgico interativo</p>
        <h1 className="mt-3 text-3xl font-black text-white md:text-5xl">Anatomia Cirúrgica em Mastologia</h1>
        <p className="mt-4 max-w-3xl text-slate-300">MVP em Next.js com visualizador 3D, navegação por procedimentos, timeline cirúrgica, painel didático e estrutura pronta para modelos anatômicos GLB/GLTF.</p>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[280px_minmax(0,1fr)_360px]">
        <div className="space-y-4"><ProcedureSidebar procedures={procedures} activeProcedureId={activeProcedureId} onSelectProcedure={selectProcedure} /><StructureToggleList visibility={visibility} onToggle={toggleStructure} /></div>
        <section className="space-y-4">
          <ViewerToolbar clippingEnabled={clippingEnabled} viewMode={viewMode} onResetCamera={() => setResetSignal((value) => value + 1)} onToggleClipping={() => setClippingEnabled((value) => !value)} onToggleSkin={() => toggleStructure("skin")} onShowVessels={() => setVisibility((current) => ({ ...current, "thoracodorsal-vessels": true }))} onSetViewMode={setViewMode} />
          <AnatomyViewer step={activeStep} visibility={visibility} clippingEnabled={clippingEnabled || Boolean(activeStep.clippingPlane?.enabled)} viewMode={viewMode} resetSignal={resetSignal} modelPath={activeProcedure.modelPath ?? "models/z-anatomy/torso-mastology.glb"} />
        </section>
        <AnnotationPanel step={activeStep} />
      </div>

      <div className="mx-auto mt-4 max-w-7xl"><StepTimeline steps={activeProcedure.steps} activeStepIndex={activeStepIndex} onSelectStep={setActiveStepIndex} /></div>
    </main>
  );
}
