"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ContactShadows, Html, Line, OrbitControls, useGLTF, useProgress } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { SurgicalStep } from "@/data/procedures";
import { hybridTorsoModel, modelLandmarks as L, modelMeshes, modelStructures, superficialStructures, tissueColors, tissueOpacity, type Landmark, type Tissue } from "@/lib/modelConfig";
import type { StructureVisibility, ViewMode } from "@/lib/viewerTypes";

type AnatomyViewerProps = {
  step: SurgicalStep;
  visibility: StructureVisibility;
  clippingEnabled: boolean;
  viewMode: ViewMode;
  resetSignal: number;
  modelPath: string;
};

const meshRecordByName = new Map(modelMeshes.map((mesh) => [mesh.name, mesh]));
const structureLabel = new Map(modelStructures.map((structure) => [structure.id, structure.label]));
const structureAnchor = new Map(modelStructures.map((structure) => [structure.id, structure.labelAnchor as Landmark]));
const mm = L.unitsPerMm;

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

/** gltfpack keeps the source node name on the parent of each quantised mesh. */
function recordFor(object: THREE.Object3D) {
  return meshRecordByName.get(object.name) ?? (object.parent ? meshRecordByName.get(object.parent.name) : undefined);
}

function tissueMaterial(tissue: Tissue, active: boolean, viewMode: ViewMode, clippingPlanes: THREE.Plane[]) {
  const color = new THREE.Color(tissueColors[tissue]);
  let opacity = tissueOpacity[tissue] ?? 1;
  const faded = viewMode === "surgical" && !active;
  if (faded) {
    opacity = Math.min(opacity, tissue === "skin" ? 0.12 : 0.22);
    color.lerp(new THREE.Color("#94a3b8"), 0.45);
  }
  const vascular = tissue === "artery" || tissue === "vein";
  const material = new THREE.MeshPhysicalMaterial({
    color,
    roughness: vascular ? 0.32 : tissue === "bone" ? 0.72 : tissue === "skin" ? 0.5 : 0.58,
    metalness: 0,
    clearcoat: vascular || tissue === "duct" ? 0.7 : tissue === "muscle" ? 0.15 : 0,
    clearcoatRoughness: 0.35,
    sheen: tissue === "skin" || tissue === "muscle" || tissue === "nerve" ? 0.45 : 0,
    sheenColor: new THREE.Color(tissue === "skin" ? "#ffd9c7" : "#ffffff"),
    sheenRoughness: 0.6,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 0.6,
    side: THREE.DoubleSide,
    clippingPlanes,
    clipShadows: true,
    emissive: viewMode === "surgical" && active ? color.clone().multiplyScalar(vascular || tissue === "nerve" ? 0.35 : 0.12) : new THREE.Color("#000000"),
  });
  return material;
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

type Snapper = (structureId: string, near: Landmark) => Landmark | undefined;

/** Builds a lookup that snaps a point to the nearest real vertex of a structure (model space). */
function buildSnapper(scene: THREE.Object3D): Snapper {
  scene.updateMatrixWorld(true);
  const toModel = scene.matrixWorld.clone().invert();
  const samples = new Map<string, Float32Array>();
  const collected = new Map<string, number[]>();
  const vertex = new THREE.Vector3();
  scene.traverse((object) => {
    if (!isMesh(object)) return;
    const record = recordFor(object);
    if (!record) return;
    const matrix = toModel.clone().multiply(object.matrixWorld);
    const position = object.geometry.attributes.position;
    const stride = Math.max(1, Math.floor(position.count / 4000));
    const list = collected.get(record.structure) ?? [];
    for (let i = 0; i < position.count; i += stride) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
      list.push(vertex.x, vertex.y, vertex.z);
    }
    collected.set(record.structure, list);
  });
  collected.forEach((list, id) => samples.set(id, new Float32Array(list)));
  return (structureId, near) => {
    const pts = samples.get(structureId);
    if (!pts) return undefined;
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      const d = (pts[i] - near[0]) ** 2 + (pts[i + 1] - near[1]) ** 2 + (pts[i + 2] - near[2]) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    return [pts[best], pts[best + 1], pts[best + 2]];
  };
}

