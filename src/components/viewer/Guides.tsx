"use client";

import { useMemo } from "react";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import type { AnchoredPoint, PackView } from "@/data/packs";
import type { SurgicalSpace } from "@/data/surgicalSpaces";
import type { AnnotationEntry, LabelMode } from "@/lib/annotations";
import type { Landmark } from "@/lib/modelConfig";
import { mm, resolvePoint, structureById, v3, type Snapper } from "./shared";

// Overlays anchored to real anatomy: annotation pins/labels and zone polygons whose vertices are
// snapped to the nearest vertex of the referenced structures. No anatomical structure is drawn here.

export type AnnotationProps = {
  entries: Map<string, AnnotationEntry>;
  mode: LabelMode;
};

/** Desktop-style name tag (used in "names" mode and for the selection on desktop). */
export function GuideLabel({ position, children, stack = 0 }: { position: Landmark; children: React.ReactNode; stack?: number }) {
  return (
    <Html position={position} className="pointer-events-none" zIndexRange={[20, 0]}>
      <div style={{ transform: `translate(${stack % 2 ? 12 : -12 - 8 * stack}px, ${-100 - stack * 70}%)` }} className="whitespace-nowrap rounded-full border border-[#E3D8CB] bg-white px-2.5 py-1 text-[11px] font-semibold leading-tight text-[#221C20] shadow-[0_4px_14px_-6px_rgba(34,28,32,.25)]">
        {children}
      </div>
    </Html>
  );
}

/** Name tag for one annotation ("names" mode). Pins are drawn by the DOM PinOverlay, decluttered in screen space. */
function Annotation({ position, entry, stack, annotations }: { position: Landmark; entry: AnnotationEntry; stack: number; annotations: AnnotationProps }) {
  if (annotations.mode !== "names") return null;
  return (
    <GuideLabel position={position} stack={stack}>
      <span className="mr-1 inline-grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: entry.color }}>
        {entry.number}
      </span>
      {entry.text}
    </GuideLabel>
  );
}

function GuideLine({ points, color = "#a855f7", dashed = false, width = 3 }: { points: Landmark[]; color?: string; dashed?: boolean; width?: number }) {
  return <Line points={points} color={color} lineWidth={width} dashed={dashed} dashSize={0.04} gapSize={0.025} depthTest={false} transparent opacity={0.95} renderOrder={10} />;
}

