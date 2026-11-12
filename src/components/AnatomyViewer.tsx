"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContactShadows, Html, OrbitControls, useProgress } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Play } from "lucide-react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { PackView, ViewOrientation } from "@/data/packs";
import { surgicalSpaces } from "@/data/surgicalSpaces";
import { hybridTorsoModel, modelLandmarks as L, type Landmark } from "@/lib/modelConfig";
import { computeSection, sectionPlane, type SectionAxis, type SectionResult } from "@/lib/sectioning";
import { defaultStudy, hiddenByLayer, type CutState, type DissectionState, type PickInfo, type StructureVisibility, type StudyState, type ViewMode } from "@/lib/viewerTypes";
import { layerAttachments, layerFibres, layerLandmarks, partById, perforatorZones, regionByStructure, skinMarkings, type LayerAttachment, type Zone } from "@/lib/anatomyLayers";
import { manipulations as manipulationDefs } from "@/data/surgicalSpaces";
import { boneMatrices, posedLandmark } from "@/lib/armPoses";
import type { BreastSide } from "@/lib/breastMap";
import { breastLevel, breastStateAt, displacePoints, loadBreastSides, type BreastSideId } from "@/lib/breastStates";
import { stepFrameCount, stepFrames } from "@/lib/mammaplastySteps";
import { AttachmentAreas, FibreLines, LandmarkDots, PerforatorZones, QuizFeedback, RegionHighlight, Ruler, SkinMarkings, useLayerBuffers } from "./viewer/StudyLayers";
import { viewAnnotations, type LabelMode } from "@/lib/annotations";
import { annotationAnchors, PackOverlay, SelectionMarker, SpaceOverlay, type AnnotationProps } from "./viewer/Guides";
import { PinOverlay, PinProjector, type ProjectedPin } from "./viewer/PinOverlay";
import { HybridModel, type ModelHandle, type PlaneSet } from "./viewer/HybridModel";
import { SectionCaps } from "./viewer/SectionCaps";
import { isMesh, mm, resolvePoint, structureById, v3, wallColors } from "./viewer/shared";

export type SectionReport = { result: SectionResult; axis: SectionAxis; positionModel: number } | null;
export type FocusRequest = { structure: string; nonce: number; point?: Landmark } | null;

type AnatomyViewerProps = {
  view: PackView;
  viewKey: string;
  caption: string;
  visibility: StructureVisibility;
  viewMode: ViewMode;
  resetSignal: number;
  modelPath: string;
  lowPower: boolean;
  cut: CutState;
  dissection: DissectionState;
  selected: string | null;
  focus: FocusRequest;
  onSelect: (structure: string | null, info?: PickInfo) => void;
  /** opens the structure card (pins' "Ver ficha"); defaults to onSelect */
  onOpenDetails?: (structure: string) => void;
  onSection: (report: SectionReport) => void;
  /** "mobile": full-bleed canvas behind floating UI; "desktop": framed card with caption and credits */
  layout?: "desktop" | "mobile";
  labelMode?: LabelMode;
  activePin?: string | null;
  onPin?: (key: string | null) => void;
  /** screen area covered by floating UI (px), used to keep the model centred in what is visible */
  insets?: { top: number; bottom: number; right?: number };
  study?: StudyState;
  selectedPart?: string | null;
  selectedLandmark?: string | null;
  /** muscle whose attachment areas are on screen (drawn see-through) */
  attachmentFocus?: string | null;
  /** reviewed landmark status / corrected positions */
  review?: Record<string, { status: string; point?: Landmark } | undefined>;
  rulerPoints?: Landmark[];
  quiz?: { target: Landmark; name: string; guess: Landmark | null } | null;
  onPickLandmark?: (id: string, info?: PickInfo) => void;
  onPickAttachment?: (item: LayerAttachment) => void;
  /** upper-limb pose id (build_poses.py) or null for the anatomical position; changes are animated */
  pose?: string | null;
  onPoseSettled?: (pose: string | null) => void;
  /** breast state id (src/data/breastModel.json: ptosis grades) or null for the breast as scanned; changes are animated */
  breast?: string | null;
  onBreastSettled?: (state: string | null) => void;
};

const POSE_MS = 950;
/** animation time per breast level (one ptosis grade), and its ceiling */
const BREAST_MS = 700;
const BREAST_MAX_MS = 1500;
/** animation time per key frame of a step-by-step sequence, and its ceiling */
const SURGERY_MS = 1500;
const SURGERY_MAX_MS = 4500;
const emptyAnchors = new Map<string, Landmark>();
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);


