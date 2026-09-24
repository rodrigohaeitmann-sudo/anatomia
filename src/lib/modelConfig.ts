import hybridTorsoManifest from "@/data/hybridTorsoManifest.json";

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
  | "lymph-node";

export type ModelStructureConfig = {
  id: string;
  label: string;
  group: string;
  color: string;
  defaultVisible: boolean;
  meshNames: string[];
  labelAnchor: [number, number, number];
  sources: string[];
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
};

/** Default opacity per tissue; deep structures are opaque so anatomical relations read clearly. */
export const tissueOpacity: Partial<Record<Tissue, number>> = {
  skin: 0.28,
  fat: 0.42,
  fascia: 0.45,
  ligament: 0.85,
};

export const modelMeshes = hybridTorsoManifest.meshes as ModelMeshRecord[];
export const modelLandmarks = hybridTorsoManifest.landmarks as unknown as ModelLandmarks;
export const hybridTorsoModel = hybridTorsoManifest;

const manifestStructures = hybridTorsoManifest.structures as unknown as Record<string, ManifestStructure>;
const meshByName = new Map(modelMeshes.map((mesh) => [mesh.name, mesh]));

function dominantTissue(meshNames: string[]): Tissue {
  const counts = new Map<Tissue, number>();
  for (const name of meshNames) {
    const tissue = meshByName.get(name)?.tissue;
    if (tissue) counts.set(tissue, (counts.get(tissue) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "muscle";
}

export const modelStructures: ModelStructureConfig[] = Object.entries(manifestStructures).map(([id, structure]) => ({
  id,
  label: structure.label,
  group: structure.group,
  color: tissueColors[dominantTissue(structure.meshNames)],
  defaultVisible: structure.visible,
  meshNames: structure.meshNames,
  labelAnchor: structure.labelAnchor,
  sources: [...new Set(structure.meshNames.map((name) => meshByName.get(name)?.source).filter((source): source is string => Boolean(source)))],
}));

export const structureGroups = [...new Set(modelStructures.map((structure) => structure.group))];

/** Structures cut by a step's clipping plane (superficial layers opened like a dissection window). */
export const superficialStructures = new Set(["skin", "pectoral-fascia", "thoracolumbar-fascia", "deltoid-fascia"]);
