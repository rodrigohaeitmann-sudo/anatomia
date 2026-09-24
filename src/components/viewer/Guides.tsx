"use client";

import { useMemo } from "react";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import type { SurgicalStep } from "@/data/procedures";
import type { SurgicalSpace } from "@/data/surgicalSpaces";
import { modelLandmarks as L, type Landmark } from "@/lib/modelConfig";
import { mm, resolvePoint, structureById, v3, wallColors, type Snapper } from "./shared";

// Didactic surgical guides: markings (incisions, pockets, drains) anchored to real anatomical
// landmarks computed from the model. No anatomical structure is drawn here.

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

function Ellipse({ center, normal, radii, color = "#a855f7", width = 3 }: { center: Landmark; normal: THREE.Vector3; radii: [number, number]; color?: string; width?: number }) {
  const points = useMemo(() => {
    const n = normal.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(up, n).normalize();
    const w = new THREE.Vector3().crossVectors(n, u).normalize();
    const c = v3(center);
    return Array.from({ length: 73 }, (_, i) => {
      const t = (i / 72) * Math.PI * 2;
      return c.clone().addScaledVector(u, Math.cos(t) * radii[0]).addScaledVector(w, Math.sin(t) * radii[1]).toArray() as Landmark;
    });
  }, [center, normal, radii]);
  return <GuideLine points={points} color={color} width={width} />;
}

function Volume({ center, radii, color, opacity = 0.28 }: { center: Landmark; radii: Landmark; color: string; opacity?: number }) {
  return (
    <mesh position={center} scale={radii} renderOrder={9}>
      <sphereGeometry args={[1, 48, 32]} />
      <meshPhysicalMaterial color={color} transparent opacity={opacity} depthWrite={false} roughness={0.2} clearcoat={0.8} />
    </mesh>
  );
}

