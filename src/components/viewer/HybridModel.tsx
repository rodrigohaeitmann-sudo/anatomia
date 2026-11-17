"use client";

import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { manipulations as manipulationDefs } from "@/data/surgicalSpaces";
import { deltaUnit, influencesAt, loadPose, variantOf } from "@/lib/armPoses";
import { buildSchematicMeshes, loadPlan, planPieceMeshes, schematicMeshNames, sheetVertices, tubeClearance, tubeFollow, tubeVertices, type SheetSpec, type TubeSpec } from "@/lib/breastAnatomy";
import { breastDisplacements, breastMeasurements, breastMeshSides, breastSkinMesh, breastStates, loadBreastSides, type BreastSideId } from "@/lib/breastStates";
import { applyCaps, applySurfaceLook, restAttributes, skinUniforms, type SurfaceLook } from "@/lib/skinShader";
import { loadSteps, stepFramesOf, stepHoleOf } from "@/lib/mammaplastySteps";
import { refineEdges } from "@/lib/subdivide";
import { tissueColors, tissueOpacity, type Tissue } from "@/lib/modelConfig";
import type { SliceTarget } from "@/lib/sectioning";
import type { PickInfo, ViewMode } from "@/lib/viewerTypes";
import { buildSnapper, isMesh, mm, namedNode, recordFor, resolvePoint, type Snapper } from "./shared";

export type ModelHandle = {
  snap: Snapper;
  /** meshes currently clipped by the section plane (for caps / 2D view) */
  sliceTargets: () => SliceTarget[];
  root: THREE.Object3D;
  /** loads an arm pose and attaches its keyframes as morph targets (null removes them) */
  preparePose: (poseId: string | null) => Promise<void>;
  /** 0 = anatomical position, 1 = the prepared pose (piecewise between keyframes) */
  setPoseFraction: (t: number) => void;
  /** computes the breast states (ptosis grades) and attaches them as morph targets to skin and breast */
  prepareBreast: () => Promise<void>;
  /** 0 = breast as scanned, k = k-th breast state; fractions blend neighbouring states */
  setBreastLevel: (level: number) => void;
  /**
   * downloads the pieces (pedicles, resections) of surgical plans, by index in planCases.ts, and gives them the breast
   * states; resolves to true when this scene has pieces of those plans (the anchors have to include them: refresh)
   */
  preparePlans: (indexes: number[]) => Promise<boolean>;
  /** fills the step-by-step meshes of a technique (src/lib/mammaplastySteps.ts) and attaches their key frames as morph targets */
  prepareSurgery: (technique: string) => Promise<void>;
  /** 0 = marking, k = k-th key frame of the prepared technique; fractions blend neighbouring frames */
  setSurgeryLevel: (level: number) => void;
  /** opens the trunk skin over the operated breast, where the skin of the step-by-step sequence takes its place (after prepareBreast) */
  /** cut the patch of the open step sequence (or of `technique`) out of the trunk skin, or close it again */
  setSkinHole: (on: boolean, technique?: string) => Promise<void>;
  /** rebuilds anchors (snapper) and section targets after the geometry moved */
  refresh: () => void;
};

/** Area-weighted vertex normals of an indexed triangle list (local space). */
function vertexNormals(positions: Float32Array, index: ArrayLike<number> | null, count: number) {
  const normals = new Float32Array(count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const total = index ? index.length : count;
  for (let f = 0; f < total; f += 3) {
    const i0 = index ? index[f] : f, i1 = index ? index[f + 1] : f + 1, i2 = index ? index[f + 2] : f + 2;
    a.fromArray(positions, i0 * 3);
    b.fromArray(positions, i1 * 3);
    c.fromArray(positions, i2 * 3);
    n.subVectors(c, b).cross(a.sub(b));
    for (const i of [i0, i1, i2]) {
      normals[i * 3] += n.x;
      normals[i * 3 + 1] += n.y;
      normals[i * 3 + 2] += n.z;
    }
  }
  for (let i = 0; i < count; i++) {
    const l = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) || 1;
    normals[i * 3] /= l;
    normals[i * 3 + 1] /= l;
    normals[i * 3 + 2] /= l;
  }
  return normals;
}

type MorphSet = { positions: THREE.BufferAttribute[]; normals: THREE.BufferAttribute[] };
type MorphSlot = "state" | "pose";

/**
 * A mesh can carry two blocks of morph targets at once: its states (breast states with the body habitus, or the
 * frames of a step sequence) and the arm pose. Both are kept per mesh and put on the geometry together, states first.
 */
const morphSlots = new WeakMap<THREE.Mesh, { state: MorphSet | null; pose: MorphSet | null }>();
/** Number of targets of each block on the geometry, for the influence writers. */
const morphBlocks = new WeakMap<THREE.Mesh, { state: number; pose: number }>();

/**
 * A set of relative morph targets from vertex displacements in the mesh's local space: one per keyframe. Normals are
 * the given ones (displacements of the rest normal, e.g. carried by the breast map) or are recomputed on every
 * deformed keyframe.
 */
function morphSetOf(mesh: THREE.Mesh, deltas: Float32Array[], normals?: Float32Array[]): MorphSet {
  const geometry = mesh.geometry;
  const set: MorphSet = { positions: [], normals: [] };
  if (normals) {
    deltas.forEach((delta, k) => {
      set.positions.push(new THREE.BufferAttribute(delta, 3));
      set.normals.push(new THREE.BufferAttribute(normals[k], 3));
    });
    return set;
  }
  const attribute = geometry.attributes.position;
  const count = attribute.count;
  const v = new THREE.Vector3();
  const base = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) v.fromBufferAttribute(attribute, i).toArray(base, i * 3);
  const index = geometry.index ? geometry.index.array : null;
  const restNormals = vertexNormals(base, index, count);
  for (const delta of deltas) {
    const posed = base.slice();
    for (let i = 0; i < posed.length; i++) posed[i] += delta[i];
    const posedNormals = vertexNormals(posed, index, count);
    for (let i = 0; i < posedNormals.length; i++) posedNormals[i] -= restNormals[i];
    set.positions.push(new THREE.BufferAttribute(delta, 3));
    set.normals.push(new THREE.BufferAttribute(posedNormals, 3));
  }
  return set;
}

