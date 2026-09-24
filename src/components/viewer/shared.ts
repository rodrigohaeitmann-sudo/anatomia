import * as THREE from "three";
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

export type Snapper = (structureId: string, near: Landmark) => Landmark | undefined;

const derived: Record<string, () => Landmark> = {
  breastLateral: () => [L.breastBounds.min[0], L.breastCenter[1], L.breastCenter[2]],
  breastMedial: () => [L.breastBounds.max[0], L.breastCenter[1], L.breastCenter[2]],
};

/** A landmark name ("key" or "key.index"), a derived landmark, or a structure id, resolved to a model-space point. */
export function resolvePoint(key: string): Landmark | undefined {
  if (derived[key]) return derived[key]();
  const [name, index] = key.split(".");
  const value = (L as unknown as Record<string, unknown>)[name];
  if (Array.isArray(value)) {
    if (index !== undefined && Array.isArray(value[Number(index)])) return value[Number(index)] as Landmark;
    if (value.length === 3 && typeof value[0] === "number") return value as Landmark;
  }
  return structureById.get(key)?.labelAnchor;
}

export type LandmarkKey = keyof ModelLandmarks;

/** Builds a lookup that snaps a point to the nearest real vertex of a structure (model space). */
export function buildSnapper(root: THREE.Object3D): Snapper {
  root.updateMatrixWorld(true);
  const toModel = root.matrixWorld.clone().invert();
  const collected = new Map<string, number[]>();
  const vertex = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  root.traverse((object) => {
    if (!isMesh(object)) return;
    const record = recordFor(object);
    if (!record) return;
    matrix.copy(toModel).multiply(object.matrixWorld);
    const position = object.geometry.attributes.position;
    const stride = Math.max(1, Math.floor(position.count / 3000));
    const list = collected.get(record.structure) ?? [];
    for (let i = 0; i < position.count; i += stride) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
      list.push(vertex.x, vertex.y, vertex.z);
    }
    collected.set(record.structure, list);
  });
  const samples = new Map([...collected].map(([id, list]) => [id, new Float32Array(list)]));
  return (structureId, near) => {
    const pts = samples.get(structureId);
    if (!pts?.length) return undefined;
    let best = 0;
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

export const wallColors = ["#22d3ee", "#a3e635", "#f472b6", "#facc15", "#fb923c", "#a78bfa"];
