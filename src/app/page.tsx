"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bone, RotateCcw, Ruler, ScanEye, Scissors, Shirt, Tags, Waypoints } from "lucide-react";
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
import { LandmarkDetails } from "@/components/tools/LandmarkDetails";
import { StructureDetails } from "@/components/tools/StructureDetails";
import { FloatingPrompt, StudyPanel, type QuizState } from "@/components/tools/StudyPanel";
import type { SelectionChip } from "@/components/mobile/SelectionBar";
import { mm, resolvePoint } from "@/components/viewer/shared";
import { ViewerToolbar } from "@/components/ViewerToolbar";
import { allPacks, type PackView } from "@/data/packs";
import { surgicalSpaces } from "@/data/surgicalSpaces";
import { labelModeCaption, nextLabelMode, viewAnnotations, type AnnotationEntry, type LabelMode } from "@/lib/annotations";
import { groupColor } from "@/lib/groupStyle";
import { hybridTorsoModel, modelStructures } from "@/lib/modelConfig";
import { axisComponent } from "@/lib/sectioning";
import { useCompactLayout, useLowPower } from "@/lib/useLowPower";
import { attachmentsFor, landmarkById, layerLandmarks, loadLayerBuffers, partById, partByMesh, regionByStructure, regionLookup, type LayerAttachment } from "@/lib/anatomyLayers";
import { useReview } from "@/lib/review";
import { defaultCut, defaultDissection, defaultStudy, hiddenByLayer, type CutState, type DissectionState, type PickInfo, type StructureVisibility, type StudyState, type ViewMode } from "@/lib/viewerTypes";

type Tab = MobileTab;
const desktopTabs: { id: Tab; label: string }[] = [
  { id: "details", label: "Ficha" },
  { id: "study", label: "Estudo" },
  { id: "cut", label: "Corte" },
  { id: "dissection", label: "Dissecar" },
];
const neuroGroups = new Set(["Vasos", "Nervos"]);
const skeleton = ["axilla", "chest-wall", "costal-cartilages", "iliac-crest"];
const structureInfo = new Map(modelStructures.map((structure) => [structure.id, structure]));
const QUIZ_KEY = "anatomia.quiz.v1";
type QuizHistory = Record<string, { n: number; lastMm: number }>;

