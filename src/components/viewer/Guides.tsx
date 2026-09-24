"use client";

import { useMemo } from "react";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import type { AnchoredPoint, PackView } from "@/data/packs";
import type { SurgicalSpace } from "@/data/surgicalSpaces";
import type { Landmark } from "@/lib/modelConfig";
import { mm, resolvePoint, structureById, v3, wallColors, type Snapper } from "./shared";

// Overlays anchored to real anatomy: labels and zone polygons whose vertices are snapped to the
// nearest vertex of the referenced structures. No anatomical structure is drawn here.

export function GuideLabel({ position, children, stack = 0 }: { position: Landmark; children: React.ReactNode; stack?: number }) {
  return (
    <Html position={position} className="pointer-events-none" zIndexRange={[20, 0]}>
      <div style={{ transform: `translate(${stack % 2 ? 12 : -12 - 8 * stack}px, ${-100 - stack * 70}%)` }} className="whitespace-nowrap rounded-xl border border-white/10 bg-slate-950/85 px-2 py-1 text-[10px] font-semibold leading-tight text-white shadow-xl backdrop-blur">{children}</div>
    </Html>
  );
}

function GuideLine({ points, color = "#a855f7", dashed = false, width = 3 }: { points: Landmark[]; color?: string; dashed?: boolean; width?: number }) {
  return <Line points={points} color={color} lineWidth={width} dashed={dashed} dashSize={0.04} gapSize={0.025} depthTest={false} transparent opacity={0.95} renderOrder={10} />;
}

export function Marker({ position, color = "#f8fafc" }: { position: Landmark; color?: string }) {
  return (
    <mesh position={position} renderOrder={11}>
      <sphereGeometry args={[4 * mm, 16, 12]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  );
}

/** Labels each wall of the active surgical space at the wall structure's point nearest the space centre. */
export function SpaceOverlay({ space, snap }: { space: SurgicalSpace; snap: Snapper | null }) {
  const centre = resolvePoint(space.centre);
  if (!centre) return null;
  return (
    <group>
      <Marker position={centre} color="#f8fafc" />
      {space.walls.map((wall, index) => {
        const points = wall.structures.map((id) => (snap ? snap(id, centre) : structureById.get(id)?.labelAnchor)).filter((p): p is Landmark => Boolean(p));
        if (!points.length) return null;
        const nearest = points.sort((a, b) => v3(a).distanceTo(v3(centre)) - v3(b).distanceTo(v3(centre)))[0];
        return (
          <group key={wall.label}>
            <GuideLine points={[centre, nearest]} color={wallColors[index % wallColors.length]} width={2} dashed />
            <Marker position={nearest} color={wallColors[index % wallColors.length]} />
            <GuideLabel position={nearest} stack={index}>
              <span style={{ color: wallColors[index % wallColors.length] }}>■</span> {wall.label}
            </GuideLabel>
          </group>
        );
      })}
    </group>
  );
}

export function SelectionMarker({ structure, snap }: { structure: string; snap: Snapper | null }) {
  const info = structureById.get(structure);
  if (!info) return null;
  const point = (snap ? snap(structure, info.labelAnchor) : undefined) ?? info.labelAnchor;
  return (
    <group>
      <Marker position={point} color="#fde68a" />
      <GuideLabel position={point}>{info.label}</GuideLabel>
    </group>
  );
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

function ZonePolygon({ corners, color, label, edgeLabels }: { corners: Landmark[]; color: string; label: string; edgeLabels?: string[] }) {
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
      <GuideLabel position={centre}>{label}</GuideLabel>
      {edgeLabels?.map((text, index) => {
        const a = corners[index];
        const b = corners[(index + 1) % corners.length];
        if (!a || !b) return null;
        return (
          <GuideLabel key={text} position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]} stack={0}>
            <span style={{ color }}>{text}</span>
          </GuideLabel>
        );
      })}
    </group>
  );
}

/** Labels and zones of the active pack view. */
export function PackOverlay({ view, snap }: { view: PackView; snap: Snapper | null }) {
  return (
    <group>
      {view.zones?.map((zone) => {
        const corners = zone.corners.map((corner) => resolveAnchored(corner, snap)).filter((c): c is Landmark => Boolean(c));
        return corners.length >= 3 ? <ZonePolygon key={zone.label} corners={corners} color={zone.color} label={zone.label} edgeLabels={zone.edgeLabels} /> : null;
      })}
      {view.labels?.map((label, index) => {
        const position = resolveAnchored(label, snap);
        if (!position) return null;
        return (
          <group key={`${label.structure}-${label.text}`}>
            <Marker position={position} color="#e2e8f0" />
            <GuideLabel position={position} stack={index % 3}>{label.text}</GuideLabel>
          </group>
        );
      })}
    </group>
  );
}
