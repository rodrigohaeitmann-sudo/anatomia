import { armPoseById } from "@/lib/armPoses";
import { layerParts } from "@/lib/anatomyLayers";
import { modelMeshes, modelStructures } from "@/lib/modelConfig";

const structureLabel = new Map(modelStructures.map((item) => [item.id, item.label]));
const partLabelByMesh = new Map(layerParts.flatMap((part) => part.meshNames.map((name) => [name, part.label] as const)));
const meshBySource = new Map(modelMeshes.map((mesh) => [mesh.sourceName, mesh]));

/** Muscles that change length the most in a pose (computed by build_poses.py on the model). */
export function stretchSummary(poseId: string, limit = 6) {
  const pose = armPoseById.get(poseId);
  if (!pose) return [];
  return Object.entries(pose.muscleStretch)
    .map(([source, stretch]) => {
      const mesh = meshBySource.get(source);
      const label = (mesh && partLabelByMesh.get(mesh.name)) || (mesh && structureLabel.get(mesh.structure)) || source;
      return { label, change: Math.round((stretch - 1) * 100) };
    })
    .filter((item) => Math.abs(item.change) >= 3)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, limit);
}
