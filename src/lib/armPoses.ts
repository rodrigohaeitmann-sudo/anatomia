/**
 * Upper-limb poses computed by scripts/hybrid/build_poses.py. Muscles, vessels and nerves are
 * deformed offline (anatomical skinning weights, dual-quaternion skinning, volume preservation and
 * bone collisions); the app receives sparse per-vertex deltas for a few keyframes per pose and plays
 * them as morph targets. Bones' rigid transforms are shipped too, for overlays (landmarks,
 * attachment areas, fibres).
 */
import * as THREE from "three";
import data from "@/data/armPoses.json";

export type ArmPose = {
  id: string;
  label: string;
  short: string;
  description: string;
  plane: number;
  elevation: number;
  external: number;
  clavicle: { elevation: number; retraction: number };
  scapula: { upward: number; tilt: number };
  humeralElevation: number;
  muscleStretch: Record<string, number>;
  frames: number[][][][];
};

type VariantInfo = { index: string; meshes: { name: string; offset: number; count: number }[]; vertices: number; poses: Record<string, { file: string; bytes: number }> };
const raw = data as unknown as {
  keyframes: number;
  stepMm: number;
  poses: ArmPose[];
  variants: Record<"desktop" | "mobile", VariantInfo>;
  /** displacement of the fibre polylines (int16 quanta) per pose, final keyframe */
  fibres: { first: number; count: number; poses: Record<string, string> };
  /** displacement of the hila (model units) per pose */
  hilaOffsets: Record<string, Record<string, [number, number, number]>>;
};

export const armPoses = raw.poses;
export const armPoseById = new Map(armPoses.map((pose) => [pose.id, pose]));
export const poseKeyframes = raw.keyframes;
export type PoseVariant = "desktop" | "mobile";
export const variantOf = (modelPath: string): PoseVariant => (modelPath.includes("-mobile") ? "mobile" : "desktop");

// ---- mesh deltas -------------------------------------------------------------------------------------
export type PoseMeshDeltas = { name: string; indices: Uint32Array; deltas: Int16Array[] };
const indexCache = new Map<PoseVariant, Promise<Uint32Array>>();
const poseCache = new Map<string, Promise<PoseMeshDeltas[]>>();

async function fetchBuffer(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.arrayBuffer();
}

export function loadPose(variant: PoseVariant, poseId: string): Promise<PoseMeshDeltas[]> {
  const key = `${variant}/${poseId}`;
  let pending = poseCache.get(key);
  if (!pending) {
    const info = raw.variants[variant];
    let index = indexCache.get(variant);
    if (!index) {
      index = fetchBuffer(info.index).then((buffer) => new Uint32Array(buffer));
      indexCache.set(variant, index);
    }
    pending = Promise.all([index, fetchBuffer(info.poses[poseId].file)]).then(([indices, buffer]) => {
      const all = new Int16Array(buffer);
      const perFrame = info.vertices * 3;
      return info.meshes.map((mesh) => ({
        name: mesh.name,
        indices: indices.subarray(mesh.offset, mesh.offset + mesh.count),
        deltas: Array.from({ length: raw.keyframes }, (_, k) => all.subarray(k * perFrame + mesh.offset * 3, k * perFrame + (mesh.offset + mesh.count) * 3)),
      }));
    });
    pending.catch(() => poseCache.delete(key));
    poseCache.set(key, pending);
  }
  return pending;
}

/** Delta (model units) of one stored quantum. */
export const deltaUnit = (unitsPerMm: number) => raw.stepMm * unitsPerMm;

/** Morph influences for animation fraction t (0 = anatomical, 1 = pose), piecewise between keyframes. */
export function influencesAt(t: number): number[] {
  const k = raw.keyframes;
  const out = new Array(k).fill(0);
  const s = Math.min(Math.max(t, 0), 1) * k;
  const step = Math.min(Math.floor(s), k - 1);
  const a = s - step;
  if (step >= 1) out[step - 1] = 1 - a;
  out[step] = a;
  return out;
}

// ---- rigid bodies (overlays) --------------------------------------------------------------------------
export const THORAX = 0, CLAVICLE = 1, SCAPULA = 2, HUMERUS = 3;
const identity = new THREE.Matrix4();
const frameMatrices = new Map<string, THREE.Matrix4[][]>();

function framesOf(pose: ArmPose) {
  let frames = frameMatrices.get(pose.id);
  if (!frames) {
    frames = pose.frames.map((mats) => mats.map((rows) => new THREE.Matrix4().set(...(rows.flat() as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]))));
    frameMatrices.set(pose.id, frames);
  }
  return frames;
}

const pa = new THREE.Vector3(), pb = new THREE.Vector3(), sa = new THREE.Vector3(), sb = new THREE.Vector3();
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();

/** Rigid transforms of thorax, clavicle, scapula and humerus at fraction t of a pose (model space). */
export function boneMatrices(poseId: string | null, t = 1): THREE.Matrix4[] {
  const pose = poseId ? armPoseById.get(poseId) : undefined;
  if (!pose || t <= 0) return [identity, identity, identity, identity];
  const frames = framesOf(pose);
  const k = raw.keyframes;
  const s = Math.min(t, 1) * k;
  const step = Math.min(Math.floor(s), k - 1);
  const a = s - step;
  return [0, 1, 2, 3].map((bone) => {
    const from = step === 0 ? identity : frames[step - 1][bone];
    const to = frames[step][bone];
    from.decompose(pa, qa, sa);
    to.decompose(pb, qb, sb);
    return new THREE.Matrix4().compose(pa.lerp(pb, a), qa.slerp(qb, a), sa.lerp(sb, a));
  });
}

/** Body that carries a landmark (by id prefix); hila use blended weights instead. */
export function landmarkBody(id: string) {
  if (id.startsWith("umero.")) return HUMERUS;
  if (id.startsWith("escapula.")) return SCAPULA;
  if (id.startsWith("clavicula.")) return CLAVICLE;
  return THORAX;
}

export function attachmentBody(boneLabel: string) {
  if (boneLabel === "Úmero") return HUMERUS;
  if (boneLabel === "Escápula") return SCAPULA;
  if (boneLabel === "Clavícula") return CLAVICLE;
  return THORAX;
}

const tmp = new THREE.Vector3();
/**
 * Landmark in a pose: bony landmarks move rigidly with their bone; hila lie on muscles and take the
 * displacement of the deformed muscle around them (computed offline from the pose deltas).
 */
export function posedLandmark(id: string, point: [number, number, number], mats: THREE.Matrix4[], poseId: string | null): [number, number, number] {
  const offset = poseId ? raw.hilaOffsets[poseId]?.[id] : undefined;
  if (offset) return [point[0] + offset[0], point[1] + offset[1], point[2] + offset[2]];
  const p = tmp.set(...point).applyMatrix4(mats[landmarkBody(id)]);
  return [p.x, p.y, p.z];
}

// ---- fibre polylines ----------------------------------------------------------------------------------
/** Range of the anatomy-layer positions covered by the fibre offsets. */
export const fibreRange = { first: raw.fibres.first, count: raw.fibres.count };
const fibreCache = new Map<string, Promise<Int16Array>>();
/** Displacement of every fibre point in a pose (quanta of deltaUnit), following the deformed muscles. */
export function loadFibreOffsets(poseId: string) {
  let pending = fibreCache.get(poseId);
  if (!pending) {
    pending = fetchBuffer(raw.fibres.poses[poseId]).then((buffer) => new Int16Array(buffer));
    pending.catch(() => fibreCache.delete(poseId));
    fibreCache.set(poseId, pending);
  }
  return pending;
}