/** Puts both blocks of a mesh on its geometry (influences start at zero: the callers write them again). */
function applyMorphs(mesh: THREE.Mesh) {
  const geometry = mesh.geometry;
  const slots = morphSlots.get(mesh) ?? { state: null, pose: null };
  const positions = [...(slots.state?.positions ?? []), ...(slots.pose?.positions ?? [])];
  const normals = [...(slots.state?.normals ?? []), ...(slots.pose?.normals ?? [])];
  morphBlocks.set(mesh, { state: slots.state?.positions.length ?? 0, pose: slots.pose?.positions.length ?? 0 });
  if (positions.length) {
    geometry.morphAttributes.position = positions;
    geometry.morphAttributes.normal = normals;
    geometry.morphTargetsRelative = true;
    mesh.updateMorphTargets();
  } else {
    delete geometry.morphAttributes.position;
    delete geometry.morphAttributes.normal;
    mesh.morphTargetInfluences = undefined;
    mesh.morphTargetDictionary = undefined;
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  // three keeps one morph texture per geometry and rebuilds it only when the target count changes:
  // disposing drops it (and the GPU buffers, re-uploaded on the next frame)
  geometry.dispose();
}

/**
 * Attaches relative morph targets to one block of a mesh (states by default), from displacements in the mesh's local
 * space or a set built before for the same geometry, keeping the other block. Returns the set.
 */
function setMorphTargets(mesh: THREE.Mesh, deltas: Float32Array[] | MorphSet | null, slot: MorphSlot = "state", normals?: Float32Array[]): MorphSet | null {
  const set = deltas === null ? null : Array.isArray(deltas) ? morphSetOf(mesh, deltas, normals) : deltas;
  const slots = morphSlots.get(mesh) ?? { state: null, pose: null };
  slots[slot] = set;
  morphSlots.set(mesh, slots);
  applyMorphs(mesh);
  return set;
}

/** Writes the influences of one block of a mesh (the other block keeps its values). */
function writeInfluences(mesh: THREE.Mesh, slot: MorphSlot, influences: number[]) {
  const target = mesh.morphTargetInfluences;
  const blocks = morphBlocks.get(mesh);
  if (!target || !blocks) return;
  const start = slot === "state" ? 0 : blocks.state;
  const count = slot === "state" ? blocks.state : blocks.pose;
  for (let k = 0; k < count; k++) target[start + k] = influences[k] ?? 0;
}

/** Breast morph targets per (shared) geometry: computed once, put back at once when the canvas is mounted anew. */
const breastMorphs = new WeakMap<THREE.BufferGeometry, MorphSet | null>();
/** Key frames of the step meshes, per (shared) geometry, likewise. */
const stepMorphs = new WeakMap<THREE.BufferGeometry, MorphSet>();
/** Trunk skin with and without the triangles over the operated breast (step-by-step views), per geometry. */
/** the trunk skin's own index and, per outline (one per case of the step sequences), the index with that patch cut out */
const skinHoles = new WeakMap<THREE.BufferGeometry, { full: THREE.BufferAttribute; open: Map<[number, number][], THREE.BufferAttribute> }>();

/** Even-odd test of a point against a polygon. */
function insidePolygon(x: number, y: number, polygon: [number, number][]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const boxOf = (polygon: [number, number][]) => polygon.reduce((box, [u, v]) => [Math.min(box[0], u), Math.min(box[1], v), Math.max(box[2], u), Math.max(box[3], v)], [Infinity, Infinity, -Infinity, -Infinity]);

/** Skin edges any state stretches beyond this (mm, deformed) are halved, in up to SKIN_REFINE_PASSES passes. */
const SKIN_EDGE_MM = { desktop: 5, phone: 7 };
const SKIN_REFINE_PASSES = 4;
/** most vertices the refinement may add to the skin */
const SKIN_REFINE_BUDGET = { desktop: 80000, phone: 30000 };
/** tissues that follow the body habitus (by their depth in the subcutaneous layer), besides skin and breasts */
const HABITUS_TISSUES = new Set(["artery", "vein", "nerve", "lymph-node", "fascia"]);
/** the arm, outside the trunk skin, keeps its shape (and its own deformation in the arm poses) */
const ARM_STRUCTURES = new Set(["brachial-vessels", "arm-nerves", "circumflex-humeral-vessels"]);

function clearMorphTargets(mesh: THREE.Mesh) {
  morphSlots.delete(mesh);
  applyMorphs(mesh);
}

/** Morph influences for a level on an axis of `count` keyframes (0 = rest, k = k-th keyframe), piecewise linear. */
function levelInfluences(level: number, count: number) {
  const out = new Array<number>(count).fill(0);
  const k = Math.min(Math.max(level, 0), count);
  const hi = Math.min(Math.ceil(k), count);
  if (hi > 0) {
    const lo = hi - 1;
    if (lo >= 1) out[lo - 1] = 1 - (k - lo);
    out[hi - 1] = k - lo;
  }
  return out;
}

export type PlaneSet = {
  /** plane applied to every visible mesh (or superficial only) */
  cut: THREE.Plane | null;
  cutScope: "all" | "superficial";
  /** plane applied to the skin only (skin window) */
  skin: THREE.Plane | null;
  /** step-defined dissection window, applied to superficial layers */
  step: THREE.Plane | null;
};

type Props = {
  modelPath: string;
  visible: (structure: string) => boolean;
  activeStructures: Set<string>;
  viewMode: ViewMode;
  planes: PlaneSet;
  selected: string | null;
  highlight: Map<string, string>;
  emphasised: Set<string>;
  manipulation: Record<string, number>;
  retracted: Record<string, number>;
  lowPower: boolean;
  /** when a portion (mesh) is selected, only those meshes glow */
  selectedMeshes?: Set<string> | null;
  /** structures drawn see-through (e.g. a muscle while its attachment areas are shown) */
  translucent?: Set<string>;
  /** structures drawn opaque whatever their tissue (e.g. the skin when a view is about the surface) */
  solid?: Set<string>;
  /** distance map: surfaces coloured by distance to these structures */
  proximity?: string[] | null;
  /** > 0: meshes fade (opacity and colour) into their new look, and in and out of view, over this many ms */
  fadeMs?: number;
  onReady: (handle: ModelHandle) => void;
  onPick: (structure: string | null, info?: PickInfo) => void;
};

/** Distance-map ramp (mm): red < 5, orange < 10, yellow < 15, then the tissue colour. */
export const proximityRamp = [
  { maxMm: 5, color: "#ef4444", label: "< 5 mm" },
  { maxMm: 10, color: "#f97316", label: "5–10 mm" },
  { maxMm: 15, color: "#facc15", label: "10–15 mm" },
];
const proximityTissues = new Set<Tissue>(["muscle", "fat", "fascia", "bone", "cartilage", "gland", "ligament", "lymph-node", "artery", "vein", "nerve"]);

export const superficialForCut = new Set(["skin", "breast-fat", "breast-ligaments", "contralateral-breast", "pectoral-fascia", "deltoid-fascia", "thoracolumbar-fascia"]);
const stepWindowStructures = new Set(["skin", "pectoral-fascia", "thoracolumbar-fascia", "deltoid-fascia"]);

/**
 * See-through skin of the operation steps: nearly clear where it faces the viewer and denser towards the outline (a
 * Fresnel falloff), so that the tissue inside keeps its colours while the shape of the breast stays readable.
 */
const GHOST_OPACITY = 0.5;
const GHOST_FACING = 0.16; // share of GHOST_OPACITY where the skin faces the viewer
function ghostly(material: THREE.Material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `float ghostRim = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));
      diffuseColor.a *= mix(${GHOST_FACING.toFixed(2)}, 1.0, pow(ghostRim, 2.0));
      #include <opaque_fragment>`,
    );
  };
  material.customProgramCacheKey = () => "ghost-skin";
}

