"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnatomyViewer, type FocusRequest, type SectionReport } from "@/components/AnatomyViewer";
import { AnnotationPanel } from "@/components/AnnotationPanel";
import { ProcedureSidebar } from "@/components/ProcedureSidebar";
import { StepTimeline } from "@/components/StepTimeline";
import { StructureToggleList } from "@/components/StructureToggleList";
import { CutPanel } from "@/components/tools/CutPanel";
import { DissectionPanel } from "@/components/tools/DissectionPanel";
import { StructureDetails } from "@/components/tools/StructureDetails";
import { ViewerToolbar } from "@/components/ViewerToolbar";
import { procedures } from "@/data/procedures";
import { hybridTorsoModel, modelStructures } from "@/lib/modelConfig";
import { useLowPower } from "@/lib/useLowPower";
import { defaultCut, defaultDissection, type CutState, type DissectionState, type StructureVisibility, type ViewMode } from "@/lib/viewerTypes";

const defaultVisibility = Object.fromEntries(modelStructures.map((structure) => [structure.id, structure.defaultVisible])) as StructureVisibility;

type Tab = "step" | "details" | "cut" | "dissection" | "structures";
const tabs: { id: Tab; label: string; mobileOnly?: boolean }[] = [
  { id: "step", label: "Etapa", mobileOnly: true },
  { id: "details", label: "Ficha" },
  { id: "cut", label: "Corte" },
  { id: "dissection", label: "Dissecar" },
  { id: "structures", label: "Estruturas", mobileOnly: true },
];