/**
 * The model's anterior faces +Z and the operative (right) side lies towards -X. Each orientation turns
 * the model (yaw) so the region of interest faces a camera placed on the +X/+Z side.
 */
const orientations: Record<ViewOrientation, { yaw: number; offset: Landmark }> = {
  anterior: { yaw: -0.15, offset: [-3.6, 2.05, 4.2] },
  anterolateral: { yaw: 0.08, offset: [-3.6, 2.05, 4.2] },
  // in front of the operated breast, a little to its side, at the height of the nipple (shape and lower pole)
  frontal: { yaw: -0.15, offset: [-2.6, 0.45, 5.2] },
  lateral: { yaw: 2.23, offset: [2.9, 1.7, 3.7] },
  // true profile at eye level (the nipple is read against the inframammary fold: no looking down on it)
  profile: { yaw: 2.23, offset: [3.0, 0.15, 3.83] },
  axillary: { yaw: 2.21, offset: [2.2, 1.7, 3.0] },
  posterior: { yaw: -2.47, offset: [4.1, 2.2, 5.2] },
  posterolateral: { yaw: 3.03, offset: [4.1, 2.2, 5.2] },
};

function framing(orientation: ViewOrientation, anchor: Landmark, distanceScale = 1) {
  const preset = orientations[orientation];
  const rotation = new THREE.Euler(0, preset.yaw, 0);
  const target = v3(anchor).applyEuler(rotation);
  return { rotation, target, position: target.clone().add(v3(preset.offset).multiplyScalar(distanceScale)) };
}

function StudioEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;
    scene.environmentIntensity = 0.55;
    return () => {
      scene.environment = null;
      environment.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

function CameraDirector({ position, target, signature }: { position: THREE.Vector3; target: THREE.Vector3; signature: string }) {
  const { camera, controls, invalidate } = useThree();
  useEffect(() => {
    camera.position.copy(position);
    const orbit = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (orbit) {
      orbit.target.copy(target);
      orbit.update();
    } else {
      camera.lookAt(target);
    }
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, controls]);
  return null;
}

/**
 * Arm poses carry the view anchor with the deformed tissue: once a pose settles, camera and orbit target
 * glide by the anchor's displacement (world space), keeping the user's own orbit and zoom. A view change
 * (signature) resets the camera to the unshifted frame, so the glide restarts from zero.
 */
function CameraFollow({ shift, signature }: { shift: THREE.Vector3; signature: string }) {
  const { camera, controls, invalidate } = useThree();
  const applied = useRef(new THREE.Vector3());
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current !== signature) {
      lastSignature.current = signature;
      applied.current.set(0, 0, 0);
    }
    const start = applied.current.clone();
    const goal = shift.clone();
    if (start.distanceTo(goal) < 1e-6) return;
    const begin = performance.now();
    const next = new THREE.Vector3();
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - begin) / 550);
      next.lerpVectors(start, goal, ease(k));
      const delta = next.clone().sub(applied.current);
      camera.position.add(delta);
      const orbit = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
      if (orbit) {
        orbit.target.add(delta);
        orbit.update();
      }
      applied.current.copy(next);
      invalidate();
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift.x, shift.y, shift.z, signature, controls]);
  return null;
}

function Invalidator({ deps }: { deps: unknown[] }) {
  const invalidate = useThree((state) => state.invalidate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => invalidate(), deps);
  return null;
}

/**
 * Shifts the projection so the orbit target sits in the middle of the area left visible by the
 * floating UI (top bar, bottom sheet), keeping the on-screen scale unchanged. Animated.
 */
function ViewInsets({ top, bottom }: { top: number; bottom: number }) {
  const { camera, size, invalidate } = useThree();
  const current = useRef(0);
  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera & { manual?: boolean };
    perspective.manual = true;
    const baseFov = 40;
    const goal = Math.max(-size.height * 0.3, Math.min(size.height * 0.45, (bottom - top) / 2));
    const start = current.current;
    const begin = performance.now();
    let frame = 0;
    const apply = (delta: number) => {
      const fullHeight = size.height + 2 * Math.abs(delta);
      const offsetY = delta >= 0 ? 2 * delta : 0;
      perspective.aspect = size.width / fullHeight;
      perspective.fov = (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(baseFov / 2)) * (fullHeight / size.height)) * 180) / Math.PI;
      if (delta === 0) perspective.clearViewOffset();
      else perspective.setViewOffset(size.width, fullHeight, 0, offsetY, size.width, size.height);
      perspective.updateProjectionMatrix();
      invalidate();
    };
    const step = (now: number) => {
      const t = Math.min(1, (now - begin) / 260);
      const eased = 1 - Math.pow(1 - t, 3);
      current.current = start + (goal - start) * eased;
      apply(current.current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [camera, size.width, size.height, top, bottom, invalidate]);
  return null;
}

