/**
 * Meshes built on the device from compact descriptions written by the pipeline:
 *
 *  - schematic breast anatomy (src/data/breastAnatomy.json, scripts/hybrid/build_breast_anatomy.py): arteries
 *    that enter the breast, nerves of the nipple-areola complex, the horizontal septum and its ligaments;
 *  - surgical plans (src/data/mammaplasty<-case>.json + mammaplasty<-case>.bin, scripts/hybrid/build_mammaplasty.py):
 *    pre-operative markings (pen lines) and the pedicle and resection of every technique, in every case;
 *  - the step-by-step sequences (src/lib/mammaplastySteps.ts): empty meshes here, filled by the viewer with the
 *    key frames of a technique when one of its views opens.
 *
 * Centre lines and mid-surfaces are carried by the breast map and the tube or slab is rebuilt around them,
 * so vessels and pen lines keep their calibre when the breast changes shape. Pieces are closed meshes whose
 * vertices move with the map like those of the gland.
 */
import * as THREE from "three";
import data from "@/data/breastAnatomy.json";
import { planFiles } from "@/data/planCases";
import { stepMeshNames } from "@/lib/mammaplastySteps";

/**
 * `clearance`: per breast state, a sparse push of the centre line (sample index, then xyz in model units) that keeps the
 * tube under the skin where the map thins the layer above it; `lengthsMm`: length of the course at rest and per state.
 */
type TubeData = { kind: "tube"; points: number[]; radiusMm: number[]; clearance?: Record<string, number[][]>; lengthsMm?: Record<string, number> };
type SheetData = { kind: "sheet"; size: number[]; points: number[]; thicknessMm: number };
/** closed mesh in a plan's binary (`plan`: which case): positions as uint16 between min and max, then uint16 indices */
type SolidData = { kind: "solid"; byteOffset: number; vertices: number; triangles: number; min: number[]; max: number[]; plan?: number };

const plans = planFiles as { bin: string; geometry: Record<string, TubeData | SolidData> }[];
const geometryData = { ...data.geometry } as unknown as Record<string, TubeData | SheetData | SolidData>;
plans.forEach((plan, index) => {
  for (const [name, item] of Object.entries(plan.geometry)) geometryData[name] = item.kind === "solid" ? { ...item, plan: index } : item;
});
let planBins: ArrayBuffer[] | null = null;
let planRequest: Promise<void> | null = null;

/**
 * Binaries with the pieces of the surgical plans, one per case. Suspends the calling component until they are loaded
 * (requested once, with the model). A binary that cannot be loaded leaves its pieces out; the model still opens.
 */
export function readPlanBin(): ArrayBuffer[] {
  if (planBins) return planBins;
  if (!planRequest) {
    planRequest = Promise.all(
      plans.map((plan) =>
        fetch(plan.bin)
          .then((response) => (response.ok ? response.arrayBuffer() : new ArrayBuffer(0)))
          .catch(() => new ArrayBuffer(0)),
      ),
    ).then((buffers) => {
      planBins = buffers;
    });
  }
  throw planRequest;
}

/** Centre line and calibre kept on a tube mesh (`mesh.userData.tube`), in model units. */
export type TubeSpec = { points: Float32Array; radii: [number, number]; sides: number };
/** Mid-surface grid and thickness kept on a sheet mesh (`mesh.userData.sheet`), in model units. */
export type SheetSpec = { points: Float32Array; size: [number, number]; thickness: number };

export const schematicMeshNames = Object.keys(geometryData);

/**
 * Push of a tube's centre line in each breast state (`stateIds`, in the order of the morph targets), as dense xyz
 * arrays (model units) to add after the breast map; null for a state without one.
 */
export function tubeClearance(name: string, stateIds: string[]): (Float32Array | null)[] | null {
  const item = geometryData[name];
  if (item?.kind !== "tube" || !item.clearance) return null;
  const length = item.points.length;
  return stateIds.map((id) => {
    const sparse = item.clearance?.[id];
    if (!sparse) return null;
    const dense = new Float32Array(length);
    for (const [index, x, y, z] of sparse) dense.set([x, y, z], index * 3);
    return dense;
  });
}