function HybridModel({ modelPath, step, visibility, viewMode, stepPlane, sectionPlane, onReady }: Pick<AnatomyViewerProps, "modelPath" | "step" | "visibility" | "viewMode"> & { stepPlane: THREE.Plane | null; sectionPlane: THREE.Plane | null; onReady: (snap: Snapper) => void }) {
  const gltf = useGLTF(modelPath, false, true);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  useEffect(() => onReady(buildSnapper(scene)), [scene, onReady]);
  const activeStructures = useMemo(() => new Set(step.visibleStructures), [step.visibleStructures]);

  useEffect(() => {
    const cache = new Map<string, THREE.MeshPhysicalMaterial>();
    scene.traverse((object) => {
      if (!isMesh(object)) return;
      const record = recordFor(object);
      if (!record) {
        object.visible = false;
        return;
      }
      object.visible = Boolean(visibility[record.structure]);
      if (!object.visible) return;
      const active = activeStructures.has(record.structure);
      const planes: THREE.Plane[] = [];
      if (stepPlane && superficialStructures.has(record.structure)) planes.push(stepPlane);
      if (sectionPlane) planes.push(sectionPlane);
      const key = `${record.tissue}|${active}|${viewMode}|${planes.length}|${planes.includes(stepPlane as THREE.Plane)}`;
      let material = cache.get(key);
      if (!material) {
        material = tissueMaterial(record.tissue, active, viewMode, planes);
        cache.set(key, material);
      }
      object.material = material;
      object.renderOrder = material.transparent ? (record.tissue === "skin" ? 3 : 2) : 0;
      object.castShadow = !material.transparent;
      object.receiveShadow = true;
    });
    return () => cache.forEach((material) => material.dispose());
  }, [activeStructures, scene, viewMode, visibility, stepPlane, sectionPlane]);

  return <primitive object={scene} />;
}

// ---------------------------------------------------------------------------------------
// Didactic surgical guides. They are markings (incisions, pockets, drains) anchored to real
// anatomical landmarks computed from the model; no anatomical structure is drawn here.
// ---------------------------------------------------------------------------------------
const v3 = (p: Landmark) => new THREE.Vector3(...p);

function GuideLabel({ position, children, stack = 0 }: { position: Landmark; children: React.ReactNode; stack?: number }) {
  return (
    <Html position={position} className="pointer-events-none" zIndexRange={[20, 0]}>
      <div style={{ transform: `translate(${stack % 2 ? 12 : -12 - 8 * stack}px, ${-100 - stack * 70}%)` }} className="whitespace-nowrap rounded-xl border border-white/10 bg-slate-950/85 px-2 py-1 text-[10px] font-semibold leading-tight text-white shadow-xl backdrop-blur">{children}</div>
    </Html>
  );
}

function GuideLine({ points, color = "#a855f7", dashed = false, width = 3 }: { points: Landmark[]; color?: string; dashed?: boolean; width?: number }) {
  return <Line points={points} color={color} lineWidth={width} dashed={dashed} dashSize={0.04} gapSize={0.025} depthTest={false} transparent opacity={0.95} renderOrder={10} />;
}

function Ellipse({ center, normal, radii, color = "#a855f7", width = 3 }: { center: Landmark; normal: THREE.Vector3; radii: [number, number]; color?: string; width?: number }) {
  const points = useMemo(() => {
    const n = normal.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(up, n).normalize();
    const w = new THREE.Vector3().crossVectors(n, u).normalize();
    const c = v3(center);
    return Array.from({ length: 73 }, (_, i) => {
      const t = (i / 72) * Math.PI * 2;
      return c.clone().addScaledVector(u, Math.cos(t) * radii[0]).addScaledVector(w, Math.sin(t) * radii[1]).toArray() as Landmark;
    });
  }, [center, normal, radii]);
  return <GuideLine points={points} color={color} width={width} />;
}

