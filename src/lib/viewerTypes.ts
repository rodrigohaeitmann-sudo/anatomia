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
