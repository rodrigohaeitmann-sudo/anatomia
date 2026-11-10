// Checks that the app's breast map (src/lib/breastMap.ts) reproduces the pipeline (build_breast.py):
// breast-test-vectors.json carries rest points and their deformed positions computed in Python.
// Usage: node scripts/hybrid/check_breast_map.mjs   (Node >= 22.18 runs the TypeScript module directly)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BreastSide } from "../../src/lib/breastMap.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const model = JSON.parse(readFileSync(join(root, "src/data/breastModel.json"), "utf8"));
const vectors = JSON.parse(readFileSync(join(root, "scripts/hybrid/breast-test-vectors.json"), "utf8"));
const file = readFileSync(join(root, "public", model.bin));
const bin = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
const toleranceMm = 0.02;
let worst = 0;
for (const [name, data] of Object.entries(model.sides)) {
  const side = new BreastSide(data, model, bin);
  const { rest, states } = vectors[name];
  const deltas = side.displacements(rest.flat());
  if (!deltas) throw new Error(`${name}: no point moved`);
  states.forEach((expected, k) => {
    let max = 0;
    expected.forEach((point, i) => {
      const error = Math.hypot(...[0, 1, 2].map((c) => rest[i][c] + deltas[k][i * 3 + c] - point[c])) / model.unitsPerMm;
      max = Math.max(max, error);
    });
    worst = Math.max(worst, max);
    console.log(`${name} ${model.states[k].id}: ${rest.length} pontos, erro máximo ${max.toFixed(4)} mm`);
  });
}
if (worst > toleranceMm) {
  console.error(`FALHOU: erro máximo ${worst.toFixed(4)} mm > ${toleranceMm} mm`);
  process.exit(1);
}
console.log(`ok: erro máximo ${worst.toFixed(4)} mm`);