function makeMaterial(tissue: Tissue, opts: { active: boolean; viewMode: ViewMode; selected: boolean; override?: string; emphasis: boolean; planes: THREE.Plane[]; lowPower: boolean; translucent: boolean; ghost?: boolean; solid: boolean; vertexColors: boolean; base?: string; baseOpacity?: number; cutting?: boolean }) {
  const color = new THREE.Color(opts.vertexColors ? "#ffffff" : opts.override ?? opts.base ?? tissueColors[tissue]);
  let opacity = opts.solid ? 1 : opts.baseOpacity ?? tissueOpacity[tissue] ?? 1;
  if (opts.translucent) opacity = Math.min(opacity, opts.ghost ? GHOST_OPACITY : 0.3);
  const faded = opts.viewMode === "surgical" && !opts.active && !opts.selected && !opts.override && !opts.emphasis;
  if (faded) {
    opacity = Math.min(opacity, tissue === "skin" ? 0.12 : 0.22);
    color.lerp(new THREE.Color("#94a3b8"), 0.45);
  }
  const vascular = tissue === "artery" || tissue === "vein";
  const glow = opts.selected ? 0.45 : opts.emphasis || (opts.viewMode === "surgical" && opts.active) ? (vascular || tissue === "nerve" ? 0.35 : 0.14) : opts.override ? 0.12 : 0;
  const common = {
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 0.6,
    side: THREE.DoubleSide,
    clippingPlanes: opts.planes,
    clipShadows: true,
    vertexColors: opts.vertexColors,
    emissive: glow && !opts.vertexColors ? (opts.selected ? new THREE.Color("#fde68a") : color.clone()).multiplyScalar(glow) : opts.selected ? new THREE.Color("#fde68a").multiplyScalar(0.25) : new THREE.Color("#000000"),
    roughness: vascular ? 0.32 : tissue === "bone" ? 0.72 : tissue === "skin" ? 0.55 : 0.58,
    metalness: 0,
  };
  if (opts.ghost && opts.translucent) {
    // no sheen: its pale rim would veil the tissue inside
    const ghost = new THREE.MeshStandardMaterial({ ...common, depthWrite: false });
    ghostly(ghost);
    return ghost;
  }
  // procedural surface (skinShader.ts): skin, nipple-areola complex and the tissues of the breast; none for painted
  // (distance map) or faded meshes, whose flat colour carries the information
  const look: SurfaceLook | null = opts.vertexColors || faded ? null : tissue === "skin" ? (opts.lowPower ? "skin-lite" : "skin") : opts.lowPower ? null : tissue === "areola" || tissue === "nipple" ? "areola" : tissue === "fat" ? "fat" : tissue === "gland" ? "gland" : null;
  const material = opts.lowPower
    ? new THREE.MeshStandardMaterial(common)
    : new THREE.MeshPhysicalMaterial({
        ...common,
        clearcoat: vascular || tissue === "duct" ? 0.7 : tissue === "muscle" ? 0.15 : 0,
        clearcoatRoughness: 0.35,
        // skin: a soft sheen and the specular reflectance of skin (F0 about 0.028)
        sheen: tissue === "skin" ? 0.2 : tissue === "muscle" || tissue === "nerve" ? 0.45 : 0,
        sheenColor: new THREE.Color(tissue === "skin" ? "#ffd9c7" : "#ffffff"),
        sheenRoughness: 0.6,
        specularIntensity: tissue === "skin" || tissue === "areola" || tissue === "nipple" ? 0.7 : 1,
      });
  if (look) applySurfaceLook(material, look, mm, tissue === "skin" ? breastCentres : undefined);
  // the section tool fills the cut of closed meshes (the skin, fasciae and septa are open sheets)
  if (opts.cutting && CAP_TISSUES.has(tissue) && !opts.vertexColors) applyCaps(material);
  return material;
}

/** closed meshes, whose cut is shown filled */
const CAP_TISSUES = new Set(["muscle", "bone", "cartilage", "fat", "gland", "duct", "artery", "vein", "nerve", "lymph-node"]);

/** Rest nipples of both breasts (model units): the dilated veins of gigantomastia lie round them. */
const breastCentres: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(...breastMeasurements.op.rest.nipple), new THREE.Vector3(...breastMeasurements.contra.rest.nipple)];
/** tissues that carry the attributes of the procedural looks */
const LOOK_TISSUES = new Set(["skin", "areola", "nipple", "fat", "gland"]);

/** A copy of a material for a fade, with the shader changes of the original (Material.clone leaves them out). */
function fadeClone<M extends THREE.Material>(material: M): M {
  const clone = material.clone() as M;
  clone.onBeforeCompile = material.onBeforeCompile;
  clone.customProgramCacheKey = material.customProgramCacheKey;
  return clone;
}

