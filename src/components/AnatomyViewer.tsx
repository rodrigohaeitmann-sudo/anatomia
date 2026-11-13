"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { ContactShadows, Html, OrbitControls, useProgress } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Play, Shirt } from "lucide-react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { PackView, ViewOrientation } from "@/data/packs";
import { surgicalSpaces } from "@/data/surgicalSpaces";
import { modelLandmarks as L, type Landmark } from "@/lib/modelConfig";
import { computeSection, sectionPlane, type SectionAxis, type SectionResult } from "@/lib/sectioning";
import { defaultStudy, hiddenByLayer, type CutState, type DissectionState, type PickInfo, type StructureVisibility, type StudyState, type ViewMode } from "@/lib/viewerTypes";
import { layerAttachments, layerFibres, layerLandmarks, partById, perforatorZones, regionByStructure, skinMarkings, type LayerAttachment, type Zone } from "@/lib/anatomyLayers";
import { manipulations as manipulationDefs } from "@/data/surgicalSpaces";
import { boneMatrices, posedLandmark } from "@/lib/armPoses";
import type { BreastSide } from "@/lib/breastMap";
import { breastLevel, breastStateAt, displacePoints, loadBreastSides, type BreastSideId } from "@/lib/breastStates";
import { stepArrows, stepFramesOf } from "@/lib/mammaplastySteps";
import { hiddenInSteps } from "@/lib/surgeryVisibility";
import { AttachmentAreas, FibreLines, LandmarkDots, PerforatorZones, QuizFeedback, RegionHighlight, Ruler, SkinMarkings, useLayerBuffers } from "./viewer/StudyLayers";
import { viewAnnotations, type AnnotationEntry, type LabelMode } from "@/lib/annotations";
import { annotationAnchors, PackOverlay, SelectionMarker, SpaceOverlay, type AnnotationProps } from "./viewer/Guides";
import { PinOverlay, PinProjector, type ProjectedPin } from "./viewer/PinOverlay";
import { HybridModel, type ModelHandle, type PlaneSet } from "./viewer/HybridModel";
import { SectionCaps } from "./viewer/SectionCaps";
import { isMesh, mm, resolvePoint, structureById, v3, wallColors } from "./viewer/shared";

export type SectionReport = { result: SectionResult; axis: SectionAxis; positionModel: number } | null;
/** Skin of the step-by-step views: as each view draws it, or always opaque or see-through (the user's choice). */
export type SkinMode = "auto" | "opaque" | "translucent";
type Motion = { technique: string; from: number; to: number; level: number; active: boolean; end: number };
export type FocusRequest = { structure: string; nonce: number; point?: Landmark } | null;
/** personal note pinned to a point of the model (drawn as a rose pin with a pen) */
export type NotePin = { key: string; point: Landmark; text: string };

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
  /** "mobile": compact pins and touch framing; "desktop": full labels. The canvas always fills its container. */
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
  /** step-by-step views: skin as drawn, or forced opaque or see-through; the toggle shows when onSkinMode is given */
  skinMode?: SkinMode;
  onSkinMode?: (mode: SkinMode) => void;
  /** structures the user made see-through (ficha: Transparência) */
  userTranslucent?: string[];
  /** the user's notes on this view */
  notePins?: NotePin[];
  onOpenNote?: (key: string) => void;
};

const POSE_MS = 950;
/** animation time per breast level (one ptosis grade), and its ceiling */
const BREAST_MS = 700;
const BREAST_MAX_MS = 1500;
/** animation time per key frame of a step-by-step sequence, and its ceiling */
const SURGERY_MS = 1500;
const SURGERY_MAX_MS = 4500;
const emptyAnchors = new Map<string, Landmark>();
const emptyNotes: NotePin[] = [];
const noteColor = "#8E5C68";
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
  // from in front and below the operated breast: the lower pole, the fold and the sutures of an inverted T
  inferior: { yaw: -0.15, offset: [-2.3, -2.3, 4.8] },
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

