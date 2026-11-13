/**
 * Local refinement of an indexed triangle mesh: every edge whose two ends lie inside a region gets a
 * midpoint vertex, and the triangles around it are split accordingly (1-to-4 inside, 1-to-2 or 1-to-3
 * along the border), so the result has no cracks or T-junctions.
 *
 * Used on the trunk skin of the light (phone) model before the breast states are computed: its triangles
 * over the breast are about 7 mm wide and ptosis stretches the upper pole threefold, which would show as
 * facets. The refined surface is the same surface at rest (midpoints lie on the existing triangles); only
 * the deformation is sampled more finely.
 */
import * as THREE from "three";

/** One pass. `inside[i]` marks the vertices of the region. Returns the number of vertices added. */
function refineOnce(geometry: THREE.BufferGeometry, inside: Uint8Array): { added: number; inside: Uint8Array } {
  const index = geometry.index;
  if (!index) return { added: 0, inside };
  const count = geometry.attributes.position.count;
  const old = index.array;
  const midpoint = new Map<number, number>();
  const pairs: number[] = [];
  const mid = (a: number, b: number) => {
    if (!inside[a] || !inside[b]) return -1;
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
  if (!added) return { added: 0, inside };
  // attributes as plain floats (what the shader sees), old vertices first, then the midpoints
  for (const name of Object.keys(geometry.attributes)) {
    const source = geometry.attributes[name];
    const size = source.itemSize;
    const values = new Float32Array((count + added) * size);
    for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) values[i * size + k] = source.getComponent(i, k);
    for (let m = 0; m < added; m++) {
      const a = pairs[m * 2], b = pairs[m * 2 + 1];
      const at = (count + m) * size;
      let length = 0;
      for (let k = 0; k < size; k++) {
        values[at + k] = (values[a * size + k] + values[b * size + k]) / 2;
        length += values[at + k] ** 2;
      }
      if (name === "normal" && length > 0) for (let k = 0; k < size; k++) values[at + k] /= Math.sqrt(length);
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
  }
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(triangles), 1));
  const grown = new Uint8Array(count + added);
  grown.set(inside);
  grown.fill(1, count);
  return { added, inside: grown };
}

/**
 * Refines the region of `geometry` marked by `inside` (one flag per vertex) `levels` times.
 * The geometry is changed in place (attributes become plain float arrays). Returns the vertices added.
 */
export function subdivideRegion(geometry: THREE.BufferGeometry, inside: Uint8Array, levels: number): number {
  let total = 0;
  let region = inside;
  for (let level = 0; level < levels; level++) {
    const result = refineOnce(geometry, region);
    if (!result.added) break;
    total += result.added;
    region = result.inside;
  }
  if (total) {
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.dispose();
  }
  return total;
}

/** Mean edge length (in the units of `positions`) of the triangles whose three vertices are inside the region. */
export function meanEdgeLength(positions: ArrayLike<number>, index: ArrayLike<number>, inside: Uint8Array): number {
  let sum = 0;
  let n = 0;
  for (let f = 0; f < index.length; f += 3) {
    const a = index[f], b = index[f + 1], c = index[f + 2];
    if (!inside[a] || !inside[b] || !inside[c]) continue;
    for (const [i, j] of [[a, b], [b, c], [c, a]]) {
      sum += Math.hypot(positions[i * 3] - positions[j * 3], positions[i * 3 + 1] - positions[j * 3 + 1], positions[i * 3 + 2] - positions[j * 3 + 2]);
      n++;
    }
  }
  return n ? sum / n : 0;
}

/**
 * Vertices of the triangles that some deformation stretches beyond `limit`: `positions` at rest and `shift` (the
 * displacement of every vertex) in the same units. Used to refine, once more, only where a large breast state
 * still stretches the skin into long facets (the upper pole of the pendulous breasts).
 */
export function stretchedRegion(positions: ArrayLike<number>, shift: ArrayLike<number>, index: ArrayLike<number>, limit: number): Uint8Array {
  const inside = new Uint8Array(positions.length / 3);
  const at = (i: number, k: number) => positions[i * 3 + k] + shift[i * 3 + k];
  const length = (i: number, j: number) => Math.hypot(at(i, 0) - at(j, 0), at(i, 1) - at(j, 1), at(i, 2) - at(j, 2));
  for (let f = 0; f < index.length; f += 3) {
    const a = index[f], b = index[f + 1], c = index[f + 2];
    if (length(a, b) > limit || length(b, c) > limit || length(c, a) > limit) inside[a] = inside[b] = inside[c] = 1;
  }
  return inside;
}