/** Lengths (mm) of the schematic tubes at rest ("rest") and in every breast state, by mesh name. */
export const tubeLengths = Object.fromEntries(
  Object.entries(data.geometry as unknown as Record<string, TubeData | SheetData>)
    .filter((entry): entry is [string, TubeData] => entry[1].kind === "tube" && Boolean((entry[1] as TubeData).lengthsMm))
    .map(([name, item]) => [name, { lengths: item.lengthsMm as Record<string, number>, radiusMm: item.radiusMm }]),
);

/**
 * Vertices of a tube around a centre line: one ring of `sides` vertices per point (parallel transport
 * frames, linear taper) followed by the two end points (centres of the end fans).
 */
export function tubeVertices(points: ArrayLike<number>, radii: [number, number], sides: number): Float32Array {
  const count = points.length / 3;
  const out = new Float32Array((count * sides + 2) * 3);
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const at = (i: number, target: THREE.Vector3) => target.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const tangentAt = (i: number) => {
    at(Math.min(i + 1, count - 1), a);
    at(Math.max(i - 1, 0), b);
    return tangent.subVectors(a, b).normalize();
  };
  tangentAt(0);
  normal.set(0, 1, 0);
  if (Math.abs(tangent.y) >= 0.9) normal.set(1, 0, 0);
  normal.crossVectors(tangent, normal).normalize();
  for (let i = 0; i < count; i++) {
    tangentAt(i);
    normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
    binormal.crossVectors(tangent, normal);
    const radius = radii[0] + ((radii[1] - radii[0]) * i) / Math.max(1, count - 1);
    for (let k = 0; k < sides; k++) {
      const angle = (k / sides) * Math.PI * 2;
      const c = Math.cos(angle) * radius;
      const s = Math.sin(angle) * radius;
      const o = (i * sides + k) * 3;
      out[o] = points[i * 3] + c * normal.x + s * binormal.x;
      out[o + 1] = points[i * 3 + 1] + c * normal.y + s * binormal.y;
      out[o + 2] = points[i * 3 + 2] + c * normal.z + s * binormal.z;
    }
  }
  for (let c = 0; c < 3; c++) {
    out[count * sides * 3 + c] = points[c];
    out[(count * sides + 1) * 3 + c] = points[(count - 1) * 3 + c];
  }
  return out;
}

function tubeIndex(count: number, sides: number) {
  const index: number[] = [];
  for (let i = 0; i < count - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const a = i * sides + k;
      const b = i * sides + ((k + 1) % sides);
      index.push(a, b, a + sides, b, b + sides, a + sides);
    }
  }
  const first = count * sides;
  const last = first + 1;
  for (let k = 0; k < sides; k++) {
    index.push(first, (k + 1) % sides, k);
    index.push(last, (count - 1) * sides + k, (count - 1) * sides + ((k + 1) % sides));
  }
  return index;
}

/**
 * Vertices of a thin slab around a mid-surface grid (nu x nv points): the grid moved half the thickness along
 * its normals, then the opposite face. A closed solid, so that sections show the sheet as a filled band.
 */
export function sheetVertices(points: ArrayLike<number>, size: [number, number], thickness: number): Float32Array {
  const [nu, nv] = size;
  const count = nu * nv;
  const out = new Float32Array(count * 6);
  const du = new THREE.Vector3();
  const dv = new THREE.Vector3();
  const n = new THREE.Vector3();
  const at = (i: number, j: number, c: number) => points[(i * nv + j) * 3 + c];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, nu - 1), j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, nv - 1);
      du.set(at(i1, j, 0) - at(i0, j, 0), at(i1, j, 1) - at(i0, j, 1), at(i1, j, 2) - at(i0, j, 2));
      dv.set(at(i, j1, 0) - at(i, j0, 0), at(i, j1, 1) - at(i, j0, 1), at(i, j1, 2) - at(i, j0, 2));
      n.crossVectors(du, dv);
      // where the grid converges to a point (apex of a fan) the normal of the neighbour is good enough
      if (n.lengthSq() < 1e-20) n.set(0, 1, 0);
      n.normalize().multiplyScalar(thickness / 2);
      const k = (i * nv + j) * 3;
      for (let c = 0; c < 3; c++) {
        out[k + c] = points[k + c] + n.getComponent(c);
        out[count * 3 + k + c] = points[k + c] - n.getComponent(c);
      }
    }
  }
  return out;
}

