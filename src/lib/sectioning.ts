import * as THREE from "three";

export type SectionAxis = "transverse" | "sagittal" | "coronal";

export type SectionLoop = {
  structure: string;
  tissue: string;
  meshName: string;
  closed: boolean;
  /** 2D coordinates in the section plane basis (u, v) */
  points: Float32Array;
  area: number;
};

export type SectionResult = {
  axis: SectionAxis;
  basis: { u: THREE.Vector3; v: THREE.Vector3; n: THREE.Vector3; offset: number };
  loops: SectionLoop[];
};

/**
 * Plane basis per axis (model space, anterior = +Z, cranial = +Y, operative right side = -X).
 * u/v follow radiological conventions for the 2D view: transverse seen from the feet
 * (patient's right on image left, anterior up), sagittal seen from the operative side
 * (anterior on image left), coronal seen from the front.
 */
export function sectionBasis(axis: SectionAxis) {
  if (axis === "transverse") return { u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 0, 1), n: new THREE.Vector3(0, -1, 0) };
  if (axis === "sagittal") return { u: new THREE.Vector3(0, 0, -1), v: new THREE.Vector3(0, 1, 0), n: new THREE.Vector3(1, 0, 0) };
  return { u: new THREE.Vector3(1, 0, 0), v: new THREE.Vector3(0, 1, 0), n: new THREE.Vector3(0, 0, 1) };
}

/** Axis coordinate of a model-space point along the section normal direction (x, y or z). */
export function axisComponent(axis: SectionAxis) {
  return axis === "transverse" ? 1 : axis === "sagittal" ? 0 : 2;
}

/** Clipping plane in model space; the kept half is on the side the normal points to. */
export function sectionPlane(axis: SectionAxis, position: number, flip: boolean) {
  const { n } = sectionBasis(axis);
  const normal = flip ? n.clone().negate() : n.clone();
  // plane through the point (position along the axis): normal · p + constant = 0
  const point = new THREE.Vector3();
  point.setComponent(axisComponent(axis), position);
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
}

type Decoded = { positions: Float32Array; index: ArrayLike<number>; box: THREE.Box3 };
const decodedCache = new WeakMap<THREE.BufferGeometry, Decoded>();

function decode(geometry: THREE.BufferGeometry): Decoded {
  const cached = decodedCache.get(geometry);
  if (cached) return cached;
  const attribute = geometry.attributes.position;
  const positions = new Float32Array(attribute.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < attribute.count; i++) {
    v.fromBufferAttribute(attribute, i);
    positions[i * 3] = v.x;
    positions[i * 3 + 1] = v.y;
    positions[i * 3 + 2] = v.z;
  }
  const index = geometry.index ? geometry.index.array : Uint32Array.from({ length: attribute.count }, (_, i) => i);
  geometry.computeBoundingBox();
  const decoded = { positions, index, box: geometry.boundingBox!.clone() };
  decodedCache.set(geometry, decoded);
  return decoded;
}

export type SliceTarget = { mesh: THREE.Mesh; structure: string; tissue: string; meshName: string; toModel: THREE.Matrix4 };

