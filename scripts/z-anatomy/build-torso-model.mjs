import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

if (!globalThis.FileReader) {
  globalThis.FileReader = class FileReader {
    result = null;
    onloadend = null;
    onerror = null;

    readAsArrayBuffer(blob) {
      blob
        .arrayBuffer()
        .then((buffer) => {
          this.result = buffer;
          this.onloadend?.({ target: this });
        })
        .catch((error) => {
          this.onerror?.(error);
        });
    }
  };
}

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const sourceDir = `${root}/assets/source/z-anatomy`;
const outputPath = `${root}/public/models/z-anatomy/torso-mastology.glb`;
const manifestPath = `${root}/src/data/zAnatomyTorsoManifest.json`;

const ordinalRibNames = [
  "First",
  "Second",
  "Third",
  "Fourth",
  "Fifth",
  "Sixth",
  "Seventh",
  "Eighth",
  "Ninth",
  "Tenth",
  "Eleventh",
  "Twelfth",
];

const costalCartilageNames = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
];

const structureSpecs = {
  "skin": {
    color: "#f8c7b8",
    opacity: 0.22,
    files: {
      "Regions_of_human_body100.fbx": [
        /^Anterior_region_of_thoraxj$/,
        /^Pectoral_regionl$/,
        /^Lateral_region_of_thoraxl$/,
        /^Scapular_regionl$/,
        /^Infrascapular_regionl$/,
      ],
    },
  },
  "breast": {
    color: "#f9a8d4",
    opacity: 0.5,
    files: {
      "Regions_of_human_body100.fbx": [/^Mammary_regionl$/, /^Inframammary_regionl$/],
    },
  },
  "latissimus-dorsi": {
    color: "#ef4444",
    opacity: 0.95,
    files: {
      "MuscularSystem100.fbx": [/^Latissimus_dorsi_musclel$/],
    },
  },
  "serratus-anterior": {
    color: "#f97316",
    opacity: 0.88,
    files: {
      "MuscularSystem100.fbx": [/^Serratus_anterior_musclel$/],
    },
  },
  "pectoralis-major": {
    color: "#fb7185",
    opacity: 0.82,
    files: {
      "MuscularSystem100.fbx": [
        /^Clavicular_head_of_pectoralis_major_musclel$/,
        /^Sternocostal_head_of_pectoralis_major_musclel$/,
        /^\(Abdominal_part_of_pectoralis_major_muscle\)l$/,
      ],
    },
  },
  "pectoralis-minor": {
    color: "#f43f5e",
    opacity: 0.76,
    files: {
      "MuscularSystem100.fbx": [/^Pectoralis_minor_musclel$/],
    },
  },
  "chest-wall": {
    color: "#cbd5e1",
    opacity: 0.62,
    files: {
      "SkeletalSystem100.fbx": [
        new RegExp(`^(${ordinalRibNames.join("|")})_ribl$`),
        new RegExp(`^Costal_cartilage_of_(${costalCartilageNames.join("|")})_ribl$`, "i"),
        /^Manubrium_of_sternum$/,
        /^Body_of_sternum$/,
        /^Vertebra_T([1-9]|1[0-2])$/,
      ],
    },
  },
  "axilla": {
    color: "#a78bfa",
    opacity: 0.55,
    files: {
      "SkeletalSystem100.fbx": [/^Scapulal$/, /^Claviclel$/],
      "Regions_of_human_body100.fbx": [/^Deltopectoral_trianglel$/],
    },
  },
  "thoracodorsal-vessels": {
    color: "#38bdf8",
    opacity: 0.95,
    files: {
      "CardioVascular41.fbx": [
        /^Thoracodorsal_arteryl$/,
        /^Thoracodorsal_veinl$/,
        /^Subscapular_arteryl$/,
        /^Subscapular_veinl$/,
        /^Axillary_arteryl$/,
        /^Axillary_veinl$/,
        /^Circumflex_scapular_arteryl$/,
        /^Circumflex_scapular_veinl$/,
        /^Lateral_thoracic_arteryl$/,
        /^Lateral_thoracic_veinl$/,
      ],
    },
  },
};

