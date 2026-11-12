"use client";

import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { manipulations as manipulationDefs } from "@/data/surgicalSpaces";
import { deltaUnit, influencesAt, loadPose, variantOf } from "@/lib/armPoses";
import { buildSchematicMeshes, readPlanBin, schematicMeshNames, sheetVertices, tubeVertices, type SheetSpec, type TubeSpec } from "@/lib/breastAnatomy";
import { breastDisplacements, breastMeshSides, breastSkinMesh, breastStates, loadBreastSides, type BreastSideId } from "@/lib/breastStates";
import { loadSteps, stepFrameCount, stepHole } from "@/lib/mammaplastySteps";
import { meanEdgeLength, subdivideRegion } from "@/lib/subdivide";
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
  /** fills the step-by-step meshes of a technique (src/lib/mammaplastySteps.ts) and attaches their key frames as morph targets */
  prepareSurgery: (technique: string) => Promise<void>;
  /** 0 = marking, k = k-th key frame of the prepared technique; fractions blend neighbouring frames */
  setSurgeryLevel: (level: number) => void;
  /** opens the trunk skin over the operated breast, where the skin of the step-by-step sequence takes its place (after prepareBreast) */
  setSkinHole: (on: boolean) => Promise<void>;
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

/**
 * Attaches relative morph targets to a mesh: one per keyframe, from vertex displacements in the mesh's
 * local space (normals are recomputed on every deformed keyframe), or a set built before for the same
 * geometry. Returns the set.
 */
function setMorphTargets(mesh: THREE.Mesh, deltas: Float32Array[] | MorphSet): MorphSet {
  const geometry = mesh.geometry;
  let set: MorphSet;
  if (Array.isArray(deltas)) {
    const attribute = geometry.attributes.position;
    const count = attribute.count;
    const v = new THREE.Vector3();
    const base = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) v.fromBufferAttribute(attribute, i).toArray(base, i * 3);
    const index = geometry.index ? geometry.index.array : null;
    const restNormals = vertexNormals(base, index, count);
    set = { positions: [], normals: [] };
    for (const delta of deltas) {
      const posed = base.slice();
      for (let i = 0; i < posed.length; i++) posed[i] += delta[i];
      const posedNormals = vertexNormals(posed, index, count);
      for (let i = 0; i < posedNormals.length; i++) posedNormals[i] -= restNormals[i];
      set.positions.push(new THREE.BufferAttribute(delta, 3));
      set.normals.push(new THREE.BufferAttribute(posedNormals, 3));
    }
  } else {
    set = deltas;
  }
  geometry.morphAttributes.position = set.positions;
  geometry.morphAttributes.normal = set.normals;
  geometry.morphTargetsRelative = true;
  mesh.updateMorphTargets();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  // three keeps one morph texture per geometry and rebuilds it only when the target count changes:
  // disposing drops it (and the GPU buffers, re-uploaded on the next frame)
  geometry.dispose();
  return set;
}

/** Breast morph targets per (shared) geometry: computed once, put back at once when the canvas is mounted anew. */
const breastMorphs = new WeakMap<THREE.BufferGeometry, MorphSet | null>();
/** Key frames of the step meshes, per (shared) geometry, likewise. */
const stepMorphs = new WeakMap<THREE.BufferGeometry, MorphSet>();
/** Trunk skin with and without the triangles over the operated breast (step-by-step views), per geometry. */
const skinHoles = new WeakMap<THREE.BufferGeometry, { full: THREE.BufferAttribute; open: THREE.BufferAttribute }>();

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
const holeBox = stepHole.reduce((box, [u, v]) => [Math.min(box[0], u), Math.min(box[1], v), Math.max(box[2], u), Math.max(box[3], v)], [Infinity, Infinity, -Infinity, -Infinity]);

function clearMorphTargets(mesh: THREE.Mesh) {
  delete mesh.geometry.morphAttributes.position;
  delete mesh.geometry.morphAttributes.normal;
  mesh.morphTargetInfluences = undefined;
  mesh.morphTargetDictionary = undefined;
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  mesh.geometry.dispose();
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

function makeMaterial(tissue: Tissue, opts: { active: boolean; viewMode: ViewMode; selected: boolean; override?: string; emphasis: boolean; planes: THREE.Plane[]; lowPower: boolean; translucent: boolean; solid: boolean; vertexColors: boolean; base?: string; baseOpacity?: number }) {
  const color = new THREE.Color(opts.vertexColors ? "#ffffff" : opts.override ?? opts.base ?? tissueColors[tissue]);
  let opacity = opts.solid ? 1 : opts.baseOpacity ?? tissueOpacity[tissue] ?? 1;
  if (opts.translucent) opacity = Math.min(opacity, 0.3);
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
    roughness: vascular ? 0.32 : tissue === "bone" ? 0.72 : tissue === "skin" ? 0.5 : 0.58,
    metalness: 0,
  };
  if (opts.lowPower) return new THREE.MeshStandardMaterial(common);
  return new THREE.MeshPhysicalMaterial({
    ...common,
    clearcoat: vascular || tissue === "duct" ? 0.7 : tissue === "muscle" ? 0.15 : 0,
    clearcoatRoughness: 0.35,
    sheen: tissue === "skin" || tissue === "muscle" || tissue === "nerve" ? 0.45 : 0,
    sheenColor: new THREE.Color(tissue === "skin" ? "#ffd9c7" : "#ffffff"),
    sheenRoughness: 0.6,
  });
}