export function HybridModel(props: Props) {
  const { modelPath, visible, activeStructures, viewMode, planes, selected, highlight, emphasised, manipulation, retracted, lowPower, selectedMeshes = null, translucent, solid, proximity = null, fadeMs = 0, onReady, onPick } = props;
  const gltf = useGLTF(modelPath, false, true);
  const scene = useMemo(() => {
    const clone = gltf.scene.clone(true);
    // schematic structures (literature) and surgical plans: built here, in model space, and treated as any other mesh from
    // now on (the pieces of the plans start empty: preparePlans)
    for (const mesh of buildSchematicMeshes(mm, lowPower ? 6 : 8)) clone.add(mesh);
    // Geometries are shared with the cached glTF. Morph targets left by a previous mount (resetting the
    // camera remounts the canvas) would be drawn by meshes that have no influences yet: start clean and
    // let the viewer prepare the current arm pose and breast state again.
    clone.updateMatrixWorld(true);
    clone.traverse((object) => {
      if (!isMesh(object)) return;
      if (object.geometry.morphAttributes.position || object.geometry.morphAttributes.normal) clearMorphTargets(object);
      // rest position in mm (and the cut rim of the trunk skin) for the procedural looks; the clone has no parent yet,
      // so its world matrices are mesh-to-model
      const record = recordFor(object);
      if (record && LOOK_TISSUES.has(record.tissue)) restAttributes(object.geometry, object.matrixWorld, mm, record.name === breastSkinMesh);
      // the trunk skin is whole again until a step-by-step view opens it
      const hole = skinHoles.get(object.geometry);
      if (hole && object.geometry.index !== hole.full) object.geometry.setIndex(hole.full);
    });
    return clone;
  }, [gltf.scene, lowPower]);
  // false once this scene is gone: asynchronous work must not touch the (shared) geometries any more
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    // a new scene (other model file) starts without morph targets: forget what was prepared for the old one
    pose.current = { id: null, meshes: [], request: pose.current.request + 1 };
    breast.current = { meshes: [], pending: null, level: 0 };
    plans.current = new Map();
    surgery.current = { key: null, meshes: [], request: surgery.current.request + 1, level: 0 };
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);
  const invalidate = useThree((state) => state.invalidate);
  const original = useRef(new Map<THREE.Object3D, THREE.Matrix4>());
  const pivots = useRef<Map<string, THREE.Vector3> | null>(null);
  const centroids = useRef(new Map<string, THREE.Vector3>());
  const pose = useRef<{ id: string | null; meshes: THREE.Mesh[]; request: number }>({ id: null, meshes: [], request: 0 });
  const meshesByName = useMemo(() => {
    const map = new Map<string, THREE.Mesh[]>();
    scene.traverse((object) => {
      if (!isMesh(object)) return;
      const record = recordFor(object);
      if (!record) return;
      const list = map.get(record.name);
      if (list) list.push(object);
      else map.set(record.name, [object]);
    });
    return map;
  }, [scene]);

  /** Mesh-local to model space with the node matrices captured at load, i.e. ignoring rigid manipulations. */
  const restMatrix = (mesh: THREE.Object3D) => {
    const chain: THREE.Object3D[] = [];
    for (let node: THREE.Object3D | null = mesh; node && node !== scene; node = node.parent) chain.push(node);
    const matrix = new THREE.Matrix4();
    for (let i = chain.length - 1; i >= 0; i--) matrix.multiply(original.current.get(chain[i]) ?? chain[i].matrix);
    return matrix;
  };

  // ---- arm poses: morph targets computed offline (build_poses.py) ---------------------------------------
  const clearPose = () => {
    const meshes = pose.current.meshes;
    meshes.forEach((mesh) => setMorphTargets(mesh, null, "pose"));
    pose.current.id = null;
    pose.current.meshes = [];
    // the state block of those meshes starts again from zero influences
    if (meshes.length) setBreastLevel(breast.current.level);
  };
  const preparePose = async (poseId: string | null) => {
    // the latest request wins: a slower download for an earlier choice never overwrites it
    const request = ++pose.current.request;
    if (pose.current.id === poseId) return;
    if (!poseId) {
      clearPose();
      invalidate();
      return;
    }
    const deltas = await loadPose(variantOf(modelPath), poseId);
    // the latest request wins, and a model unmounted meanwhile must not touch the shared geometries
    if (request !== pose.current.request || !alive.current) return;
    clearPose();
    const unit = deltaUnit(mm);
    const v = new THREE.Vector3();
    const meshes: THREE.Mesh[] = [];
    for (const entry of deltas) {
      for (const mesh of meshesByName.get(entry.name) ?? []) {
        const count = mesh.geometry.attributes.position.count;
        // model-space deltas to the mesh's local (possibly quantised) space
        const linear = new THREE.Matrix3().setFromMatrix4(restMatrix(mesh)).invert();
        const frames = entry.deltas.map((frame) => {
          const delta = new Float32Array(count * 3);
          for (let j = 0; j < entry.indices.length; j++) {
            v.set(frame[j * 3], frame[j * 3 + 1], frame[j * 3 + 2]).multiplyScalar(unit).applyMatrix3(linear);
            v.toArray(delta, entry.indices[j] * 3);
          }
          return delta;
        });
        setMorphTargets(mesh, frames, "pose");
        meshes.push(mesh);
      }
    }
    // schematic branches that leave a posed vessel: the root goes with the vessel, fading along the branch (the rest
    // of it stays with the breast, which the poses do not move)
    const byName = new Map(deltas.map((entry) => [entry.name, entry]));
    for (const name of schematicMeshNames) {
      const follow = tubeFollow(name);
      const entry = follow ? byName.get(follow.parent) : undefined;
      if (!follow || !entry) continue;
      for (const mesh of meshesByName.get(name) ?? []) {
        const tube = mesh.userData.tube as TubeSpec | undefined;
        const parent = meshesByName.get(follow.parent)?.[0];
        if (!tube || !parent) continue;
        // the vertex of the source vessel nearest to the root, among those the pose moves
        const toModel = restMatrix(parent);
        const attribute = parent.geometry.attributes.position;
        const root = new THREE.Vector3().fromArray(tube.points, 0);
        let best = -1;
        let bestDistance = Infinity;
        for (let j = 0; j < entry.indices.length; j++) {
          const distance = v.fromBufferAttribute(attribute, entry.indices[j]).applyMatrix4(toModel).distanceToSquared(root);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = j;
          }
        }
        if (best < 0) continue;
        const count = tube.points.length / 3;
        const weight = new Float32Array(count);
        let along = 0;
        for (let i = 0; i < count; i++) {
          if (i) along += Math.hypot(tube.points[i * 3] - tube.points[i * 3 - 3], tube.points[i * 3 + 1] - tube.points[i * 3 - 2], tube.points[i * 3 + 2] - tube.points[i * 3 - 1]);
          const t = Math.min(along / (follow.fadeMm * mm), 1);
          weight[i] = 1 - t * t * t * (t * (6 * t - 15) + 10);
        }
        const rest = tubeVertices(tube.points, tube.radii, tube.sides);
        const frames = entry.deltas.map((frame) => {
          const shift = [frame[best * 3] * unit, frame[best * 3 + 1] * unit, frame[best * 3 + 2] * unit];
          const moved = tube.points.map((value, i) => value + weight[Math.floor(i / 3)] * shift[i % 3]);
          const posed = tubeVertices(moved, tube.radii, tube.sides);
          for (let i = 0; i < posed.length; i++) posed[i] -= rest[i];
          return posed;
        });
        setMorphTargets(mesh, frames, "pose");
        meshes.push(mesh);
      }
    }
    pose.current.id = poseId;
    pose.current.meshes = meshes;
    // composing the blocks zeroed the state influences of these meshes
    setBreastLevel(breast.current.level);
  };
  const setPoseFraction = (t: number) => {
    const influences = influencesAt(t);
    for (const mesh of pose.current.meshes) writeInfluences(mesh, "pose", influences);
    invalidate();
  };

  // ---- breast states: morph targets computed on the device (breastMap.ts) -------------------------------
  const breast = useRef<{ meshes: THREE.Mesh[]; pending: Promise<void> | null; level: number }>({ meshes: [], pending: null, level: 0 });
  const setBreastLevel = (level: number) => {
    breast.current.level = level;
    // the dilated veins of gigantomastia come in between G3 and G4
    const veins = Math.min(Math.max(level - (breastStates.length - 1), 0), 1);
    skinUniforms.uVeins.value = veins * veins * (3 - 2 * veins);
    const influences = levelInfluences(level, breastStates.length);
    for (const mesh of breast.current.meshes) writeInfluences(mesh, "state", influences);
    invalidate();
  };
  const prepareBreast = () => {
    const state = breast.current;
    if (!state.pending) {
      state.pending = (async () => {
        const sides = await loadBreastSides();
        const v = new THREE.Vector3();
        state.meshes = [];
        // the schematic structures belong to the operated breast and follow it (the pieces of the surgical plans are
        // prepared case by case, when a view shows one: preparePlans)
        const schematic = schematicMeshNames.filter((name) => !planPieceMeshes.has(name)).map((name) => [name, ["op"]] as [string, BreastSideId[]]);
        // vessels, nerves, nodes and fasciae follow the body habitus of the large states by their depth in the fat
        const habitusOnly: [string, BreastSideId[]][] = [];
        for (const [name, list] of meshesByName) {
          if (breastMeshSides.has(name) || schematicMeshNames.includes(name)) continue;
          const record = recordFor(list[0]);
          if (record && HABITUS_TISSUES.has(record.tissue) && !ARM_STRUCTURES.has(record.structure)) habitusOnly.push([name, []]);
        }
        for (const [name, which] of [...breastMeshSides, ...schematic, ...habitusOnly]) {
          for (const mesh of meshesByName.get(name) ?? []) {
            if (!alive.current) return;
            const known = breastMorphs.get(mesh.geometry);
            if (known !== undefined) {
              if (known) {
                setMorphTargets(mesh, known);
                state.meshes.push(mesh);
              }
              continue;
            }
            const tube = mesh.userData.tube as TubeSpec | undefined;
            const sheet = mesh.userData.sheet as SheetSpec | undefined;
            const skeleton = tube?.points ?? sheet?.points;
            if (skeleton) {
              // vessels, nerves and septa keep their calibre and thickness: the map carries the centre line (or the
              // mid-surface) and the mesh is rebuilt around it
              const rebuild = (points: Float32Array) => (tube ? tubeVertices(points, tube.radii, tube.sides) : sheetVertices(points, sheet!.size, sheet!.thickness));
              const shifts = breastDisplacements(sides, which, skeleton);
              if (shifts) {
                const rest = rebuild(skeleton);
                // where the large states thin the layer over a superficial branch, its centre line is pushed inwards
                const push = tube ? tubeClearance(name, breastStates.map((item) => item.id)) : null;
                const frames = shifts.map((shift, k) => {
                  const extra = push?.[k];
                  const posed = rebuild(skeleton.map((value, i) => value + shift[i] + (extra ? extra[i] : 0)));
                  for (let i = 0; i < posed.length; i++) posed[i] -= rest[i];
                  return posed;
                });
                breastMorphs.set(mesh.geometry, setMorphTargets(mesh, frames));
                state.meshes.push(mesh);
              } else {
                breastMorphs.set(mesh.geometry, null);
              }
              continue;
            }
            const toModel = restMatrix(mesh);
            const restPositions = () => {
              const attribute = mesh.geometry.attributes.position;
              const out = new Float32Array(attribute.count * 3);
              for (let i = 0; i < attribute.count; i++) v.fromBufferAttribute(attribute, i).applyMatrix4(toModel).toArray(out, i * 3);
              return out;
            };
            let rest = restPositions();
            const habitusMode = name === breastSkinMesh ? "skin" : "depth";
            let deltas = breastDisplacements(sides, which, rest, habitusMode);
            // the skin is refined where a state stretches its edges (breast map and habitus) beyond SKIN_EDGE_MM, with
            // midpoints on the curved rest surface; old vertices keep their indices and only the new ones need the map
            if (deltas && name === breastSkinMesh && mesh.geometry.index) {
              const limit = (lowPower ? SKIN_EDGE_MM.phone : SKIN_EDGE_MM.desktop) * mm;
              const budget = lowPower ? SKIN_REFINE_BUDGET.phone : SKIN_REFINE_BUDGET.desktop;
              let added = 0;
              for (let pass = 0; pass < SKIN_REFINE_PASSES && added < budget && deltas; pass++) {
                const frames: Float32Array[] = deltas;
                const p = rest;
                const tooLong = (a: number, b: number) => {
                  for (const frame of frames) {
                    const dx = p[a * 3] + frame[a * 3] - p[b * 3] - frame[b * 3];
                    const dy = p[a * 3 + 1] + frame[a * 3 + 1] - p[b * 3 + 1] - frame[b * 3 + 1];
                    const dz = p[a * 3 + 2] + frame[a * 3 + 2] - p[b * 3 + 2] - frame[b * 3 + 2];
                    if (dx * dx + dy * dy + dz * dz > limit * limit) return true;
                  }
                  return false;
                };
                const before = rest.length / 3;
                const more = refineEdges(mesh.geometry, tooLong);
                if (!more) break;
                added += more;
                rest = restPositions();
                const fresh = breastDisplacements(sides, which, rest.subarray(before * 3), habitusMode);
                deltas = frames.map((frame, k) => {
                  const grown = new Float32Array(rest.length);
                  grown.set(frame);
                  if (fresh) grown.set(fresh[k], before * 3);
                  return grown;
                });
              }
            }
            const count = rest.length / 3;
            if (deltas) {
              const linear = new THREE.Matrix3().setFromMatrix4(toModel).invert();
              for (const frame of deltas) for (let i = 0; i < count; i++) v.fromArray(frame, i * 3).applyMatrix3(linear).toArray(frame, i * 3);
              breastMorphs.set(mesh.geometry, setMorphTargets(mesh, deltas));
              state.meshes.push(mesh);
            } else {
              breastMorphs.set(mesh.geometry, null);
            }
            // a few hundred thousand vertices in all: yield between meshes so the page stays responsive
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
        if (alive.current) setBreastLevel(state.level);
      })();
      state.pending.catch(() => {
        state.pending = null;
      });
    }
    return state.pending;
  };

  // ---- pieces of the surgical plans: downloaded and given the breast states case by case ------------------------
  const plans = useRef(new Map<number, Promise<boolean>>());
  const preparePlans = async (indexes: number[]) => {
    let changed = false;
    for (const index of indexes) {
      const known = plans.current.get(index);
      if (known) {
        changed = (await known) || changed;
        continue;
      }
      const request = (async () => {
        const pieces = await loadPlan(index);
        await prepareBreast();
        const sides = await loadBreastSides();
        const state = breast.current;
        const v = new THREE.Vector3();
        for (const [name, piece] of pieces) {
          if (!alive.current) return false;
          for (const mesh of meshesByName.get(name) ?? []) {
            const geometry = mesh.geometry;
            let frames = breastMorphs.get(geometry);
            if (frames === undefined) {
              // geometry and breast states in one go: the piece is never drawn in a shape the breast is not in
              geometry.setAttribute("position", new THREE.BufferAttribute(piece.positions, 3));
              geometry.setAttribute("normal", new THREE.BufferAttribute(vertexNormals(piece.positions, piece.index, piece.positions.length / 3), 3));
              geometry.setIndex(new THREE.BufferAttribute(piece.index, 1));
              geometry.computeBoundingBox();
              geometry.computeBoundingSphere();
              const toModel = restMatrix(mesh);
              const count = piece.positions.length / 3;
              const rest = new Float32Array(count * 3);
              for (let i = 0; i < count; i++) v.fromArray(piece.positions, i * 3).applyMatrix4(toModel).toArray(rest, i * 3);
              const deltas = breastDisplacements(sides, ["op"], rest);
              if (deltas) {
                const linear = new THREE.Matrix3().setFromMatrix4(toModel).invert();
                for (const frame of deltas) for (let i = 0; i < count; i++) v.fromArray(frame, i * 3).applyMatrix3(linear).toArray(frame, i * 3);
              }
              frames = deltas ? setMorphTargets(mesh, deltas) : null;
              breastMorphs.set(geometry, frames);
            } else if (frames) {
              setMorphTargets(mesh, frames);
            }
            if (frames && !state.meshes.includes(mesh)) state.meshes.push(mesh);
          }
          setBreastLevel(state.level);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return alive.current;
      })();
      plans.current.set(index, request);
      try {
        changed = (await request) || changed;
      } catch (error) {
        // not downloaded (offline before the first visit): tried again the next time a view needs it
        plans.current.delete(index);
        throw error;
      }
    }
    return changed;
  };

  // ---- step-by-step sequences: key frames written by build_mammaplasty_steps.py ----------------------------
  const surgery = useRef<{ key: string | null; meshes: THREE.Mesh[]; request: number; level: number }>({ key: null, meshes: [], request: 0, level: 0 });
  const setSurgeryLevel = (level: number) => {
    surgery.current.level = level;
    const influences = levelInfluences(level, Math.max(stepFramesOf(surgery.current.key ?? "").length - 1, 0));
    for (const mesh of surgery.current.meshes) writeInfluences(mesh, "state", influences);
    invalidate();
  };
  const prepareSurgery = async (technique: string) => {
    const state = surgery.current;
    const request = ++state.request;
    if (state.key === technique) return;
    const steps = await loadSteps(technique);
    // the latest request wins, and a model unmounted meanwhile must not touch the shared geometries
    if (request !== surgery.current.request || !alive.current) return;
    const meshes: THREE.Mesh[] = [];
    steps.forEach((step, name) => {
      for (const mesh of meshesByName.get(name) ?? []) {
        const geometry = mesh.geometry;
        const known = stepMorphs.get(geometry);
        if (known) {
          setMorphTargets(mesh, known);
        } else {
          // the steps are drawn in model space, as the other generated meshes: frame 0 is the geometry
          const base = step.positions[0];
          geometry.setAttribute("position", new THREE.BufferAttribute(base, 3));
          geometry.setAttribute("normal", new THREE.BufferAttribute(vertexNormals(base, step.index, base.length / 3), 3));
          geometry.setIndex(new THREE.BufferAttribute(step.index, 1));
          // the procedural looks read the first frame (model space) as the rest position
          if (geometry.attributes.restMm) geometry.deleteAttribute("restMm");
          restAttributes(geometry, new THREE.Matrix4(), mm, false);
          const deltas = step.positions.slice(1).map((frame) => frame.map((value, i) => value - base[i]));
          stepMorphs.set(geometry, setMorphTargets(mesh, deltas)!);
        }
        meshes.push(mesh);
      }
    });
    state.key = technique;
    state.meshes = meshes;
    setSurgeryLevel(state.level);
  };
  const setSkinHole = async (on: boolean, technique?: string) => {
    let changed = false;
    const outline = stepHoleOf(technique ?? surgery.current.key ?? "");
    const holeBox = boxOf(outline);
    for (const mesh of meshesByName.get(breastSkinMesh) ?? []) {
      const geometry = mesh.geometry;
      let hole = skinHoles.get(geometry);
      // a geometry rebuilt meanwhile (refined, or the model reloaded) starts again
      if (hole && geometry.index !== hole.full && ![...hole.open.values()].includes(geometry.index as THREE.BufferAttribute)) hole = undefined;
      if (!hole) {
        if (!on || !geometry.index) continue;
        hole = { full: geometry.index, open: new Map() };
        skinHoles.set(geometry, hole);
      }
      let open = hole.open.get(outline);
      if (on && !open) {
        const side = (await loadBreastSides()).op;
        if (!alive.current) return;
        // a triangle goes when its three corners (rest pose) fall inside the outline of the patch, drawn in the chart
        // of the operated breast slightly inside the patch: the skin that stays then overlaps the patch, never leaves a gap
        const index = hole.full.array;
        const attribute = geometry.attributes.position;
        const toModel = restMatrix(mesh);
        const p = new THREE.Vector3();
        const within = new Uint8Array(attribute.count);
        for (let i = 0; i < attribute.count; i++) {
          p.fromBufferAttribute(attribute, i).applyMatrix4(toModel);
          const [u, v, depth] = side.chart(p.x, p.y, p.z);
          within[i] = depth > -30 && u > holeBox[0] && u < holeBox[2] && v > holeBox[1] && v < holeBox[3] && insidePolygon(u, v, outline) ? 1 : 0;
        }
        const kept: number[] = [];
        for (let f = 0; f < index.length; f += 3) if (!(within[index[f]] && within[index[f + 1]] && within[index[f + 2]])) kept.push(index[f], index[f + 1], index[f + 2]);
        const array = index instanceof Uint32Array ? Uint32Array.from(kept) : Uint16Array.from(kept);
        open = new THREE.BufferAttribute(array, 1);
        hole.open.set(outline, open);
      }
      const index = on && open ? open : hole.full;
      if (geometry.index !== index) {
        geometry.setIndex(index);
        changed = true;
      }
    }
    if (changed) invalidate();
  };
  const handle = (): ModelHandle => ({
    snap: buildSnapper(scene),
    sliceTargets: () => sliceTargets(scene, visible, planes),
    root: scene,
    preparePose,
    setPoseFraction,
    prepareBreast,
    setBreastLevel,
    preparePlans,
    prepareSurgery,
    setSurgeryLevel,
    setSkinHole,
    refresh: () => onReady(handle()),
  });

  // capture original node matrices and rest-pose pivots once
  useEffect(() => {
    scene.updateMatrixWorld(true);
    const toModel = scene.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    const sums = new Map<string, { sum: THREE.Vector3; n: number }>();
    scene.traverse((object) => {
      const node = namedNode(object);
      if (node && !original.current.has(node)) {
        node.updateMatrix();
        original.current.set(node, node.matrix.clone());
        node.matrixAutoUpdate = false;
      }
      if (isMesh(object)) {
        const record = recordFor(object);
        if (!record) return;
        object.geometry.computeBoundingBox();
        box.copy(object.geometry.boundingBox!).applyMatrix4(toModel.clone().multiply(object.matrixWorld));
        const entry = sums.get(record.structure) ?? { sum: new THREE.Vector3(), n: 0 };
        entry.sum.add(box.getCenter(new THREE.Vector3()));
        entry.n += 1;
        sums.set(record.structure, entry);
      }
    });
    sums.forEach((entry, id) => centroids.current.set(id, entry.sum.divideScalar(entry.n)));
    const restSnap = buildSnapper(scene);
    pivots.current = new Map(
      manipulationDefs
        .filter((m) => m.kind === "reflect")
        .map((m) => {
          const near = resolvePoint(m.pivotNear);
          const point = near ? restSnap(m.pivotStructure, near) : undefined;
          return [m.id, new THREE.Vector3(...(point ?? [0, 0, 0]))];
        }),
    );
  }, [scene]);

  // rigid manipulations (reflect / retract) — geometry itself is never deformed
  useEffect(() => {
    if (!pivots.current) return;
    const bodyCentre = new THREE.Vector3();
    centroids.current.forEach((c) => bodyCentre.add(c));
    bodyCentre.divideScalar(Math.max(1, centroids.current.size));
    const perStructure = new Map<string, THREE.Matrix4>();
    const compose = (id: string, m: THREE.Matrix4) => perStructure.set(id, m.clone().multiply(perStructure.get(id) ?? new THREE.Matrix4()));
    for (const def of manipulationDefs) {
      const amount = manipulation[def.id] ?? 0;
      if (def.kind !== "reflect" || amount <= 0) continue;
      const pivot = pivots.current.get(def.id)!;
      const rotation = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...def.axis).normalize(), THREE.MathUtils.degToRad((def.maxAngle ?? 90) * amount));
      const m = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z).multiply(rotation).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
      def.structures.forEach((id) => compose(id, m));
    }
    for (const def of manipulationDefs) {
      const amount = manipulation[def.id] ?? 0;
      if (def.kind !== "transpose" || amount <= 0 || !def.target) continue;
      const start = centroids.current.get(def.structures[0]);
      const targetPoint = resolvePoint(def.target);
      if (!start || !targetPoint) continue;
      const offset = def.targetOffsetMm ?? [0, 0, 0];
      const end = new THREE.Vector3(...targetPoint).add(new THREE.Vector3(...offset).multiplyScalar(mm));
      // half-turn about a vertical axis midway between start and end: the arc passes lateral to the chest
      const centre = start.clone().add(end).multiplyScalar(0.5);
      const angle = Math.PI * amount * (start.z < end.z ? 1 : -1);
      const rotation = new THREE.Matrix4().makeRotationY(angle);
      const lift = new THREE.Matrix4().makeTranslation(0, (end.y - start.y) * amount, 0);
      const m = lift.multiply(new THREE.Matrix4().makeTranslation(centre.x, 0, centre.z)).multiply(rotation).multiply(new THREE.Matrix4().makeTranslation(-centre.x, 0, -centre.z));
      def.structures.forEach((id) => compose(id, m));
    }
    const explode = manipulationDefs.find((m) => m.kind === "retract");
    for (const [id, amount] of Object.entries(retracted)) {
      if (amount <= 0) continue;
      const centre = centroids.current.get(id);
      if (!centre) continue;
      const direction = centre.clone().sub(bodyCentre).setY(0).normalize().multiplyScalar((explode?.distanceMm ?? 80) * mm * amount);
      compose(id, new THREE.Matrix4().makeTranslation(direction.x, direction.y, direction.z));
    }
    original.current.forEach((matrix, node) => {
      const record = recordFor(node);
      const extra = record ? perStructure.get(record.structure) : undefined;
      node.matrix.copy(extra ? extra.clone().multiply(matrix) : matrix);
      node.matrixWorldNeedsUpdate = true;
    });
    scene.updateMatrixWorld(true);
    onReady(handle());
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manipulation, retracted, scene]);

  // expose updated slice targets when visibility / planes change
  useEffect(() => {
    onReady(handle());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, planes.cut, planes.cutScope]);

  // distance map: per-vertex colours from the distance to the target structures (model space)
  const proximityKey = proximity?.length ? [...proximity].sort().join(",") : "";
  useEffect(() => {
    if (!proximityKey) return;
    paintProximity(scene, new Set(proximityKey.split(",")));
    invalidate();
  }, [scene, proximityKey, invalidate]);

  // materials, visibility, clipping; with fadeMs, every mesh fades from the look it had to the new one
  const fadedScene = useRef<THREE.Object3D | null>(null);
  const fadeClones = useRef(new Set<THREE.Material>());
  useEffect(() => {
    const targets = new Set(proximityKey ? proximityKey.split(",") : []);
    const cache = new Map<string, THREE.Material>();
    // the first look of a scene is put on at once; later changes fade
    const fading = fadeMs > 0 && fadedScene.current === scene;
    fadedScene.current = scene;
    type Fade = { mesh: THREE.Mesh; clone: THREE.MeshStandardMaterial; from: number; to: number; fromColor: THREE.Color; toColor: THREE.Color; final: THREE.Material | null; order: number };
    const fades: Fade[] = [];
    const previousClones = new Set(fadeClones.current);
    const opacityOf = (material: THREE.Material) => (material.transparent ? material.opacity : 1);
    scene.traverse((object) => {
      if (!isMesh(object)) return;
      const record = recordFor(object);
      if (!record) {
        object.visible = false;
        return;
      }
      const wasVisible = object.visible;
      const before = object.material as THREE.MeshStandardMaterial;
      const show = visible(record.structure);
      if (!show) {
        if (fading && wasVisible && before?.color) {
          const clone = fadeClone(before);
          clone.transparent = true;
          fades.push({ mesh: object, clone, from: opacityOf(before), to: 0, fromColor: before.color.clone(), toColor: before.color.clone(), final: null, order: record.tissue === "skin" ? 3 : 2 });
          object.material = clone;
          fadeClones.current.add(clone);
          return;
        }
        object.visible = false;
        return;
      }
      const list: THREE.Plane[] = [];
      if (planes.cut && (planes.cutScope === "all" || superficialForCut.has(record.structure))) list.push(planes.cut);
      if (planes.skin && record.structure === "skin") list.push(planes.skin);
      if (planes.step && stepWindowStructures.has(record.structure)) list.push(planes.step);
      const override = highlight.get(record.structure);
      const painted = targets.size > 0 && proximityTissues.has(record.tissue) && !targets.has(record.structure) && Boolean(object.geometry.getAttribute("color"));
      const opts = {
        active: activeStructures.has(record.structure),
        viewMode,
        selected: selectedMeshes ? selectedMeshes.has(record.name) : selected === record.structure,
        override,
        emphasis: emphasised.has(record.structure) || targets.has(record.structure),
        planes: list,
        lowPower,
        translucent: Boolean(translucent?.has(record.structure)),
        // the skin of the operated breast in the steps: see-through as a ghost
        ghost: record.tissue === "skin" && record.structure.startsWith("mamo-step-"),
        solid: Boolean(solid?.has(record.structure)),
        vertexColors: painted,
        base: record.color,
        baseOpacity: record.opacity,
        cutting: planes.cut !== null && list.includes(planes.cut),
      };
      const key = `${record.tissue}|${record.color ?? ""}|${record.opacity ?? ""}|${opts.active}|${viewMode}|${opts.selected}|${override}|${opts.emphasis}|${opts.translucent}|${opts.ghost}|${opts.solid}|${painted}|${list.includes(planes.cut as THREE.Plane)}${list.includes(planes.skin as THREE.Plane)}${list.includes(planes.step as THREE.Plane)}`;
      let material = cache.get(key);
      if (!material) {
        material = makeMaterial(record.tissue, opts);
        cache.set(key, material);
      }
      const order = material.transparent ? (record.tissue === "skin" ? 3 : 2) : 0;
      const target = material as THREE.MeshStandardMaterial;
      if (fading && before?.color && target.color) {
        const from = wasVisible ? opacityOf(before) : 0;
        const fromColor = (wasVisible ? before.color : target.color).clone();
        if (Math.abs(from - opacityOf(target)) > 0.02 || !fromColor.equals(target.color)) {
          const clone = fadeClone(target);
          clone.transparent = true;
          clone.opacity = from;
          clone.color.copy(fromColor);
          clone.depthWrite = from >= 0.6;
          fades.push({ mesh: object, clone, from, to: opacityOf(target), fromColor, toColor: target.color.clone(), final: material, order: record.tissue === "skin" ? 3 : 2 });
          object.visible = true;
          object.material = clone;
          object.renderOrder = record.tissue === "skin" ? 3 : 2;
          fadeClones.current.add(clone);
          return;
        }
      }
      object.visible = true;
      object.material = material;
      object.renderOrder = order;
      object.castShadow = !lowPower && !material.transparent;
      object.receiveShadow = !lowPower;
    });
    // fades interrupted by this change start again from where they were: their old clones go
    const used = new Set<THREE.Material>();
    scene.traverse((object) => {
      if (isMesh(object)) used.add(object.material as THREE.Material);
    });
    previousClones.forEach((clone) => {
      if (!used.has(clone)) {
        clone.dispose();
        fadeClones.current.delete(clone);
      }
    });
    let frame = 0;
    if (fades.length) {
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / fadeMs);
        const k = t * t * (3 - 2 * t);
        for (const fade of fades) {
          fade.clone.opacity = fade.from + (fade.to - fade.from) * k;
          fade.clone.depthWrite = fade.clone.opacity >= 0.6;
          fade.clone.color.lerpColors(fade.fromColor, fade.toColor, k);
        }
        if (t >= 1) {
          for (const fade of fades) {
            if (fade.final) {
              fade.mesh.material = fade.final;
              fade.mesh.renderOrder = fade.final.transparent ? fade.order : 0;
              fade.mesh.castShadow = !lowPower && !fade.final.transparent;
              fade.mesh.receiveShadow = !lowPower;
            } else {
              fade.mesh.visible = false;
            }
            fade.clone.dispose();
            fadeClones.current.delete(fade.clone);
          }
        }
        invalidate();
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }
    invalidate();
    return () => {
      cancelAnimationFrame(frame);
      cache.forEach((material) => material.dispose());
    };
  }, [scene, visible, activeStructures, viewMode, planes, selected, selectedMeshes, translucent, solid, proximityKey, highlight, emphasised, lowPower, fadeMs, invalidate]);

  function handleClick(event: ThreeEvent<MouseEvent>) {
    if (event.delta > 6) return;
    event.stopPropagation();
    const candidates = event.intersections.filter((hit) => {
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        if (!node.visible) return false;
        node = node.parent;
      }
      const material = (hit.object as THREE.Mesh).material as THREE.Material;
      return (material.clippingPlanes ?? []).every((plane) => plane.distanceToPoint(hit.point) >= 0);
    });
    const solid = candidates.find((hit) => ((hit.object as THREE.Mesh).material as THREE.Material).opacity >= 0.5);
    const hit = solid ?? candidates[0];
    const record = hit ? recordFor(hit.object) : undefined;
    if (!hit || !record) {
      onPick(null);
      return;
    }
    const local = scene.worldToLocal(hit.point.clone());
    // the same surface point in the anatomical position (for region lookups and reviewed landmarks)
    let rest: [number, number, number] = [local.x, local.y, local.z];
    const mesh = hit.object as THREE.Mesh;
    if (hit.face && hit.barycoord && mesh.morphTargetInfluences?.some((value) => value !== 0)) {
      const attribute = mesh.geometry.attributes.position;
      const p = new THREE.Vector3();
      const point = new THREE.Vector3();
      ([hit.face.a, hit.face.b, hit.face.c] as const).forEach((vertex, k) => point.addScaledVector(p.fromBufferAttribute(attribute, vertex), hit.barycoord!.getComponent(k)));
      scene.updateMatrixWorld();
      const toModel = scene.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
      point.applyMatrix4(toModel);
      rest = [point.x, point.y, point.z];
    }
    onPick(record.structure, { meshName: record.name, point: [local.x, local.y, local.z], restPoint: rest });
  }

  return <primitive object={scene} onClick={handleClick} />;
}

