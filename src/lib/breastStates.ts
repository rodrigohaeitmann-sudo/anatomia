/**
 * Breast states (ptosis grades with their hypertrophy) of the hybrid model. The chart and the measurements come from
 * scripts/hybrid/build_breast.py; the deformation itself is evaluated here, on the device, by
 * src/lib/breastMap.ts (a few kB of parameters instead of megabytes of per-vertex deltas).
 */
import data from "@/data/breastModel.json";
import habitusData from "@/data/habitusModel.json";
import { blendStates, BreastSide, type BreastModelParams, type BreastSideData, type BreastStateData } from "@/lib/breastMap";
import { Habitus, type HabitusData } from "@/lib/habitusMap";

export type BreastSideId = "op" | "contra";

export type BreastMeasurement = {
  /** nipple height relative to the inframammary fold on the breast meridian (mm, + above) */
  nippleToFoldMm: number;
  lowestContourToFoldMm: number;
  nippleAboveLowestContourMm: number;
  /** sternal notch to nipple, over the skin */
  notchToNippleMm: number;
  /** nipple to fold along the lower pole skin */
  nippleToFoldSkinMm: number;
  nippleToMidlineMm: number;
  projectionMm: number;
  nipple: [number, number, number];
  regnault: string;
  /** volume of the mound in front of the trunk surface, and its gain over the breast as scanned */
  volumeMl: number;
  volumeGainPct: number;
  /** a reduction of this state to `reductionToMl` would remove about `reductionG` grams: hypertrophy grade (Berrocal Revueltas) */
  reductionToMl?: number;
  reductionG?: number;
  berrocal?: string;
};

const raw = data as unknown as BreastModelParams & {
  bin: string;
  skin: string;
  sides: Record<BreastSideId, BreastSideData>;
  measurements: Record<BreastSideId, Record<string, BreastMeasurement>>;
};

export const breastStates: BreastStateData[] = raw.states;
export const breastStateById = new Map(breastStates.map((state) => [state.id, state]));
export const breastMeasurements = raw.measurements;
export const breastSkinMesh = raw.skin;

/** Position of a state on the morph axis: 0 = the model as scanned, k = k-th state. */
export const breastLevel = (id: string | null | undefined) => (id ? breastStates.findIndex((state) => state.id === id) + 1 : 0);
export const breastStateAt = (level: number) => (level >= 1 ? breastStates[Math.round(level) - 1] ?? null : null);

/** Measurements of the operative breast in a state ("rest" = no state). */
export const measurementsOf = (id: string | null | undefined, side: BreastSideId = "op") => breastMeasurements[side][id ?? "rest"];

/** Mesh names deformed by each side; the trunk skin carries both breasts. */
export const breastMeshSides = new Map<string, BreastSideId[]>();
(Object.keys(raw.sides) as BreastSideId[]).forEach((side) => {
  raw.sides[side].meshes.forEach((name) => breastMeshSides.set(name, [side]));
});
breastMeshSides.set(raw.skin, ["op", "contra"]);

let pending: Promise<Record<BreastSideId, BreastSide>> | null = null;
/** Body habitus of the large states (docs/plano-pele-habito-vasos.md): loaded with the breast sides. */
let habitus: Habitus | null = null;
const habitusMeta = habitusData as unknown as HabitusData;

async function fetchBuffer(path: string) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.arrayBuffer();
}

export function loadBreastSides(): Promise<Record<BreastSideId, BreastSide>> {
  if (!pending) {
    pending = Promise.all([fetchBuffer(raw.bin), fetchBuffer(habitusMeta.bin)])
      .then(([buffer, habitusBuffer]) => {
        habitus = new Habitus(habitusMeta, habitusBuffer, breastStates.map((state) => state.id));
        return { op: new BreastSide(raw.sides.op, raw, buffer), contra: new BreastSide(raw.sides.contra, raw, buffer) };
      })
      .catch((error) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}

/** States with a body habitus (the trunk widens with them). */
export const habitusStates = new Set(Object.keys(habitusMeta.states));
export const habitusOf = (id: string | null | undefined) => (id ? habitusMeta.states[id] ?? null : null);

/**
 * Per-state displacements (model units) of rest-pose points: the breast map of the sides that carry them, plus the
 * body habitus ("none" leaves it out; "skin": the points are the skin itself and move by the whole offset; "depth": by
 * their depth in the subcutaneous layer, zero below the deep fascia). The habitus is zero inside the mounds.
 * The two breasts never overlap, so their displacements simply add up.
 */
export function breastDisplacements(sides: Record<BreastSideId, BreastSide>, which: BreastSideId[], positions: ArrayLike<number>, withHabitus: "depth" | "skin" | "none" = "depth"): Float32Array[] | null {
  let total: Float32Array[] | null = null;
  const add = (deltas: Float32Array[] | null) => {
    if (!deltas) return;
    if (!total) total = deltas;
    else total.forEach((frame, k) => frame.forEach((_, i) => (frame[i] += deltas[k][i])));
  };
  for (const side of which) add(sides[side].displacements(positions));
  if (withHabitus !== "none" && habitus) add(habitus.displacements(positions, withHabitus === "skin"));
  return total;
}

/** Carries loose points (markings, anchors) to a breast level; points outside the breasts are returned as they are. */
export function displacePoints<P extends [number, number, number]>(sides: Record<BreastSideId, BreastSide>, points: P[], level: number): P[] {
  if (level <= 0 || !points.length) return points;
  // markings and anchors lie on the skin
  const deltas = breastDisplacements(sides, ["op", "contra"], points.flat(), "skin");
  if (!deltas) return points;
  return points.map((point, index) => {
    const d = blendStates(deltas, index, level);
    return [point[0] + d[0], point[1] + d[1], point[2] + d[2]] as P;
  });
}
