// Decodes the published (meshopt-compressed) desktop model into plain arrays in model space, so the
// anatomy layers are computed on exactly the geometry the viewer shows.
// Usage: node scripts/hybrid/decode_model.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifest = JSON.parse(readFileSync(join(root, "src/data/hybridTorsoManifest.json"), "utf8"));
const names = new Set(manifest.meshes.map((mesh) => mesh.name));
const bytes = readFileSync(join(root, "public", manifest.modelPath.replace(/^\//, "")));
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
await MeshoptDecoder.ready;
const gltf = await new Promise((resolve, reject) => loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", resolve, reject));
gltf.scene.updateMatrixWorld(true);

const outDir = join(root, "assets/build/model-meshes");
mkdirSync(outDir, { recursive: true });
const index = {};
const v = new THREE.Vector3();
gltf.scene.traverse((object) => {
  if (!object.isMesh) return;
  // gltfpack keeps the source node name on the parent of each quantised mesh
  const name = names.has(object.name) ? object.name : names.has(object.parent?.name) ? object.parent.name : null;
  if (!name) return;
  const p = object.geometry.attributes.position;
  const pos = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(object.matrixWorld);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const idx = object.geometry.index ? Uint32Array.from(object.geometry.index.array) : Uint32Array.from({ length: p.count }, (_, i) => i);
  writeFileSync(join(outDir, `${name}.pos.bin`), Buffer.from(pos.buffer));
  writeFileSync(join(outDir, `${name}.idx.bin`), Buffer.from(idx.buffer));
  index[name] = { vertices: p.count, triangles: idx.length / 3 };
});
writeFileSync(join(outDir, "index.json"), JSON.stringify(index));
console.log(`decoded ${Object.keys(index).length} meshes into ${outDir}`);
