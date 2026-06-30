import { latissimusDorsiFlapSteps } from "@/data/latissimusDorsiFlapSteps";

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
  code: string;
  phase: string;
  title: string;
  shortDescription: string;
  detailedDescription: string;
  patientPosition: string;
  orientation: "posterior" | "posterolateral" | "axillary-closeup" | "lateral-position" | "anterior" | "closure";
  overlayPreset: SurgicalOverlayPreset;
  visibleStructures: string[];
  annotations: AnatomyAnnotation[];
  references: SurgicalReference[];
  practicalTips: string[];
  attentionPoints: string[];
  comparison?: SurgicalComparison;
  camera?: CameraPreset;
  clippingPlane?: ClippingPlaneConfig;
};

export type SurgicalOverlayPreset =
  | "topographic-anatomy"
  | "pedicle-anatomy"
  | "skin-marking"
  | "lateral-decubitus"
  | "inferior-incision"
  | "inferolateral-dissection"
  | "upper-incision"
  | "trapezius-plane"
  | "free-anterior-border"
  | "superior-limit"
  | "inferior-limit"
  | "inferior-muscle-release"
  | "deep-plane-clean"
  | "pedicle-isolation"
  | "islanded-flap"
  | "axillary-tunnel"
  | "donor-closure"
  | "supine-reposition"
  | "anterior-flap"
  | "breast-pocket"
  | "drain"
  | "prepectoral-pocket"
  | "sizer"
  | "irrigation"
  | "implant"
  | "pocket-closure"
  | "muscle-coverage"
  | "deepithelialization"
  | "final-suture"
  | "dressing";

export type SurgicalReference = {
  label: string;
  detail: string;
  targetStructure?: string;
};

export type SurgicalComparison = {
  correct: string;
  pitfall: string;
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

export const procedures: SurgicalProcedure[] = [
  {
    id: "latissimus-dorsi-flap",
    title: "Reconstrução mamária com retalho do grande dorsal",
    specialty: "Reconstrução mamária",
    description:
      "Roteiro interativo com 30 etapas do retalho miocutâneo de grande dorsal direito, incluindo marcação, colheita, pedículo, tunelização, loja pré-peitoral, implante e fechamento.",
    modelPath: "models/z-anatomy/torso-mastology.glb",
    steps: latissimusDorsiFlapSteps,
  },
];

export const futureProcedureGroups = [
  "Mastologia oncológica",
  "Reconstrução mamária",
  "Anatomia aplicada",
];
