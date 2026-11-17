/**
 * Local refinement of an indexed triangle mesh: every edge whose two ends lie inside a region gets a
 * midpoint vertex, and the triangles around it are split accordingly (1-to-4 inside, 1-to-2 or 1-to-3
 * along the border), so the result has no cracks or T-junctions.
 *
 * Used on the trunk skin before the breast states are computed: ptosis and hypertrophy stretch the upper pole up to
 * tenfold, which shows as long facets. refineEdges halves the edges a state stretches beyond a limit, placing the
 * midpoints on the curved surface of the vertex normals, so the refined skin is smooth at rest and samples the
 * deformation finely (docs/plano-pele-habito-vasos.md, phase F).
 */
import * as THREE from "three";

/**
 * One pass: every edge `split(a, b)` accepts gets a midpoint. With `smooth`, the midpoint of the positions lies on the
 * curved surface the vertex normals describe (the edge of a PN triangle: m = (a + b) / 2 - [((b - a)·na) na +
 * ((a - b)·nb) nb] / 8), so the refined surface is smooth at rest instead of keeping the facets of the coarse one; every
 * other attribute is averaged (normals renormalised). Returns the number of vertices added.
 */
function refinePass(geometry: THREE.BufferGeometry, split: (a: number, b: number) => boolean, smooth: boolean): number {
  const index = geometry.index;
  if (!index) return 0;
  const count = geometry.attributes.position.count;
  const old = index.array;
  const midpoint = new Map<number, number>();
  const pairs: number[] = [];
  const mid = (a: number, b: number) => {
    if (!split(a, b)) return -1;
    const key = a < b ? a * count + b : b * count + a;
    let id = midpoint.get(key);
    if (id === undefined) {
      id = count + pairs.length / 2;
      midpoint.set(key, id);
      pairs.push(a, b);
    }
    return id;
  };
  const triangles: number[] = [];
  for (let f = 0; f < old.length; f += 3) {
    const a = old[f], b = old[f + 1], c = old[f + 2];
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    const split = Number(ab >= 0) + Number(bc >= 0) + Number(ca >= 0);
    if (split === 0) triangles.push(a, b, c);
    else if (split === 3) triangles.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    else if (split === 1) {
      if (ab >= 0) triangles.push(a, ab, c, ab, b, c);
      else if (bc >= 0) triangles.push(b, bc, a, bc, c, a);
      else triangles.push(c, ca, b, ca, a, b);
    } else if (ab < 0) triangles.push(c, ca, bc, ca, a, bc, a, b, bc);
    else if (bc < 0) triangles.push(a, ab, ca, ab, b, ca, b, c, ca);
    else triangles.push(b, bc, ab, bc, c, ab, c, a, ab);
  }
  const added = pairs.length / 2;
  if (!added) return 0;
  // normals of the old vertices, for the curved midpoints
  const normal = smooth ? geometry.attributes.normal : undefined;
  const n = normal ? new Float32Array(count * 3) : null;
  if (normal && n) for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) n[i * 3 + k] = normal.getComponent(i, k);
  // attributes as plain floats (what the shader sees), old vertices first, then the midpoints
  for (const name of Object.keys(geometry.attributes)) {
    const source = geometry.attributes[name];
    const size = source.itemSize;
    const values = new Float32Array((count + added) * size);
    for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) values[i * size + k] = source.getComponent(i, k);
    const curved = name === "position" && n !== null && size === 3;
    for (let m = 0; m < added; m++) {
      const a = pairs[m * 2], b = pairs[m * 2 + 1];
      const at = (count + m) * size;
      let length = 0;
      for (let k = 0; k < size; k++) {
        values[at + k] = (values[a * size + k] + values[b * size + k]) / 2;
        length += values[at + k] ** 2;
      }
      if (curved) {
        let wa = 0, wb = 0;
        for (let k = 0; k < 3; k++) {
          const e = values[b * 3 + k] - values[a * 3 + k];
          wa += e * n[a * 3 + k];
          wb -= e * n[b * 3 + k];
        }
        for (let k = 0; k < 3; k++) values[at + k] -= (wa * n[a * 3 + k] + wb * n[b * 3 + k]) / 8;
      }
      if (name === "normal" && length > 0) for (let k = 0; k < size; k++) values[at + k] /= Math.sqrt(length);
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
  }
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(triangles), 1));
  return added;
}

function refreshBounds(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.dispose();
}

/**
 * One pass of refinement driven by the edges themselves: every edge `split(a, b)` accepts is halved (the caller tests
 * the deformed length, for instance), with curved midpoints when `smooth`. Old vertices keep their indices; the
 * midpoints are appended. Returns the vertices added.
 */
export function refineEdges(geometry: THREE.BufferGeometry, split: (a: number, b: number) => boolean, smooth = true): number {
  const added = refinePass(geometry, split, smooth);
  if (added) refreshBounds(geometry);
  return added;
}
