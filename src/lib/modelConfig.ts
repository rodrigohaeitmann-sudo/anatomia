export type ModelStructureConfig = {
  id: string;
  label: string;
  color: string;
  defaultVisible: boolean;
  futureMeshName?: string;
};

export const modelStructures: ModelStructureConfig[] = [
  { id: "skin", label: "Pele", color: "#f8c7b8", defaultVisible: true, futureMeshName: "skin" },
  { id: "subcutaneous", label: "Tecido subcutâneo", color: "#facc15", defaultVisible: true, futureMeshName: "subcutaneous_tissue" },
  { id: "latissimus-dorsi", label: "Músculo grande dorsal", color: "#ef4444", defaultVisible: true, futureMeshName: "latissimus_dorsi" },
  { id: "serratus-anterior", label: "Serrátil anterior", color: "#f97316", defaultVisible: false, futureMeshName: "serratus_anterior" },
  { id: "thoracodorsal-vessels", label: "Vasos toracodorsais", color: "#38bdf8", defaultVisible: true, futureMeshName: "thoracodorsal_bundle" },
  { id: "chest-wall", label: "Parede torácica", color: "#94a3b8", defaultVisible: true, futureMeshName: "chest_wall" },
  { id: "axilla", label: "Axila", color: "#a78bfa", defaultVisible: true, futureMeshName: "axilla" },
  { id: "breast", label: "Mama", color: "#f9a8d4", defaultVisible: true, futureMeshName: "breast" },
];

export const futureModelGuidelines = {
  acceptedFormats: [".glb", ".gltf"],
  publicDirectory: "/models",
  attributionRequired: true,
};