const sourceDescriptions = {
  "MuscularSystem100.fbx": "Z-Anatomy muscular system FBX",
  "SkeletalSystem100.fbx": "Z-Anatomy skeletal system FBX",
  "CardioVascular41.fbx": "Z-Anatomy cardiovascular system FBX",
  "Regions_of_human_body100.fbx": "Z-Anatomy regions of human body FBX",
};

const materialByStructure = new Map(
  Object.entries(structureSpecs).map(([structureId, spec]) => [
    structureId,
    new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: 0.72,
      metalness: 0.02,
      transparent: spec.opacity < 1,
      opacity: spec.opacity,
      side: THREE.DoubleSide,
    }),
  ]),
);

function loadFbx(fileName) {
  const bytes = readFileSync(`${sourceDir}/${fileName}`);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new FBXLoader().parse(buffer, "");
}

function findStructureForMesh(fileName, meshName) {
  for (const [structureId, spec] of Object.entries(structureSpecs)) {
    const patterns = spec.files[fileName] ?? [];
    if (patterns.some((pattern) => pattern.test(meshName))) {
      return structureId;
    }
  }

  return undefined;
}

function cloneMeshWithWorldGeometry(mesh, structureId, sourceFile) {
  mesh.updateWorldMatrix(true, false);
  let geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.computeVertexNormals();

  const clone = new THREE.Mesh(geometry, materialByStructure.get(structureId));
  clone.name = mesh.name;
  clone.userData = {
    sourceFile,
    structureId,
    source: "Z-Anatomy",
    license: "CC BY-SA 4.0",
  };
  clone.castShadow = true;
  clone.receiveShadow = true;

  return clone;
}

const scene = new THREE.Group();
scene.name = "ZAnatomyTorsoMastology";

const selectedMeshesByStructure = Object.fromEntries(Object.keys(structureSpecs).map((id) => [id, []]));
const parsedFiles = new Set();

for (const fileName of Object.keys(sourceDescriptions)) {
  const object = loadFbx(fileName);
  parsedFiles.add(fileName);

  object.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;

    const structureId = findStructureForMesh(fileName, child.name);
    if (!structureId) return;

    const clone = cloneMeshWithWorldGeometry(child, structureId, fileName);
    scene.add(clone);
    selectedMeshesByStructure[structureId].push(child.name);
  });
}

const bounds = new THREE.Box3().setFromObject(scene);
const center = bounds.getCenter(new THREE.Vector3());
const size = bounds.getSize(new THREE.Vector3());
const scale = 4.2 / Math.max(size.x, size.y, size.z);

scene.children.forEach((child) => {
  child.position.sub(center);
  child.position.multiplyScalar(scale);
  child.scale.multiplyScalar(scale);
});

scene.updateMatrixWorld(true);

const exporter = new GLTFExporter();
const arrayBuffer = await exporter.parseAsync(scene, {
  binary: true,
  onlyVisible: true,
  trs: false,
});

writeFileSync(outputPath, Buffer.from(arrayBuffer));

const manifest = {
  modelPath: "models/z-anatomy/torso-mastology.glb",
  sourceRepository: "https://github.com/LluisV/Z-Anatomy/tree/PC-Version/Resources/Models/FBX",
  license: "CC BY-SA 4.0",
  generatedFrom: [...parsedFiles].map((fileName) => ({
    fileName,
    description: sourceDescriptions[fileName],
  })),
  structures: Object.fromEntries(
    Object.entries(selectedMeshesByStructure).map(([structureId, meshNames]) => [
      structureId,
      {
        meshNames: [...new Set(meshNames)].sort(),
      },
    ]),
  ),
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${manifestPath}`);
for (const [structureId, meshNames] of Object.entries(selectedMeshesByStructure)) {
  console.log(`${structureId}: ${meshNames.length} meshes`);
}
