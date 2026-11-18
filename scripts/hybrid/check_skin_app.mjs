// The trunk skin as the app prepares it (docs/plano-pele-habito-vasos.md, phase F): the refinement of
// src/lib/subdivide.ts driven by the deformed edge length (breast maps of src/lib/breastMap.ts and body habitus of
// src/lib/habitusMap.ts, as HybridModel.prepareBreast does), then per state the longest deformed edge over the moving
// skin and the error of the normals the app computes (facets of the deformed mesh) against the normals of the smooth
// surface carried by the map (finite differences, on a sample of vertices).
// Usage: node scripts/hybrid/check_skin_app.mjs [--report]   (after decode_model.mjs, with and without --mobile)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { BreastSide } from "../../src/lib/breastMap.ts";
import { Habitus } from "../../src/lib/habitusMap.ts";
import { refineEdges } from "../../src/lib/subdivide.ts";

// as in HybridModel.tsx
const SKIN_EDGE_MM = { desktop: 5, phone: 7 };
const SKIN_REFINE_PASSES = 4;
const SKIN_REFINE_BUDGET = { desktop: 80000, phone: 30000 };
// normals of the facets against the carried ones: p95, and the worst vertex (the inframammary fold is a real crease)
const LIMITS = { normalP95Deg: 2.5, normalMaxDeg: 40 };

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => {
  const file = readFileSync(join(root, path));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
};
const breast = JSON.parse(readFileSync(join(root, "src/data/breastModel.json"), "utf8"));
const habitusData = JSON.parse(readFileSync(join(root, "src/data/habitusModel.json"), "utf8"));
const chart = read(join("public", breast.bin));
const sides = Object.values(breast.sides).map((data) => new BreastSide(data, breast, chart));
const habitus = new Habitus(habitusData, read(join("public", habitusData.bin)), breast.states.map((state) => state.id));
const mm = breast.unitsPerMm;
const states = breast.states.map((state) => state.id);

/** breast maps of both sides plus the habitus of the skin, per state (model units), as breastDisplacements(..., "skin") */
function displacements(positions) {
  const count = positions.length / 3;
  const total = states.map(() => new Float32Array(count * 3));
  for (const deltas of [...sides.map((side) => side.displacements(positions)), habitus.displacements(positions, true)]) {
    if (!deltas) continue;
    for (let k = 0; k < deltas.length; k++) {
      const frame = deltas[k];
      const out = total[k];
      for (let i = 0; i < frame.length; i++) out[i] += frame[i];
    }
  }
  return total;
}

function vertexNormals(positions, index, count) {
  const normals = new Float32Array(count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let f = 0; f < index.length; f += 3) {
    const [i0, i1, i2] = [index[f], index[f + 1], index[f + 2]];
    a.fromArray(positions, i0 * 3);
    b.fromArray(positions, i1 * 3);
    c.fromArray(positions, i2 * 3);
    const n = c.clone().sub(b).cross(a.clone().sub(b));
    for (const i of [i0, i1, i2]) for (let k = 0; k < 3; k++) normals[i * 3 + k] += n.getComponent(k);
  }
  for (let i = 0; i < count; i++) {
    const l = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) normals[i * 3 + k] /= l;
  }
  return normals;
}

