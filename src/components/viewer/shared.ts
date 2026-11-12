import * as THREE from "three";
import { planPoints } from "@/data/mammaplasty";
import { stepPoints } from "@/lib/mammaplastySteps";
import { modelLandmarks as L, modelMeshes, modelStructures, type Landmark, type ModelLandmarks } from "@/lib/modelConfig";

export const meshRecordByName = new Map(modelMeshes.map((mesh) => [mesh.name, mesh]));
export const structureById = new Map(modelStructures.map((structure) => [structure.id, structure]));
export const mm = L.unitsPerMm;
export const v3 = (p: Landmark) => new THREE.Vector3(...p);

export function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

/** gltfpack keeps the source node name on the parent of each quantised mesh. */
export function namedNode(object: THREE.Object3D): THREE.Object3D | undefined {
  if (meshRecordByName.has(object.name)) return object;
  if (object.parent && meshRecordByName.has(object.parent.name)) return object.parent;
  return undefined;
}

export function recordFor(object: THREE.Object3D) {
  const node = namedNode(object);
  return node ? meshRecordByName.get(node.name) : undefined;
}

/**
 * Snaps a point to the nearest real vertex of a structure (model space). `near` is a rest-pose point
 * (landmarks are defined on the anatomical position): the search runs on the rest positions and the
 * answer is where that vertex is now, so labels and zones ride on the deformed muscles of an arm pose.
 */
export type Snapper = {
  (structureId: string, near: Landmark): Landmark | undefined;
  /** where a rest-pose point is carried by the current arm pose (displacement of the nearest sampled vertex) */
  follow: (point: Landmark) => Landmark;
};

const derived: Record<string, () => Landmark> = {
  breastLateral: () => [L.breastBounds.min[0], L.breastCenter[1], L.breastCenter[2]],
  breastMedial: () => [L.breastBounds.max[0], L.breastCenter[1], L.breastCenter[2]],
  /** middle of the breast profile: halfway between the fold and the nipple tip, a little above the fold */
  breastProfile: () => [(L.inframammaryFold[0] + L.nipple[0]) / 2, L.inframammaryFold[1] + 15 * L.unitsPerMm, (L.inframammaryFold[2] + L.nipple[2]) / 2],
};

/** A landmark name ("key" or "key.index"), a derived landmark, a point of a surgical plan or a structure id, resolved to a model-space point. */
export function resolvePoint(key: string): Landmark | undefined {
  if (derived[key]) return derived[key]();
  if (planPoints[key]) return planPoints[key].rest;
  if (stepPoints[key]) return stepPoints[key];
  const [name, index] = key.split(".");
  const value = (L as unknown as Record<string, unknown>)[name];
  if (Array.isArray(value)) {
    if (index !== undefined && Array.isArray(value[Number(index)])) return value[Number(index)] as Landmark;
    if (value.length === 3 && typeof value[0] === "number") return value as Landmark;
  }
  return structureById.get(key)?.labelAnchor;
}

export type LandmarkKey = keyof ModelLandmarks;

/** Builds the snapper from the meshes as they are now (rigid manipulations and arm-pose morphs included). */
export function buildSnapper(root: THREE.Object3D): Snapper {
  root.updateMatrixWorld(true);
  const toModel = root.matrixWorld.clone().invert();
  const restLists = new Map<string, number[]>();
  const posedLists = new Map<string, number[]>();
  const vertex = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  let posedAny = false;
  root.traverse((object) => {
    if (!isMesh(object)) return;
    const record = recordFor(object);
    if (!record) return;
    matrix.copy(toModel).multiply(object.matrixWorld);
    const position = object.geometry.attributes.position;
    const stride = Math.max(1, Math.floor(position.count / 3000));
    const rest = restLists.get(record.structure) ?? [];
    const posed = posedLists.get(record.structure) ?? [];
    // posed meshes (arm poses are morph targets): remember both the rest and the deformed position
    const morphed = Boolean(object.morphTargetInfluences?.some((value) => value !== 0));
    posedAny ||= morphed;
    for (let i = 0; i < position.count; i += stride) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
      rest.push(vertex.x, vertex.y, vertex.z);
      if (morphed) object.getVertexPosition(i, vertex).applyMatrix4(matrix);
      posed.push(vertex.x, vertex.y, vertex.z);
    }
    restLists.set(record.structure, rest);
    posedLists.set(record.structure, posed);
  });
  const restSamples = new Map([...restLists].map(([id, list]) => [id, new Float32Array(list)]));
  const posedSamples = posedAny ? new Map([...posedLists].map(([id, list]) => [id, new Float32Array(list)])) : restSamples;
  const nearestIn = (pts: Float32Array, near: Landmark) => {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      const d = (pts[i] - near[0]) ** 2 + (pts[i + 1] - near[1]) ** 2 + (pts[i + 2] - near[2]) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    return { best, bestDistance };
  };
  const snap = ((structureId: string, near: Landmark) => {
    const pts = restSamples.get(structureId);
    if (!pts?.length) return undefined;
    const { best } = nearestIn(pts, near);
    const posed = posedSamples.get(structureId)!;
    return [posed[best], posed[best + 1], posed[best + 2]] as Landmark;
  }) as Snapper;
  snap.follow = (point) => {
    if (!posedAny) return point;
    let owner = "";
    let at = -1;
    let bestDistance = Infinity;
    restSamples.forEach((pts, id) => {
      const { best, bestDistance: d } = nearestIn(pts, point);
      if (d < bestDistance) {
        bestDistance = d;
        at = best;
        owner = id;
      }
    });
    if (at < 0) return point;
    const rest = restSamples.get(owner)!;
    const posed = posedSamples.get(owner)!;
    return [point[0] + posed[at] - rest[at], point[1] + posed[at + 1] - rest[at + 1], point[2] + posed[at + 2] - rest[at + 2]];
  };
  return snap;
}

export { wallColors } from "@/lib/annotations";
