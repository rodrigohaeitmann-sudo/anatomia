// Extracts the Z-Anatomy meshes used by the hybrid torso (fasciae, axillary lymph nodes, lateral pectoral
// nerve, plus serratus/latissimus used only to register Z-Anatomy onto BodyParts3D) in FBX world space.
// Usage: node scripts/hybrid/extract_zanatomy.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.({ target: this });
    });
  }
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fbxDir = join(root, "assets/source/hybrid/z-anatomy/fbx");
const outDir = join(root, "assets/source/hybrid/z-anatomy/extracted");
const wanted = new Set([
  "Pectoral_fascial", "Clavipectoral_fascial", "Deltoid_fascial",
  "Anterior_layer_of_thoracolumbar_fascial", "Middle_layer_of_thoracolumbar_fascial", "Posterior_layer_of_thoracolumbar_fascial",
  "Anterior_axillary_nodesl", "Posterior_axillary_nodesl", "Lateral_axillary_nodesl", "Central_axillary_nodesl",
  "Apical_axillary_nodesl", "Interpectoral_nodesl", "Parasternal_nodesl",
  "Lateral_pectoral_nervel", "Serratus_anterior_musclel", "Latissimus_dorsi_musclel",
]);

mkdirSync(outDir, { recursive: true });
const found = [];
for (const file of ["MuscularSystem100.fbx", "LymphoidOrgans100.fbx", "NervousSystem100.fbx"]) {
  const bytes = readFileSync(join(fbxDir, file));
  const object = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  object.updateMatrixWorld(true);
  object.traverse((mesh) => {
    if (!mesh.isMesh || !wanted.has(mesh.name)) return;
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    writeFileSync(join(outDir, `${mesh.name}.pos.bin`), Buffer.from(new Float32Array(geometry.attributes.position.array).buffer));
    if (geometry.index) writeFileSync(join(outDir, `${mesh.name}.idx.bin`), Buffer.from(new Uint32Array(geometry.index.array).buffer));
    found.push(mesh.name);
  });
}
const missing = [...wanted].filter((name) => !found.includes(name));
if (missing.length) throw new Error(`missing Z-Anatomy meshes: ${missing.join(", ")}`);
console.log(`extracted ${found.length} meshes into ${outDir}`);
