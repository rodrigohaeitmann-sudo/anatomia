import type { SectionAxis } from "@/lib/sectioning";

export type ViewMode = "anatomical" | "surgical";

export type StructureVisibility = Record<string, boolean>;

export type CutScope = "all" | "superficial";

export type CutState = {
  axis: SectionAxis | null;
  /** 0..1 along the model extent of the axis */
  position: number;
  flip: boolean;
  scope: CutScope;
  /** exact model-space coordinate set by a pack view; cleared when the slider moves */
  absolute?: number | null;
};

export type SkinWindow = "none" | "anterior" | "posterior" | "lateral";

export type DissectionState = {
  /** 0 = intact … 5 = neurovascular and skeleton only */
  layer: number;
  skinWindow: SkinWindow;
  /** manipulation id -> amount 0..1 */
  manipulations: Record<string, number>;
  /** retract distance 0..1 per structure (exploded view) */
  retracted: Record<string, number>;
  space: string | null;
};

export const defaultCut: CutState = { axis: null, position: 0.5, flip: false, scope: "all" };
export const defaultDissection: DissectionState = { layer: 0, skinWindow: "none", manipulations: {}, retracted: {}, space: null };

/** Structures removed at each dissection depth (cumulative). */
export const dissectionLayers: { label: string; remove: string[] }[] = [
  { label: "Intacto", remove: [] },
  { label: "Sem pele", remove: ["skin"] },
  { label: "Sem mama e fáscias", remove: ["breast", "breast-fat", "breast-ligaments", "nipple-areola", "contralateral-breast", "pectoral-fascia", "deltoid-fascia", "thoracolumbar-fascia"] },
  { label: "Sem músculos superficiais", remove: ["pectoralis-major", "contralateral-pectoral", "trapezius", "latissimus-dorsi", "deltoid", "external-oblique"] },
  { label: "Sem músculos intermediários", remove: ["pectoralis-minor", "subclavius", "serratus-anterior", "rhomboids", "levator-scapulae", "teres-major", "teres-minor", "infraspinatus", "supraspinatus", "coracobrachialis-biceps", "triceps", "serratus-posterior"] },
  { label: "Neurovascular e esqueleto", remove: ["subscapularis", "intercostal-muscles"] },
];

export function hiddenByLayer(layer: number) {
  return new Set(dissectionLayers.slice(0, layer + 1).flatMap((entry) => entry.remove));
}

/** Study layers (aba Estudo). */
export type StudyState = {
  /** bony landmark dots */
  landmarks: boolean;
  /** attachment areas: none, the selected muscle only, or every area on visible bones */
  attachments: "selected" | "all";
  /** fibre directions: the selected muscle only, or every muscle that has them */
  fibres: "off" | "selected" | "all";
  /** surgical marking lines/points on the skin */
  markings: boolean;
  /** perforator zones shown on the skin */
  zones: string[];
  /** distance map: colour surfaces by distance (mm) to these structures */
  proximity: string[] | null;
  ruler: boolean;
};

export const defaultStudy: StudyState = { landmarks: false, attachments: "selected", fibres: "off", markings: false, zones: [], proximity: null, ruler: false };

/** point: tapped surface point as shown (posed); restPoint: the same point in the anatomical position */
export type PickInfo = { meshName: string; point: [number, number, number]; restPoint?: [number, number, number] };
