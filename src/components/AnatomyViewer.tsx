"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContactShadows, Html, OrbitControls, useProgress } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { PackView, ViewOrientation } from "@/data/packs";
import { surgicalSpaces } from "@/data/surgicalSpaces";
import { hybridTorsoModel, modelLandmarks as L, type Landmark } from "@/lib/modelConfig";
import { computeSection, sectionPlane, type SectionAxis, type SectionResult } from "@/lib/sectioning";
import { hiddenByLayer, type CutState, type DissectionState, type StructureVisibility, type ViewMode } from "@/lib/viewerTypes";
import { PackOverlay, SelectionMarker, SpaceOverlay } from "./viewer/Guides";
import { HybridModel, type ModelHandle, type PlaneSet } from "./viewer/HybridModel";
import { SectionCaps } from "./viewer/SectionCaps";
import { isMesh, resolvePoint, structureById, v3, wallColors } from "./viewer/shared";

export type SectionReport = { result: SectionResult; axis: SectionAxis; positionModel: number } | null;
export type FocusRequest = { structure: string; nonce: number } | null;

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
  onSelect: (structure: string | null) => void;
  onSection: (report: SectionReport) => void;
};


/**
 * The model's anterior faces +Z and the operative (right) side lies towards -X. Each orientation turns
 * the model (yaw) so the region of interest faces a camera placed on the +X/+Z side.
 */
const orientations: Record<ViewOrientation, { yaw: number; offset: Landmark }> = {
  anterior: { yaw: -0.15, offset: [-3.6, 2.05, 4.2] },
  anterolateral: { yaw: 0.08, offset: [-3.6, 2.05, 4.2] },
  lateral: { yaw: 2.23, offset: [2.9, 1.7, 3.7] },
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

function Invalidator({ deps }: { deps: unknown[] }) {
  const invalidate = useThree((state) => state.invalidate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => invalidate(), deps);
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

export function AnatomyViewer({ view, viewKey, caption, visibility, viewMode, resetSignal, modelPath, lowPower, cut, dissection, selected, focus, onSelect, onSection }: AnatomyViewerProps) {
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
    const map = new Map<string, string>();
    space?.walls.forEach((wall, index) => wall.structures.forEach((id) => map.set(id, wallColors[index % wallColors.length])));
    return map;
  }, [space]);
  const emphasised = useMemo(() => new Set([...(space?.contents ?? []), ...(view.focus ?? [])]), [space, view.focus]);
  const activeStructures = useMemo(() => new Set(view.focus ?? []), [view.focus]);

  // ---- camera framing ---------------------------------------------------------------------------
  const orientation = view.orientation;
  const focusAnchor = focus ? (handle?.snap(focus.structure, structureById.get(focus.structure)?.labelAnchor ?? L.breastCenter) ?? structureById.get(focus.structure)?.labelAnchor) : undefined;
  const anchor = focusAnchor ?? (view.anchor ? resolvePoint(view.anchor) : undefined) ?? (space ? resolvePoint(space.centre) : undefined) ?? L.breastCenter;
  const frame = useMemo(() => framing(orientation, anchor, focusAnchor ? 0.55 : view.distance ?? (space ? 0.8 : 1)), [orientation, anchor, focusAnchor, view.distance, space]);
  const rotationMatrix = useMemo(() => new THREE.Matrix4().makeRotationFromEuler(frame.rotation), [frame.rotation]);
  const cameraSignature = `${viewKey}|${space?.id ?? ""}|${focus?.nonce ?? ""}|${resetSignal}`;

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


  return (
    <div className="viewer-shell relative h-[58dvh] min-h-[360px] overflow-hidden rounded-3xl border border-slate-800 bg-[radial-gradient(circle_at_50%_35%,#1e293b,#020617_70%)] sm:h-[620px]">
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-2">
        <span className="rounded-full border border-pink-300/20 bg-pink-500/15 px-3 py-1 text-xs font-bold text-pink-100">{caption}</span>
        {space && <span className="rounded-full border border-cyan-300/30 bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-100">{space.label}</span>}
      </div>
      <Canvas
        key={resetSignal}
        frameloop="demand"
        camera={{ position: frame.position.toArray(), fov: 40, near: 0.05, far: 200 }}
        shadows={!lowPower}
        dpr={lowPower ? [1, 1.5] : [1, 2]}
        gl={{ antialias: true, localClippingEnabled: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05, powerPreference: "high-performance" }}
        onPointerMissed={(event) => event.type === "click" && onSelect(null)}
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
              onReady={handleReady}
              onPick={onSelect}
            />
          </Suspense>
          <SectionCaps section={section} planeNormal={cutModel ? cutModel.plane.normal : null} selected={selected} />
          <PackOverlay view={view} snap={handle?.snap ?? null} />
          {space && <SpaceOverlay space={space} snap={handle?.snap ?? null} />}
          {selected && <SelectionMarker structure={selected} snap={handle?.snap ?? null} />}
        </group>
        {!lowPower && <ContactShadows position={[0, L.latissimusBounds.min[1] - 0.15, 0]} opacity={0.45} scale={9} blur={2.6} far={5} />}
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
        <CameraDirector position={frame.position} target={frame.target} signature={cameraSignature} />
        <Invalidator deps={[cutModel, skinModel, rotationMatrix]} />
      </Canvas>
      <div className="absolute bottom-3 left-3 right-3 rounded-2xl border border-white/10 bg-slate-950/75 p-2 text-[11px] text-slate-300 backdrop-blur sm:p-3 sm:text-xs">
        <span className="font-semibold text-slate-100">Toque em uma estrutura para ver a ficha.</span>
        <span className="hidden sm:inline"> · Modelo híbrido feminino · HRA/NIH · BodyParts3D/DBCLS · Z-Anatomy · {(hybridTorsoModel.totalTriangles / 1e6).toFixed(1)} M triângulos</span>
      </div>
    </div>
  );
}

