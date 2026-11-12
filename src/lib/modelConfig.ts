import breastAnatomy from "@/data/breastAnatomy.json";
import hybridTorsoManifest from "@/data/hybridTorsoManifest.json";
import mammaplasty from "@/data/mammaplasty.json";
import mammaplastySteps from "@/data/mammaplastySteps.json";

export type Tissue =
  | "skin"
  | "fat"
  | "gland"
  | "duct"
  | "ligament"
  | "nipple"
  | "areola"
  | "muscle"
  | "bone"
  | "cartilage"
  | "fascia"
  | "artery"
  | "vein"
  | "nerve"
  | "lymph-node"
  /** pen line of a pre-operative marking (surgical plan) */
  | "marking"
  /** pedicle or resection of a surgical plan */
  | "piece";

export type ModelStructureConfig = {
  id: string;
  label: string;
  group: string;
  color: string;
  defaultVisible: boolean;
  meshNames: string[];
  labelAnchor: [number, number, number];
  sources: string[];
  /** traced from the literature on landmarks of the real meshes (src/data/breastAnatomy.json), not segmented */
  schematic: boolean;
  /** marking or piece of a surgical plan (src/data/mammaplasty.json) */
  plan: boolean;
  /** false for the meshes of the step-by-step sequences, which only their views show */
  listed: boolean;
};

export type ModelMeshRecord = {
  name: string;
  structure: string;
  tissue: Tissue;
  source: string;
  sourceName: string;
  license: string;
  triangles: number;
  fma?: string;
  /** own colour and opacity (schematic sheets); default: those of the tissue */
  color?: string;
  opacity?: number;
};

type ManifestStructure = { label: string; group: string; visible: boolean; labelAnchor: [number, number, number]; meshNames: string[] };

export type Landmark = [number, number, number];

export type ModelLandmarks = {
  nipple: Landmark;
  breastCenter: Landmark;
  breastBounds: { min: Landmark; max: Landmark };
  inframammaryFold: Landmark;
  latissimusCenter: Landmark;
  latissimusBounds: { min: Landmark; max: Landmark };
  latissimusAnteriorBorder: [Landmark, Landmark];
  latissimusInferior: Landmark;
  scapulaInferiorAngle: Landmark;
  trapeziusInferiorBorder: Landmark;
  iliacCrestTop: Landmark;
  thoracodorsalArteryOrigin: Landmark;
  thoracodorsalArteryDistal: Landmark;
  thoracodorsalNerveDistal: Landmark;
  axillaryArteryCenter: Landmark;
  skinPaddleCenter: Landmark;
  unitsPerMm: number;
};

/** Physically inspired base colours per tissue (linear sRGB hex). */
export const tissueColors: Record<Tissue, string> = {
  skin: "#e7b8a0",
  fat: "#f1cf7c",
  gland: "#e8879f",
  duct: "#d8467a",
  ligament: "#f3efe6",
  nipple: "#8a4a3a",
  areola: "#9b5a47",
  muscle: "#b8453b",
  bone: "#ece2cd",
  cartilage: "#b9d6de",
  fascia: "#ebe6d6",
  artery: "#d32f2f",
  vein: "#2a5bb8",
  nerve: "#f5d547",
  "lymph-node": "#7cc26b",
  marking: "#2536a8",
  piece: "#3fae6b",
};

/** Default opacity per tissue; deep structures are opaque so anatomical relations read clearly. */
export const tissueOpacity: Partial<Record<Tissue, number>> = {
  skin: 0.28,
  fat: 0.42,
  fascia: 0.45,
  ligament: 0.85,
};

/** Source name of the schematic structures (scripts/hybrid/build_breast_anatomy.py). */
export const schematicSource = breastAnatomy.source;
/** Source name of markings and pieces of the surgical plans (scripts/hybrid/build_mammaplasty.py). */
export const planSource = mammaplasty.source;
export const modelMeshes = [...hybridTorsoManifest.meshes, ...breastAnatomy.meshes, ...mammaplasty.meshes, ...mammaplastySteps.meshes] as ModelMeshRecord[];
/** structures of the step-by-step sequences: shown by their views, not listed with the anatomy */
const stepStructures = new Set(Object.keys(mammaplastySteps.structures));
export const modelLandmarks = hybridTorsoManifest.landmarks as unknown as ModelLandmarks;
export const hybridTorsoModel = hybridTorsoManifest;

const manifestStructures = { ...hybridTorsoManifest.structures, ...breastAnatomy.structures, ...mammaplasty.structures, ...mammaplastySteps.structures } as unknown as Record<string, ManifestStructure>;
const meshByName = new Map(modelMeshes.map((mesh) => [mesh.name, mesh]));

function dominantTissue(meshNames: string[]): Tissue {
  const counts = new Map<Tissue, number>();
  for (const name of meshNames) {
    const tissue = meshByName.get(name)?.tissue;
    if (tissue) counts.set(tissue, (counts.get(tissue) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "muscle";
}

/** Colour of a mesh: its own, or that of its tissue. */
export const meshColor = (meshName: string, tissue: Tissue | string) => meshByName.get(meshName)?.color ?? tissueColors[tissue as Tissue];

export const modelStructures: ModelStructureConfig[] = Object.entries(manifestStructures).map(([id, structure]) => ({
  id,
  label: structure.label,
  group: structure.group,
  color: meshByName.get(structure.meshNames[0])?.color ?? tissueColors[dominantTissue(structure.meshNames)],
  defaultVisible: structure.visible,
  meshNames: structure.meshNames,
  labelAnchor: structure.labelAnchor,
  sources: [...new Set(structure.meshNames.map((name) => meshByName.get(name)?.source).filter((source): source is string => Boolean(source)))],
  schematic: structure.meshNames.every((name) => meshByName.get(name)?.source === schematicSource),
  plan: structure.meshNames.every((name) => meshByName.get(name)?.source === planSource),
  listed: !stepStructures.has(id),
}));

export const structureGroups = [...new Set(modelStructures.map((structure) => structure.group))];

/** Structures cut by a step's clipping plane (superficial layers opened like a dissection window). */
export const superficialStructures = new Set(["skin", "pectoral-fascia", "thoracolumbar-fascia", "deltoid-fascia"]);