export default function Home() {
  const [activeProcedureId, setActiveProcedureId] = useState(procedures[0].id);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [visibility, setVisibility] = useState<StructureVisibility>(defaultVisibility);
  const [viewMode, setViewMode] = useState<ViewMode>("anatomical");
  const [resetSignal, setResetSignal] = useState(0);
  const [cut, setCut] = useState<CutState>(defaultCut);
  const [dissection, setDissection] = useState<DissectionState>(defaultDissection);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest>(null);
  const [section, setSection] = useState<SectionReport>(null);
  const [tab, setTab] = useState<Tab>("step");
  const lowPower = useLowPower();

  const activeProcedure = useMemo(() => procedures.find((procedure) => procedure.id === activeProcedureId) ?? procedures[0], [activeProcedureId]);
  const activeStep = activeProcedure.steps[activeStepIndex] ?? activeProcedure.steps[0];
  const desktopModel = activeProcedure.modelPath ?? hybridTorsoModel.modelPath;
  const modelPath = lowPower ? desktopModel.replace(/\.glb$/, "-mobile.glb") : desktopModel;

  useEffect(() => {
    setVisibility((current) => ({ ...current, ...Object.fromEntries(activeStep.visibleStructures.map((id) => [id, true])) }));
    setDissection({ ...defaultDissection, ...activeStep.dissection, manipulations: { ...activeStep.dissection?.manipulations }, retracted: {} });
    setFocus(null);
  }, [activeStep]);

  useEffect(() => {
    if (tab === "step" && window.matchMedia("(min-width: 1024px)").matches) setTab("details");
  }, [tab]);

  const select = useCallback((structure: string | null) => {
    setSelected(structure);
    if (structure) setTab("details");
  }, []);
  const handleSection = useCallback((report: SectionReport) => setSection(report), []);

  function selectProcedure(id: string) {
    setActiveProcedureId(id);
    setActiveStepIndex(0);
  }

  function toggleStructure(id: string) {
    setVisibility((current) => ({ ...current, [id]: !current[id] }));
  }

  const goToStep = (index: number) => setActiveStepIndex(Math.max(0, Math.min(activeProcedure.steps.length - 1, index)));
  const showStepDefaults = () => setVisibility({ ...defaultVisibility, ...Object.fromEntries(activeStep.visibleStructures.map((id) => [id, true])) });

  const toolContent = (id: Tab) => {
    if (id === "step") return <AnnotationPanel step={activeStep} />;
    if (id === "structures") return <StructureToggleList visibility={visibility} onToggle={toggleStructure} />;
    if (id === "cut") return <CutPanel cut={cut} onChange={setCut} report={section} selected={selected} onSelect={select} />;
    if (id === "dissection") return <DissectionPanel dissection={dissection} onChange={setDissection} />;
    return (
      <StructureDetails
        structure={selected}
        dissection={dissection}
        onDissection={setDissection}
        onIsolate={(structure) => setVisibility(Object.fromEntries(modelStructures.map((item) => [item.id, item.id === structure])))}
        onHide={(structure) => setVisibility((current) => ({ ...current, [structure]: false }))}
        onShowAll={showStepDefaults}
        onFocus={(structure) => setFocus({ structure, nonce: Date.now() })}
        onClose={() => setSelected(null)}
      />
    );
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#1e3a8a55,transparent_35%),radial-gradient(circle_at_top_right,#be185d44,transparent_30%),#020617] px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] md:p-8">
      <header className="mx-auto mb-3 max-w-7xl rounded-3xl border border-slate-800 bg-slate-950/80 p-4 shadow-2xl md:mb-6 md:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-sky-300">Atlas cirúrgico interativo</p>
        <h1 className="mt-1 text-xl font-black text-white md:mt-3 md:text-5xl">Anatomia Cirúrgica em Mastologia</h1>
        <p className="mt-3 hidden max-w-3xl text-slate-300 md:block">Roteiro interativo do retalho de grande dorsal para reconstrução mamária, com modelo anatômico feminino híbrido (pele e mama do Visible Human Female/NIH, vasos, nervos e músculos do BodyParts3D), cortes, dissecção por camadas e fichas anatômicas.</p>
      </header>

      <div className="mx-auto grid max-w-7xl gap-3 lg:grid-cols-[280px_minmax(0,1fr)_360px] lg:gap-4">
        <div className="hidden space-y-4 lg:block">
          <ProcedureSidebar procedures={procedures} activeProcedureId={activeProcedureId} onSelectProcedure={selectProcedure} />
          <StructureToggleList visibility={visibility} onToggle={toggleStructure} />
        </div>
        <section className="min-w-0 space-y-3">
          <ViewerToolbar
            viewMode={viewMode}
            onResetCamera={() => setResetSignal((value) => value + 1)}
            onTransverseCut={() => {
              setCut((current) => ({ ...current, axis: "transverse", position: current.axis === "transverse" ? current.position : 0.62 }));
              setTab("cut");
            }}
            onToggleSkin={() => toggleStructure("skin")}
            onShowVessels={() => setVisibility((current) => ({ ...current, ...Object.fromEntries(modelStructures.filter((structure) => structure.group === "Vasos" || structure.group === "Nervos").map((structure) => [structure.id, true])) }))}
            onSetViewMode={setViewMode}
          />
          {lowPower === null ? (
            <div className="h-[58dvh] min-h-[360px] rounded-3xl border border-slate-800 bg-slate-950 sm:h-[620px]" />
          ) : (
            <AnatomyViewer
              step={activeStep}
              visibility={visibility}
              viewMode={viewMode}
              resetSignal={resetSignal}
              modelPath={modelPath}
              lowPower={lowPower}
              cut={cut}
              dissection={dissection}
              selected={selected}
              focus={focus}
              onSelect={select}
              onSection={handleSection}
            />
          )}
          <nav className="flex items-center gap-2 lg:hidden" aria-label="Navegação entre etapas">
            <button className="rounded-full bg-white/10 px-4 py-3 text-sm font-bold text-white disabled:opacity-40" disabled={activeStepIndex === 0} onClick={() => goToStep(activeStepIndex - 1)} aria-label="Etapa anterior">‹</button>
            <button className="min-w-0 flex-1 truncate rounded-2xl bg-slate-900/80 px-3 py-2 text-left text-sm text-white" onClick={() => setTab("step")}>
              <span className="text-xs font-bold text-pink-300">{activeStep.code} · {activeStepIndex + 1}/{activeProcedure.steps.length}</span>
              <span className="block truncate font-semibold">{activeStep.title}</span>
            </button>
            <button className="rounded-full bg-white/10 px-4 py-3 text-sm font-bold text-white disabled:opacity-40" disabled={activeStepIndex === activeProcedure.steps.length - 1} onClick={() => goToStep(activeStepIndex + 1)} aria-label="Próxima etapa">›</button>
          </nav>
          <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-3 md:p-4">
            <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1" role="tablist">
              {tabs.map((item) => (
                <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`${item.mobileOnly ? "lg:hidden" : ""} shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${tab === item.id ? "bg-sky-500/30 text-white" : "bg-slate-900 text-slate-300"}`}>
                  {item.label}
                  {item.id === "details" && selected ? " •" : ""}
                </button>
              ))}
            </div>
            {toolContent(tab)}
          </div>
        </section>
        <div className="hidden lg:block">
          <AnnotationPanel step={activeStep} />
        </div>
      </div>

      <div className="mx-auto mt-4 hidden max-w-7xl md:block"><StepTimeline steps={activeProcedure.steps} activeStepIndex={activeStepIndex} onSelectStep={setActiveStepIndex} /></div>
    </main>
  );
}