function sliceTargets(scene: THREE.Object3D, visible: (structure: string) => boolean, planes: PlaneSet): SliceTarget[] {
  scene.updateMatrixWorld(true);
  const toModel = scene.matrixWorld.clone().invert();
  const targets: SliceTarget[] = [];
  scene.traverse((object) => {
    if (!isMesh(object)) return;
    const record = recordFor(object);
    if (!record || !visible(record.structure)) return;
    if (planes.cutScope === "superficial" && !superficialForCut.has(record.structure)) return;
    targets.push({ mesh: object, structure: record.structure, tissue: record.tissue, meshName: record.name, toModel: toModel.clone().multiply(object.matrixWorld) });
  });
  return targets;
}

/**
 * Colours every eligible mesh by its distance to the target structures: nearest target vertex found
 * through a uniform grid (cell = ramp limit), only for vertices inside the targets' box.
 */
function paintProximity(scene: THREE.Object3D, targets: Set<string>) {
  scene.updateMatrixWorld(true);
  const toModel = scene.matrixWorld.clone().invert();
  const limit = proximityRamp[proximityRamp.length - 1].maxMm * mm;
  const cell = limit;
  const grid = new Map<string, number[]>();
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const seen = new Set<string>();
  scene.traverse((object) => {
    if (!isMesh(object)) return;
    const record = recordFor(object);
    if (!record || !targets.has(record.structure)) return;
    m.copy(toModel).multiply(object.matrixWorld);
    const position = object.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(m);
      // thin the target cloud to ~1 mm voxels
      const voxel = `${Math.round(v.x / mm)},${Math.round(v.y / mm)},${Math.round(v.z / mm)}`;
      if (seen.has(voxel)) continue;
      seen.add(voxel);
      box.expandByPoint(v);
      const k = `${Math.floor(v.x / cell)},${Math.floor(v.y / cell)},${Math.floor(v.z / cell)}`;
      const list = grid.get(k);
      if (list) list.push(v.x, v.y, v.z);
      else grid.set(k, [v.x, v.y, v.z]);
    }
  });
  if (box.isEmpty()) return;
  box.expandByScalar(limit);
  const ramp = proximityRamp.map((step) => ({ ...step, c: new THREE.Color(step.color) }));
  const base = new THREE.Color();
  const out = new THREE.Color();
  scene.traverse((object) => {
    if (!isMesh(object)) return;
    const record = recordFor(object);
    if (!record || targets.has(record.structure) || !proximityTissues.has(record.tissue)) return;
    m.copy(toModel).multiply(object.matrixWorld);
    const position = object.geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    base.set(tissueColors[record.tissue]);
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(m);
      let best = Infinity;
      if (box.containsPoint(v)) {
        const cx = Math.floor(v.x / cell), cy = Math.floor(v.y / cell), cz = Math.floor(v.z / cell);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++) {
              const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
              if (!list) continue;
              for (let j = 0; j < list.length; j += 3) {
                const d = (list[j] - v.x) ** 2 + (list[j + 1] - v.y) ** 2 + (list[j + 2] - v.z) ** 2;
                if (d < best) best = d;
              }
            }
      }
      const dMm = Math.sqrt(best) / mm;
      const step = ramp.find((item) => dMm < item.maxMm);
      if (step) out.copy(step.c).lerp(base, Math.max(0, (dMm - (step.maxMm - 5)) / 5) * 0.25);
      else out.copy(base);
      colors[i * 3] = out.r;
      colors[i * 3 + 1] = out.g;
      colors[i * 3 + 2] = out.b;
    }
    object.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  });
}