export function Marker({ position, color = "#f8fafc" }: { position: Landmark; color?: string }) {
  return (
    <mesh position={position} renderOrder={11}>
      <sphereGeometry args={[4 * mm, 16, 12]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  );
}

export function SurgicalGuideOverlay({ step, snap }: { step: SurgicalStep; snap: Snapper | null }) {
  const preset = step.overlayPreset;
  const outward = useMemo(() => v3(L.skinPaddleCenter).sub(v3(L.latissimusCenter)).setY(0).normalize(), []);
  const breastNormal = useMemo(() => v3(L.nipple).sub(v3(L.breastCenter)).normalize(), []);
  const paddle = L.skinPaddleCenter;
  const paddleRadii: [number, number] = [95 * mm, 38 * mm];
  const offset = (p: Landmark, n: THREE.Vector3, d: number) => v3(p).addScaledVector(n, d).toArray() as Landmark;
  const breastRadii: Landmark = [
    (L.breastBounds.max[0] - L.breastBounds.min[0]) * 0.42,
    (L.breastBounds.max[1] - L.breastBounds.min[1]) * 0.4,
    (L.breastBounds.max[2] - L.breastBounds.min[2]) * 0.42,
  ];
  const showPaddle = ["skin-marking", "lateral-decubitus", "inferior-incision", "inferolateral-dissection", "upper-incision", "trapezius-plane", "islanded-flap", "deepithelialization"].includes(preset);
  const showPedicle = ["pedicle-anatomy", "pedicle-isolation", "islanded-flap", "axillary-tunnel", "anterior-flap", "muscle-coverage"].includes(preset);
  const showPocket = ["breast-pocket", "prepectoral-pocket", "sizer", "irrigation", "implant", "pocket-closure", "muscle-coverage"].includes(preset);
  const paddleTop = offset(paddle, new THREE.Vector3(0, 1, 0), paddleRadii[1]);
  const paddleBottom = offset(paddle, new THREE.Vector3(0, -1, 0), paddleRadii[1]);
  const along = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), outward).normalize();
  const incision = (p: Landmark): Landmark[] => [offset(p, along, -paddleRadii[0] * 1.15), offset(p, along, paddleRadii[0] * 1.15)];

  return (
    <group>
      {showPaddle && <Ellipse center={paddle} normal={outward} radii={paddleRadii} />}
      {preset === "skin-marking" && <GuideLabel position={paddleTop}>Ilha de pele sobre o grande dorsal</GuideLabel>}
      {preset === "inferior-incision" && <GuideLine points={incision(paddleBottom)} color="#e879f9" width={4} />}
      {preset === "upper-incision" && <GuideLine points={incision(paddleTop)} color="#e879f9" width={4} />}
      {preset === "trapezius-plane" && (
        <>
          <Marker position={L.trapeziusInferiorBorder} color="#22c55e" />
          <GuideLabel position={L.trapeziusInferiorBorder}>Borda inferior do trapézio</GuideLabel>
        </>
      )}
      {preset === "free-anterior-border" && (
        <>
          <GuideLine points={L.latissimusAnteriorBorder} color="#38bdf8" width={4} dashed />
          <GuideLabel position={L.latissimusAnteriorBorder[0]}>Borda anterior livre do GD</GuideLabel>
        </>
      )}
      {preset === "superior-limit" && (
        <>
          <GuideLine points={[L.scapulaInferiorAngle, L.thoracodorsalArteryOrigin]} color="#f59e0b" width={4} dashed />
          <Marker position={L.scapulaInferiorAngle} color="#f59e0b" />
          <GuideLabel position={L.scapulaInferiorAngle}>Ângulo inferior da escápula</GuideLabel>
        </>
      )}
      {["inferior-limit", "inferior-muscle-release"].includes(preset) && (
        <>
          <GuideLine points={[L.latissimusInferior, L.iliacCrestTop]} color="#a855f7" width={4} dashed />
          <Marker position={L.iliacCrestTop} color="#a855f7" />
          <GuideLabel position={L.iliacCrestTop}>Crista ilíaca / limite inferior</GuideLabel>
        </>
      )}
      {showPedicle && (
        <>
          <Marker position={L.thoracodorsalArteryOrigin} color="#fca5a5" />
        </>
      )}
      {preset === "axillary-tunnel" && <GuideLine points={[L.thoracodorsalArteryOrigin, L.axillaryArteryCenter, L.breastCenter]} color="#38bdf8" width={6} dashed />}
      {preset === "donor-closure" && <GuideLine points={incision(paddle)} color="#e2e8f0" width={4} />}
      {showPocket && <Volume center={L.breastCenter} radii={breastRadii} color="#f9a8d4" opacity={0.18} />}
      {preset === "sizer" && <Volume center={L.breastCenter} radii={breastRadii.map((r) => r * 0.82) as Landmark} color="#93c5fd" opacity={0.42} />}
      {preset === "irrigation" && <Volume center={L.breastCenter} radii={breastRadii.map((r) => r * 0.85) as Landmark} color="#bae6fd" opacity={0.3} />}
      {preset === "implant" && <Volume center={L.breastCenter} radii={breastRadii.map((r) => r * 0.85) as Landmark} color="#dbeafe" opacity={0.6} />}
      {["pocket-closure", "final-suture"].includes(preset) && <Ellipse center={offset(L.nipple, breastNormal, 2 * mm)} normal={breastNormal} radii={[breastRadii[0] * 0.9, breastRadii[1] * 0.9]} color="#f8fafc" />}
      {preset === "deepithelialization" && <Ellipse center={offset(L.nipple, breastNormal, 2 * mm)} normal={breastNormal} radii={[45 * mm, 22 * mm]} color="#fb7185" />}
      {preset === "drain" && <GuideLine points={[L.inframammaryFold, offset(L.inframammaryFold, new THREE.Vector3(-1, -0.6, 0).normalize(), 120 * mm)]} color="#dbeafe" width={5} />}
      {preset === "dressing" && <Ellipse center={offset(L.nipple, breastNormal, 6 * mm)} normal={breastNormal} radii={[breastRadii[0] * 1.05, breastRadii[1] * 1.05]} color="#e2e8f0" width={6} />}
      {step.annotations.map((item, index) => {
        const target = item.targetStructure;
        const anchor = target ? (item.position && snap ? snap(target, item.position) : undefined) ?? structureById.get(target)?.labelAnchor : undefined;
        const position = anchor ?? item.position;
        if (!position) return null;
        return (
          <group key={item.id}>
            {anchor && <Marker position={anchor} color="#e2e8f0" />}
            <GuideLabel position={position} stack={index}>{item.label}</GuideLabel>
          </group>
        );
      })}
    </group>
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
