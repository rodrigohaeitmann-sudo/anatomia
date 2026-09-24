"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnatomyViewer, type FocusRequest, type SectionReport } from "@/components/AnatomyViewer";
import { PackInfoPanel } from "@/components/packs/PackInfoPanel";
import { PackNavigator } from "@/components/packs/PackNavigator";
import { ViewSwitcher } from "@/components/packs/ViewSwitcher";
import { StructureToggleList } from "@/components/StructureToggleList";
import { CutPanel } from "@/components/tools/CutPanel";
import { DissectionPanel } from "@/components/tools/DissectionPanel";
import { StructureDetails } from "@/components/tools/StructureDetails";
import { mm, resolvePoint } from "@/components/viewer/shared";
import { ViewerToolbar } from "@/components/ViewerToolbar";
import { allPacks, type PackView } from "@/data/packs";
import { hybridTorsoModel, modelStructures } from "@/lib/modelConfig";
import { axisComponent } from "@/lib/sectioning";
import { useLowPower } from "@/lib/useLowPower";
import { defaultCut, defaultDissection, type CutState, type DissectionState, type StructureVisibility, type ViewMode } from "@/lib/viewerTypes";

type Tab = "pack" | "details" | "cut" | "dissection" | "structures";
const tabs: { id: Tab; label: string; mobileOnly?: boolean }[] = [
  { id: "pack", label: "Pack", mobileOnly: true },
  { id: "details", label: "Ficha" },
  { id: "cut", label: "Corte" },
  { id: "dissection", label: "Dissecar" },
  { id: "structures", label: "Estruturas", mobileOnly: true },
];

function visibilityFor(view: PackView): StructureVisibility {
  const shown = new Set(view.structures);
  return Object.fromEntries(modelStructures.map((structure) => [structure.id, shown.has(structure.id)]));
}

function cutFor(view: PackView): CutState {
  if (!view.cut) return defaultCut;
  const point = resolvePoint(view.cut.at);
  const absolute = point ? point[axisComponent(view.cut.axis)] + (view.cut.offsetMm ?? 0) * mm : null;
  return { axis: view.cut.axis, position: 0.5, flip: view.cut.flip ?? false, scope: view.cut.scope ?? "all", absolute };
}

function dissectionFor(view: PackView): DissectionState {
  return { ...defaultDissection, skinWindow: view.skinWindow ?? "none", manipulations: { ...view.manipulations }, retracted: {}, space: view.space ?? null };
}

