import zAnatomyTorsoManifest from "@/data/zAnatomyTorsoManifest.json";

export type ModelStructureConfig = {
  id: string;
  label: string;
  color: string;
  defaultVisible: boolean;
  meshNames: string[];
  opacity?: number;
  sourceType: "z-anatomy" | "procedural";
  futureMeshName?: string;
};

type ZAnatomyStructureRecord = Record<string, { meshNames: string[] }>;

const zAnatomyStructures = zAnatomyTorsoManifest.structures as ZAnatomyStructureRecord;

function zAnatomyMeshes(id: string) {
  return zAnatomyStructures[id]?.meshNames ?? [];
}

export const modelStructures: ModelStructureConfig[] = [
  { id: "skin", label: "Pele", color: "#f8c7b8", defaultVisible: true, meshNames: zAnatomyMeshes("skin"), opacity: 0.24, sourceType: "z-anatomy", futureMeshName: "skin" },
  { id: "subcutaneous", label: "Tecido subcutâneo", color: "#facc15", defaultVisible: true, meshNames: [], opacity: 0.42, sourceType: "procedural", futureMeshName: "subcutaneous_tissue" },
  { id: "latissimus-dorsi", label: "Músculo grande dorsal", color: "#ef4444", defaultVisible: true, meshNames: zAnatomyMeshes("latissimus-dorsi"), opacity: 0.96, sourceType: "z-anatomy", futureMeshName: "latissimus_dorsi" },
  { id: "serratus-anterior", label: "Serrátil anterior", color: "#f97316", defaultVisible: false, meshNames: zAnatomyMeshes("serratus-anterior"), opacity: 0.88, sourceType: "z-anatomy", futureMeshName: "serratus_anterior" },
  { id: "trapezius", label: "Trapézio", color: "#8b5cf6", defaultVisible: false, meshNames: zAnatomyMeshes("trapezius"), opacity: 0.34, sourceType: "z-anatomy", futureMeshName: "trapezius" },
  { id: "teres-major", label: "Redondo maior", color: "#f59e0b", defaultVisible: false, meshNames: zAnatomyMeshes("teres-major"), opacity: 0.72, sourceType: "z-anatomy", futureMeshName: "teres_major" },
  { id: "pectoralis-major", label: "Peitoral maior", color: "#fb7185", defaultVisible: false, meshNames: zAnatomyMeshes("pectoralis-major"), opacity: 0.82, sourceType: "z-anatomy", futureMeshName: "pectoralis_major" },
  { id: "pectoralis-minor", label: "Peitoral menor", color: "#f43f5e", defaultVisible: false, meshNames: zAnatomyMeshes("pectoralis-minor"), opacity: 0.76, sourceType: "z-anatomy", futureMeshName: "pectoralis_minor" },
  { id: "thoracolumbar-fascia", label: "Fáscia toracolombar", color: "#f8fafc", defaultVisible: false, meshNames: zAnatomyMeshes("thoracolumbar-fascia"), opacity: 0.72, sourceType: "z-anatomy", futureMeshName: "thoracolumbar_fascia" },
  { id: "iliac-crest", label: "Crista ilíaca", color: "#e7e5e4", defaultVisible: false, meshNames: zAnatomyMeshes("iliac-crest"), opacity: 0.68, sourceType: "z-anatomy", futureMeshName: "iliac_crest" },
  { id: "thoracodorsal-vessels", label: "Vasos toracodorsais", color: "#38bdf8", defaultVisible: true, meshNames: zAnatomyMeshes("thoracodorsal-vessels"), opacity: 0.98, sourceType: "z-anatomy", futureMeshName: "thoracodorsal_bundle" },
  { id: "chest-wall", label: "Parede torácica", color: "#cbd5e1", defaultVisible: true, meshNames: zAnatomyMeshes("chest-wall"), opacity: 0.62, sourceType: "z-anatomy", futureMeshName: "chest_wall" },
  { id: "axilla", label: "Axila", color: "#a78bfa", defaultVisible: true, meshNames: zAnatomyMeshes("axilla"), opacity: 0.55, sourceType: "z-anatomy", futureMeshName: "axilla" },
  { id: "breast", label: "Mama", color: "#f9a8d4", defaultVisible: true, meshNames: zAnatomyMeshes("breast"), opacity: 0.5, sourceType: "z-anatomy", futureMeshName: "breast" },
];

export const zAnatomyTorsoModel = zAnatomyTorsoManifest;

export const futureModelGuidelines = {
  acceptedFormats: [".glb", ".gltf"],
  publicDirectory: "/models/z-anatomy",
  attributionRequired: true,
};