let failed = false;
for (const [variant, dir] of [["desktop", "model-meshes"], ["phone", "model-meshes-mobile"]]) {
  const pos = new Float32Array(read(`assets/build/${dir}/hra_VH_F_skin.pos.bin`));
  const idx = new Uint32Array(read(`assets/build/${dir}/hra_VH_F_skin.idx.bin`));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos.slice(), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(vertexNormals(pos, idx, pos.length / 3), 3));
  geometry.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
  const start = performance.now();
  let rest = geometry.attributes.position.array;
  let deltas = displacements(rest);
  const limit = SKIN_EDGE_MM[variant] * mm;
  let added = 0;
  for (let pass = 0; pass < SKIN_REFINE_PASSES && added < SKIN_REFINE_BUDGET[variant]; pass++) {
    const frames = deltas;
    const p = rest;
    const tooLong = (a, b) => {
      for (const frame of frames) {
        const dx = p[a * 3] + frame[a * 3] - p[b * 3] - frame[b * 3];
        const dy = p[a * 3 + 1] + frame[a * 3 + 1] - p[b * 3 + 1] - frame[b * 3 + 1];
        const dz = p[a * 3 + 2] + frame[a * 3 + 2] - p[b * 3 + 2] - frame[b * 3 + 2];
        if (dx * dx + dy * dy + dz * dz > limit * limit) return true;
      }
      return false;
    };
    const before = rest.length / 3;
    const more = refineEdges(geometry, tooLong);
    if (!more) break;
    added += more;
    rest = geometry.attributes.position.array;
    const fresh = displacements(rest.subarray(before * 3));
    deltas = frames.map((frame, k) => {
      const grown = new Float32Array(rest.length);
      grown.set(frame);
      grown.set(fresh[k], before * 3);
      return grown;
    });
  }
  const elapsed = performance.now() - start;
  const index = geometry.index.array;
  const count = rest.length / 3;
  const restNormals = geometry.attributes.normal.array;
  // the cut border and its rim are a sharp edge on purpose: two rings around the boundary are left out of the normals
  const border = new Uint8Array(count);
  {
    const edges = new Map();
    for (let f = 0; f < index.length; f += 3) {
      for (const [a, b] of [[index[f], index[f + 1]], [index[f + 1], index[f + 2]], [index[f + 2], index[f]]]) {
        const key = a < b ? a * count + b : b * count + a;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    for (const [key, n] of edges) if (n === 1) { border[Math.floor(key / count)] = 1; border[key % count] = 1; }
    for (let ring = 0; ring < 2; ring++) {
      const next = border.slice();
      for (let f = 0; f < index.length; f += 3) {
        const t = [index[f], index[f + 1], index[f + 2]];
        if (t.some((i) => border[i])) for (const i of t) next[i] = 1;
      }
      border.set(next);
    }
  }
  console.log(`${variant}: ${pos.length / 3} → ${count} vértices (+${added}) em ${elapsed.toFixed(0)} ms`);
  const rng = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  deltas.forEach((frame, k) => {
    let longest = 0;
    const moving = new Uint8Array(count);
    for (let i = 0; i < count; i++) if (Math.hypot(frame[i * 3], frame[i * 3 + 1], frame[i * 3 + 2]) > 0.5 * mm) moving[i] = 1;
    for (let f = 0; f < index.length; f += 3) {
      const t = [index[f], index[f + 1], index[f + 2]];
      if (!t.every((i) => moving[i])) continue;
      for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
        const d = Math.hypot(...[0, 1, 2].map((c) => rest[a * 3 + c] + frame[a * 3 + c] - rest[b * 3 + c] - frame[b * 3 + c]));
        longest = Math.max(longest, d / mm);
      }
    }
    // normals of the deformed facets against the normal carried by the map, on up to 3000 moving vertices
    const posed = new Float32Array(rest.length);
    for (let i = 0; i < rest.length; i++) posed[i] = rest[i] + frame[i];
    const facet = vertexNormals(posed, index, count);
    const sample = [];
    const share = 3000 / Math.max(1, moving.reduce((s, x) => s + x, 0));
    for (let i = 0; i < count; i++) if (moving[i] && !border[i] && rng() < share) sample.push(i);
    const h = 0.5 * mm;
    const probes = new Float32Array(sample.length * 12);
    const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), n = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    sample.forEach((i, s) => {
      n.fromArray(restNormals, i * 3).normalize();
      t1.crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).normalize();
      t2.crossVectors(n, t1);
      [[t1, 1], [t1, -1], [t2, 1], [t2, -1]].forEach(([t, sign], j) => {
        for (let c = 0; c < 3; c++) probes[s * 12 + j * 3 + c] = rest[i * 3 + c] + sign * h * t.getComponent(c);
      });
    });
    const moved = displacements(probes)[k];
    const worst = [];
    const angles = sample.map((i, s) => {
      const at = (j) => new THREE.Vector3().fromArray(probes, s * 12 + j * 3).add(new THREE.Vector3().fromArray(moved, s * 12 + j * 3));
      const a1 = at(0).sub(at(1));
      const a2 = at(2).sub(at(3));
      const carried = new THREE.Vector3().crossVectors(a1, a2).normalize();
      const got = new THREE.Vector3().fromArray(facet, i * 3);
      if (carried.dot(got) < 0) carried.negate();
      const angle = (Math.acos(Math.min(1, Math.max(-1, carried.dot(got)))) * 180) / Math.PI;
      worst.push([angle, i]);
      return angle;
    }).sort((a, b) => a - b);
    if (process.env.WORST && states[k] === process.env.WORST && variant === "desktop") {
      worst.sort((a, b) => b[0] - a[0]);
      for (const [angle, i] of worst.slice(0, 12)) {
        const c = sides[0].chart(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]);
        const disp = Math.hypot(frame[i * 3], frame[i * 3 + 1], frame[i * 3 + 2]) / mm;
        console.log(`      ${angle.toFixed(1)}° vértice ${i} (${i >= pos.length / 3 ? "novo" : "original"}) y=${(rest[i * 3 + 1] / mm).toFixed(0)} mm; carta op u=${c[0].toFixed(0)} v=${c[1].toFixed(0)} d=${c[2].toFixed(1)}; desl. ${disp.toFixed(1)} mm`);
      }
    }
    const p95 = angles[Math.floor(angles.length * 0.95)] ?? 0;
    const max = angles[angles.length - 1] ?? 0;
    const ok = longest <= SKIN_EDGE_MM[variant] * 1.05 && p95 <= LIMITS.normalP95Deg && max <= LIMITS.normalMaxDeg;
    if (!ok) failed = true;
    console.log(`   ${states[k].padEnd(8)} maior aresta ${longest.toFixed(1)} mm (limite ${SKIN_EDGE_MM[variant]}); normal: p95 ${p95.toFixed(1)}°, máx ${max.toFixed(1)}° (${angles.length} vértices)${ok ? "" : "  <-- acima do limite"}`);
  });
}
if (failed && !process.argv.includes("--report")) {
  console.error("FALHOU");
  process.exit(1);
}
console.log(failed ? "limites excedidos (--report)" : "ok");
