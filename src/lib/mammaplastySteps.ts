/**
 * Reduction mammaplasty step by step (src/data/mammaplastySteps.json and public/models/hybrid/mammaplasty-<key>.bin,
 * written by scripts/hybrid/build_mammaplasty_steps.py): skin, pieces, areola, the vessels and nerves the pedicle keeps,
 * sutures, measurements and scars of every technique at its key frames (marking, incision, resection, transposition and
 * the stages of the closure). The viewer plays them as morph targets: frame 0 is the geometry, the others are deltas.
 */
import data from "@/data/mammaplastySteps.json";

export type StepRecord = { name: string; vertices: number; triangles: number; frames: number[]; byteOffset: number };
/** Clinical measurements of the breast before the operation and of the expected result (mm, mL). */
export type StepMeasurements = { nippleToFoldMm: number; notchToNippleMm: number; nippleToFoldSkinMm: number; projectionMm: number; volumeMl: number };
type TechniqueData = {
  bin: string;
  min: number[];
  max: number[];
  byteLength: number;
  meshes: StepRecord[];
  /** label anchors: a vertex of every piece at the first key frame (model units) */
  points: Record<string, [number, number, number]>;
  measurements: { before: StepMeasurements; after: StepMeasurements };
  pillarsMl: Record<string, number>;
  /** key frames of this technique */
  frames: { id: string; label: string }[];
  /** marking and result: areola before and after (areolotome), rise of the nipple, B-C, vertical scar (mm) */
  measures: { areolaNowMm: number; areolaNewMm: number; ascensionMm: number; bcMm?: number; verticalScarMm?: number; areolaResultMm: number };
  /** schematic branches the pedicle keeps (src/data/breastAnatomy.json mesh names) */
  branches: { artery: string[]; nerve: string[] };
  /** where things go in each step (model units): drawn while the step plays */
  arrows: StepArrow[];
  /** height of the new nipple above the fold in the result (mm) */
  nippleAboveFoldMm: number;
};
export type StepArrow = { frame: number; from: [number, number, number]; to: [number, number, number]; color: string };

const techniques = data.techniques as unknown as Record<string, TechniqueData>;

/** Key frames of a technique (its schedule: the closure has its own stages in every technique). */
export const stepFramesOf = (key: string) => techniques[key]?.frames ?? [];
export const stepHole = data.hole as [number, number][];
/** technique of every step mesh */
export const stepMeshTechnique = new Map<string, string>();
Object.entries(techniques).forEach(([key, item]) => item.meshes.forEach((mesh) => stepMeshTechnique.set(mesh.name, key)));
export const stepMeshNames = [...stepMeshTechnique.keys()];
/** Label anchors of the step views, as "step:<technique>:<piece>" (see PackLabel.near). */
export const stepPoints: Record<string, [number, number, number]> = {};
Object.entries(techniques).forEach(([key, item]) => Object.entries(item.points).forEach(([name, point]) => (stepPoints[`step:${key}:${name}`] = point)));
export const stepMeasurements = (key: string) => techniques[key].measurements;
export const stepPillarVolumes = (key: string) => techniques[key].pillarsMl;
export const stepMeasures = (key: string) => techniques[key].measures;
export const stepBranches = (key: string) => techniques[key].branches;
export const stepArrows = (key: string) => techniques[key]?.arrows ?? [];
/** Structures of the step-by-step sequence of a technique (listed with the anatomy while one of its views is open). */
export const stepStructuresOf = (key: string) => Object.keys(data.structures).filter((id) => id.endsWith(`-${key}`));

export type StepGeometry = { positions: Float32Array[]; index: Uint16Array };

const pending = new Map<string, Promise<Map<string, StepGeometry>>>();

/**
 * Positions of every mesh of a technique at every key frame (model units) and its indices. A frame a mesh does not
 * store repeats the one before it (or the first stored frame when none is before it).
 */
export function loadSteps(key: string): Promise<Map<string, StepGeometry>> {
  let request = pending.get(key);
  if (!request) {
    const item = techniques[key];
    request = fetch(item.bin)
      .then((response) => {
        if (!response.ok) throw new Error(`mammaplasty steps: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => {
        const out = new Map<string, StepGeometry>();
        const span = item.max.map((value, c) => value - item.min[c]);
        for (const mesh of item.meshes) {
          let offset = mesh.byteOffset;
          const stored = new Map<number, Float32Array>();
          for (const frame of mesh.frames) {
            const raw = new Uint16Array(buffer, offset, mesh.vertices * 3);
            const positions = new Float32Array(mesh.vertices * 3);
            for (let i = 0; i < positions.length; i++) positions[i] = item.min[i % 3] + (raw[i] / 65535) * span[i % 3];
            stored.set(frame, positions);
            offset += mesh.vertices * 6;
          }
          const index = new Uint16Array(buffer.slice(offset, offset + mesh.triangles * 6));
          const positions: Float32Array[] = [];
          for (let k = 0; k < item.frames.length; k++) {
            const before = mesh.frames.filter((frame) => frame <= k);
            positions.push(stored.get(before.length ? before[before.length - 1] : mesh.frames[0])!);
          }
          out.set(mesh.name, { positions, index });
        }
        return out;
      })
      .catch((error) => {
        pending.delete(key);
        throw error;
      });
    pending.set(key, request);
  }
  return request;
}
