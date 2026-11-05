/**
 * Study layers computed by scripts/hybrid/build_anatomy_layers.py: bony landmarks, muscle attachment
 * areas, muscle portions, fibre directions, hila, skin markings and perforator zones. Points and
 * metadata ship in the JSON; meshes and polylines in a quantised binary loaded on first use.
 */
import * as THREE from "three";
import data from "@/data/anatomyLayers.json";

export type LayerLandmark = {
  id: string;
  name: string;
  category: "osseo" | "costela" | "hilo";
  bone: string;
  structure: string;
  point: [number, number, number];
  normal: [number, number, number];
  source: string;
  note: string;
  palpable: boolean;
  sourceOffsetMm?: number;
};

export type LayerAttachment = {
  id: string;
  muscle: string;
  part: string | null;
  kind: "origin" | "insertion";
  bone: string;
  boneStructure: string;
  rib: number | null;
  source: string;
  sourceTag: string;
  areaMm2: number;
  centroid: [number, number, number];
  positions: [number, number];
  indices: [number, number];
};

export type LayerPart = { id: string; structure: string; label: string; meshNames: string[] };
export type LayerRegion = {
  structure: string;
  method: string;
  parts: { id: string; label: string; rib: number; labelIndex: number }[];
  positions: [number, number];
  labels: [number, number];
};
export type LayerFibre = { id: string; structure: string; part: string | null; lines: number; positions: [number, number]; counts: [number, number] };
export type Marking = { id: string; label: string; kind: "line" | "point"; color: string; points: [number, number, number][]; note: string };
export type Zone = {
  id: string;
  label: string;
  color: string;
  note: string;
  refs: string[];
  strip: { left: [number, number, number][]; right: [number, number, number][] };
  emphasis?: { left: [number, number, number][]; right: [number, number, number][] } | null;
  emphasisLabel?: string;
};

type Layout = { byteOffset: number; length: number };
const raw = data as unknown as {
  bin: string;
  byteLength: number;
  layout: Record<"positions" | "indices" | "lineCounts" | "labels", Layout>;
  quantization: { min: [number, number, number]; step: [number, number, number] };
  fit: Record<string, { medianMm: number; p95Mm: number }>;
  landmarks: LayerLandmark[];
  attachments: LayerAttachment[];
  parts: LayerPart[];
  regions: LayerRegion[];
  fibres: LayerFibre[];
  markings: Marking[];
  zones: Zone[];
};

export const layerLandmarks = raw.landmarks;
export const layerAttachments = raw.attachments;
export const layerParts = raw.parts;
export const layerRegions = raw.regions;
export const layerFibres = raw.fibres;
export const skinMarkings = raw.markings;
export const perforatorZones = raw.zones;
export const boneFit = raw.fit;

export const landmarkById = new Map(layerLandmarks.map((item) => [item.id, item]));
export const partByMesh = new Map(layerParts.flatMap((part) => part.meshNames.map((name) => [name, part] as const)));
const regionPartList = layerRegions.flatMap((region) => region.parts.map((part) => ({ ...part, structure: region.structure, meshNames: [] as string[] })));
export const partById = new Map<string, { id: string; structure: string; label: string }>([...layerParts, ...regionPartList].map((part) => [part.id, part]));
export const regionByStructure = new Map(layerRegions.map((region) => [region.structure, region]));
export const fibreStructures = new Set(layerFibres.map((fibre) => fibre.structure));

/** Parts of a structure (mesh portions and computed regions), for lists in cards. */
export function partsOf(structure: string) {
  return [...partById.values()].filter((part) => part.structure === structure);
}

export function attachmentsFor(structure: string, part?: string | null) {
  return layerAttachments.filter((item) => item.muscle === structure && (!part || !item.part || item.part === part));
}

/** Attachment areas whose extent reaches within `radiusMm` of a landmark on the same bone (for the landmark card). */
export function attachmentsNear(landmark: LayerLandmark, unitsPerMm: number, radiusMm = 8) {
  const p = new THREE.Vector3(...landmark.point);
  return layerAttachments.filter((item) => item.boneStructure === landmark.structure && p.distanceTo(new THREE.Vector3(...item.centroid)) / unitsPerMm < radiusMm + Math.sqrt(item.areaMm2) / 2);
}

