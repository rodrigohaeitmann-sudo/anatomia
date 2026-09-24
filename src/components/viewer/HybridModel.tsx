"use client";

import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { manipulations as manipulationDefs } from "@/data/surgicalSpaces";
import { tissueColors, tissueOpacity, type Tissue } from "@/lib/modelConfig";
import type { SliceTarget } from "@/lib/sectioning";
import type { ViewMode } from "@/lib/viewerTypes";
import { buildSnapper, isMesh, mm, namedNode, recordFor, resolvePoint, type Snapper } from "./shared";

export type ModelHandle = {
  snap: Snapper;
  /** meshes currently clipped by the section plane (for caps / 2D view) */
  sliceTargets: () => SliceTarget[];
  root: THREE.Object3D;
};

export type PlaneSet = {
  /** plane applied to every visible mesh (or superficial only) */
  cut: THREE.Plane | null;
  cutScope: "all" | "superficial";
  /** plane applied to the skin only (skin window) */
  skin: THREE.Plane | null;
  /** step-defined dissection window, applied to superficial layers */
  step: THREE.Plane | null;
};

type Props = {
  modelPath: string;
  visible: (structure: string) => boolean;
  activeStructures: Set<string>;
  viewMode: ViewMode;
  planes: PlaneSet;
  selected: string | null;
  highlight: Map<string, string>;
  emphasised: Set<string>;
  manipulation: Record<string, number>;
  retracted: Record<string, number>;
  lowPower: boolean;
  onReady: (handle: ModelHandle) => void;
  onPick: (structure: string | null) => void;
};

export const superficialForCut = new Set(["skin", "breast-fat", "breast-ligaments", "contralateral-breast", "pectoral-fascia", "deltoid-fascia", "thoracolumbar-fascia"]);
const stepWindowStructures = new Set(["skin", "pectoral-fascia", "thoracolumbar-fascia", "deltoid-fascia"]);

function makeMaterial(tissue: Tissue, opts: { active: boolean; viewMode: ViewMode; selected: boolean; override?: string; emphasis: boolean; planes: THREE.Plane[]; lowPower: boolean }) {
  const color = new THREE.Color(opts.override ?? tissueColors[tissue]);
  let opacity = tissueOpacity[tissue] ?? 1;
  const faded = opts.viewMode === "surgical" && !opts.active && !opts.selected && !opts.override && !opts.emphasis;
  if (faded) {
    opacity = Math.min(opacity, tissue === "skin" ? 0.12 : 0.22);
    color.lerp(new THREE.Color("#94a3b8"), 0.45);
  }
  const vascular = tissue === "artery" || tissue === "vein";
  const glow = opts.selected ? 0.45 : opts.emphasis || (opts.viewMode === "surgical" && opts.active) ? (vascular || tissue === "nerve" ? 0.35 : 0.14) : opts.override ? 0.12 : 0;
  const common = {
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 0.6,
    side: THREE.DoubleSide,
    clippingPlanes: opts.planes,
    clipShadows: true,
    emissive: glow ? (opts.selected ? new THREE.Color("#fde68a") : color.clone()).multiplyScalar(glow) : new THREE.Color("#000000"),
    roughness: vascular ? 0.32 : tissue === "bone" ? 0.72 : tissue === "skin" ? 0.5 : 0.58,
    metalness: 0,
  };
  if (opts.lowPower) return new THREE.MeshStandardMaterial(common);
  return new THREE.MeshPhysicalMaterial({
    ...common,
    clearcoat: vascular || tissue === "duct" ? 0.7 : tissue === "muscle" ? 0.15 : 0,
    clearcoatRoughness: 0.35,
    sheen: tissue === "skin" || tissue === "muscle" || tissue === "nerve" ? 0.45 : 0,
    sheenColor: new THREE.Color(tissue === "skin" ? "#ffd9c7" : "#ffffff"),
    sheenRoughness: 0.6,
  });
}

