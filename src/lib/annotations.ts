import type { PackView } from "@/data/packs";
import type { SurgicalSpace } from "@/data/surgicalSpaces";

export const labelColor = "#e2e8f0";
export const wallColors = ["#22d3ee", "#a3e635", "#f472b6", "#facc15", "#fb923c", "#a78bfa"];

export type AnnotationEntry = {
  /** stable key shared by the 3D pin and the legend row */
  key: string;
  number: number;
  text: string;
  color: string;
  kind: "label" | "edge" | "wall";
  /** structure to select when the entry is tapped */
  structure?: string;
  /** heading the entry belongs to (zone title / space name) */
  group?: string;
};

/**
 * Every annotation of a view, numbered once, so the pins drawn on the model and the legend shown in
 * the panel always agree: view labels first, then zone limits, then the walls of the active space.
 */
export function viewAnnotations(view: PackView, space: SurgicalSpace | null): AnnotationEntry[] {
  const entries: AnnotationEntry[] = [];
  const push = (entry: Omit<AnnotationEntry, "number">) => entries.push({ ...entry, number: entries.length + 1 });
  view.labels?.forEach((label, index) => push({ key: `label:${index}`, text: label.text, color: labelColor, kind: "label", structure: label.structure }));
  view.zones?.forEach((zone, zoneIndex) =>
    zone.edgeLabels?.forEach((text, edgeIndex) => push({ key: `zone:${zoneIndex}:${edgeIndex}`, text, color: zone.color, kind: "edge", group: zone.label })),
  );
  space?.walls.forEach((wall, index) => push({ key: `wall:${index}`, text: wall.label, color: wallColors[index % wallColors.length], kind: "wall", structure: wall.structures[0], group: space.label }));
  return entries;
}

export type LabelMode = "pins" | "names" | "hidden";
export const labelModeCaption: Record<LabelMode, string> = { pins: "Pinos", names: "Nomes", hidden: "Ocultos" };
export const nextLabelMode: Record<LabelMode, LabelMode> = { pins: "names", names: "hidden", hidden: "pins" };