/** Intersects every target mesh with the plane (model space) and returns chained contour loops. */
export function computeSection(targets: SliceTarget[], axis: SectionAxis, plane: THREE.Plane): SectionResult {
  const basis = sectionBasis(axis);
  const loops: SectionLoop[] = [];
  const localPlane = new THREE.Plane();
  const inverse = new THREE.Matrix4();
  const box = new THREE.Box3();

  for (const target of targets) {
    const { positions, index, box: localBox } = decode(target.mesh.geometry);
    box.copy(localBox).applyMatrix4(target.toModel);
    if (!plane.intersectsBox(box)) continue;
    inverse.copy(target.toModel).invert();
    localPlane.copy(plane).applyMatrix4(inverse);
    const nx = localPlane.normal.x, ny = localPlane.normal.y, nz = localPlane.normal.z, c = localPlane.constant;
    const vertexCount = positions.length / 3;
    const dist = new Float32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      const d = nx * positions[i * 3] + ny * positions[i * 3 + 1] + nz * positions[i * 3 + 2] + c;
      dist[i] = d === 0 ? 1e-9 : d;
    }

    const pointOf = new Map<number, number>();
    const pts: number[] = [];
    const adjacency = new Map<number, number[]>();
    const edgePoint = (a: number, b: number) => {
      const lo = a < b ? a : b, hi = a < b ? b : a;
      const key = lo * vertexCount + hi;
      let id = pointOf.get(key);
      if (id === undefined) {
        const t = dist[lo] / (dist[lo] - dist[hi]);
        pts.push(
          positions[lo * 3] + (positions[hi * 3] - positions[lo * 3]) * t,
          positions[lo * 3 + 1] + (positions[hi * 3 + 1] - positions[lo * 3 + 1]) * t,
          positions[lo * 3 + 2] + (positions[hi * 3 + 2] - positions[lo * 3 + 2]) * t,
        );
        id = pts.length / 3 - 1;
        pointOf.set(key, id);
      }
      return id;
    };
    const link = (a: number, b: number) => {
      if (a === b) return;
      (adjacency.get(a) ?? adjacency.set(a, []).get(a)!).push(b);
      (adjacency.get(b) ?? adjacency.set(b, []).get(b)!).push(a);
    };

    for (let f = 0; f < index.length; f += 3) {
      const a = index[f], b = index[f + 1], cc = index[f + 2];
      const sa = dist[a] > 0, sb = dist[b] > 0, sc = dist[cc] > 0;
      if (sa === sb && sb === sc) continue;
      const crossing: number[] = [];
      if (sa !== sb) crossing.push(edgePoint(a, b));
      if (sb !== sc) crossing.push(edgePoint(b, cc));
      if (sc !== sa) crossing.push(edgePoint(cc, a));
      if (crossing.length === 2) link(crossing[0], crossing[1]);
    }
    if (!pts.length) continue;

    // chain segments into polylines / loops
    const visited = new Set<number>();
    const world = new THREE.Vector3();
    const toUV = (id: number, out: number[]) => {
      world.set(pts[id * 3], pts[id * 3 + 1], pts[id * 3 + 2]).applyMatrix4(target.toModel);
      out.push(world.dot(basis.u), world.dot(basis.v));
    };
    // open chains must start from an end point, closed loops from anywhere
    const keys = [...adjacency.keys()];
    const starts = [...keys.filter((k) => adjacency.get(k)!.length === 1), ...keys.filter((k) => adjacency.get(k)!.length !== 1)];
    for (const start of starts) {
      if (visited.has(start)) continue;
      const chain: number[] = [start];
      visited.add(start);
      let prev = -1, current = start, closed = false;
      for (;;) {
        const next = adjacency.get(current)!.find((n) => n !== prev && !visited.has(n));
        if (next === undefined) {
          closed = chain.length > 2 && adjacency.get(current)!.includes(start);
          break;
        }
        visited.add(next);
        chain.push(next);
        prev = current;
        current = next;
      }
      if (chain.length < 2) continue;
      const uv: number[] = [];
      chain.forEach((id) => toUV(id, uv));
      let area = 0;
      for (let i = 0, n = chain.length; i < n; i++) {
        const j = (i + 1) % n;
        area += uv[i * 2] * uv[j * 2 + 1] - uv[j * 2] * uv[i * 2 + 1];
      }
      loops.push({ structure: target.structure, tissue: target.tissue, meshName: target.meshName, closed, points: new Float32Array(uv), area: Math.abs(area) / 2 });
    }
  }
  return { axis, basis: { ...basis, offset: plane.constant }, loops };
}

export function pointInLoop(x: number, y: number, pts: Float32Array) {
  let inside = false;
  for (let i = 0, j = pts.length / 2 - 1; i < pts.length / 2; j = i++) {
    const xi = pts[i * 2], yi = pts[i * 2 + 1], xj = pts[j * 2], yj = pts[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Tissues whose sections are drawn filled (volumes); surfaces (skin, fasciae) are outlined only. */
export const filledTissues = new Set(["muscle", "bone", "cartilage", "fat", "gland", "duct", "artery", "vein", "nerve", "lymph-node", "nipple", "areola", "ligament"]);

/** Groups closed loops of one mesh into outer shapes with holes (even-odd nesting). */
export function shapesFor(loops: SectionLoop[]) {
  const closed = loops.filter((loop) => loop.closed && loop.points.length >= 6).sort((a, b) => b.area - a.area);
  const depth = closed.map((loop, i) => closed.slice(0, i).filter((other) => pointInLoop(loop.points[0], loop.points[1], other.points)).length);
  const shapes: { outer: SectionLoop; holes: SectionLoop[] }[] = [];
  closed.forEach((loop, i) => {
    if (depth[i] % 2 === 0) {
      shapes.push({ outer: loop, holes: [] });
    } else {
      for (let k = shapes.length - 1; k >= 0; k--) {
        if (pointInLoop(loop.points[0], loop.points[1], shapes[k].outer.points)) {
          shapes[k].holes.push(loop);
          break;
        }
      }
    }
  });
  return shapes;
}