export default function Home() {
  const [packId, setPackId] = useState(allPacks[0].pack.id);
  const [viewIndex, setViewIndex] = useState(0);
  const [visibility, setVisibility] = useState<StructureVisibility>(() => visibilityFor(allPacks[0].pack.views[0]));
  const [viewMode, setViewMode] = useState<ViewMode>("anatomical");
  const [resetSignal, setResetSignal] = useState(0);
  const [cut, setCut] = useState<CutState>(defaultCut);
  const [dissection, setDissection] = useState<DissectionState>(defaultDissection);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest>(null);
  const [section, setSection] = useState<SectionReport>(null);
  const [tab, setTab] = useState<Tab>("pack");
  const lowPower = useLowPower();

  const { group, pack } = useMemo(() => allPacks.find((entry) => entry.pack.id === packId) ?? allPacks[0], [packId]);
  const view = pack.views[viewIndex] ?? pack.views[0];
  const viewKey = `${pack.id}/${view.id}`;
  const modelPath = lowPower ? hybridTorsoModel.modelPath.replace(/\.glb$/, "-mobile.glb") : hybridTorsoModel.modelPath;

  // deep link: #pack/view
  useEffect(() => {
    const [hashPack, hashView] = decodeURIComponent(window.location.hash.slice(1)).split("/");
    const entry = allPacks.find((item) => item.pack.id === hashPack);
    if (entry) {
      setPackId(entry.pack.id);
      setViewIndex(Math.max(0, entry.pack.views.findIndex((item) => item.id === hashView)));
    }
    if (window.matchMedia("(min-width: 1024px)").matches) setTab("details");
  }, []);

  // opening a view applies its complete state
  useEffect(() => {
    setVisibility(visibilityFor(view));
    setCut(cutFor(view));
    setDissection(dissectionFor(view));
    setFocus(null);
    setSelected(null);
    history.replaceState(null, "", `#${viewKey}`);
  }, [view, viewKey]);

  const select = useCallback((structure: string | null) => {
    setSelected(structure);
    if (structure) setTab("details");
  }, []);
  const handleSection = useCallback((report: SectionReport) => setSection(report), []);
  const toggleStructure = (id: string) => setVisibility((current) => ({ ...current, [id]: !current[id] }));
  const openPack = (id: string) => {
    setPackId(id);
    setViewIndex(0);
  };

  const toolContent = (id: Tab) => {
    if (id === "pack")
      return (
        <div className="space-y-4">
          <PackInfoPanel groupTitle={group.title} pack={pack} view={view} viewIndex={viewIndex} selected={selected} onSelect={select} />
          <details className="rounded-2xl border border-slate-800 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-sky-200">Trocar de pack</summary>
            <div className="mt-3"><PackNavigator activePackId={pack.id} onSelect={openPack} compact /></div>
          </details>
        </div>
      );
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
        onShowAll={() => setVisibility(visibilityFor(view))}
        onFocus={(structure) => setFocus({ structure, nonce: Date.now() })}
        onClose={() => setSelected(null)}
      />
    );
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#1e3a8a55,transparent_35%),radial-gradient(circle_at_top_right,#be185d44,transparent_30%),#020617] px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] md:p-8">
      <header className="mx-auto mb-3 max-w-7xl rounded-3xl border border-slate-800 bg-slate-950/80 p-4 shadow-2xl md:mb-6 md:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-sky-300">Atlas anatômico interativo</p>
        <h1 className="mt-1 text-xl font-black text-white md:mt-3 md:text-5xl">Anatomia Cirúrgica em Mastologia</h1>
        <p className="mt-3 hidden max-w-3xl text-slate-300 md:block">Packs de visualização sistematizados (mama, axila, retalhos, parede torácica) sobre um modelo feminino híbrido: pele e mama do Visible Human Female/NIH, vasos, nervos e músculos do BodyParts3D. Cada pack tem várias vistas com foco nas relações espaciais.</p>
      </header>

      <div className="mx-auto grid max-w-7xl gap-3 lg:grid-cols-[280px_minmax(0,1fr)_360px] lg:gap-4">
        <div className="hidden space-y-4 lg:block">
          <PackNavigator activePackId={pack.id} onSelect={openPack} />
          <StructureToggleList visibility={visibility} onToggle={toggleStructure} />
        </div>
        <section className="min-w-0 space-y-3">
          <div className="lg:hidden">
            <button onClick={() => setTab("pack")} className="w-full rounded-2xl bg-slate-900/80 px-3 py-2 text-left">
              <span className="text-[11px] font-bold uppercase text-sky-300">{group.title}</span>
              <span className="block truncate text-base font-bold text-white">{pack.title}</span>
            </button>
          </div>
          <ViewSwitcher pack={pack} activeIndex={viewIndex} onSelect={setViewIndex} />
          <ViewerToolbar
            viewMode={viewMode}
            onResetCamera={() => setResetSignal((value) => value + 1)}
            onTransverseCut={() => {
              setCut((current) => ({ ...current, axis: "transverse", absolute: current.axis === "transverse" ? current.absolute : null, position: current.axis === "transverse" ? current.position : 0.62 }));
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
              view={view}
              viewKey={viewKey}
              caption={`${pack.title} · ${view.title}`}
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
        <div className="hidden max-h-[calc(100vh-2rem)] overflow-y-auto rounded-3xl border border-slate-800 bg-slate-950/80 p-5 lg:block">
          <PackInfoPanel groupTitle={group.title} pack={pack} view={view} viewIndex={viewIndex} selected={selected} onSelect={select} />
        </div>
      </div>
    </main>
  );
}
