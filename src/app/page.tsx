"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcw, ScanEye, Scissors, Shirt, Tags, Waypoints } from "lucide-react";
import { AnatomyViewer, type FocusRequest, type SectionReport } from "@/components/AnatomyViewer";
import { AboutSheet } from "@/components/mobile/AboutSheet";
import type { SheetSnap } from "@/components/mobile/BottomSheet";
import { MobileShell, type MobileTab } from "@/components/mobile/MobileShell";
import { PackLibrary } from "@/components/mobile/PackLibrary";
import type { RailItem } from "@/components/mobile/ToolRail";
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
import { surgicalSpaces } from "@/data/surgicalSpaces";
import { labelModeCaption, nextLabelMode, viewAnnotations, type AnnotationEntry, type LabelMode } from "@/lib/annotations";
import { groupColor } from "@/lib/groupStyle";
import { hybridTorsoModel, modelStructures } from "@/lib/modelConfig";
import { axisComponent } from "@/lib/sectioning";
import { useCompactLayout, useLowPower } from "@/lib/useLowPower";
import { defaultCut, defaultDissection, type CutState, type DissectionState, type StructureVisibility, type ViewMode } from "@/lib/viewerTypes";

type Tab = MobileTab;
const desktopTabs: { id: Tab; label: string }[] = [
  { id: "details", label: "Ficha" },
  { id: "cut", label: "Corte" },
  { id: "dissection", label: "Dissecar" },
];
const neuroGroups = new Set(["Vasos", "Nervos"]);

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
  const [snap, setSnap] = useState<SheetSnap>("peek");
  const [labelMode, setLabelMode] = useState<LabelMode>("names");
  const [activePin, setActivePin] = useState<string | null>(null);
  const [neuro, setNeuro] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const lowPower = useLowPower();
  const compact = useCompactLayout();

  const { group, pack } = useMemo(() => allPacks.find((entry) => entry.pack.id === packId) ?? allPacks[0], [packId]);
  const view = pack.views[viewIndex] ?? pack.views[0];
  const viewKey = `${pack.id}/${view.id}`;
  const modelPath = lowPower ? hybridTorsoModel.modelPath.replace(/\.glb$/, "-mobile.glb") : hybridTorsoModel.modelPath;
  const space = useMemo(() => surgicalSpaces.find((item) => item.id === dissection.space) ?? null, [dissection.space]);
  const entries = useMemo(() => viewAnnotations(view, space), [view, space]);

  // layout defaults: numbered pins on phones (names cover the model), names on desktop
  useEffect(() => {
    if (compact === null) return;
    setLabelMode(compact ? "pins" : "names");
    setTab(compact ? "pack" : "details");
  }, [compact]);

  // deep link: #pack/view
  useEffect(() => {
    const [hashPack, hashView] = decodeURIComponent(window.location.hash.slice(1)).split("/");
    const entry = allPacks.find((item) => item.pack.id === hashPack);
    if (entry) {
      setPackId(entry.pack.id);
      setViewIndex(Math.max(0, entry.pack.views.findIndex((item) => item.id === hashView)));
    }
  }, []);

  // opening a view applies its complete state
  useEffect(() => {
    setVisibility(visibilityFor(view));
    setCut(cutFor(view));
    setDissection(dissectionFor(view));
    setFocus(null);
    setSelected(null);
    setActivePin(null);
    setNeuro(false);
    history.replaceState(null, "", `#${viewKey}`);
  }, [view, viewKey]);

  /** tap on the model: phones only mark the structure (chip at the bottom); desktop opens the card */
  const select = useCallback(
    (structure: string | null) => {
      setSelected(structure);
      if (structure) setActivePin(null);
      if (structure && !compact) setTab("details");
    },
    [compact],
  );
  const openDetails = useCallback(
    (structure: string) => {
      setSelected(structure);
      setTab("details");
      if (compact) setSnap("half");
    },
    [compact],
  );
  const handleSection = useCallback((report: SectionReport) => setSection(report), []);
  const toggleStructure = (id: string) => setVisibility((current) => ({ ...current, [id]: !current[id] }));
  const isolate = (structure: string) => setVisibility(Object.fromEntries(modelStructures.map((item) => [item.id, item.id === structure])));
  const openPack = (id: string, index = 0) => {
    setPackId(id);
    setViewIndex(index);
    setLibraryOpen(false);
    setSnap("peek");
  };
  const toggleNeuro = () => {
    setNeuro((on) => {
      const next = !on;
      const shown = new Set(view.structures);
      setVisibility((current) => ({
        ...current,
        ...Object.fromEntries(modelStructures.filter((structure) => neuroGroups.has(structure.group)).map((structure) => [structure.id, next || shown.has(structure.id)])),
      }));
      return next;
    });
  };
  const toggleCut = () => {
    if (cut.axis) {
      setCut((current) => ({ ...current, axis: null }));
      return;
    }
    setCut((current) => ({ ...current, axis: "transverse", absolute: null, position: 0.62 }));
    setTab("cut");
    if (compact) setSnap("half");
  };
  const pickLegend = (entry: AnnotationEntry) => {
    if (compact) {
      setLabelMode((mode) => (mode === "hidden" ? "pins" : mode));
      setActivePin(entry.key);
      setSnap("peek");
    } else if (entry.structure) {
      openDetails(entry.structure);
    }
  };

  const toolContent = (id: Tab) => {
    if (id === "pack") return <PackInfoPanel groupTitle={group.title} pack={pack} view={view} viewIndex={viewIndex} selected={selected} onSelect={openDetails} legend={{ entries, activePin, onPick: pickLegend }} />;
    if (id === "structures") return <StructureToggleList visibility={visibility} onToggle={toggleStructure} embedded={Boolean(compact)} />;
    if (id === "cut") return <CutPanel cut={cut} onChange={setCut} report={section} selected={selected} onSelect={(structure) => (structure ? openDetails(structure) : setSelected(null))} />;
    if (id === "dissection") return <DissectionPanel dissection={dissection} onChange={setDissection} />;
    return (
      <StructureDetails
        structure={selected}
        dissection={dissection}
        onDissection={setDissection}
        onIsolate={isolate}
        onHide={(structure) => setVisibility((current) => ({ ...current, [structure]: false }))}
        onShowAll={() => setVisibility(visibilityFor(view))}
        onFocus={(structure) => {
          setFocus({ structure, nonce: Date.now() });
          if (compact) setSnap("peek");
        }}
        onClose={() => setSelected(null)}
      />
    );
  };

  const viewer = (mobile: boolean, insets?: { top: number; bottom: number; right: number }) =>
    lowPower === null ? null : (
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
        onOpenDetails={openDetails}
        onSection={handleSection}
        layout={mobile ? "mobile" : "desktop"}
        labelMode={labelMode}
        activePin={activePin}
        onPin={setActivePin}
        insets={insets}
      />
    );

  if (compact === null) return <main className="fixed inset-0 bg-slate-950" />;

  if (compact) {
    const rail: RailItem[] = [
      { id: "labels", label: labelModeCaption[labelMode], icon: Tags, active: labelMode !== "hidden", onPress: () => setLabelMode((mode) => nextLabelMode[mode]) },
      { id: "cut", label: "Corte", icon: Scissors, active: Boolean(cut.axis), onPress: toggleCut },
      { id: "skin", label: "Pele", icon: Shirt, active: Boolean(visibility.skin), onPress: () => toggleStructure("skin") },
      { id: "neuro", label: "Vasos", icon: Waypoints, active: neuro, onPress: toggleNeuro },
      { id: "focus", label: "Foco", icon: ScanEye, active: viewMode === "surgical", onPress: () => setViewMode((mode) => (mode === "surgical" ? "anatomical" : "surgical")) },
      { id: "reset", label: "Centro", icon: RotateCcw, onPress: () => setResetSignal((value) => value + 1) },
    ];
    return (
      <MobileShell
        groupTitle={group.title}
        groupColor={groupColor(group.id)}
        pack={pack}
        viewIndex={viewIndex}
        onViewIndex={setViewIndex}
        tab={tab}
        onTab={setTab}
        snap={snap}
        onSnap={setSnap}
        rail={rail}
        selected={selected}
        onOpenDetails={() => selected && openDetails(selected)}
        onIsolate={isolate}
        onDeselect={() => setSelected(null)}
        onLibrary={() => setLibraryOpen(true)}
        onAbout={() => setAboutOpen(true)}
        renderViewer={(insets) => viewer(true, insets)}
        content={toolContent(tab)}
        overlays={
          <>
            <PackLibrary open={libraryOpen} activePackId={pack.id} onSelect={openPack} onClose={() => setLibraryOpen(false)} />
            <AboutSheet open={aboutOpen} onClose={() => setAboutOpen(false)} />
          </>
        }
      />
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#1e3a8a55,transparent_35%),radial-gradient(circle_at_top_right,#be185d44,transparent_30%),#020617] p-8">
      <header className="mx-auto mb-6 max-w-7xl rounded-3xl border border-slate-800 bg-slate-950/80 p-6 shadow-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-sky-300">Atlas anatômico interativo</p>
        <h1 className="mt-3 text-5xl font-black text-white">Anatomia Cirúrgica em Mastologia</h1>
        <p className="mt-3 max-w-3xl text-slate-300">Packs de visualização sistematizados (mama, axila, retalhos, parede torácica) sobre um modelo feminino híbrido: pele e mama do Visible Human Female/NIH, vasos, nervos e músculos do BodyParts3D. Cada pack tem várias vistas com foco nas relações espaciais.</p>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-[280px_minmax(0,1fr)_360px] gap-4">
        <div className="space-y-4">
          <PackNavigator activePackId={pack.id} onSelect={openPack} />
          <StructureToggleList visibility={visibility} onToggle={toggleStructure} />
        </div>
        <section className="min-w-0 space-y-3">
          <ViewSwitcher pack={pack} activeIndex={viewIndex} onSelect={setViewIndex} />
          <ViewerToolbar
            viewMode={viewMode}
            labelCaption={labelModeCaption[labelMode]}
            onCycleLabels={() => setLabelMode((mode) => (mode === "names" ? "hidden" : "names"))}
            onResetCamera={() => setResetSignal((value) => value + 1)}
            onTransverseCut={toggleCut}
            onToggleSkin={() => toggleStructure("skin")}
            onShowVessels={toggleNeuro}
            onSetViewMode={setViewMode}
          />
          {viewer(false)}
          <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
            <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1" role="tablist">
              {desktopTabs.map((item) => (
                <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${tab === item.id ? "bg-sky-500/30 text-white" : "bg-slate-900 text-slate-300"}`}>
                  {item.label}
                  {item.id === "details" && selected ? " •" : ""}
                </button>
              ))}
            </div>
            {toolContent(tab === "pack" || tab === "structures" ? "details" : tab)}
          </div>
        </section>
        <div className="max-h-[calc(100vh-2rem)] overflow-y-auto rounded-3xl border border-slate-800 bg-slate-950/80 p-5">{toolContent("pack")}</div>
      </div>
    </main>
  );
}
