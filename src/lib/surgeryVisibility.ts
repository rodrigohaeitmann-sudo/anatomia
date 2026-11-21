/**
 * Which structures can be shown in the step-by-step mammaplasty views. The steps carry their own skin, pieces, areola,
 * vessels and nerves through every key frame; the structures of the breast as scanned (gland, fat, ligaments, the
 * nipple-areola complex of the model, the schematic vessels and nerves) and the plans of the techniques only follow
 * the shape of the breast, not the operation: in the steps they would stay where tissue was removed, so they are not
 * shown there (and not listed).
 */
import { breastMeshSides } from "@/lib/breastStates";
import { stepReplacesOf } from "@/lib/mammaplastySteps";
import { modelMeshes, modelStructures } from "@/lib/modelConfig";

const structureOf = new Map(modelMeshes.map((mesh) => [mesh.name, mesh.structure]));

/** Structures of the operated breast as scanned and the schematic layer. */
const breastAsScanned = new Set<string>([
  ...[...breastMeshSides].filter(([, sides]) => sides.includes("op") && sides.length === 1).map(([name]) => structureOf.get(name) ?? ""),
  ...modelStructures.filter((structure) => structure.schematic).map((structure) => structure.id),
]);
breastAsScanned.delete("");

/**
 * Hidden in a step view at this key frame (`cutFrame`: the frame of the resection, from which the marking is cut). In
 * the steps of a reconstruction, the structures of the trunk its sequence carries itself are hidden too.
 */
export function hiddenInSteps(id: string, frame: number, cutFrame: number, technique?: string) {
  if (breastAsScanned.has(id)) return true;
  if (technique && stepReplacesOf(technique).structures.includes(id)) return true;
  if (id.startsWith("mamo-pedicle-") || id.startsWith("mamo-resection-")) return true;
  if ((id.startsWith("mamo-marking-") || id.startsWith("mamo-reference-lines")) && frame >= cutFrame) return true;
  return false;
}

/** Listed in the structure list while a step view of `technique` is open. */
export const listedInSteps = (id: string, technique?: string) => !hiddenInSteps(id, 0, Infinity, technique) && !id.startsWith("mamo-marking-") && !id.startsWith("mamo-reference-lines");
