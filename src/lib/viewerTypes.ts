export type ViewMode = "anatomical" | "surgical";

export type StructureVisibility = Record<string, boolean>;

export type ViewerState = {
  clippingEnabled: boolean;
  viewMode: ViewMode;
  structureVisibility: StructureVisibility;
};