function sheetIndex(nu: number, nv: number) {
  const index: number[] = [];
  const count = nu * nv;
  for (let i = 0; i < nu - 1; i++) {
    for (let j = 0; j < nv - 1; j++) {
      const a = i * nv + j;
      const b = a + nv;
      index.push(a, b, b + 1, a, b + 1, a + 1);
      index.push(count + a, count + b + 1, count + b, count + a, count + a + 1, count + b + 1);
    }
  }
  // rim: join the two faces along the four borders
  const rim = (a: number, b: number) => index.push(a, count + a, count + b, a, count + b, b);
  for (let i = 0; i < nu - 1; i++) {
    rim((i + 1) * nv, i * nv);
    rim(i * nv + nv - 1, (i + 1) * nv + nv - 1);
  }
  for (let j = 0; j < nv - 1; j++) {
    rim(j, j + 1);
    rim((nu - 1) * nv + j + 1, (nu - 1) * nv + j);
  }
  return index;
}

// geometries are shared by every mount of the model, like those of the glTF (one set per tube resolution)
const cache = new Map<string, { geometry: THREE.BufferGeometry; tube?: TubeSpec; sheet?: SheetSpec }>();

/** Geometries of the step meshes, shared by every mount (filled once per technique). */
const stepCache = new Map<string, THREE.BufferGeometry>();

/**
 * One mesh per generated part, in model space, named as in the manifests (`sides`: tube resolution;
 * `planBins`: contents of the plans' binaries, for the pieces; the step meshes start empty).
 */
export function buildSchematicMeshes(unitsPerMm: number, sides: number, planBins: ArrayBuffer[]): THREE.Mesh[] {
  const meshes = schematicMeshNames.map((name) => {
    const key = `${name}|${sides}`;
    let entry = cache.get(key);
    if (!entry) {
      const item = geometryData[name];
      const geometry = new THREE.BufferGeometry();
      let tube: TubeSpec | undefined;
      let sheet: SheetSpec | undefined;
      if (item.kind === "tube") {
        tube = { points: Float32Array.from(item.points), radii: [item.radiusMm[0] * unitsPerMm, item.radiusMm[1] * unitsPerMm], sides };
        geometry.setAttribute("position", new THREE.BufferAttribute(tubeVertices(tube.points, tube.radii, sides), 3));
        geometry.setIndex(tubeIndex(tube.points.length / 3, sides));
      } else if (item.kind === "solid") {
        const planBin = planBins[item.plan ?? 0] ?? new ArrayBuffer(0);
        if (planBin.byteLength < item.byteOffset + item.vertices * 6 + item.triangles * 6) return null;
        const quantised = new Uint16Array(planBin.slice(item.byteOffset, item.byteOffset + item.vertices * 6));
        const positions = new Float32Array(item.vertices * 3);
        for (let i = 0; i < positions.length; i++) positions[i] = item.min[i % 3] + (quantised[i] / 65535) * (item.max[i % 3] - item.min[i % 3]);
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(planBin.slice(item.byteOffset + item.vertices * 6, item.byteOffset + item.vertices * 6 + item.triangles * 6)), 1));
      } else {
        sheet = { points: Float32Array.from(item.points), size: [item.size[0], item.size[1]], thickness: item.thicknessMm * unitsPerMm };
        geometry.setAttribute("position", new THREE.BufferAttribute(sheetVertices(sheet.points, sheet.size, sheet.thickness), 3));
        geometry.setIndex(sheetIndex(sheet.size[0], sheet.size[1]));
      }
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      entry = { geometry, tube, sheet };
      cache.set(key, entry);
    }
    const mesh = new THREE.Mesh(entry.geometry);
    mesh.name = name;
    if (entry.tube) mesh.userData.tube = entry.tube;
    if (entry.sheet) mesh.userData.sheet = entry.sheet;
    return mesh;
  });
  // the step-by-step sequences: an empty triangle until their technique is opened (HybridModel.prepareSurgery)
  for (const name of stepMeshNames) {
    let geometry = stepCache.get(name);
    if (!geometry) {
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(9), 3));
      geometry.setIndex([0, 1, 2]);
      stepCache.set(name, geometry);
    }
    const mesh = new THREE.Mesh(geometry);
    mesh.name = name;
    meshes.push(mesh);
  }
  return meshes.filter((mesh): mesh is THREE.Mesh => mesh !== null);
}
