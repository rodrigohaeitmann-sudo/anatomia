"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnatomyViewer, type FocusRequest, type NotePin, type SectionReport, type SkinMode } from "@/components/AnatomyViewer";
import type { QuizState } from "@/components/tools/StudyPanel";
import { mm, resolvePoint } from "@/components/viewer/shared";
import { allPacks, type PackView } from "@/data/packs";
import { surgicalSpaces } from "@/data/surgicalSpaces";
import { attachmentsFor, landmarkById, layerLandmarks, loadLayerBuffers, partByMesh, regionByStructure, regionLookup, type LayerAttachment } from "@/lib/anatomyLayers";
import { viewAnnotations, type AnnotationEntry, type LabelMode } from "@/lib/annotations";
import { planCaseOf } from "@/lib/breastAnatomy";
import { breastStateById } from "@/lib/breastStates";
import { stepStructuresOf } from "@/lib/mammaplastySteps";
import { hybridTorsoModel, modelStructures, structureGroups, type Landmark } from "@/lib/modelConfig";
import { useReview } from "@/lib/review";
import { axisComponent } from "@/lib/sectioning";
import { addNote, FREE_PACK, FREE_VIEW, recordState, recordVisit, updateNote, useNotes, useSettings, type Note } from "@/lib/store";
import { listedInSteps } from "@/lib/surgeryVisibility";
import { useLowPower } from "@/lib/useLowPower";
import { defaultCut, defaultDissection, defaultStudy, hiddenByLayer, type CutState, type DissectionState, type PickInfo, type StructureVisibility, type StudyState, type ViewMode } from "@/lib/viewerTypes";

export type StudyMode = "guided" | "free";
/** tools of the dock / toolbar, plus the panels reached from the "more" menu */
export type ToolId = "layers" | "cut" | "shape" | "arm" | "note" | "study" | "dissection" | "structures";

const neuroGroups = new Set(["Vasos", "Nervos"]);
const skeleton = ["axilla", "chest-wall", "costal-cartilages", "iliac-crest"];
const QUIZ_KEY = "anatomia.quiz.v1";
type QuizHistory = Record<string, { n: number; lastMm: number }>;

function readQuizHistory(): QuizHistory {
  try {
    return JSON.parse(window.localStorage.getItem(QUIZ_KEY) ?? "{}") as QuizHistory;
  } catch {
    return {};
  }
}

/** Structures of the whole model opened in the free mode: the anatomy without skin, fasciae, schematic layer or plans. */
const freeStructures = modelStructures.filter((item) => item.listed && !item.plan && !item.schematic && item.group !== "Superfície" && item.group !== "Fáscias" && item.id !== "contralateral-pectoral").map((item) => item.id);

/** The free mode is a view of its own: the whole model, no labels, framed on the breast and the axilla. */
export const freeView: PackView = {
  id: FREE_VIEW,
  title: "Modelo completo",
  description: "O modelo inteiro aberto. Toque em qualquer estrutura para ver a ficha; use Camadas para escolher o que aparece, Forma para a ptose e Braço para a posição do membro superior.",
  structures: freeStructures,
  orientation: "anterolateral",
  anchor: "breastCenter",
  distance: 1.3,
  relations: [],
};

/** Display name and members of each group of structures (tool Camadas). */
const groupNames: Record<string, string> = { Superfície: "Pele", Esqueleto: "Ossos" };
export const layerGroups = structureGroups
  .map((group) => ({ group, name: groupNames[group] ?? group, ids: modelStructures.filter((item) => item.group === group && item.listed && !item.plan).map((item) => item.id) }))
  .filter((entry) => entry.ids.length > 0);

export type LayerPreset = "all" | "breast" | "neuro";
const schematicIds = new Set(modelStructures.filter((item) => item.schematic).map((item) => item.id));
const presetGroups: Record<LayerPreset, string[]> = {
  all: ["Superfície", "Mama", "Músculos", "Vasos", "Nervos", "Linfáticos", "Esqueleto"],
  breast: ["Mama", "Esqueleto"],
  neuro: ["Vasos", "Nervos", "Linfáticos", "Esqueleto"],
};

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

export type NoteDraft = { id: string | null; text: string; point: Landmark | null; structure: string | null; awaitingPoint: boolean };
type Restore = { key: string; breast: string | null; pose: string | null };

