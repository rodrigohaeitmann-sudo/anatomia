// Extracts from the Z-Anatomy skeleton (FBX world space) the bones of the shoulder girdle and thorax
// with their named bony landmarks and muscle attachment areas, for build_anatomy_layers.py.
//
// - Bones: left side (the model presents the source left as the operative right) plus the sternum.
// - Landmarks: Z-Anatomy draws each bony feature as a label with a thin leader line; both ends of the
//   line are kept and the build picks the end that touches the bone.
// - Attachments: child meshes of a bone named <Muscle><o|e><n><l|r> are surfaces on the bone. The o/e
//   tag is kept for reference only: it disagrees with the classical origin/insertion in about a third
//   of the areas, so the build classifies each area from its own table.
// Usage: node scripts/hybrid/extract_zanatomy_skeleton.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
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
const fbx = join(root, "assets/source/hybrid/z-anatomy/fbx/SkeletalSystem100.fbx");
const outDir = join(root, "assets/source/hybrid/z-anatomy/extracted");
const ribs = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh", "Twelfth"].map((n) => `${n}_ribl`);
const bones = ["Humerusl", "Scapulal", "Claviclel", "Manubrium_of_sternum", "Body_of_sternum", "Xiphoid_process", "Hip_bonel", ...ribs];

const bytes = readFileSync(fbx);
const scene = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
scene.updateMatrixWorld(true);
const byName = new Map();
scene.traverse((o) => {
  if (!byName.has(o.name)) byName.set(o.name, []);
  byName.get(o.name).push(o);
});

const round = (v) => Math.round(v * 1e4) / 1e4;
function worldGeometry(mesh) {
  const g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  const pos = Array.from(g.attributes.position.array, round);
  const idx = g.index ? Array.from(g.index.array) : [...Array(pos.length / 3).keys()];
  return { pos, idx };
}

const out = { source: "Z-Anatomy SkeletalSystem100.fbx (CC BY-SA 4.0)", bones: {}, landmarks: [], attachments: [] };
const point = new THREE.Vector3();
for (const name of bones) {
  // the bone itself is the mesh whose parent is a collection group (names ending in "g")
  const mesh = (byName.get(name) ?? []).find((o) => o.isMesh && o.parent && /g$/.test(o.parent.name));
  if (!mesh) throw new Error(`missing Z-Anatomy bone ${name}`);
  out.bones[name] = worldGeometry(mesh);
  for (const child of mesh.children) {
    if (child.isMesh) {
      const match = child.name.match(/^(.*?)([oe])(\d*)([lr])$/);
      // the side letter is unreliable in the source (some left-rib areas end in "r"); the parent bone decides
      if (!match) continue;
      out.attachments.push({ bone: name, name: child.name, muscle: match[1], tag: match[2], part: match[3], ...worldGeometry(child) });
      continue;
    }
    const marker = child.children.find((c) => c.isMesh);
    if (!marker) continue;
    const p = marker.geometry.attributes.position;
    const verts = [];
    for (let i = 0; i < p.count; i++) {
      point.fromBufferAttribute(p, i).applyMatrix4(marker.matrixWorld);
      verts.push(round(point.x), round(point.y), round(point.z));
    }
    out.landmarks.push({ bone: name, name: child.name.replace(/[st]$/, ""), verts });
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "skeleton.json"), JSON.stringify(out));
console.log(`skeleton: ${Object.keys(out.bones).length} bones, ${out.landmarks.length} landmarks, ${out.attachments.length} attachment areas`);