export function Marker({ position, color = "#221C20" }: { position: Landmark; color?: string }) {
  return (
    <mesh position={position} renderOrder={11}>
      <sphereGeometry args={[4 * mm, 16, 12]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  );
}

/** Marks each wall of the active surgical space at the wall structure's point nearest the space centre. */
export function SpaceOverlay({ space, snap, annotations }: { space: SurgicalSpace; snap: Snapper | null; annotations: AnnotationProps }) {
  const centre = resolvePoint(space.centre);
  if (!centre) return null;
  return (
    <group>
      <Marker position={centre} color="#221C20" />
      {space.walls.map((wall, index) => {
        const entry = annotations.entries.get(`wall:${index}`);
        const nearest = wallPoint(wall.structures, centre, snap);
        if (!nearest || !entry) return null;
        return (
          <group key={wall.label}>
            <GuideLine points={[centre, nearest]} color={entry.color} width={2} dashed />
            <Marker position={nearest} color={entry.color} />
            <Annotation position={nearest} entry={entry} stack={index} annotations={annotations} />
          </group>
        );
      })}
    </group>
  );
}

export function SelectionMarker({ structure, snap, showName }: { structure: string; snap: Snapper | null; showName: boolean }) {
  const info = structureById.get(structure);
  if (!info) return null;
  const point = (snap ? snap(structure, info.labelAnchor) : undefined) ?? info.labelAnchor;
  return (
    <group>
      <Marker position={point} color="#fde68a" />
      {showName && <GuideLabel position={point}>{info.label}</GuideLabel>}
    </group>
  );
}

/** Model-space anchor of every annotation key (labels, zone edges, space walls). */
export function annotationAnchors(view: PackView, space: SurgicalSpace | null, snap: Snapper | null): Map<string, Landmark> {
  const anchors = new Map<string, Landmark>();
  view.labels?.forEach((label, index) => {
    const position = resolveAnchored(label, snap);
    if (position) anchors.set(`label:${index}`, position);
  });
  view.zones?.forEach((zone, zoneIndex) => {
    const corners = zone.corners.map((corner) => resolveAnchored(corner, snap)).filter((c): c is Landmark => Boolean(c));
    zone.edgeLabels?.forEach((_, index) => {
      const a = corners[index];
      const b = corners[(index + 1) % corners.length];
      if (a && b) anchors.set(`zone:${zoneIndex}:${index}`, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    });
  });
  const centre = space ? resolvePoint(space.centre) : undefined;
  if (space && centre) {
    space.walls.forEach((wall, index) => {
      const nearest = wallPoint(wall.structures, centre, snap);
      if (nearest) anchors.set(`wall:${index}`, nearest);
    });
  }
  return anchors;
}

function wallPoint(structures: string[], centre: Landmark, snap: Snapper | null) {
  const points = structures.map((id) => (snap ? snap(id, centre) : structureById.get(id)?.labelAnchor)).filter((p): p is Landmark => Boolean(p));
  return points.sort((a, b) => v3(a).distanceTo(v3(centre)) - v3(b).distanceTo(v3(centre)))[0];
}

function resolveAnchored(point: AnchoredPoint, snap: Snapper | null): Landmark | undefined {
  const nearBase = resolvePoint(point.near);
  if (!nearBase) return undefined;
  const shift = point.nearOffsetMm ?? [0, 0, 0];
  const near: Landmark = [nearBase[0] + shift[0] * mm, nearBase[1] + shift[1] * mm, nearBase[2] + shift[2] * mm];
  const base = (snap ? snap(point.structure, near) : undefined) ?? structureById.get(point.structure)?.labelAnchor;
  if (!base) return undefined;
  const offset = point.offsetMm ?? [0, 0, 0];
  return [base[0] + offset[0] * mm, base[1] + offset[1] * mm, base[2] + offset[2] * mm];
}

function ZonePolygon({ corners, color, label, zoneIndex, edgeCount, annotations }: { corners: Landmark[]; color: string; label: string; zoneIndex: number; edgeCount: number; annotations: AnnotationProps }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const flat: number[] = [];
    for (let i = 1; i < corners.length - 1; i++) flat.push(...corners[0], ...corners[i], ...corners[i + 1]);
    g.setAttribute("position", new THREE.Float32BufferAttribute(flat, 3));
    return g;
  }, [corners]);
  const centre = corners.reduce((acc, c) => [acc[0] + c[0] / corners.length, acc[1] + c[1] / corners.length, acc[2] + c[2] / corners.length], [0, 0, 0] as Landmark);
  return (
    <group>
      <mesh geometry={geometry} renderOrder={12}>
        <meshBasicMaterial color={color} transparent opacity={0.22} side={THREE.DoubleSide} depthTest={false} depthWrite={false} />
      </mesh>
      <GuideLine points={[...corners, corners[0]]} color={color} width={4} />
      {corners.map((corner, index) => <Marker key={index} position={corner} color={color} />)}
      {annotations.mode !== "hidden" && <GuideLabel position={centre}>{label}</GuideLabel>}
      {Array.from({ length: edgeCount }, (_, index) => {
        const entry = annotations.entries.get(`zone:${zoneIndex}:${index}`);
        const a = corners[index];
        const b = corners[(index + 1) % corners.length];
        if (!a || !b || !entry) return null;
        return <Annotation key={entry.key} position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]} entry={entry} stack={0} annotations={annotations} />;
      })}
    </group>
  );
}

/** Labels and zones of the active pack view. */
export function PackOverlay({ view, snap, annotations }: { view: PackView; snap: Snapper | null; annotations: AnnotationProps }) {
  return (
    <group>
      {view.zones?.map((zone, zoneIndex) => {
        const corners = zone.corners.map((corner) => resolveAnchored(corner, snap)).filter((c): c is Landmark => Boolean(c));
        return corners.length >= 3 ? <ZonePolygon key={zone.label} corners={corners} color={zone.color} label={zone.label} zoneIndex={zoneIndex} edgeCount={zone.edgeLabels?.length ?? 0} annotations={annotations} /> : null;
      })}
      {view.labels?.map((label, index) => {
        const position = resolveAnchored(label, snap);
        const entry = annotations.entries.get(`label:${index}`);
        if (!position || !entry) return null;
        return (
          <group key={entry.key}>
            {annotations.mode !== "hidden" && <Marker position={position} color="#221C20" />}
            <Annotation position={position} entry={entry} stack={index % 3} annotations={annotations} />
          </group>
        );
      })}
    </group>
  );
}
