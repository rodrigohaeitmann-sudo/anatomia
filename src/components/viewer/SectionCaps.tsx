"use client";

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { tissueColors, type Tissue } from "@/lib/modelConfig";
import { filledTissues, shapesFor, type SectionLoop, type SectionResult } from "@/lib/sectioning";
import { mm } from "./shared";

/** Filled cross-section caps (volumes) and contour lines (all loops), drawn on the section plane. */
export function SectionCaps({ section, planeNormal, selected }: { section: SectionResult | null; planeNormal: THREE.Vector3 | null; selected: string | null }) {
  const invalidate = useThree((state) => state.invalidate);
  const group = useMemo(() => {
    const root = new THREE.Group();
    if (!section || !planeNormal) return root;
    const { u, v, n } = section.basis;
    // model-space point of (a, b) on the plane, nudged towards the removed half so it is not clipped
    const w = -section.basis.offset * n.dot(planeNormal);
    const lift = planeNormal.clone().multiplyScalar(-0.35 * mm);
    const to3 = (a: number, b: number, target: THREE.Vector3) => target.copy(u).multiplyScalar(a).addScaledVector(v, b).addScaledVector(n, w).add(lift);

    const byMesh = new Map<string, SectionLoop[]>();
    section.loops.forEach((loop) => byMesh.set(loop.meshName, [...(byMesh.get(loop.meshName) ?? []), loop]));
    const ranked = [...byMesh.values()].sort((a, b) => Math.max(...b.map((l) => l.area)) - Math.max(...a.map((l) => l.area)));

    ranked.forEach((loops, rank) => {
      const tissue = loops[0].tissue as Tissue;
      const isSelected = loops[0].structure === selected;
      const color = new THREE.Color(isSelected ? "#fde68a" : tissueColors[tissue] ?? "#cbd5e1");
      if (filledTissues.has(tissue)) {
        const material = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.92), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 - rank });
        for (const { outer, holes } of shapesFor(loops)) {
          const shape = new THREE.Shape(Array.from({ length: outer.points.length / 2 }, (_, i) => new THREE.Vector2(outer.points[i * 2], outer.points[i * 2 + 1])));
          holes.forEach((hole) => shape.holes.push(new THREE.Path(Array.from({ length: hole.points.length / 2 }, (_, i) => new THREE.Vector2(hole.points[i * 2], hole.points[i * 2 + 1])))));
          const geometry = new THREE.ShapeGeometry(shape);
          const pos = geometry.attributes.position;
          const p = new THREE.Vector3();
          for (let i = 0; i < pos.count; i++) {
            to3(pos.getX(i), pos.getY(i), p);
            pos.setXYZ(i, p.x, p.y, p.z);
          }
          geometry.computeBoundingSphere();
          const mesh = new THREE.Mesh(geometry, material);
          mesh.renderOrder = 5 + rank;
          root.add(mesh);
        }
      }
      const lineMaterial = new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(tissue === "skin" ? 1 : 0.6), transparent: true, opacity: 0.95 });
      for (const loop of loops) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < loop.points.length / 2; i++) pts.push(to3(loop.points[i * 2], loop.points[i * 2 + 1], new THREE.Vector3()));
        const geometry = new THREE.BufferGeometry().setFromPoints(pts);
        const line = loop.closed ? new THREE.LineLoop(geometry, lineMaterial) : new THREE.Line(geometry, lineMaterial);
        line.renderOrder = 6 + rank;
        root.add(line);
      }
    });
    return root;
  }, [section, planeNormal, selected]);

  useEffect(() => {
    invalidate();
    return () => {
      group.traverse((object) => {
        const item = object as THREE.Mesh;
        item.geometry?.dispose();
        (item.material as THREE.Material | undefined)?.dispose?.();
      });
    };
  }, [group, invalidate]);

  return <primitive object={group} />;
}