export function HybridModel(props: Props) {
  const { modelPath, visible, activeStructures, viewMode, planes, selected, highlight, emphasised, manipulation, retracted, lowPower, selectedMeshes = null, translucent, solid, proximity = null, onReady, onPick } = props;
  const gltf = useGLTF(modelPath, false, true);
  // pieces of the surgical plans (a small binary, loaded with the model)
  const planBin = readPlanBin();
  const scene = useMemo(() => {
    const clone = gltf.scene.clone(true);
    // schematic structures (literature) and surgical plans: built here, in model space, and treated as any other mesh from now on
    for (const mesh of buildSchematicMeshes(mm, lowPower ? 6 : 8, planBin)) clone.add(mesh);
    // Geometries are shared with the cached glTF. Morph targets left by a previous mount (resetting the
    // camera remounts the canvas) would be drawn by meshes that have no influences yet: start clean and
    // let the viewer prepare the current arm pose and breast state again.
    clone.traverse((object) => {
      if (!isMesh(object)) return;
      if (object.geometry.morphAttributes.position || object.geometry.morphAttributes.normal) clearMorphTargets(object);
      // the trunk skin is whole again until a step-by-step view opens it
      const hole = skinHoles.get(object.geometry);
      if (hole && object.geometry.index !== hole.full) object.geometry.setIndex(hole.full);
    });
    return clone;
  }, [gltf.scene, lowPower, planBin]);
  // false once this scene is gone: asynchronous work must not touch the (shared) geometries any more
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    // a new scene (other model file) starts without morph targets: forget what was prepared for the old one
    pose.current = { id: null, meshes: [], request: pose.current.request + 1 };
    breast.current = { meshes: [], pending: null, level: 0 };
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
    pose.current.meshes.forEach(clearMorphTargets);
    pose.current.id = null;
    pose.current.meshes = [];
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
        setMorphTargets(mesh, frames);
        meshes.push(mesh);
      }
    }
    pose.current.id = poseId;
    pose.current.meshes = meshes;
  };
  const setPoseFraction = (t: number) => {
    const influences = influencesAt(t);
    for (const mesh of pose.current.meshes) {
      const target = mesh.morphTargetInfluences;
      if (!target) continue;
      for (let k = 0; k < target.length; k++) target[k] = influences[k] ?? 0;
    }
    invalidate();
  };

  // ---- breast states: morph targets computed on the device (breastMap.ts) -------------------------------
  const breast = useRef<{ meshes: THREE.Mesh[]; pending: Promise<void> | null; level: number }>({ meshes: [], pending: null, level: 0 });
  const setBreastLevel = (level: number) => {
    breast.current.level = level;
    const influences = levelInfluences(level, breastStates.length);
    for (const mesh of breast.current.meshes) {
      const target = mesh.morphTargetInfluences;
      if (target) for (let k = 0; k < target.length; k++) target[k] = influences[k] ?? 0;
    }
    invalidate();
  };
  const prepareBreast = () => {
    const state = breast.current;
    if (!state.pending) {
      state.pending = (async () => {
        const sides = await loadBreastSides();
        const v = new THREE.Vector3();
        state.meshes = [];
        // the schematic structures belong to the operated breast and follow it
        const schematic = schematicMeshNames.map((name) => [name, ["op"]] as [string, BreastSideId[]]);
        for (const [name, which] of [...breastMeshSides, ...schematic]) {
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
                const frames = shifts.map((shift) => {
                  const posed = rebuild(skeleton.map((value, i) => value + shift[i]));
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
            let deltas = breastDisplacements(sides, which, rest);
            // the light model's skin is too coarse over the breast for the stretch of the upper pole: refine it there
            if (deltas && name === breastSkinMesh && mesh.geometry.index) {
              const last = deltas[deltas.length - 1];
              const index = mesh.geometry.index.array;
              const moved = new Uint8Array(rest.length / 3);
              for (let i = 0; i < moved.length; i++) if (last[i * 3] || last[i * 3 + 1] || last[i * 3 + 2]) moved[i] = 1;
              const region = moved.slice();
              for (let f = 0; f < index.length; f += 3) if (moved[index[f]] || moved[index[f + 1]] || moved[index[f + 2]]) region[index[f]] = region[index[f + 1]] = region[index[f + 2]] = 1;
              const edgeMm = meanEdgeLength(rest, index, region) / mm;
              if (subdivideRegion(mesh.geometry, region, edgeMm > 9 ? 2 : edgeMm > 4.5 ? 1 : 0)) {
                rest = restPositions();
                deltas = breastDisplacements(sides, which, rest);
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

  // ---- step-by-step sequences: key frames written by build_mammaplasty_steps.py ----------------------------
  const surgery = useRef<{ key: string | null; meshes: THREE.Mesh[]; request: number; level: number }>({ key: null, meshes: [], request: 0, level: 0 });
  const setSurgeryLevel = (level: number) => {
    surgery.current.level = level;
    const influences = levelInfluences(level, stepFrameCount - 1);
    for (const mesh of surgery.current.meshes) {
      const target = mesh.morphTargetInfluences;
      if (target) for (let k = 0; k < target.length; k++) target[k] = influences[k] ?? 0;
    }
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
          const deltas = step.positions.slice(1).map((frame) => frame.map((value, i) => value - base[i]));
          stepMorphs.set(geometry, setMorphTargets(mesh, deltas));
        }
        meshes.push(mesh);
      }
    });
    state.key = technique;
    state.meshes = meshes;
    setSurgeryLevel(state.level);
  };
  const setSkinHole = async (on: boolean) => {
    let changed = false;
    for (const mesh of meshesByName.get(breastSkinMesh) ?? []) {
      const geometry = mesh.geometry;
      let hole = skinHoles.get(geometry);
      if (hole && geometry.index !== hole.full && geometry.index !== hole.open) hole = undefined;
      if (!hole) {
        if (!on || !geometry.index) continue;
        const side = (await loadBreastSides()).op;
        if (!alive.current) return;
        // a triangle goes when its three corners (rest pose) fall inside the outline of the patch, drawn in the chart
        // of the operated breast slightly inside the patch: the skin that stays then overlaps the patch, never leaves a gap
        const full = geometry.index;
        const index = full.array;
        const attribute = geometry.attributes.position;
        const toModel = restMatrix(mesh);
        const p = new THREE.Vector3();
        const within = new Uint8Array(attribute.count);
        for (let i = 0; i < attribute.count; i++) {
          p.fromBufferAttribute(attribute, i).applyMatrix4(toModel);
          const [u, v, depth] = side.chart(p.x, p.y, p.z);
          within[i] = depth > -30 && u > holeBox[0] && u < holeBox[2] && v > holeBox[1] && v < holeBox[3] && insidePolygon(u, v, stepHole) ? 1 : 0;
        }
        const kept: number[] = [];
        for (let f = 0; f < index.length; f += 3) if (!(within[index[f]] && within[index[f + 1]] && within[index[f + 2]])) kept.push(index[f], index[f + 1], index[f + 2]);
        const array = index instanceof Uint32Array ? Uint32Array.from(kept) : Uint16Array.from(kept);
        hole = { full, open: new THREE.BufferAttribute(array, 1) };
        skinHoles.set(geometry, hole);
      }
      const index = on ? hole.open : hole.full;
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

  // materials, visibility, clipping
  useEffect(() => {
    const targets = new Set(proximityKey ? proximityKey.split(",") : []);
    const cache = new Map<string, THREE.Material>();
    scene.traverse((object) => {
      if (!isMesh(object)) return;
      const record = recordFor(object);
      if (!record) {
        object.visible = false;
        return;
      }
      object.visible = visible(record.structure);
      if (!object.visible) return;
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
        solid: Boolean(solid?.has(record.structure)),
        vertexColors: painted,
        base: record.color,
        baseOpacity: record.opacity,
      };
      const key = `${record.tissue}|${record.color ?? ""}|${record.opacity ?? ""}|${opts.active}|${viewMode}|${opts.selected}|${override}|${opts.emphasis}|${opts.translucent}|${opts.solid}|${painted}|${list.includes(planes.cut as THREE.Plane)}${list.includes(planes.skin as THREE.Plane)}${list.includes(planes.step as THREE.Plane)}`;
      let material = cache.get(key);
      if (!material) {
        material = makeMaterial(record.tissue, opts);
        cache.set(key, material);
      }
      object.material = material;
      object.renderOrder = material.transparent ? (record.tissue === "skin" ? 3 : 2) : 0;
      object.castShadow = !lowPower && !material.transparent;
      object.receiveShadow = !lowPower;
    });
    invalidate();
    return () => cache.forEach((material) => material.dispose());
  }, [scene, visible, activeStructures, viewMode, planes, selected, selectedMeshes, translucent, solid, proximityKey, highlight, emphasised, lowPower, invalidate]);

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