/**
 * State and actions of the 3D viewer, shared by the phone and desktop layouts: the pack and view (guided mode) or the
 * whole model (free mode), what is shown, cut, dissection, study layers, arm position, breast shape, selection and the
 * personal notes of the view. The 3D engine itself (AnatomyViewer) is unchanged.
 */
export function useViewerController({ compact, active }: { compact: boolean; active: boolean }) {
  const settings = useSettings();
  const notes = useNotes();
  const [mode, setModeState] = useState<StudyMode>("guided");
  const [packId, setPackId] = useState(allPacks[0].pack.id);
  const [viewIndex, setViewIndexState] = useState(0);
  const [visibility, setVisibility] = useState<StructureVisibility>(() => visibilityFor(allPacks[0].pack.views[0]));
  const [viewMode, setViewMode] = useState<ViewMode>("anatomical");
  const [resetSignal, setResetSignal] = useState(0);
  const [cut, setCut] = useState<CutState>(defaultCut);
  const [dissection, setDissection] = useState<DissectionState>(defaultDissection);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest>(null);
  const [section, setSection] = useState<SectionReport>(null);
  const [labelsHidden, setLabelsHidden] = useState(false);
  const [activePin, setActivePin] = useState<string | null>(null);
  const [neuro, setNeuro] = useState(false);
  const [armPose, setArmPose] = useState<string | null>(null);
  const [poseSettled, setPoseSettled] = useState<string | null>(null);
  const [breast, setBreast] = useState<string | null>(null);
  const [breastSettled, setBreastSettled] = useState<string | null>(null);
  const [study, setStudy] = useState<StudyState>(defaultStudy);
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [selectedLandmark, setSelectedLandmark] = useState<string | null>(null);
  const [attachmentFocus, setAttachmentFocus] = useState<string | null>(null);
  const [rulerPoints, setRulerPoints] = useState<[number, number, number][]>([]);
  const [quiz, setQuiz] = useState<QuizState | null>(null);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolId | null>(null);
  const [userTranslucent, setUserTranslucent] = useState<string[]>([]);
  const [lastPick, setLastPick] = useState<Landmark | null>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const quizHistory = useRef<QuizHistory>({});
  const restore = useRef<Restore | null>(null);
  const pendingSelect = useRef<string | null>(null);
  const pendingPin = useRef<string | null>(null);
  // the user's choices in the steps of a surgery (structures shown or hidden, the skin) hold for every step of the
  // technique, until they are undone or another technique is opened
  type StepPrefs = { technique: string; overrides: Record<string, boolean>; skin: SkinMode };
  const [stepPrefs, setStepPrefs] = useState<StepPrefs | null>(null);
  const stepPrefsRef = useRef<StepPrefs | null>(null);
  const rememberStep = (overrides: Record<string, boolean>, skin?: SkinMode) => {
    const current = stepPrefsRef.current;
    if (!current) return;
    const next = { ...current, overrides: { ...current.overrides, ...overrides }, skin: skin ?? current.skin };
    stepPrefsRef.current = next;
    setStepPrefs(next);
  };
  const review = useReview();
  const detectedLowPower = useLowPower();
  const lowPower = detectedLowPower === null ? null : settings.quality === "auto" ? detectedLowPower : settings.quality === "low";

  const { group, pack } = useMemo(() => allPacks.find((entry) => entry.pack.id === packId) ?? allPacks[0], [packId]);
  const free = mode === "free";
  const view = free ? freeView : pack.views[viewIndex] ?? pack.views[0];
  const viewKey = free ? FREE_PACK : `${pack.id}/${view.id}`;
  const labelMode: LabelMode = labelsHidden ? "hidden" : settings.labelNames ? "names" : "pins";
  // the step-by-step sequences are drawn on the breast they were planned on
  const breastLock = view.surgery ? `Nos passos da cirurgia a mama fica na forma em que a técnica foi planejada (${breastStateById.get(view.breast ?? "")?.label ?? "ptose grau II com hipertrofia moderada"}).` : undefined;
  // the pieces, vessels and sutures of the technique on screen can be shown or hidden like any structure
  const stepStructures = useMemo(() => (view.surgery ? stepStructuresOf(view.surgery.technique) : []), [view.surgery]);
  const modelPath = lowPower ? hybridTorsoModel.modelPath.replace(/\.glb$/, "-mobile.glb") : hybridTorsoModel.modelPath;
  const space = useMemo(() => surgicalSpaces.find((item) => item.id === dissection.space) ?? null, [dissection.space]);
  const entries = useMemo(() => viewAnnotations(view, space), [view, space]);
  const noteScope = free ? { packId: FREE_PACK, viewId: FREE_VIEW } : { packId: pack.id, viewId: view.id };
  const viewNotes = useMemo(() => notes.filter((note) => note.packId === noteScope.packId && note.viewId === noteScope.viewId), [notes, noteScope.packId, noteScope.viewId]);

  // opening a view applies its complete state (in the steps of a surgery, with the user's choices for the technique)
  useEffect(() => {
    const technique = view.surgery?.technique ?? null;
    const prefs = technique ? (stepPrefsRef.current?.technique === technique ? stepPrefsRef.current : { technique, overrides: {}, skin: "auto" as SkinMode }) : null;
    stepPrefsRef.current = prefs;
    setStepPrefs(prefs);
    setVisibility({ ...visibilityFor(view), ...(prefs?.overrides ?? {}) });
    setCut(cutFor(view));
    setDissection(dissectionFor(view));
    setFocus(null);
    setSelected(null);
    setSelectedPart(null);
    setSelectedLandmark(null);
    setAttachmentFocus(null);
    setActivePin(null);
    setNeuro(false);
    setUserTranslucent([]);
    setStudy((current) => ({ ...current, proximity: null }));
    setRulerPoints([]);
    setDraft(null);
    const pending = restore.current?.key === viewKey ? restore.current : null;
    restore.current = null;
    setArmPose(pending && !view.surgery ? pending.pose : view.pose ?? null);
    setBreast(pending && !view.surgery ? pending.breast : view.breast ?? null);
    // a note opened from the list: its pin is shown open
    if (pendingPin.current) setActivePin(pendingPin.current);
    pendingPin.current = null;
    // a structure asked for by the search: shown, selected and framed in the free mode
    const wanted = pendingSelect.current;
    pendingSelect.current = null;
    if (wanted) {
      setVisibility((current) => ({ ...current, [wanted]: true }));
      setSelected(wanted);
      setFocus({ structure: wanted, nonce: Date.now() });
    }
  }, [view, viewKey]);

  // "continue where I left off": the last guided view, with its shape and arm
  useEffect(() => {
    if (active && !free) recordVisit(pack.id, view.id, view.breast ?? null, view.pose ?? null);
  }, [active, free, pack.id, view.id, view.breast, view.pose]);
  useEffect(() => {
    if (active && !free) recordState(breast, armPose);
  }, [active, free, breast, armPose]);

  // a distance-map target is always shown
  useEffect(() => {
    const targets = study.proximity;
    if (targets?.length) setVisibility((current) => ({ ...current, ...Object.fromEntries(targets.map((id) => [id, true])) }));
  }, [study.proximity]);

  // ---- navigation ------------------------------------------------------------------------------------
  const openGuided = useCallback((id: string, index = 0, state?: { breast: string | null; pose: string | null }) => {
    const entry = allPacks.find((item) => item.pack.id === id);
    if (!entry) return;
    const safeIndex = Math.max(0, Math.min(entry.pack.views.length - 1, index));
    if (state) restore.current = { key: `${id}/${entry.pack.views[safeIndex].id}`, ...state };
    setModeState("guided");
    setPackId(id);
    setViewIndexState(safeIndex);
    setTool(null);
  }, []);
  const openFree = useCallback(
    (structure?: string | null) => {
      setTool(null);
      if (mode === "free") {
        if (structure) {
          setVisibility((current) => ({ ...current, [structure]: true }));
          setSelected(structure);
          setSelectedLandmark(null);
          setFocus({ structure, nonce: Date.now() });
        }
        return;
      }
      pendingSelect.current = structure ?? null;
      setModeState("free");
    },
    [mode],
  );
  const setMode = useCallback(
    (next: StudyMode) => {
      if (next === "free") openFree();
      else openGuided(packId, viewIndex);
    },
    [openFree, openGuided, packId, viewIndex],
  );
  const setViewIndex = useCallback((index: number) => setViewIndexState(Math.max(0, Math.min(pack.views.length - 1, index))), [pack.views.length]);
  const nextView = () => setViewIndex(viewIndex + 1);
  const prevView = () => setViewIndex(viewIndex - 1);

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
    if (compact) setTool(null);
  };
  const nextQuiz = () => setQuiz((current) => (current ? { ...current, targetId: nextQuizTarget(), guess: null, errorMm: null } : current));
  const stopQuiz = () => setQuiz(null);
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
    if (draft?.awaitingPoint) {
      if (info) setDraft({ ...draft, point: info.point, structure: structure ?? draft.structure, awaitingPoint: false });
      return;
    }
    if (study.ruler) {
      if (info) setRulerPoints((points) => (points.length >= 2 ? [info.point] : [...points, info.point]));
      return;
    }
    if (adjusting) {
      if (info) review.update(adjusting, { status: "ajustado", point: info.restPoint ?? info.point });
      setAdjusting(null);
      return;
    }
    setSelectedLandmark(null);
    if (!structure) {
      setSelected(null);
      setSelectedPart(null);
      return;
    }
    setLastPick(info?.point ?? null);
    const meshPart = info ? partByMesh.get(info.meshName) : undefined;
    setSelectedPart(meshPart?.id ?? null);
    setSelected(structure);
    setActivePin(null);
    if (attachmentFocus && attachmentsFor(structure).length) setAttachmentFocus(structure);
    if (!meshPart && info && regionByStructure.has(structure)) {
      loadLayerBuffers()
        .then((buffers) => {
          const lookup = regionLookup(structure, buffers);
          const label = lookup?.labelAt(...(info.restPoint ?? info.point));
          const part = lookup?.parts.find((item) => item.labelIndex === label);
          if (part) setSelectedPart(part.id);
        })
        .catch(() => undefined);
    }
  };
  const pickLandmark = (id: string, info?: PickInfo) => {
    if (quiz?.targetId && !quiz.guess) return;
    if (adjusting) {
      if (info) review.update(adjusting, { status: "ajustado", point: info.restPoint ?? info.point });
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
  };
  const pickAttachment = (item: LayerAttachment) => {
    setSelectedLandmark(null);
    setSelected(item.muscle);
    setSelectedPart(item.part);
  };
  const showAttachments = (structure: string | null) => {
    setAttachmentFocus(structure);
    if (!structure) return;
    const bones = new Set(attachmentsFor(structure).map((item) => item.boneStructure));
    setVisibility((current) => ({ ...current, ...Object.fromEntries([...bones].map((id) => [id, true])), [structure]: true }));
    setFocus({ structure, nonce: Date.now() });
  };
  const showSkeleton = () => {
    setVisibility(Object.fromEntries(modelStructures.map((item) => [item.id, skeleton.includes(item.id)])));
    setStudy((current) => ({ ...current, landmarks: true }));
    setDissection((current) => ({ ...current, layer: 0 }));
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
  const handlePoseSettled = useCallback((settled: string | null) => {
    setPoseSettled(settled);
    // a position that could not be loaded (offline before its first download) leaves the arm at rest
    if (!settled) setArmPose(null);
  }, []);
  /** arm position: the static trunk skin does not follow the movement, so it is hidden in surgical positions */
  const choosePose = (id: string | null) => {
    setArmPose(id);
    setRulerPoints([]);
    setQuiz(null);
    // back to the anatomical position: the skin returns if the current view shows it
    setVisibility((current) => ({ ...current, skin: id ? false : view.structures.includes("skin") }));
  };
  const handleBreastSettled = useCallback((settled: string | null) => {
    setBreastSettled(settled);
    // a state that could not be computed (chart not downloaded yet, offline) leaves the breast as scanned
    if (!settled) setBreast(null);
  }, []);
  /** breast shape: skin and breast structures are deformed together, so nothing has to be hidden */
  const chooseBreast = (id: string | null) => {
    if (breastLock) return;
    setBreast(id);
    setRulerPoints([]);
    setQuiz(null);
  };
  const rulerMm = rulerPoints.length === 2 ? Math.hypot(rulerPoints[0][0] - rulerPoints[1][0], rulerPoints[0][1] - rulerPoints[1][1], rulerPoints[0][2] - rulerPoints[1][2]) / mm : null;
  const quizTarget = quiz?.targetId ? landmarkById.get(quiz.targetId) : undefined;
  const openDetails = useCallback((structure: string) => {
    setSelectedLandmark(null);
    setSelected(structure);
    setActivePin(null);
  }, []);
  const handleSection = useCallback((report: SectionReport) => setSection(report), []);
  const toggleStructure = (id: string) => {
    // in the steps of a surgery the skin is the skin of the trunk and that of the steps together
    const ids = view.surgery && id === "skin" ? ["skin", `mamo-step-skin-${view.surgery.technique}`, `mamo-step-disc-${view.surgery.technique}`] : [id];
    const next = !visibility[id];
    const changes = Object.fromEntries(ids.map((item) => [item, next]));
    if (view.surgery) rememberStep(changes);
    setVisibility((current) => ({ ...current, ...changes }));
  };
  const chooseSkinMode = (skin: SkinMode) => rememberStep({}, skin);
  const isolate = (structure: string) => setVisibility(Object.fromEntries(modelStructures.map((item) => [item.id, item.id === structure])));
  const hideStructure = (structure: string) => {
    setVisibility((current) => ({ ...current, [structure]: false }));
    setSelected((current) => (current === structure ? null : current));
  };
  const toggleTranslucent = (structure: string) => setUserTranslucent((current) => (current.includes(structure) ? current.filter((id) => id !== structure) : [...current, structure]));
  const focusStructure = (structure: string) => setFocus({ structure, nonce: Date.now() });
  const showViewStructures = () => setVisibility(visibilityFor(view));
  const toggleNeuro = () => {
    // in the steps of a surgery, the vessels and nerves are those that follow the operation
    if (view.surgery) {
      const ids = [`mamo-step-arteries-${view.surgery.technique}`, `mamo-step-nerves-${view.surgery.technique}`];
      const next = !ids.every((id) => visibility[id]);
      const changes = Object.fromEntries(ids.map((id) => [id, next]));
      rememberStep(changes);
      setVisibility((current) => ({ ...current, ...changes }));
      setNeuro(next);
      return;
    }
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
  const startCut = () => {
    if (!cut.axis) setCut((current) => ({ ...current, axis: "transverse", absolute: null, position: 0.62 }));
  };
  const pickLegend = (entry: AnnotationEntry) => {
    if (labelsHidden) setLabelsHidden(false);
    setActivePin((current) => (current === entry.key ? null : entry.key));
  };
  const deselect = () => {
    setSelected(null);
    setSelectedPart(null);
    setSelectedLandmark(null);
  };

  // ---- layers (tool Camadas) -----------------------------------------------------------------------------
  // the structures of the surgical plans are listed only for the case of the view (none outside the plans)
  const viewCases = useMemo(() => new Set(view.structures.map(planCaseOf).filter((index) => index !== undefined)), [view.structures]);
  const allowed = useCallback(
    (id: string) => {
      if (view.surgery) return listedInSteps(id);
      const plan = planCaseOf(id);
      return plan === undefined || viewCases.has(plan);
    },
    [view.surgery, viewCases],
  );
  const setGroupShown = (groupName: string, on: boolean) => {
    const entry = layerGroups.find((item) => item.group === groupName);
    if (!entry) return;
    const ids = entry.ids.filter(allowed);
    const changes = Object.fromEntries(ids.map((id) => [id, on]));
    if (view.surgery) rememberStep(changes);
    setVisibility((current) => ({ ...current, ...changes }));
  };
  /** presets of the tool Camadas (the schematic layer stays as it is: it is shown by its own views) */
  const applyPreset = (preset: LayerPreset) => {
    const groups = new Set(presetGroups[preset]);
    const changes: Record<string, boolean> = {};
    for (const entry of layerGroups) {
      for (const id of entry.ids.filter(allowed)) {
        if (!schematicIds.has(id)) changes[id] = groups.has(entry.group);
      }
    }
    if (view.surgery) rememberStep(changes);
    setVisibility((current) => ({ ...current, ...changes }));
    setDissection((current) => ({ ...current, layer: 0 }));
  };
  const visibleCount = modelStructures.filter((item) => item.listed && !item.plan && visibility[item.id] && !hidden.has(item.id)).length;
  const listedCount = modelStructures.filter((item) => item.listed && !item.plan).length;

  // ---- notes -------------------------------------------------------------------------------------------
  const startNote = (options?: { onStructure?: boolean; note?: Note }) => {
    if (options?.note) {
      setDraft({ id: options.note.id, text: options.note.text, point: options.note.point, structure: options.note.structure, awaitingPoint: false });
    } else if (options?.onStructure && selected) {
      setDraft({ id: null, text: "", point: lastPick, structure: selected, awaitingPoint: !lastPick });
    } else {
      setDraft({ id: null, text: "", point: null, structure: null, awaitingPoint: true });
    }
    setTool("note");
  };
  const saveNote = () => {
    if (!draft || !draft.text.trim()) return;
    if (draft.id) updateNote(draft.id, { text: draft.text.trim(), point: draft.point });
    else addNote({ packId: noteScope.packId, viewId: noteScope.viewId, text: draft.text.trim(), point: draft.point, structure: draft.structure });
    setDraft(null);
    setTool(null);
  };
  const cancelNote = () => {
    setDraft(null);
    if (tool === "note") setTool(null);
  };
  const notePins: NotePin[] = useMemo(() => {
    const pins = viewNotes.filter((note) => note.point && note.id !== draft?.id).map((note) => ({ key: `note:${note.id}`, point: note.point!, text: note.text }));
    if (draft?.point) pins.push({ key: "note:draft", point: draft.point, text: draft.text.trim() || "Nova anotação" });
    return pins;
  }, [viewNotes, draft]);

  // ---- tools -------------------------------------------------------------------------------------------
  const openTool = (id: ToolId | null) => {
    const next = tool === id ? null : id;
    if (tool === "note" && next !== "note") setDraft(null);
    if (next === "note" && tool !== "note") {
      startNote();
      return;
    }
    if (next === "cut") startCut();
    setTool(next);
  };
  const toggleLabels = () => setLabelsHidden((value) => !value);
  /** opens the pin of a note (after the view it belongs to has been applied, when it changes) */
  const showNote = (key: string) => {
    pendingPin.current = key;
    setActivePin(key);
  };
  const resetCamera = () => setResetSignal((value) => value + 1);

  const renderViewer = (layout: "mobile" | "desktop", insets?: { top: number; bottom: number; right: number }, options?: { notes?: boolean; labels?: boolean }) =>
    lowPower === null ? null : (
      <AnatomyViewer
        view={view}
        viewKey={viewKey}
        caption={free ? "Modelo completo" : `${pack.title} · ${view.title}`}
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
        layout={layout}
        labelMode={options?.labels === false ? "hidden" : labelMode}
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
        pose={armPose}
        onPoseSettled={handlePoseSettled}
        breast={breast}
        onBreastSettled={handleBreastSettled}
        skinMode={view.surgery ? stepPrefs?.skin ?? "auto" : "auto"}
        onSkinMode={view.surgery ? chooseSkinMode : undefined}
        userTranslucent={userTranslucent}
        notePins={options?.notes === false ? [] : notePins}
        onOpenNote={(key) => {
          const note = viewNotes.find((item) => `note:${item.id}` === key);
          if (note) startNote({ note });
        }}
      />
    );

  return {
    // where
    mode,
    free,
    setMode,
    openGuided,
    openFree,
    group,
    pack,
    view,
    viewIndex,
    viewKey,
    setViewIndex,
    nextView,
    prevView,
    entries,
    space,
    // state
    lowPower,
    visibility,
    viewMode,
    setViewMode,
    cut,
    setCut,
    section,
    dissection,
    setDissection,
    selected,
    selectedPart,
    setSelectedPart,
    selectedLandmark,
    setSelectedLandmark,
    attachmentFocus,
    study,
    setStudy,
    labelMode,
    labelsHidden,
    activePin,
    setActivePin,
    neuro,
    armPose,
    poseSettled,
    breast,
    breastSettled,
    breastLock,
    rulerPoints,
    rulerMm,
    quiz,
    quizPool: quizPool.length,
    quizTarget,
    adjusting,
    setAdjusting,
    review,
    stepStructures,
    tool,
    userTranslucent,
    draft,
    setDraft,
    viewNotes,
    visibleCount,
    listedCount,
    // actions
    openTool,
    setTool,
    toggleLabels,
    showNote,
    resetCamera,
    toggleStructure,
    toggleNeuro,
    isolate,
    hideStructure,
    toggleTranslucent,
    focusStructure,
    showViewStructures,
    showAttachments,
    showSkeleton,
    exportReview,
    choosePose,
    chooseBreast,
    clearRuler: () => setRulerPoints([]),
    startQuiz,
    nextQuiz,
    stopQuiz,
    openDetails,
    pickLegend,
    deselect,
    allowed,
    setGroupShown,
    applyPreset,
    startNote,
    saveNote,
    cancelNote,
    setFocusPoint: (point: Landmark, structure: string) => setFocus({ structure, nonce: Date.now(), point }),
    renderViewer,
  };
}

export type ViewerController = ReturnType<typeof useViewerController>;