function Volume({ center, radii, color, opacity = 0.28 }: { center: Landmark; radii: Landmark; color: string; opacity?: number }) {
  return (
    <mesh position={center} scale={radii} renderOrder={9}>
      <sphereGeometry args={[1, 48, 32]} />
      <meshPhysicalMaterial color={color} transparent opacity={opacity} depthWrite={false} roughness={0.2} clearcoat={0.8} />
    </mesh>
  );
}

function Marker({ position, color = "#f8fafc" }: { position: Landmark; color?: string }) {
  return (
    <mesh position={position} renderOrder={11}>
      <sphereGeometry args={[4 * mm, 16, 12]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  );
}

function SurgicalGuideOverlay({ step, snap }: { step: SurgicalStep; snap: Snapper | null }) {
  const preset = step.overlayPreset;
  const outward = useMemo(() => v3(L.skinPaddleCenter).sub(v3(L.latissimusCenter)).setY(0).normalize(), []);
  const breastNormal = useMemo(() => v3(L.nipple).sub(v3(L.breastCenter)).normalize(), []);
  const paddle = L.skinPaddleCenter;
  const paddleRadii: [number, number] = [95 * mm, 38 * mm];
  const offset = (p: Landmark, n: THREE.Vector3, d: number) => v3(p).addScaledVector(n, d).toArray() as Landmark;
  const breastRadii: Landmark = [
    (L.breastBounds.max[0] - L.breastBounds.min[0]) * 0.42,
    (L.breastBounds.max[1] - L.breastBounds.min[1]) * 0.4,
    (L.breastBounds.max[2] - L.breastBounds.min[2]) * 0.42,
  ];
  const showPaddle = ["skin-marking", "lateral-decubitus", "inferior-incision", "inferolateral-dissection", "upper-incision", "trapezius-plane", "islanded-flap", "deepithelialization"].includes(preset);
  const showPedicle = ["pedicle-anatomy", "pedicle-isolation", "islanded-flap", "axillary-tunnel", "anterior-flap", "muscle-coverage"].includes(preset);
  const showPocket = ["breast-pocket", "prepectoral-pocket", "sizer", "irrigation", "implant", "pocket-closure", "muscle-coverage"].includes(preset);
  const paddleTop = offset(paddle, new THREE.Vector3(0, 1, 0), paddleRadii[1]);
  const paddleBottom = offset(paddle, new THREE.Vector3(0, -1, 0), paddleRadii[1]);
  const along = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), outward).normalize();
  const incision = (p: Landmark): Landmark[] => [offset(p, along, -paddleRadii[0] * 1.15), offset(p, along, paddleRadii[0] * 1.15)];

  return (
    <group>
      {showPaddle && <Ellipse center={paddle} normal={outward} radii={paddleRadii} />}
      {preset === "skin-marking" && <GuideLabel position={paddleTop}>Ilha de pele sobre o grande dorsal</GuideLabel>}
      {preset === "inferior-incision" && <GuideLine points={incision(paddleBottom)} color="#e879f9" width={4} />}
      {preset === "upper-incision" && <GuideLine points={incision(paddleTop)} color="#e879f9" width={4} />}
      {preset === "trapezius-plane" && (
        <>
          <Marker position={L.trapeziusInferiorBorder} color="#22c55e" />
          <GuideLabel position={L.trapeziusInferiorBorder}>Borda inferior do trapézio</GuideLabel>
        </>
      )}
      {preset === "free-anterior-border" && (
        <>
          <GuideLine points={L.latissimusAnteriorBorder} color="#38bdf8" width={4} dashed />
          <GuideLabel position={L.latissimusAnteriorBorder[0]}>Borda anterior livre do GD</GuideLabel>
        </>
      )}
      {preset === "superior-limit" && (
        <>
          <GuideLine points={[L.scapulaInferiorAngle, L.thoracodorsalArteryOrigin]} color="#f59e0b" width={4} dashed />
          <Marker position={L.scapulaInferiorAngle} color="#f59e0b" />
          <GuideLabel position={L.scapulaInferiorAngle}>Ângulo inferior da escápula</GuideLabel>
        </>
      )}
      {["inferior-limit", "inferior-muscle-release"].includes(preset) && (
        <>
          <GuideLine points={[L.latissimusInferior, L.iliacCrestTop]} color="#a855f7" width={4} dashed />
          <Marker position={L.iliacCrestTop} color="#a855f7" />
          <GuideLabel position={L.iliacCrestTop}>Crista ilíaca / limite inferior</GuideLabel>
        </>
      )}
      {showPedicle && (
        <>
          <Marker position={L.thoracodorsalArteryOrigin} color="#fca5a5" />
        </>
      )}
      {preset === "axillary-tunnel" && <GuideLine points={[L.thoracodorsalArteryOrigin, L.axillaryArteryCenter, L.breastCenter]} color="#38bdf8" width={6} dashed />}
      {preset === "donor-closure" && <GuideLine points={incision(paddle)} color="#e2e8f0" width={4} />}
      {showPocket && <Volume center={L.breastCenter} radii={breastRadii} color="#f9a8d4" opacity={0.18} />}
      {preset === "sizer" && <Volume center={L.breastCenter} radii={breastRadii.map((r) => r * 0.82) as Landmark} color="#93c5fd" opacity={0.42} />}
      {preset === "irrigation" && <Volume center={L.breastCenter} radii={breastRadii.map((r) => r * 0.85) as Landmark} color="#bae6fd" opacity={0.3} />}
      {preset === "implant" && <Volume center={L.breastCenter} radii={breastRadii.map((r) => r * 0.85) as Landmark} color="#dbeafe" opacity={0.6} />}
      {["pocket-closure", "final-suture"].includes(preset) && <Ellipse center={offset(L.nipple, breastNormal, 2 * mm)} normal={breastNormal} radii={[breastRadii[0] * 0.9, breastRadii[1] * 0.9]} color="#f8fafc" />}
      {preset === "deepithelialization" && <Ellipse center={offset(L.nipple, breastNormal, 2 * mm)} normal={breastNormal} radii={[45 * mm, 22 * mm]} color="#fb7185" />}
      {preset === "drain" && <GuideLine points={[L.inframammaryFold, offset(L.inframammaryFold, new THREE.Vector3(-1, -0.6, 0).normalize(), 120 * mm)]} color="#dbeafe" width={5} />}
      {preset === "dressing" && <Ellipse center={offset(L.nipple, breastNormal, 6 * mm)} normal={breastNormal} radii={[breastRadii[0] * 1.05, breastRadii[1] * 1.05]} color="#e2e8f0" width={6} />}
      {step.annotations.map((item, index) => {
        const target = item.targetStructure;
        const anchor = target ? (item.position && snap ? snap(target, item.position) : undefined) ?? structureAnchor.get(target) : undefined;
        const position = anchor ?? item.position;
        if (!position) return null;
        return (
          <group key={item.id}>
            {anchor && <Marker position={anchor} color="#e2e8f0" />}
            <GuideLabel position={position} stack={index}>{item.label}</GuideLabel>
          </group>
        );
      })}
    </group>
  );
}

