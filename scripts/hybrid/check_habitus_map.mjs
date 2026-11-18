// Checks that the app's body habitus (src/lib/habitusMap.ts) reproduces
// the pipeline (build_habitus.py): habitus-test-vectors.json carries rest points and their displacements per state.
// Usage: node scripts/hybrid/check_habitus_map.mjs   (Node >= 22.18 runs the TypeScript modules directly)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Habitus } from "../../src/lib/habitusMap.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => {
  const file = readFileSync(join(root, path));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
};
const breast = JSON.parse(readFileSync(join(root, "src/data/breastModel.json"), "utf8"));
const habitusData = JSON.parse(readFileSync(join(root, "src/data/habitusModel.json"), "utf8"));
const vectors = JSON.parse(readFileSync(join(root, "scripts/hybrid/habitus-test-vectors.json"), "utf8"));
const habitus = new Habitus(habitusData, read(join("public", habitusData.bin)), breast.states.map((state) => state.id));
const toleranceMm = 0.02;
let worst = 0;
for (const [label, skin, states] of [["profundidade", false, vectors.states], ["pele", true, vectors.skinStates]]) {
  const deltas = habitus.displacements(vectors.rest.flat(), skin);
  states.forEach((expected, k) => {
    let max = 0;
    let moved = 0;
    expected.forEach((delta, i) => {
      const got = deltas ? [0, 1, 2].map((c) => deltas[k][i * 3 + c]) : [0, 0, 0];
      max = Math.max(max, Math.hypot(...[0, 1, 2].map((c) => got[c] - delta[c])) / breast.unitsPerMm);
      if (Math.hypot(...delta) > 1e-6) moved++;
    });
    worst = Math.max(worst, max);
    console.log(`${label} ${breast.states[k].id}: ${expected.length} pontos (${moved} movidos), erro máximo ${max.toFixed(4)} mm`);
  });
}
if (worst > toleranceMm) {
  console.error(`FALHOU: erro máximo ${worst.toFixed(4)} mm > ${toleranceMm} mm`);
  process.exit(1);
}
console.log(`ok: erro máximo ${worst.toFixed(4)} mm`);