function readQuizHistory(): QuizHistory {
  try {
    return JSON.parse(window.localStorage.getItem(QUIZ_KEY) ?? "{}") as QuizHistory;
  } catch {
    return {};
  }
}

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
  const [study, setStudy] = useState<StudyState>(defaultStudy);
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [selectedLandmark, setSelectedLandmark] = useState<string | null>(null);
  const [attachmentFocus, setAttachmentFocus] = useState<string | null>(null);
  const [rulerPoints, setRulerPoints] = useState<[number, number, number][]>([]);
  const [quiz, setQuiz] = useState<QuizState | null>(null);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const quizHistory = useRef<QuizHistory>({});
  const review = useReview();
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
    setSelectedPart(null);
    setSelectedLandmark(null);
    setAttachmentFocus(null);
    setActivePin(null);
    setNeuro(false);
    setStudy((current) => ({ ...current, proximity: null }));
    setRulerPoints([]);
    history.replaceState(null, "", `#${viewKey}`);
  }, [view, viewKey]);

  /** tap on the model: phones only mark the structure (chip at the bottom); desktop opens the card */
  const select = useCallback(
    (structure: string | null) => {
      setSelected(structure);
      if (structure) setActivePin(null);
      if (structure && !compact && tab !== "study") setTab("details");
    },
    [compact, tab],
  );

  // a distance-map target is always shown
  useEffect(() => {
    const targets = study.proximity;
    if (targets?.length) setVisibility((current) => ({ ...current, ...Object.fromEntries(targets.map((id) => [id, true])) }));
  }, [study.proximity]);

  // ---- quiz -----------------------------------------------------------------------------------------
  const hidden = useMemo(() => hiddenByLayer(dissection.layer), [dissection.layer]);
  const quizPool = useMemo(() => layerLandmarks.filter((item) => item.category !== "costela" && visibility[item.structure] && !hidden.has(item.structure)), [visibility, hidden]);
  const nextQuizTarget = useCallback(() => {
    if (!quizPool.length) return null;
    const history = quizHistory.current;
    const fresh = quizPool.filter((item) => !history[item.id]);
    if (fresh.length) return fresh[Math.floor(Math.random() * fresh.length)].id;
    return [...quizPool].sort((a, b) => (history[b.id]?.lastMm ?? 0) - (history[a.id]?.lastMm ?? 0))[Math.floor(Math.random() * Math.min(3, quizPool.length))].id;
  }, [quizPool]);
  const startQuiz = () => {
    quizHistory.current = readQuizHistory();
    setQuiz({ targetId: nextQuizTarget(), guess: null, errorMm: null, session: [] });
    setStudy((current) => ({ ...current, ruler: false }));
    setSelected(null);
    setSelectedLandmark(null);
    if (compact) setSnap("peek");
  };
  const answerQuiz = (point: [number, number, number]) => {
    setQuiz((current) => {
      if (!current?.targetId || current.guess) return current;
      const target = landmarkById.get(current.targetId);
      if (!target) return current;
      const errorMm = Math.hypot(point[0] - target.point[0], point[1] - target.point[1], point[2] - target.point[2]) / mm;
      const history = { ...quizHistory.current, [target.id]: { n: (quizHistory.current[target.id]?.n ?? 0) + 1, lastMm: errorMm } };
      quizHistory.current = history;
      try {
        window.localStorage.setItem(QUIZ_KEY, JSON.stringify(history));
      } catch {
        // storage unavailable: the order simply restarts next time
      }
      return { ...current, guess: point, errorMm, session: [...current.session, errorMm] };
    });
  };

  // ---- taps on the model ------------------------------------------------------------------------------
  const handlePick = (structure: string | null, info?: PickInfo) => {
    if (quiz?.targetId && !quiz.guess) {
      if (info) answerQuiz(info.point);
      return;
    }
    if (study.ruler) {
      if (info) setRulerPoints((points) => (points.length >= 2 ? [info.point] : [...points, info.point]));
      return;
    }
    if (adjusting) {
      if (info) review.update(adjusting, { status: "ajustado", point: info.point });
      setAdjusting(null);
      return;
    }
    setSelectedLandmark(null);
    if (!structure) {
      select(null);
      setSelectedPart(null);
      return;
    }
    const meshPart = info ? partByMesh.get(info.meshName) : undefined;
    setSelectedPart(meshPart?.id ?? null);
    select(structure);
    if (attachmentFocus && attachmentsFor(structure).length) setAttachmentFocus(structure);
    if (!meshPart && info && regionByStructure.has(structure)) {
      loadLayerBuffers()
        .then((buffers) => {
          const lookup = regionLookup(structure, buffers);
          const label = lookup?.labelAt(...info.point);
          const part = lookup?.parts.find((item) => item.labelIndex === label);
          if (part) setSelectedPart(part.id);
        })
        .catch(() => undefined);
    }
  };
  const pickLandmark = (id: string, info?: PickInfo) => {
    if (quiz?.targetId && !quiz.guess) return;
    if (adjusting) {
      if (info) review.update(adjusting, { status: "ajustado", point: info.point });
      setAdjusting(null);
      return;
    }
    const landmark = landmarkById.get(id);
    if (study.ruler && landmark) {
      const point = review.store[id]?.point ?? landmark.point;
      setRulerPoints((points) => (points.length >= 2 ? [point] : [...points, point]));
      return;
    }
    setSelectedLandmark(id);
    setSelected(null);
    setSelectedPart(null);
    setActivePin(null);
    if (!compact) setTab("details");
  };
  const pickAttachment = (item: LayerAttachment) => {
    setSelectedLandmark(null);
    setSelected(item.muscle);
    setSelectedPart(item.part);
    if (!compact) setTab("details");
  };
  const showAttachments = (structure: string | null) => {
    setAttachmentFocus(structure);
    if (!structure) return;
    const bones = new Set(attachmentsFor(structure).map((item) => item.boneStructure));
    setVisibility((current) => ({ ...current, ...Object.fromEntries([...bones].map((id) => [id, true])), [structure]: true }));
    setFocus({ structure, nonce: Date.now() });
    if (compact) setSnap("peek");
  };
  const showSkeleton = () => {
    setVisibility(Object.fromEntries(modelStructures.map((item) => [item.id, skeleton.includes(item.id)])));
    setStudy((current) => ({ ...current, landmarks: true }));
    setDissection((current) => ({ ...current, layer: 0 }));
    if (compact) setSnap("peek");
  };
  const exportReview = () => {
    const blob = new Blob([review.exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `revisao-anatomia-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const rulerMm = rulerPoints.length === 2 ? Math.hypot(rulerPoints[0][0] - rulerPoints[1][0], rulerPoints[0][1] - rulerPoints[1][1], rulerPoints[0][2] - rulerPoints[1][2]) / mm : null;
  const quizTarget = quiz?.targetId ? landmarkById.get(quiz.targetId) : undefined;
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

  const deselect = () => {
    setSelected(null);
    setSelectedPart(null);
    setSelectedLandmark(null);
  };
  const selectionChip: SelectionChip | null = selectedLandmark
    ? (() => {
        const item = landmarkById.get(selectedLandmark);
        return item ? { group: `Marco · ${item.bone}`, label: item.name, color: "#fde68a" } : null;
      })()
    : selected
      ? { group: selectedPart ? structureInfo.get(selected)?.label ?? "" : structureInfo.get(selected)?.group ?? "", label: (selectedPart && partById.get(selectedPart)?.label) || structureInfo.get(selected)?.label || selected, color: structureInfo.get(selected)?.color ?? "#fff" }
      : null;

  const toolContent = (id: Tab) => {
    if (id === "study")
      return (
        <StudyPanel
          study={study}
          onStudy={setStudy}
          onSkeleton={showSkeleton}
          rulerPoints={rulerPoints}
          rulerMm={rulerMm}
          onClearRuler={() => setRulerPoints([])}
          quiz={quiz}
          quizPool={quizPool.length}
          onQuizStart={startQuiz}
          onQuizNext={() => setQuiz((current) => (current ? { ...current, targetId: nextQuizTarget(), guess: null, errorMm: null } : current))}
          onQuizStop={() => setQuiz(null)}
          review={review.store}
          onExportReview={exportReview}
        />
      );
    if (id === "details" && selectedLandmark)
      return (
        <LandmarkDetails
          key={selectedLandmark}
          id={selectedLandmark}
          review={review.store[selectedLandmark]}
          adjusting={adjusting === selectedLandmark}
          onReview={review.update}
          onAdjust={(lm) => {
            setAdjusting(lm);
            if (lm && compact) setSnap("peek");
          }}
          onFocus={(point) => {
            setFocus({ structure: landmarkById.get(selectedLandmark)?.structure ?? "axilla", nonce: Date.now(), point });
            if (compact) setSnap("peek");
          }}
          onSelectMuscle={(structure, part) => {
            setSelectedLandmark(null);
            setSelected(structure);
            setSelectedPart(part);
          }}
          onClose={() => setSelectedLandmark(null)}
        />
      );
    if (id === "pack") return <PackInfoPanel groupTitle={group.title} pack={pack} view={view} viewIndex={viewIndex} selected={selected} onSelect={openDetails} legend={{ entries, activePin, onPick: pickLegend }} />;
    if (id === "structures") return <StructureToggleList visibility={visibility} onToggle={toggleStructure} embedded={Boolean(compact)} />;
    if (id === "cut") return <CutPanel cut={cut} onChange={setCut} report={section} selected={selected} onSelect={(structure) => (structure ? openDetails(structure) : setSelected(null))} />;
    if (id === "dissection") return <DissectionPanel dissection={dissection} onChange={setDissection} />;
    return (
      <StructureDetails
        structure={selected}
        part={selectedPart}
        onPart={setSelectedPart}
        attachmentsShown={Boolean(selected) && attachmentFocus === selected}
        onAttachments={showAttachments}
        fibresShown={study.fibres !== "off"}
        onFibres={() => setStudy((current) => ({ ...current, fibres: current.fibres === "off" ? "selected" : "off" }))}
        proximityShown={Boolean(selected && study.proximity?.includes(selected))}
        onProximity={(structure) => setStudy((current) => ({ ...current, proximity: structure ? [structure] : null }))}
        dissection={dissection}
        onDissection={setDissection}
        onIsolate={isolate}
        onHide={(structure) => setVisibility((current) => ({ ...current, [structure]: false }))}
        onShowAll={() => setVisibility(visibilityFor(view))}
        onFocus={(structure) => {
          setFocus({ structure, nonce: Date.now() });
          if (compact) setSnap("peek");
        }}
        onClose={deselect}
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
        onSelect={handlePick}
        onOpenDetails={openDetails}
        onSection={handleSection}
        layout={mobile ? "mobile" : "desktop"}
        labelMode={labelMode}
        activePin={activePin}
        onPin={setActivePin}
        insets={insets}
        study={quiz ? { ...study, landmarks: false } : study}
        selectedPart={selectedPart}
        selectedLandmark={selectedLandmark}
        attachmentFocus={attachmentFocus}
        review={review.store}
        rulerPoints={rulerPoints}
        quiz={quizTarget ? { target: quizTarget.point, name: quizTarget.name, guess: quiz?.guess ?? null } : null}
        onPickLandmark={pickLandmark}
        onPickAttachment={pickAttachment}
      />
    );

  if (compact === null) return <main className="fixed inset-0 bg-slate-950" />;

  if (compact) {
    const rail: RailItem[] = [
      { id: "labels", label: labelModeCaption[labelMode], icon: Tags, active: labelMode !== "hidden", onPress: () => setLabelMode((mode) => nextLabelMode[mode]) },
      { id: "landmarks", label: "Marcos", icon: Bone, active: study.landmarks, onPress: () => setStudy((current) => ({ ...current, landmarks: !current.landmarks })) },
      { id: "ruler", label: "Régua", icon: Ruler, active: study.ruler, onPress: () => setStudy((current) => ({ ...current, ruler: !current.ruler })) },
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
        selection={selectionChip}
        onOpenDetails={() => {
          setTab("details");
          setSnap("half");
        }}
        onIsolate={selected && !selectedLandmark ? () => isolate(selected) : undefined}
        onDeselect={deselect}
        onLibrary={() => setLibraryOpen(true)}
        onAbout={() => setAboutOpen(true)}
        renderViewer={(insets) => viewer(true, insets)}
        content={toolContent(tab)}
        overlays={
          <>
            <PackLibrary open={libraryOpen} activePackId={pack.id} onSelect={openPack} onClose={() => setLibraryOpen(false)} />
            <AboutSheet open={aboutOpen} onClose={() => setAboutOpen(false)} />
            {quiz && (
              <FloatingPrompt
                top={86}
                title={quizTarget ? <>Toque: <span className="text-amber-200">{quizTarget.name}</span></> : "Sem marcos visíveis"}
                detail={quiz.errorMm !== null ? `Erro ${quiz.errorMm.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mm · média ${(quiz.session.reduce((a, b) => a + b, 0) / quiz.session.length).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mm (${quiz.session.length})` : quizTarget?.bone}
                actions={[
                  { label: quiz.errorMm === null ? "Pular" : "Próximo", primary: true, onPress: () => setQuiz((current) => (current ? { ...current, targetId: nextQuizTarget(), guess: null, errorMm: null } : current)) },
                  { label: "Sair", onPress: () => setQuiz(null) },
                ]}
              />
            )}
            {adjusting && !quiz && (
              <FloatingPrompt
                top={86}
                title={<>Toque no osso: nova posição de <span className="text-violet-200">{landmarkById.get(adjusting)?.name}</span></>}
                actions={[{ label: "Cancelar", onPress: () => setAdjusting(null) }]}
              />
            )}
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