// ---- binary ----------------------------------------------------------------------------------------
export type LayerBuffers = { positions: Float32Array; indices: Uint16Array; lineCounts: Uint16Array; labels: Uint8Array };
let pending: Promise<LayerBuffers> | null = null;

export function loadLayerBuffers(): Promise<LayerBuffers> {
  if (!pending) {
    pending = fetch(raw.bin)
      .then((response) => {
        if (!response.ok) throw new Error(`anatomy layers: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => {
        const { layout, quantization } = raw;
        const q = new Uint16Array(buffer, layout.positions.byteOffset, layout.positions.length);
        const positions = new Float32Array(q.length);
        for (let i = 0; i < q.length; i++) positions[i] = quantization.min[i % 3] + q[i] * quantization.step[i % 3];
        return {
          positions,
          indices: new Uint16Array(buffer, layout.indices.byteOffset, layout.indices.length),
          lineCounts: new Uint16Array(buffer, layout.lineCounts.byteOffset, layout.lineCounts.length),
          labels: new Uint8Array(buffer, layout.labels.byteOffset, layout.labels.length),
        };
      })
      .catch((error) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}

export function attachmentGeometry(item: LayerAttachment, buffers: LayerBuffers) {
  const [p0, pn] = item.positions;
  const [i0, iN] = item.indices;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(buffers.positions.slice(p0 * 3, (p0 + pn) * 3), 3));
  geometry.setIndex(new THREE.BufferAttribute(Uint16Array.from(buffers.indices.subarray(i0, i0 + iN)), 1));
  geometry.computeVertexNormals();
  return geometry;
}

/** Fibre polylines as one segment list (LineSegments). */
export function fibreGeometry(item: LayerFibre, buffers: LayerBuffers) {
  const [p0] = item.positions;
  const [c0, cn] = item.counts;
  const segments: number[] = [];
  let cursor = p0;
  for (let k = 0; k < cn; k++) {
    const count = buffers.lineCounts[c0 + k];
    for (let j = 0; j < count - 1; j++) {
      const a = (cursor + j) * 3;
      const b = (cursor + j + 1) * 3;
      segments.push(buffers.positions[a], buffers.positions[a + 1], buffers.positions[a + 2], buffers.positions[b], buffers.positions[b + 1], buffers.positions[b + 2]);
    }
    cursor += count;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(segments, 3));
  return geometry;
}

/** Labelled samples of a partitioned muscle, with a coarse grid for nearest-sample lookup. */
export type RegionLookup = { labelAt: (x: number, y: number, z: number) => number; parts: LayerRegion["parts"] };
const lookups = new Map<string, RegionLookup>();

export function regionLookup(structure: string, buffers: LayerBuffers): RegionLookup | null {
  const region = regionByStructure.get(structure);
  if (!region) return null;
  const cached = lookups.get(structure);
  if (cached) return cached;
  const [p0, pn] = region.positions;
  const [l0] = region.labels;
  const pts = buffers.positions.subarray(p0 * 3, (p0 + pn) * 3);
  const labels = buffers.labels.subarray(l0, l0 + pn);
  const cell = 0.08;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < pn; i++) {
    const k = key(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  }
  const labelAt = (x: number, y: number, z: number) => {
    let best = -1;
    let bestD = Infinity;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    for (let r = 1; r <= 3 && best < 0; r++) {
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (let dz = -r; dz <= r; dz++) {
            const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (!list) continue;
            for (const i of list) {
              const d = (pts[i * 3] - x) ** 2 + (pts[i * 3 + 1] - y) ** 2 + (pts[i * 3 + 2] - z) ** 2;
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            }
          }
    }
    return best < 0 ? -1 : labels[best];
  };
  const lookup = { labelAt, parts: region.parts };
  lookups.set(structure, lookup);
  return lookup;
}

export const attachmentColors = {
  origin: "#ef4444",
  insertion: "#3b82f6",
  originComputed: "#fca5a5",
  insertionComputed: "#93c5fd",
};

export const kindLabel = { origin: "Origem", insertion: "Inserção" } as const;
