export type SurgicalProcedure = {
  id: string;
  title: string;
  specialty: string;
  description: string;
  modelPath?: string;
  steps: SurgicalStep[];
};

export type SurgicalStep = {
  id: string;
  title: string;
  shortDescription: string;
  detailedDescription: string;
  visibleStructures: string[];
  annotations: AnatomyAnnotation[];
  camera?: CameraPreset;
  clippingPlane?: ClippingPlaneConfig;
};

export type AnatomyAnnotation = {
  id: string;
  label: string;
  description?: string;
  targetStructure?: string;
  position?: [number, number, number];
};

export type CameraPreset = {
  position: [number, number, number];
  target: [number, number, number];
  zoom?: number;
};

export type ClippingPlaneConfig = {
  enabled: boolean;
  normal: [number, number, number];
  constant: number;
};

const baseCamera: CameraPreset = {
  position: [4, 3, 6],
  target: [0, 0.5, 0],
  zoom: 1,
};

export const procedures: SurgicalProcedure[] = [
  {
    id: "latissimus-dorsi-flap",
    title: "Reconstrução mamária com retalho do grande dorsal",
    specialty: "Reconstrução mamária",
    description:
      "Módulo didático para navegação pelas etapas principais da reconstrução mamária com retalho miocutâneo do músculo grande dorsal.",
    modelPath: "models/z-anatomy/torso-mastology.glb",
    steps: [
      ["positioning", "Posicionamento da paciente em decúbito lateral", "Organização da paciente, apoios e campos para acesso simultâneo ao dorso, axila e região mamária."],
      ["skin-paddle-marking", "Marcação do fuso cutâneo no dorso", "Planejamento do fuso cutâneo conforme necessidade de pele, cicatriz prévia e arco de rotação do retalho."],
      ["inferior-incision", "Incisão inferior do fuso", "Abertura inicial no limite inferior para desenvolver o plano de dissecção com segurança."],
      ["subcutaneous-dissection", "Dissecção do retalho cutâneo-subcutâneo", "Elevação cuidadosa do envelope cutâneo-subcutâneo, preservando vascularização e orientação do fuso."],
      ["muscle-identification", "Identificação do músculo grande dorsal", "Exposição da borda do músculo grande dorsal e confirmação dos limites anatômicos relevantes."],
      ["flap-elevation", "Elevação do retalho miocutâneo", "Liberação progressiva do retalho com atenção aos planos avasculares e à espessura adequada."],
      ["pedicle-preservation", "Identificação e preservação do pedículo toracodorsal", "Reconhecimento do pedículo toracodorsal, mantendo comprimento e integridade para rotação segura."],
      ["axillary-tunnel", "Confecção do túnel axilar", "Criação de comunicação ampla e sem compressão entre dorso, axila e loja mamária."],
      ["flap-rotation", "Rotação do retalho para a região mamária", "Transposição do retalho pelo túnel axilar, verificando torção, tensão e perfusão."],
      ["shaping-fixation", "Modelagem e fixação do retalho", "Ajuste tridimensional do retalho e fixação para reconstruir volume, contorno e simetria."],
    ].map(([id, title, description], index) => ({
      id,
      title,
      shortDescription: description,
      detailedDescription: `${description} Esta etapa foi mockada para o MVP e deve ser revisada com imagens, modelos e notas cirúrgicas específicas antes do uso educacional formal.`,
      visibleStructures:
        index < 3
          ? ["skin", "subcutaneous", "breast", "pectoralis-major", "chest-wall"]
          : index < 6
            ? ["skin", "subcutaneous", "latissimus-dorsi", "serratus-anterior", "chest-wall", "breast"]
            : ["skin", "subcutaneous", "latissimus-dorsi", "serratus-anterior", "thoracodorsal-vessels", "axilla", "chest-wall", "breast", "pectoralis-major"],
      annotations: [
        {
          id: `${id}-focus`,
          label: `Foco: ${title}`,
          description,
          targetStructure: index >= 6 ? "thoracodorsal-vessels" : "latissimus-dorsi",
          position: [0, 1 + index * 0.04, 0],
        },
      ],
      camera: { ...baseCamera, position: [4 - index * 0.1, 3, 6 - index * 0.12] as [number, number, number] },
      clippingPlane: { enabled: index >= 3, normal: [1, 0, 0], constant: 0.15 },
    })),
  },
];

export const futureProcedureGroups = [
  "Mastologia oncológica",
  "Reconstrução mamária",
  "Anatomia aplicada",
];