/**
 * The model's anterior faces +Z and the operative (right) side lies towards -X. Each orientation turns
 * the model so the relevant region faces the step camera (which sits on the +X/+Z side), and the orbit
 * target is anchored to a real landmark of that region.
 */
const orientationYaw: Record<SurgicalStep["orientation"], number> = {
  posterior: -2.47,
  posterolateral: 3.03,
  "lateral-position": 3.03,
  closure: 3.03,
  "axillary-closeup": 2.21,
  anterior: -0.15,
};

function framing(step: SurgicalStep) {
  const yaw = orientationYaw[step.orientation];
  const rotation: [number, number, number] = [0, yaw, 0];
  const anchor: Landmark =
    step.orientation === "anterior" ? L.breastCenter : step.orientation === "axillary-closeup" ? L.thoracodorsalArteryOrigin : L.latissimusCenter;
  const target = v3(anchor).applyEuler(new THREE.Euler(...rotation));
  const camera = step.camera ?? { position: [4, 3, 6] as Landmark, target: [0, 0.4, 0] as Landmark };
  const offset = v3(camera.position).sub(v3(camera.target)).multiplyScalar(1 / (camera.zoom ?? 1));
  return { rotation, cameraTarget: target.toArray() as Landmark, cameraPosition: target.clone().add(offset).toArray() as Landmark };
}

