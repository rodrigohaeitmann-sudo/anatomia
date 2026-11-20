/**
 * Reduction mammaplasty step by step (src/data/mammaplastySteps<-case>.json and public/models/hybrid/mammaplasty-<key>.bin,
 * written by scripts/hybrid/build_mammaplasty_steps.py; one file per case, see planCases.ts): skin, pieces, areola, the
 * vessels and nerves the pedicle keeps,
 * sutures, measurements and scars of every technique at its key frames (marking, incision, resection, transposition and
 * the stages of the closure). The viewer plays them as morph targets: frame 0 is the geometry, the others are deltas.
 */
import { stepFiles } from "@/data/planCases";

export type StepRecord = { name: string; vertices: number; triangles: number; frames: number[]; byteOffset: number };
/** Clinical measurements of the breast before the operation and of the expected result (mm, mL). */
export type StepMeasurements = { nippleToFoldMm: number; notchToNippleMm: number; nippleToFoldSkinMm: number; projectionMm: number; volumeMl: number };
type TechniqueData = {
  /** pitanguy, wise or vertical */
  technique: string;
  /** breast state of the case (ptose-2, g3, g4) */
  case: string;
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
  /**
   * reconstructions (build_flaps.py): the outlines where the trunk skin gives way, in the chart of the trunk (u, v);
   * `depth`: tested only in front of the base of the breast (the breast patch), as the mammaplasty hole
   */
  holes?: StepHole[];
  /** structures and meshes of the torso model this sequence carries itself (not shown twice in its steps) */
  replaces?: { structures: string[]; meshes: string[] };
};
export type StepHole = { outline: [number, number][]; depth: boolean };
export type StepArrow = { frame: number; from: [number, number, number]; to: [number, number, number]; color: string };

type StepFile = { hole: [number, number][]; techniques: Record<string, TechniqueData>; structures: Record<string, unknown> };
const files = stepFiles as StepFile[];
const techniques: Record<string, TechniqueData> = Object.assign({}, ...files.map((file) => file.techniques));
const structures: Record<string, unknown> = Object.assign({}, ...files.map((file) => file.structures));
/** Technique (pitanguy, wise, vertical) and case of a step sequence key (e.g. "wise-g3"). */
export const stepTechniqueOf = (key: string) => techniques[key]?.technique ?? key;
export const stepCaseOf = (key: string) => techniques[key]?.case ?? "ptose-2";

/** Key frames of a technique (its schedule: the closure has its own stages in every technique). */
export const stepFramesOf = (key: string) => techniques[key]?.frames ?? [];
/**
 * Outlines (rest chart of the operated breast, u v) of the skin patches of a technique: the trunk skin gives way inside
 * them. A mammaplasty has one, round the breast; a flap reconstruction also opens the back or the abdomen.
 */
const holes = new Map<string, StepHole[]>();
files.forEach((file) => Object.entries(file.techniques).forEach(([key, item]) => holes.set(key, item.holes ?? [{ outline: file.hole, depth: true }])));
const firstHoles = [{ outline: files[0].hole, depth: true }];
export const stepHolesOf = (key: string) => holes.get(key) ?? firstHoles;
const noReplace = { structures: [] as string[], meshes: [] as string[] };
/** What of the torso model a technique carries itself (hidden in its steps). */
export const stepReplacesOf = (key: string) => techniques[key]?.replaces ?? noReplace;
const reconstructionKeys = new Set(Object.entries(techniques).filter(([, item]) => item.holes).map(([key]) => key));
/** A mastectomy or flap reconstruction (build_flaps.py), not a reduction mammaplasty. */
export const isReconstruction = (key: string) => reconstructionKeys.has(key);
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
export const stepStructuresOf = (key: string) => Object.keys(structures).filter((id) => id.endsWith(`-${key}`));
type MeshRecord = { name: string; structure: string; tissue: string };
const tissuesOf = new Map<string, Set<string>>();
files.forEach((file) => ((file as unknown as { meshes: MeshRecord[] }).meshes ?? []).forEach((mesh) => tissuesOf.set(mesh.structure, (tissuesOf.get(mesh.structure) ?? new Set()).add(mesh.tissue))));
const only = (id: string, kinds: string[]) => [...(tissuesOf.get(id) ?? [])].every((tissue) => kinds.includes(tissue)) && tissuesOf.has(id);
/**
 * The skin of a technique's steps (the first is its main patch): what the skin buttons of the viewer act on with the
 * skin of the trunk.
 */
export const stepSkinIdsOf = (key: string) =>
  isReconstruction(key) ? stepStructuresOf(key).filter((id) => only(id, ["skin"])).sort((a, b) => Number(!a.startsWith("recon-skin-")) - Number(!b.startsWith("recon-skin-"))) : [`mamo-step-skin-${key}`, `mamo-step-disc-${key}`];
/** The vessels and nerves of a technique's steps (the Vasos button). */
export const stepVesselIdsOf = (key: string) =>
  isReconstruction(key) ? stepStructuresOf(key).filter((id) => only(id, ["artery", "vein", "nerve"])) : ["arteries", "nerves", "arteries-cut", "nerves-cut"].map((part) => `mamo-step-${part}-${key}`);
/** Measures of a reconstruction (build_flaps.py: mm, mL, cm², degrees). */
export const reconstructionMeasures = (key: string) => (techniques[key]?.measures ?? {}) as unknown as Record<string, number>;

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