function LoadingModel() {
  const { progress } = useProgress();
  return (
    <Html center className="pointer-events-none">
      <div className="rounded-xl bg-slate-900/90 px-4 py-3 text-xs font-semibold text-white shadow-xl">Carregando modelo anatômico… {progress.toFixed(0)}%</div>
    </Html>
  );
}

/** Model-space extent along each axis, from the loaded geometry (rest pose). */
function modelExtent(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const toModel = root.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const meshBox = new THREE.Box3();
  root.traverse((object) => {
    if (!isMesh(object)) return;
    object.geometry.computeBoundingBox();
    meshBox.copy(object.geometry.boundingBox!).applyMatrix4(toModel.clone().multiply(object.matrixWorld));
    box.union(meshBox);
  });
  return box;
}

export function AnatomyViewer(props: AnatomyViewerProps) {
  const { view, viewKey, caption, visibility, viewMode, resetSignal, modelPath, lowPower, cut, dissection, selected, focus, onSelect, onOpenDetails, onSection, layout = "desktop", labelMode = "names", activePin = null, onPin, insets } = props;
  const { study = defaultStudy, selectedPart = null, selectedLandmark = null, attachmentFocus = null, review = {}, rulerPoints = [], quiz = null, onPickLandmark, onPickAttachment, pose = null, onPoseSettled, breast = null, onBreastSettled } = props;
  const mobile = layout === "mobile";
  const [handle, setHandle] = useState<ModelHandle | null>(null);
  const [extent, setExtent] = useState<THREE.Box3 | null>(null);
  const [section, setSection] = useState<SectionResult | null>(null);
  const space = useMemo(() => surgicalSpaces.find((item) => item.id === dissection.space) ?? null, [dissection.space]);

  // ---- visibility (toggles, dissection depth, space) -------------------------------------------
  const hidden = useMemo(() => {
    const set = hiddenByLayer(dissection.layer);
    space?.hide?.forEach((id) => set.add(id));
    return set;
  }, [dissection.layer, space]);
  const forced = useMemo(() => new Set(space ? [...space.walls.flatMap((wall) => wall.structures), ...space.contents] : []), [space]);
  const visible = useCallback((id: string) => (Boolean(visibility[id]) || forced.has(id)) && !hidden.has(id), [visibility, hidden, forced]);
  const highlight = useMemo(() => {
    const map = new Map<string, string>(Object.entries(view.tint ?? {}));
    space?.walls.forEach((wall, index) => wall.structures.forEach((id) => map.set(id, wallColors[index % wallColors.length])));
    return map;
  }, [space, view.tint]);
  const emphasised = useMemo(() => new Set([...(space?.contents ?? []), ...(view.focus ?? [])]), [space, view.focus]);
  const activeStructures = useMemo(() => new Set(view.focus ?? []), [view.focus]);
  const entries = useMemo(() => new Map(viewAnnotations(view, space).map((entry) => [entry.key, entry])), [view, space]);
  const annotations: AnnotationProps = useMemo(() => ({ entries, mode: labelMode }), [entries, labelMode]);
  const anchors = useMemo(() => annotationAnchors(view, space, handle?.snap ?? null), [view, space, handle]);
  const [pins, setPins] = useState<ProjectedPin[]>([]);
  const shellRef = useRef<HTMLDivElement>(null);
  const [shellSize, setShellSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!shellRef.current) return;
    const observer = new ResizeObserver(([entry]) => setShellSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(shellRef.current);
    return () => observer.disconnect();
  }, []);

  // ---- camera framing ---------------------------------------------------------------------------
  const orientation = view.orientation;
  const focusAnchor = focus ? (focus.point ?? handle?.snap(focus.structure, structureById.get(focus.structure)?.labelAnchor ?? L.breastCenter) ?? structureById.get(focus.structure)?.labelAnchor) : undefined;
  const anchor = focusAnchor ?? (view.anchor ? resolvePoint(view.anchor) : undefined) ?? (space ? resolvePoint(space.centre) : undefined) ?? L.breastCenter;
  // a step-by-step sequence shows the whole breast and the specimen beside it: phones (narrow canvas) step back
  const distance = (view.distance ?? (space ? 0.8 : 1)) * (mobile && view.surgery ? 1.45 : 1);
  const frame = useMemo(() => framing(orientation, anchor, focusAnchor ? 0.55 : distance), [orientation, anchor, focusAnchor, distance]);
  const rotationMatrix = useMemo(() => new THREE.Matrix4().makeRotationFromEuler(frame.rotation), [frame.rotation]);
  // the steps of one surgical technique share the camera: the tissue moves, the point of view the user chose stays
  const cameraSignature = `${view.surgery ? `passos:${view.surgery.technique}` : viewKey}|${space?.id ?? ""}|${focus?.nonce ?? ""}|${resetSignal}`;

  // ---- clipping planes (defined in model space, applied in world space) --------------------------
  const cutWorld = useRef(new THREE.Plane()).current;
  const skinWorld = useRef(new THREE.Plane()).current;
  const cutModel = useMemo(() => {
    if (!cut.axis || !extent) return null;
    const component = cut.axis === "transverse" ? "y" : cut.axis === "sagittal" ? "x" : "z";
    const position = cut.absolute ?? extent.min[component] + (extent.max[component] - extent.min[component]) * cut.position;
    return { plane: sectionPlane(cut.axis, position, cut.flip), position };
  }, [cut.axis, cut.position, cut.flip, cut.absolute, extent]);
  const skinModel = useMemo(() => {
    const midDepth = (L.nipple[2] + L.latissimusCenter[2]) / 2;
    if (dissection.skinWindow === "anterior") return new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, midDepth));
    if (dissection.skinWindow === "posterior") return new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, midDepth));
    if (dissection.skinWindow === "lateral") return new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(1, 0, 0), new THREE.Vector3(L.nipple[0], 0, 0));
    return null;
  }, [dissection.skinWindow]);

  if (cutModel) cutWorld.copy(cutModel.plane).applyMatrix4(rotationMatrix);
  if (skinModel) skinWorld.copy(skinModel).applyMatrix4(rotationMatrix);
  const planes: PlaneSet = useMemo(
    () => ({ cut: cutModel ? cutWorld : null, cutScope: cut.scope, skin: skinModel ? skinWorld : null, step: null }),
    // only rebuild materials when a plane is switched on/off, not when it moves
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Boolean(cutModel), cut.scope, Boolean(skinModel)],
  );

  // ---- study layers ------------------------------------------------------------------------------
  const displaced = useMemo(() => {
    const set = new Set<string>();
    for (const def of manipulationDefs) if ((dissection.manipulations[def.id] ?? 0) > 0) def.structures.forEach((id) => set.add(id));
    Object.entries(dissection.retracted).forEach(([id, amount]) => amount > 0 && set.add(id));
    return set;
  }, [dissection.manipulations, dissection.retracted]);
  // ---- arm pose: animate the morph targets, then let overlays follow the bones ----------------------
  const [settledPose, setSettledPose] = useState<string | null>(null);
  const [poseAnimating, setAnimating] = useState(false);
  const poseRun = useRef<{ id: string | null; t: number; token: number; root: THREE.Object3D | null }>({ id: null, t: 0, token: 0, root: null });
  const handleRef = useRef<ModelHandle | null>(null);
  useEffect(() => {
    if (!handle) return;
    handleRef.current = handle;
    const run = poseRun.current;
    // a model mounted anew (camera reset) is back in the anatomical position: the pose is put on again at once
    const fresh = run.root !== handle.root;
    if (fresh) {
      run.root = handle.root;
      run.id = null;
      run.t = 0;
    }
    if (run.id === pose && run.t === (pose ? 1 : 0)) return;
    // a new run supersedes any previous one (which stops at its next frame); it resumes from run.t
    const token = ++run.token;
    const live = () => run.token === token;
    const tween = (from: number, to: number) =>
      new Promise<void>((resolve) => {
        const start = performance.now();
        const step = (now: number) => {
          if (!live()) return resolve();
          const k = fresh ? 1 : Math.min(1, (now - start) / (POSE_MS * Math.abs(to - from) || 1));
          run.t = from + (to - from) * ease(k);
          handleRef.current?.setPoseFraction(run.t);
          if (k < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
    (async () => {
      setAnimating(true);
      try {
        if (run.id && run.id !== pose && run.t > 0) await tween(run.t, 0);
        if (!live()) return;
        if (pose) {
          await handleRef.current?.preparePose(pose);
          if (!live()) return;
          if (run.id !== pose) run.t = 0;
          run.id = pose;
          await tween(run.t, 1);
        } else {
          await handleRef.current?.preparePose(null);
          run.id = null;
          run.t = 0;
        }
      } catch {
        // pose data unavailable (offline before the first download): stay in the current position
      }
      if (!live()) return;
      setAnimating(false);
      const settled = run.t > 0 ? run.id : null;
      setSettledPose(settled);
      onPoseSettled?.(settled);
      handleRef.current?.refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose, handle]);
  useEffect(
    () => () => {
      poseRun.current.token += 1;
    },
    [],
  );
  // ---- breast state: animate the morph level, then let overlays follow the deformed skin ------------------
  const [settledBreast, setSettledBreast] = useState(0);
  const [breastAnimating, setBreastAnimating] = useState(false);
  const breastRun = useRef<{ level: number; token: number; root: THREE.Object3D | null }>({ level: 0, token: 0, root: null });
  useEffect(() => {
    if (!handle) return;
    handleRef.current = handle;
    const run = breastRun.current;
    const target = breastLevel(breast);
    const fresh = run.root !== handle.root;
    if (fresh) {
      run.root = handle.root;
      run.level = 0;
    }
    if (run.level === target) return;
    const token = ++run.token;
    const live = () => run.token === token;
    (async () => {
      setBreastAnimating(true);
      try {
        await handle.prepareBreast();
        if (!live()) return;
        const from = run.level;
        // the step-by-step sequences are drawn on one breast state: it is put on at once
        const duration = fresh || view.surgery ? 0 : Math.min(BREAST_MAX_MS, BREAST_MS * Math.abs(target - from));
        await new Promise<void>((resolve) => {
          const start = performance.now();
          const step = (now: number) => {
            if (!live()) return resolve();
            const k = duration ? Math.min(1, (now - start) / duration) : 1;
            run.level = from + (target - from) * ease(k);
            handleRef.current?.setBreastLevel(run.level);
            if (k < 1) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        });
      } catch {
        // chart unavailable (offline before the first download): the breast stays as it is
      }
      if (!live()) return;
      setBreastAnimating(false);
      setSettledBreast(run.level);
      onBreastSettled?.(breastStateAt(run.level)?.id ?? null);
      handleRef.current?.refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breast, handle]);
  useEffect(
    () => () => {
      breastRun.current.token += 1;
    },
    [],
  );
  // ---- step-by-step sequence (reduction mammaplasty): animate the key frame, on the breast it was planned on ---
  const surgery = view.surgery ?? null;
  const [surgeryAnimating, setSurgeryAnimating] = useState(false);
  const [replay, setReplay] = useState(0);
  const surgeryRun = useRef<{ technique: string | null; level: number; goal: string; token: number; root: THREE.Object3D | null; replay: number }>({ technique: null, level: 0, goal: "", token: 0, root: null, replay: 0 });
  useEffect(() => {
    if (!handle) return;
    handleRef.current = handle;
    const run = surgeryRun.current;
    if (run.root !== handle.root) {
      // a model mounted anew has no sequence on: it is put on again at once
      run.root = handle.root;
      run.technique = null;
      run.level = 0;
      run.goal = "";
    }
    if (!surgery) {
      if (run.goal) {
        run.token += 1;
        run.goal = "";
        setSurgeryAnimating(false);
      }
      void handle.setSkinHole(false);
      return;
    }
    const replaying = replay !== run.replay;
    run.replay = replay;
    const goal = `${surgery.technique}:${surgery.frame}`;
    // already there, or on the way
    if (!replaying && run.goal === goal) return;
    run.goal = goal;
    const token = ++run.token;
    const live = () => run.token === token;
    (async () => {
      setSurgeryAnimating(true);
      try {
        await handle.prepareBreast();
        if (!live()) return;
        await handle.prepareSurgery(surgery.technique);
        if (!live()) return;
        await handle.setSkinHole(true);
        if (!live()) return;
        // another technique starts at its frame; a replay starts where the view says
        let from = run.technique === surgery.technique && !surgery.instant ? run.level : surgery.frame;
        if (replaying) from = surgery.replayFrom ?? Math.max(0, surgery.frame - 1);
        run.technique = surgery.technique;
        const to = surgery.frame;
        const duration = Math.min(SURGERY_MAX_MS, SURGERY_MS * Math.abs(to - from));
        await new Promise<void>((resolve) => {
          const start = performance.now();
          const step = (now: number) => {
            if (!live()) return resolve();
            const k = duration ? Math.min(1, (now - start) / duration) : 1;
            run.level = from + (to - from) * ease(k);
            handleRef.current?.setSurgeryLevel(run.level);
            if (k < 1) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        });
      } catch {
        // steps not downloaded (offline before the first visit): try again with the next change
        run.goal = "";
      }
      if (!live()) return;
      setSurgeryAnimating(false);
      handleRef.current?.refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surgery?.technique, surgery?.frame, replay, handle]);
  useEffect(
    () => () => {
      surgeryRun.current.token += 1;
    },
    [],
  );
  const canReplay = Boolean(surgery && surgery.replayFrom !== null && surgery.frame > 0);
  const animating = poseAnimating || breastAnimating || surgeryAnimating;
  // the chart itself, to carry loose overlay points (skin markings, perforator zones) with the breast
  const [breastSides, setBreastSides] = useState<Record<BreastSideId, BreastSide> | null>(null);
  useEffect(() => {
    if (settledBreast <= 0 || breastSides) return;
    let alive = true;
    loadBreastSides()
      .then((sides) => alive && setBreastSides(sides))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [settledBreast, breastSides]);
  const mats = useMemo(() => boneMatrices(settledPose, 1), [settledPose]);
  const anchorShift = useMemo(() => {
    const shift = new THREE.Vector3();
    if ((!settledPose && settledBreast <= 0) || animating || focusAnchor || !handle || view.follow === false) return shift;
    const moved = handle.snap.follow(anchor);
    return shift.set(moved[0] - anchor[0], moved[1] - anchor[1], moved[2] - anchor[2]).applyEuler(frame.rotation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledPose, settledBreast, animating, Boolean(focusAnchor), handle, anchor[0], anchor[1], anchor[2], frame.rotation, view.follow]);

  const landmarkItems = useMemo(() => {
    if (animating) return [];
    const items = layerLandmarks.filter((item) => (study.landmarks && visible(item.structure) && !displaced.has(item.structure)) || item.id === selectedLandmark);
    return items.map((item) => {
      const rest = (review[item.id]?.point ?? item.point) as [number, number, number];
      return { ...item, point: settledPose ? posedLandmark(item.id, rest, mats, settledPose) : rest };
    });
  }, [study.landmarks, visible, displaced, selectedLandmark, review, settledPose, mats, animating]);
  const attachmentItems = useMemo(() => {
    const muscle = attachmentFocus ?? null;
    return layerAttachments.filter((item) => {
      if (displaced.has(item.muscle) || displaced.has(item.boneStructure) || !visible(item.boneStructure)) return false;
      if (study.attachments === "all") return true;
      return item.muscle === muscle && (!selectedPart || !item.part || item.part === selectedPart);
    });
  }, [study.attachments, attachmentFocus, selectedPart, visible, displaced]);
  const fibreItems = useMemo(() => {
    if (study.fibres === "off") return [];
    return layerFibres.filter((item) => {
      if (!visible(item.structure) || displaced.has(item.structure)) return false;
      if (study.fibres === "all") return true;
      if (item.structure !== selected) return false;
      return !selectedPart || !item.part || item.part === selectedPart;
    });
  }, [study.fibres, selected, selectedPart, visible, displaced]);
  const selectedRegion = useMemo(() => {
    if (!selectedPart) return null;
    const structure = selectedPart.split("#")[0];
    const region = regionByStructure.get(structure)?.parts.find((part) => part.id === selectedPart);
    return region ? { structure, labelIndex: region.labelIndex } : null;
  }, [selectedPart]);
  const selectedMeshes = useMemo(() => {
    const part = selectedPart ? partById.get(selectedPart) : undefined;
    const names = part && "meshNames" in part ? (part as { meshNames: string[] }).meshNames : [];
    return names.length ? new Set(names) : null;
  }, [selectedPart]);
  const translucent = useMemo(() => new Set([...(attachmentFocus ? [attachmentFocus] : []), ...(view.translucent ?? [])]), [attachmentFocus, view.translucent]);
  const solid = useMemo(() => new Set(view.solid ?? []), [view.solid]);
  // skin markings and perforator zones are drawn on the trunk skin, which does not follow the arm (anatomical
  // position only) but does carry the breast: in a breast state their points go through the same map
  const overSkin = !settledPose && !animating && (settledBreast <= 0 || Boolean(breastSides));
  const zones = useMemo(() => {
    if (!overSkin) return [];
    const shown = perforatorZones.filter((zone) => study.zones.includes(zone.id));
    if (settledBreast <= 0 || !breastSides) return shown;
    const move = (strip: Zone["strip"]) => ({ left: displacePoints(breastSides, strip.left, settledBreast), right: displacePoints(breastSides, strip.right, settledBreast) });
    return shown.map((zone) => ({ ...zone, strip: move(zone.strip), emphasis: zone.emphasis ? move(zone.emphasis) : zone.emphasis }));
  }, [study.zones, overSkin, settledBreast, breastSides]);
  const markings = useMemo(() => {
    if (!overSkin || !study.markings) return [];
    if (settledBreast <= 0 || !breastSides) return skinMarkings;
    return skinMarkings.map((item) => ({ ...item, points: displacePoints(breastSides, item.points, settledBreast) }));
  }, [study.markings, overSkin, settledBreast, breastSides]);
  const buffers = useLayerBuffers(attachmentItems.length > 0 || fibreItems.length > 0 || Boolean(selectedRegion));
  const reviewStatus = useMemo(() => Object.fromEntries(Object.entries(review).map(([id, entry]) => [id, entry?.status])), [review]);

  const handleReady = useCallback((next: ModelHandle) => {
    setHandle(next);
    setExtent((current) => current ?? modelExtent(next.root));
  }, []);

  // ---- cross-section (debounced CPU slicing) -----------------------------------------------------
  useEffect(() => {
    if (!cutModel || !handle || !cut.axis) {
      setSection(null);
      onSection(null);
      return;
    }
    const axis = cut.axis;
    const timer = window.setTimeout(() => {
      const result = computeSection(handle.sliceTargets(), axis, cutModel.plane);
      setSection(result);
      onSection({ result, axis, positionModel: cutModel.position });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [cutModel, handle, cut.axis, onSection]);


  const shellClass = mobile
    ? "viewer-shell absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_50%_40%,#1e293b,#020617_72%)]"
    : "viewer-shell relative h-[58dvh] min-h-[360px] overflow-hidden rounded-3xl border border-slate-800 bg-[radial-gradient(circle_at_50%_35%,#1e293b,#020617_70%)] sm:h-[620px]";

  return (
    <div ref={shellRef} className={shellClass}>
      {!mobile && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-2">
          <span className="rounded-full border border-pink-300/20 bg-pink-500/15 px-3 py-1 text-xs font-bold text-pink-100">{caption}</span>
          {space && <span className="rounded-full border border-cyan-300/30 bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-100">{space.label}</span>}
        </div>
      )}
      <Canvas
        key={resetSignal}
        frameloop="demand"
        camera={{ position: frame.position.toArray(), fov: 40, near: 0.05, far: 200 }}
        shadows={!lowPower}
        dpr={lowPower ? [1, 1.5] : [1, 2]}
        gl={{ antialias: true, localClippingEnabled: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05, powerPreference: "high-performance" }}
        onPointerMissed={(event) => {
          if (event.type !== "click") return;
          onSelect(null);
          onPin?.(null);
        }}
      >
        <StudioEnvironment />
        <hemisphereLight args={["#f8fafc", "#1e293b", 0.35]} />
        <directionalLight position={[4, 6, 5]} intensity={2.1} castShadow={!lowPower} shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} />
        <directionalLight position={[-5, 3, -4]} intensity={0.9} color="#9cc7ff" />
        <directionalLight position={[0, -3, 4]} intensity={0.35} color="#ffd9c7" />
        <group rotation={frame.rotation}>
          <Suspense fallback={<LoadingModel />}>
            <HybridModel
              modelPath={modelPath}
              visible={visible}
              activeStructures={activeStructures}
              viewMode={viewMode}
              planes={planes}
              selected={selected}
              highlight={highlight}
              emphasised={emphasised}
              manipulation={dissection.manipulations}
              retracted={dissection.retracted}
              lowPower={lowPower}
              selectedMeshes={selectedMeshes}
              translucent={translucent}
              solid={solid}
              proximity={study.proximity}
              onReady={handleReady}
              onPick={(structure, info) => {
                // a tap within 9 mm of a shown landmark picks the landmark (rulers and quizzes still get the point)
                if (info && onPickLandmark && study.landmarks && !quiz) {
                  let best: string | null = null;
                  let bestMm = 9;
                  for (const item of landmarkItems) {
                    const d = Math.hypot(item.point[0] - info.point[0], item.point[1] - info.point[1], item.point[2] - info.point[2]) / mm;
                    if (d < bestMm) {
                      bestMm = d;
                      best = item.id;
                    }
                  }
                  if (best) {
                    onPickLandmark(best, info);
                    return;
                  }
                }
                onSelect(structure, info);
              }}
            />
          </Suspense>
          {landmarkItems.length > 0 && <LandmarkDots items={landmarkItems} selected={selectedLandmark} review={reviewStatus} showNames={labelMode !== "hidden" || Boolean(selectedLandmark)} />}
          {attachmentItems.length > 0 && !animating && (
            <AttachmentAreas items={attachmentItems} buffers={buffers} planes={cutModel && cut.scope === "all" ? [cutWorld] : []} mats={settledPose ? mats : null} onPick={(item) => onPickAttachment?.(item)} />
          )}
          {fibreItems.length > 0 && !animating && <FibreLines items={fibreItems} buffers={buffers} pose={settledPose} />}
          {selectedRegion && !animating && <RegionHighlight key={settledPose ?? "rest"} root={handle?.root ?? null} structure={selectedRegion.structure} labelIndex={selectedRegion.labelIndex} buffers={buffers} />}
          {markings.length > 0 && <SkinMarkings markings={markings} showLabels={labelMode !== "hidden"} />}
          {zones.length > 0 && <PerforatorZones zones={zones} />}
          {study.ruler && <Ruler points={rulerPoints} />}
          {quiz && <QuizFeedback target={quiz.target} guess={quiz.guess} name={quiz.name} />}
          <SectionCaps section={section} planeNormal={cutModel ? cutModel.plane.normal : null} selected={selected} />
          {!animating && <PackOverlay view={view} snap={handle?.snap ?? null} annotations={annotations} />}
          {space && !animating && <SpaceOverlay space={space} snap={handle?.snap ?? null} annotations={annotations} />}
          {selected && !animating && <SelectionMarker structure={selected} snap={handle?.snap ?? null} showName={!mobile && labelMode !== "hidden"} />}
        </group>
        {!lowPower && <ContactShadows position={[0, L.latissimusBounds.min[1] - 0.15, 0]} opacity={0.45} scale={9} blur={2.6} far={5} />}
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
        <CameraDirector position={frame.position} target={frame.target} signature={cameraSignature} />
        <CameraFollow shift={anchorShift} signature={cameraSignature} />
        <Invalidator deps={[cutModel, skinModel, rotationMatrix]} />
        {insets && <ViewInsets top={insets.top} bottom={insets.bottom} />}
        {labelMode === "pins" && <PinProjector anchors={animating ? emptyAnchors : anchors} rotation={frame.rotation} onProject={setPins} />}
      </Canvas>
      {labelMode === "pins" && (
        <PinOverlay
          pins={pins}
          entries={entries}
          activePin={activePin}
          onPin={onPin ?? (() => undefined)}
          onOpenDetails={onOpenDetails ?? ((structure) => onSelect(structure))}
          width={shellSize.width}
          height={shellSize.height}
          insets={insets ?? { top: 0, bottom: 0 }}
        />
      )}
      {surgery && (
        <div
          className={`absolute z-10 flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/80 py-1 pl-3 pr-1 text-xs text-slate-200 shadow-lg backdrop-blur ${mobile ? "left-3" : "right-3 top-3"}`}
          style={mobile ? { top: (insets?.top ?? 0) + 10 } : undefined}
        >
          <span>
            Passo {surgery.frame + 1}/{stepFrameCount} · <span className="font-semibold text-white">{stepFrames[surgery.frame]?.label}</span>
          </span>
          {canReplay && (
            <button
              type="button"
              onClick={() => setReplay((value) => value + 1)}
              disabled={surgeryAnimating}
              className="flex items-center gap-1 rounded-full bg-pink-500/25 px-2.5 py-1 font-semibold text-pink-100 transition enabled:active:bg-pink-500/40 disabled:opacity-50"
              aria-label="Rever a animação deste passo"
            >
              <Play size={12} /> Rever
            </button>
          )}
        </div>
      )}
      {!mobile && (
        <div className="absolute bottom-3 left-3 right-3 rounded-2xl border border-white/10 bg-slate-950/75 p-2 text-[11px] text-slate-300 backdrop-blur sm:p-3 sm:text-xs">
          <span className="font-semibold text-slate-100">Toque em uma estrutura para ver a ficha.</span>
          <span className="hidden sm:inline"> · Modelo híbrido feminino · HRA/NIH · BodyParts3D/DBCLS · Z-Anatomy · {(hybridTorsoModel.totalTriangles / 1e6).toFixed(1)} M triângulos</span>
        </div>
      )}
    </div>
  );
}