function CameraDirector({ position, target, signature, smooth = false }: { position: THREE.Vector3; target: THREE.Vector3; signature: string; smooth?: boolean }) {
  const { camera, controls, invalidate } = useThree();
  const placed = useRef(false);
  useEffect(() => {
    const orbit = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    // the first framing of a canvas is put at once; later ones glide when asked (steps of a surgery)
    if (!smooth || !orbit || !placed.current) {
      camera.position.copy(position);
      if (orbit) {
        orbit.target.copy(target);
        orbit.update();
      } else {
        camera.lookAt(target);
      }
      placed.current = Boolean(orbit);
      invalidate();
      return;
    }
    const fromPosition = camera.position.clone();
    const fromTarget = orbit.target.clone();
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      const k = ease(t);
      camera.position.lerpVectors(fromPosition, position, k);
      orbit.target.lerpVectors(fromTarget, target, k);
      orbit.update();
      invalidate();
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, controls]);
  return null;
}

/**
 * Arrows of the motion of a surgical step (src/data/mammaplastySteps.json): each grows from where a part was to where
 * it goes while its step plays, stays a moment once the step is over, then fades.
 */
function MotionArrows({ motion, technique }: { motion: MutableRefObject<Motion>; technique: string | null }) {
  const invalidate = useThree((state) => state.invalidate);
  const group = useMemo(() => {
    const root = new THREE.Group();
    for (const arrow of technique ? stepArrows(technique) : []) {
      const material = new THREE.MeshBasicMaterial({ color: arrow.color, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.9 * mm, 0.9 * mm, 1, 10), material);
      const head = new THREE.Mesh(new THREE.ConeGeometry(2.6 * mm, 7 * mm, 14), material);
      shaft.renderOrder = head.renderOrder = 20;
      const item = new THREE.Group();
      item.add(shaft, head);
      item.visible = false;
      item.userData = { frame: arrow.frame, shaft, head, material, from: v3(arrow.from), to: v3(arrow.to) };
      root.add(item);
    }
    return root;
  }, [technique]);
  useEffect(
    () => () =>
      group.traverse((object) => {
        if (!isMesh(object)) return;
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }),
    [group],
  );
  const scratch = useMemo(() => ({ up: new THREE.Vector3(0, 1, 0), dir: new THREE.Vector3(), turn: new THREE.Quaternion() }), []);
  useFrame(() => {
    const m = motion.current;
    const fade = m.active ? 1 : Math.max(0, 1 - (performance.now() - m.end - 700) / 900);
    group.visible = Boolean(technique) && m.technique === technique && m.to > m.from && fade > 0;
    if (!group.visible) return;
    for (const item of group.children) {
      const { frame, shaft, head, material, from, to } = item.userData as { frame: number; shaft: THREE.Mesh; head: THREE.Mesh; material: THREE.MeshBasicMaterial; from: THREE.Vector3; to: THREE.Vector3 };
      const grown = Math.min(1, Math.max(0, m.level - (frame - 1)));
      item.visible = frame > m.from && frame <= Math.ceil(m.to) && grown > 0.02;
      if (!item.visible) continue;
      const { up, dir, turn } = scratch;
      dir.subVectors(to, from);
      const length = dir.length() * grown;
      dir.normalize();
      turn.setFromUnitVectors(up, dir);
      const headLength = Math.min(7 * mm, length * 0.5);
      shaft.scale.set(1, Math.max(length - headLength, 1e-4), 1);
      shaft.quaternion.copy(turn);
      shaft.position.copy(from).addScaledVector(dir, (length - headLength) / 2);
      head.scale.setScalar(headLength / (7 * mm));
      head.quaternion.copy(turn);
      head.position.copy(from).addScaledVector(dir, length - headLength / 2);
      material.opacity = 0.9 * fade;
    }
    if (!m.active) invalidate();
  });
  return <primitive object={group} />;
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
      <div className="w-52 rounded-2xl border border-line bg-surface px-4 py-3 text-center text-[13px] font-semibold text-ink shadow-glass">
        Carregando o modelo… {progress.toFixed(0)}%
        <div className="mt-2 h-1 overflow-hidden rounded bg-line">
          <div className="h-full rounded bg-ink transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      </div>
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
  const { study = defaultStudy, selectedPart = null, selectedLandmark = null, attachmentFocus = null, review = {}, rulerPoints = [], quiz = null, onPickLandmark, onPickAttachment, pose = null, onPoseSettled, breast = null, onBreastSettled, skinMode = "auto", onSkinMode, userTranslucent, notePins = emptyNotes, onOpenNote } = props;
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
  // in the steps of a surgery, what keeps the breast as it was (and would stay where tissue is removed) is not shown
  const stepFrame = view.surgery?.frame ?? -1;
  const cutFrame = view.surgery ? stepFramesOf(view.surgery.technique).findIndex((item) => item.id === "resseccao") : -1;
  const inSteps = Boolean(view.surgery);
  const visible = useCallback(
    (id: string) => (Boolean(visibility[id]) || forced.has(id)) && !hidden.has(id) && !(inSteps && hiddenInSteps(id, stepFrame, cutFrame)),
    [visibility, hidden, forced, inSteps, stepFrame, cutFrame],
  );
  const highlight = useMemo(() => {
    const map = new Map<string, string>(Object.entries(view.tint ?? {}));
    space?.walls.forEach((wall, index) => wall.structures.forEach((id) => map.set(id, wallColors[index % wallColors.length])));
    return map;
  }, [space, view.tint]);
  const emphasised = useMemo(() => new Set([...(space?.contents ?? []), ...(view.focus ?? [])]), [space, view.focus]);
  const activeStructures = useMemo(() => new Set(view.focus ?? []), [view.focus]);
  const entries = useMemo(() => {
    const map = new Map<string, AnnotationEntry>(viewAnnotations(view, space).map((entry) => [entry.key, entry]));
    notePins.forEach((note) => map.set(note.key, { key: note.key, number: 0, text: note.text, color: noteColor, kind: "note" }));
    return map;
  }, [view, space, notePins]);
  // names are drawn by the DOM pins (pills): the 3D layer only keeps its markers and zone titles
  const annotations: AnnotationProps = useMemo(() => ({ entries, mode: labelMode === "names" ? "pins" : labelMode }), [entries, labelMode]);
  const anchors = useMemo(() => {
    const map = annotationAnchors(view, space, handle?.snap ?? null);
    if (labelMode === "hidden") map.clear();
    notePins.forEach((note) => map.set(note.key, note.point));
    return map;
  }, [view, space, handle, notePins, labelMode]);
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
  // the steps of one surgical technique seen from the same side share the camera: the tissue moves, the point of view
  // the user chose stays
  const cameraSignature = `${view.surgery ? `passos:${view.surgery.technique}:${view.orientation}` : viewKey}|${space?.id ?? ""}|${focus?.nonce ?? ""}|${resetSignal}`;

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
  const motion = useRef<Motion>({ technique: "", from: 0, to: 0, level: 0, active: false, end: 0 });
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
        await handle.setSkinHole(true, surgery.technique);
        if (!live()) return;
        // another technique starts at its frame; a replay starts where the view says
        let from = run.technique === surgery.technique && !surgery.instant ? run.level : surgery.frame;
        if (replaying) from = surgery.replayFrom ?? Math.max(0, surgery.frame - 1);
        run.technique = surgery.technique;
        const to = surgery.frame;
        const duration = Math.min(SURGERY_MAX_MS, SURGERY_MS * Math.abs(to - from));
        motion.current = { technique: surgery.technique, from, to, level: from, active: duration > 0, end: 0 };
        await new Promise<void>((resolve) => {
          const start = performance.now();
          const step = (now: number) => {
            if (!live()) return resolve();
            const k = duration ? Math.min(1, (now - start) / duration) : 1;
            run.level = from + (to - from) * ease(k);
            motion.current.level = run.level;
            handleRef.current?.setSurgeryLevel(run.level);
            if (k < 1) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        });
        motion.current.active = false;
        motion.current.end = performance.now();
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
  // the skin of a surgical step: as the view draws it, or as the user asked (opaque or see-through)
  const skinIds = useMemo(() => (view.surgery ? ["skin", `mamo-step-skin-${view.surgery.technique}`, `mamo-step-disc-${view.surgery.technique}`] : []), [view.surgery]);
  const translucent = useMemo(() => {
    const set = new Set([...(attachmentFocus ? [attachmentFocus] : []), ...(view.translucent ?? []), ...(userTranslucent ?? [])]);
    if (skinMode === "opaque") skinIds.forEach((id) => set.delete(id));
    if (skinMode === "translucent") skinIds.forEach((id) => set.add(id));
    return set;
  }, [attachmentFocus, view.translucent, skinMode, skinIds, userTranslucent]);
  const solid = useMemo(() => {
    const set = new Set(view.solid ?? []);
    if (skinMode === "opaque") skinIds.forEach((id) => set.add(id));
    if (skinMode === "translucent") skinIds.forEach((id) => set.delete(id));
    return set;
  }, [view.solid, skinMode, skinIds]);
  const skinOpaque = Boolean(view.surgery) && solid.has(`mamo-step-skin-${view.surgery?.technique}`);
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


  // light sand stage (MamaFlow Anatomia): the canvas fills the area its layout gives it
  const shellClass = "viewer-shell stage-bg absolute inset-0 overflow-hidden";

  return (
    <div ref={shellRef} className={shellClass}>
      <span className="sr-only">{caption}</span>
      {space && (
        <div className="pointer-events-none absolute left-3 z-10" style={{ top: (insets?.top ?? 0) + 12 }}>
          <span className="glass rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink shadow-glass">{space.label}</span>
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
        <hemisphereLight args={["#fffaf4", "#cdbba6", 0.4]} />
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
              fadeMs={view.surgery ? 650 : 0}
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
          <MotionArrows motion={motion} technique={view.surgery?.technique ?? null} />
          {space && !animating && <SpaceOverlay space={space} snap={handle?.snap ?? null} annotations={annotations} />}
          {selected && !animating && <SelectionMarker structure={selected} snap={handle?.snap ?? null} showName={!mobile && labelMode !== "hidden"} />}
        </group>
        {!lowPower && <ContactShadows position={[0, L.latissimusBounds.min[1] - 0.15, 0]} opacity={0.45} scale={9} blur={2.6} far={5} />}
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
        <CameraDirector position={frame.position} target={frame.target} signature={cameraSignature} smooth={Boolean(view.surgery)} />
        <CameraFollow shift={anchorShift} signature={cameraSignature} />
        <Invalidator deps={[cutModel, skinModel, rotationMatrix]} />
        {insets && <ViewInsets top={insets.top} bottom={insets.bottom} />}
        {anchors.size > 0 && <PinProjector anchors={animating ? emptyAnchors : anchors} rotation={frame.rotation} onProject={setPins} />}
      </Canvas>
      {anchors.size > 0 && (
        <PinOverlay
          pins={pins}
          entries={entries}
          activePin={activePin}
          onPin={onPin ?? (() => undefined)}
          onOpenDetails={onOpenDetails ?? ((structure) => onSelect(structure))}
          onOpenNote={onOpenNote}
          showNames={labelMode === "names"}
          compact={mobile}
          width={shellSize.width}
          height={shellSize.height}
          insets={insets ?? { top: 0, bottom: 0 }}
        />
      )}
      {surgery && (
        <div
          className={`glass absolute z-10 flex flex-wrap items-center gap-1.5 rounded-[18px] border border-line py-1 pl-3 pr-1 text-xs text-ink-2 shadow-glass ${mobile ? "left-3 max-w-[calc(100%-5.5rem)]" : "left-4 max-w-[60%]"}`}
          style={{ top: (insets?.top ?? 0) + (mobile ? 10 : 16) }}
        >
          <span className="mr-0.5 font-semibold text-ink">{surgery.caption ?? stepFramesOf(surgery.technique)[surgery.frame]?.label}</span>
          {onSkinMode && (
            <button
              type="button"
              onClick={() => onSkinMode(skinOpaque ? "translucent" : "opaque")}
              className="flex items-center gap-1 rounded-full bg-warm px-2.5 py-1 font-semibold text-ink transition active:bg-line"
              aria-label={skinOpaque ? "Deixar a pele transparente" : "Deixar a pele opaca"}
              aria-pressed={skinMode !== "auto"}
            >
              <Shirt size={12} /> {skinOpaque ? "Pele transparente" : "Pele opaca"}
            </button>
          )}
          {canReplay && (
            <button
              type="button"
              onClick={() => setReplay((value) => value + 1)}
              disabled={surgeryAnimating}
              className="flex items-center gap-1 rounded-full bg-rose-tint px-2.5 py-1 font-semibold text-rose-deep transition enabled:active:bg-rose-bg disabled:opacity-50"
              aria-label="Rever a animação deste passo"
            >
              <Play size={12} /> Rever
            </button>
          )}
        </div>
      )}
    </div>
  );
}