export function HybridModel(props: Props) {
  const { modelPath, visible, activeStructures, viewMode, planes, selected, highlight, emphasised, manipulation, retracted, lowPower, onReady, onPick } = props;
  const gltf = useGLTF(modelPath, false, true);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  const invalidate = useThree((state) => state.invalidate);
  const original = useRef(new Map<THREE.Object3D, THREE.Matrix4>());
  const pivots = useRef<Map<string, THREE.Vector3> | null>(null);
  const centroids = useRef(new Map<string, THREE.Vector3>());

  // capture original node matrices and rest-pose pivots once
  useEffect(() => {
    scene.updateMatrixWorld(true);
    const toModel = scene.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    const sums = new Map<string, { sum: THREE.Vector3; n: number }>();
    scene.traverse((object) => {
      const node = namedNode(object);
      if (node && !original.current.has(node)) {
        node.updateMatrix();
        original.current.set(node, node.matrix.clone());
        node.matrixAutoUpdate = false;
      }
      if (isMesh(object)) {
        const record = recordFor(object);
        if (!record) return;
        object.geometry.computeBoundingBox();
        box.copy(object.geometry.boundingBox!).applyMatrix4(toModel.clone().multiply(object.matrixWorld));
        const entry = sums.get(record.structure) ?? { sum: new THREE.Vector3(), n: 0 };
        entry.sum.add(box.getCenter(new THREE.Vector3()));
        entry.n += 1;
        sums.set(record.structure, entry);
      }
    });
    sums.forEach((entry, id) => centroids.current.set(id, entry.sum.divideScalar(entry.n)));
    const restSnap = buildSnapper(scene);
    pivots.current = new Map(
      manipulationDefs
        .filter((m) => m.kind === "reflect")
        .map((m) => {
          const near = resolvePoint(m.pivotNear);
          const point = near ? restSnap(m.pivotStructure, near) : undefined;
          return [m.id, new THREE.Vector3(...(point ?? [0, 0, 0]))];
        }),
    );
  }, [scene]);

  // rigid manipulations (reflect / retract) — geometry itself is never deformed
  useEffect(() => {
    if (!pivots.current) return;
    const bodyCentre = new THREE.Vector3();
    centroids.current.forEach((c) => bodyCentre.add(c));
    bodyCentre.divideScalar(Math.max(1, centroids.current.size));
    const perStructure = new Map<string, THREE.Matrix4>();
    const compose = (id: string, m: THREE.Matrix4) => perStructure.set(id, m.clone().multiply(perStructure.get(id) ?? new THREE.Matrix4()));
    for (const def of manipulationDefs) {
      const amount = manipulation[def.id] ?? 0;
      if (def.kind !== "reflect" || amount <= 0) continue;
      const pivot = pivots.current.get(def.id)!;
      const rotation = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...def.axis).normalize(), THREE.MathUtils.degToRad((def.maxAngle ?? 90) * amount));
      const m = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z).multiply(rotation).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
      def.structures.forEach((id) => compose(id, m));
    }
    for (const def of manipulationDefs) {
      const amount = manipulation[def.id] ?? 0;
      if (def.kind !== "transpose" || amount <= 0 || !def.target) continue;
      const start = centroids.current.get(def.structures[0]);
      const targetPoint = resolvePoint(def.target);
      if (!start || !targetPoint) continue;
      const offset = def.targetOffsetMm ?? [0, 0, 0];
      const end = new THREE.Vector3(...targetPoint).add(new THREE.Vector3(...offset).multiplyScalar(mm));
      // half-turn about a vertical axis midway between start and end: the arc passes lateral to the chest
      const centre = start.clone().add(end).multiplyScalar(0.5);
      const angle = Math.PI * amount * (start.z < end.z ? 1 : -1);
      const rotation = new THREE.Matrix4().makeRotationY(angle);
      const lift = new THREE.Matrix4().makeTranslation(0, (end.y - start.y) * amount, 0);
      const m = lift.multiply(new THREE.Matrix4().makeTranslation(centre.x, 0, centre.z)).multiply(rotation).multiply(new THREE.Matrix4().makeTranslation(-centre.x, 0, -centre.z));
      def.structures.forEach((id) => compose(id, m));
    }
    const explode = manipulationDefs.find((m) => m.kind === "retract");
    for (const [id, amount] of Object.entries(retracted)) {
      if (amount <= 0) continue;
      const centre = centroids.current.get(id);
      if (!centre) continue;
      const direction = centre.clone().sub(bodyCentre).setY(0).normalize().multiplyScalar((explode?.distanceMm ?? 80) * mm * amount);
      compose(id, new THREE.Matrix4().makeTranslation(direction.x, direction.y, direction.z));
    }
    original.current.forEach((matrix, node) => {
      const record = recordFor(node);
      const extra = record ? perStructure.get(record.structure) : undefined;
      node.matrix.copy(extra ? extra.clone().multiply(matrix) : matrix);
      node.matrixWorldNeedsUpdate = true;
    });
    scene.updateMatrixWorld(true);
    onReady({ snap: buildSnapper(scene), sliceTargets: () => sliceTargets(scene, visible, planes), root: scene });
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manipulation, retracted, scene]);

  // expose updated slice targets when visibility / planes change
  useEffect(() => {
    onReady({ snap: buildSnapper(scene), sliceTargets: () => sliceTargets(scene, visible, planes), root: scene });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, planes.cut, planes.cutScope]);

  // materials, visibility, clipping
  useEffect(() => {
    const cache = new Map<string, THREE.Material>();
    scene.traverse((object) => {
      if (!isMesh(object)) return;
      const record = recordFor(object);
      if (!record) {
        object.visible = false;
        return;
      }
      object.visible = visible(record.structure);
      if (!object.visible) return;
      const list: THREE.Plane[] = [];
      if (planes.cut && (planes.cutScope === "all" || superficialForCut.has(record.structure))) list.push(planes.cut);
      if (planes.skin && record.structure === "skin") list.push(planes.skin);
      if (planes.step && stepWindowStructures.has(record.structure)) list.push(planes.step);
      const override = highlight.get(record.structure);
      const opts = {
        active: activeStructures.has(record.structure),
        viewMode,
        selected: selected === record.structure,
        override,
        emphasis: emphasised.has(record.structure),
        planes: list,
        lowPower,
      };
      const key = `${record.tissue}|${opts.active}|${viewMode}|${opts.selected}|${override}|${opts.emphasis}|${list.includes(planes.cut as THREE.Plane)}${list.includes(planes.skin as THREE.Plane)}${list.includes(planes.step as THREE.Plane)}`;
      let material = cache.get(key);
      if (!material) {
        material = makeMaterial(record.tissue, opts);
        cache.set(key, material);
      }
      object.material = material;
      object.renderOrder = material.transparent ? (record.tissue === "skin" ? 3 : 2) : 0;
      object.castShadow = !lowPower && !material.transparent;
      object.receiveShadow = !lowPower;
    });
    invalidate();
    return () => cache.forEach((material) => material.dispose());
  }, [scene, visible, activeStructures, viewMode, planes, selected, highlight, emphasised, lowPower, invalidate]);

  function handleClick(event: ThreeEvent<MouseEvent>) {
    if (event.delta > 6) return;
    event.stopPropagation();
    const candidates = event.intersections.filter((hit) => {
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        if (!node.visible) return false;
        node = node.parent;
      }
      const material = (hit.object as THREE.Mesh).material as THREE.Material;
      return (material.clippingPlanes ?? []).every((plane) => plane.distanceToPoint(hit.point) >= 0);
    });
    const solid = candidates.find((hit) => ((hit.object as THREE.Mesh).material as THREE.Material).opacity >= 0.5);
    const hit = solid ?? candidates[0];
    onPick(hit ? recordFor(hit.object)?.structure ?? null : null);
  }

  return <primitive object={scene} onClick={handleClick} />;
}

function sliceTargets(scene: THREE.Object3D, visible: (structure: string) => boolean, planes: PlaneSet): SliceTarget[] {
  scene.updateMatrixWorld(true);
  const toModel = scene.matrixWorld.clone().invert();
  const targets: SliceTarget[] = [];
  scene.traverse((object) => {
    if (!isMesh(object)) return;
    const record = recordFor(object);
    if (!record || !visible(record.structure)) return;
    if (planes.cutScope === "superficial" && !superficialForCut.has(record.structure)) return;
    targets.push({ mesh: object, structure: record.structure, tissue: record.tissue, meshName: record.name, toModel: toModel.clone().multiply(object.matrixWorld) });
  });
  return targets;
}