function LoadingModel() {
  const { progress } = useProgress();
  return (
    <Html center className="pointer-events-none">
      <div className="rounded-xl bg-slate-900/90 px-4 py-3 text-xs font-semibold text-white shadow-xl">Carregando modelo anatômico… {progress.toFixed(0)}%</div>
    </Html>
  );
}

export function AnatomyViewer({ step, visibility, clippingEnabled, viewMode, resetSignal, modelPath }: AnatomyViewerProps) {
  const activeLabels = step.visibleStructures.map((id) => structureLabel.get(id) ?? id);
  const { rotation: sceneRotation, cameraPosition, cameraTarget } = useMemo(() => framing(step), [step]);
  const stepPlane = useMemo(() => (step.clippingPlane?.enabled ? new THREE.Plane(new THREE.Vector3(...step.clippingPlane.normal).normalize(), step.clippingPlane.constant) : null), [step.clippingPlane]);
  // Manual section: sagittal plane through the nipple, keeping the medial half.
  const sectionPlane = useMemo(() => (clippingEnabled ? new THREE.Plane(new THREE.Vector3(1, 0, 0), -L.nipple[0]) : null), [clippingEnabled]);
  const shadowY = L.latissimusBounds.min[1] - 0.15;
  const [snap, setSnap] = useState<Snapper | null>(null);
  const handleReady = useCallback((snapper: Snapper) => setSnap(() => snapper), []);

  return (
    <div className="viewer-shell relative h-[620px] min-h-[520px] overflow-hidden rounded-3xl border border-slate-800 bg-[radial-gradient(circle_at_50%_35%,#1e293b,#020617_70%)]">
      <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2">
        <span className="rounded-full border border-pink-300/20 bg-pink-500/15 px-3 py-1 text-xs font-bold text-pink-100">{step.code}</span>
        <span className="rounded-full border border-sky-300/20 bg-sky-500/15 px-3 py-1 text-xs font-semibold text-sky-100">{step.patientPosition}</span>
      </div>
      <Canvas
        key={resetSignal}
        camera={{ position: cameraPosition, fov: 40, near: 0.05, far: 200 }}
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, localClippingEnabled: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      >
        <StudioEnvironment />
        <hemisphereLight args={["#f8fafc", "#1e293b", 0.35]} />
        <directionalLight position={[4, 6, 5]} intensity={2.1} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} />
        <directionalLight position={[-5, 3, -4]} intensity={0.9} color="#9cc7ff" />
        <directionalLight position={[0, -3, 4]} intensity={0.35} color="#ffd9c7" />
        <group rotation={sceneRotation}>
          <Suspense fallback={<LoadingModel />}>
            <HybridModel modelPath={modelPath} step={step} visibility={visibility} viewMode={viewMode} stepPlane={stepPlane} sectionPlane={sectionPlane} onReady={handleReady} />
          </Suspense>
          <SurgicalGuideOverlay step={step} snap={snap} />
        </group>
        <ContactShadows position={[0, shadowY, 0]} opacity={0.45} scale={9} blur={2.6} far={5} />
        <OrbitControls target={cameraTarget} makeDefault enableDamping />
      </Canvas>
      <div className="absolute bottom-4 left-4 right-4 rounded-2xl border border-white/10 bg-slate-950/75 p-3 text-xs text-slate-300 backdrop-blur">
        Modelo híbrido feminino · HRA/NIH (CC BY 4.0) · BodyParts3D/DBCLS · Z-Anatomy (CC BY-SA 4.0) · {(hybridTorsoModel.totalTriangles / 1e6).toFixed(1)} M triângulos · Etapa: {activeLabels.join(" • ")}
      </div>
    </div>
  );
}

useGLTF.preload(hybridTorsoModel.modelPath, false, true);
