"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Html, Line } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import {
  attachmentColors,
  attachmentGeometry,
  fibreGeometry,
  loadLayerBuffers,
  regionLookup,
  type LayerAttachment,
  type LayerBuffers,
  type LayerFibre,
  type LayerLandmark,
  type Marking,
  type Zone,
} from "@/lib/anatomyLayers";
import { isMesh, mm, recordFor } from "./shared";

// Overlays for the study layers. Everything is positioned in model space (inside the rotated group),
// from data computed offline on the model's own meshes; nothing anatomical is modelled here.

export function useLayerBuffers(enabled: boolean) {
  const [buffers, setBuffers] = useState<LayerBuffers | null>(null);
  useEffect(() => {
    if (!enabled || buffers) return;
    let alive = true;
    loadLayerBuffers()
      .then((result) => alive && setBuffers(result))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled, buffers]);
  return buffers;
}

function Tag({ position, children, tone = "slate" }: { position: THREE.Vector3Tuple; children: React.ReactNode; tone?: "slate" | "amber" | "sky" }) {
  const border = tone === "amber" ? "border-amber-300/40" : tone === "sky" ? "border-sky-300/40" : "border-white/10";
  return (
    <Html position={position} className="pointer-events-none" zIndexRange={[25, 0]}>
      <div className={`-translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-lg border ${border} bg-slate-950/90 px-2 py-0.5 text-[11px] font-semibold text-white shadow-lg`}>{children}</div>
    </Html>
  );
}

// ---- bony landmarks -------------------------------------------------------------------------------
/** Dot colours: palpable landmarks amber, deep ones cyan, ribs violet, hila orange; review status wins. */
export const landmarkColors = { palpable: "#f59e0b", deep: "#0ea5e9", rib: "#8b5cf6", hilum: "#f97316" };
const landmarkTone = (item: LayerLandmark, review?: string) => {
  if (review === "confirmado") return "#22c55e";
  if (review === "incorreto") return "#ef4444";
  if (review === "ajustado") return "#d946ef";
  if (item.category === "hilo") return landmarkColors.hilum;
  if (item.category === "costela") return landmarkColors.rib;
  return item.palpable ? landmarkColors.palpable : landmarkColors.deep;
};

export function LandmarkDots({
  items,
  selected,
  review,
  showNames,
}: {
  items: (LayerLandmark & { point: [number, number, number] })[];
  selected: string | null;
  review: Record<string, string | undefined>;
  showNames: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const geometry = useMemo(() => new THREE.SphereGeometry(3.4 * mm, 16, 12), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.08 }), []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    items.forEach((item, index) => {
      matrix.makeTranslation(item.point[0], item.point[1], item.point[2]);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, color.set(landmarkTone(item, review[item.id])));
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [items, review, invalidate]);
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);
  const active = items.find((item) => item.id === selected);
  return (
    <>
      {/* taps are resolved by the page from the tapped surface point (nearest landmark), which is
          more forgiving on a phone than hitting a 7 mm sphere */}
      <instancedMesh key={`dots-${items.length}`} ref={ref} args={[geometry, material, Math.max(1, items.length)]} raycast={() => undefined} />
      {active && (
        <>
          <mesh position={active.point} renderOrder={20}>
            <sphereGeometry args={[4.6 * mm, 18, 12]} />
            <meshBasicMaterial color="#fde047" depthTest={false} transparent opacity={0.95} />
          </mesh>
          {showNames && <Tag position={active.point} tone="amber">{active.name}</Tag>}
        </>
      )}
    </>
  );
}

// ---- attachment areas -----------------------------------------------------------------------------
export function AttachmentAreas({ items, buffers, planes, onPick }: { items: LayerAttachment[]; buffers: LayerBuffers | null; planes: THREE.Plane[]; onPick: (item: LayerAttachment) => void }) {
  const materials = useMemo(() => {
    const make = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, emissive: new THREE.Color(color).multiplyScalar(0.18), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6, side: THREE.DoubleSide });
    return { origin: make(attachmentColors.origin), insertion: make(attachmentColors.insertion), originComputed: make(attachmentColors.originComputed), insertionComputed: make(attachmentColors.insertionComputed) };
  }, []);
  useEffect(() => {
    Object.values(materials).forEach((material) => (material.clippingPlanes = planes));
  }, [materials, planes]);
  useEffect(() => () => Object.values(materials).forEach((material) => material.dispose()), [materials]);
  const geometries = useMemo(() => (buffers ? new Map(items.map((item) => [item.id, attachmentGeometry(item, buffers)])) : null), [items, buffers]);
  useEffect(() => () => geometries?.forEach((geometry) => geometry.dispose()), [geometries]);
  if (!geometries) return null;
  return (
    <group>
      {items.map((item) => {
        const computed = item.source !== "Z-Anatomy";
        const material = item.kind === "origin" ? (computed ? materials.originComputed : materials.origin) : computed ? materials.insertionComputed : materials.insertion;
        return (
          <mesh
            key={item.id}
            geometry={geometries.get(item.id)}
            material={material}
            renderOrder={1}
            onClick={(event: ThreeEvent<MouseEvent>) => {
              if (event.delta > 6) return;
              event.stopPropagation();
              onPick(item);
            }}
          />
        );
      })}
    </group>
  );
}

// ---- fibre directions -----------------------------------------------------------------------------
export function FibreLines({ items, buffers }: { items: LayerFibre[]; buffers: LayerBuffers | null }) {
  // screen-space wide lines (LineSegments2) stay legible on phones; one draw call per muscle
  const sets = useMemo(() => {
    if (!buffers) return [];
    return items.map((item) => {
      const array = fibreGeometry(item, buffers).getAttribute("position").array as Float32Array;
      const points: [number, number, number][] = [];
      for (let i = 0; i < array.length; i += 3) points.push([array[i], array[i + 1], array[i + 2]]);
      return { id: item.id, points };
    });
  }, [items, buffers]);
  return (
    <group>
      {sets.map((entry) => (
        <Line key={entry.id} points={entry.points} segments color="#fff1f2" lineWidth={1.4} transparent opacity={0.9} renderOrder={2} raycast={() => undefined} />
      ))}
    </group>
  );
}

// ---- computed region (serratus digitation / pectoralis minor slip) ---------------------------------
/** Highlights one region of a partitioned muscle: an overlay mesh attached to the muscle's own mesh. */
export function RegionHighlight({ root, structure, labelIndex, buffers }: { root: THREE.Object3D | null; structure: string; labelIndex: number; buffers: LayerBuffers | null }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (!root || !buffers) return;
    const lookup = regionLookup(structure, buffers);
    if (!lookup) return;
    root.updateMatrixWorld(true);
    const toModel = root.matrixWorld.clone().invert();
    const added: THREE.Mesh[] = [];
    const material = new THREE.MeshBasicMaterial({ color: "#fbbf24", transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide });
    root.traverse((object) => {
      if (!isMesh(object) || recordFor(object)?.structure !== structure) return;
      const geometry = object.geometry;
      const position = geometry.attributes.position;
      const matrix = toModel.clone().multiply(object.matrixWorld);
      const v = new THREE.Vector3();
      const labels = new Int16Array(position.count);
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(matrix);
        labels[i] = lookup.labelAt(v.x, v.y, v.z);
      }
      const index = geometry.index;
      const tris: number[] = [];
      const count = index ? index.count : position.count;
      for (let t = 0; t < count; t += 3) {
        const a = index ? index.getX(t) : t, b = index ? index.getX(t + 1) : t + 1, c = index ? index.getX(t + 2) : t + 2;
        const votes = Number(labels[a] === labelIndex) + Number(labels[b] === labelIndex) + Number(labels[c] === labelIndex);
        if (votes >= 2) tris.push(a, b, c);
      }
      if (!tris.length) return;
      const overlay = new THREE.BufferGeometry();
      overlay.setAttribute("position", position);
      if (geometry.attributes.normal) overlay.setAttribute("normal", geometry.attributes.normal);
      overlay.setIndex(tris);
      const mesh = new THREE.Mesh(overlay, material);
      mesh.renderOrder = 5;
      mesh.raycast = () => undefined;
      object.add(mesh);
      added.push(mesh);
    });
    invalidate();
    return () => {
      added.forEach((mesh) => {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      });
      material.dispose();
      invalidate();
    };
  }, [root, structure, labelIndex, buffers, invalidate]);
  return null;
}

// ---- ruler ----------------------------------------------------------------------------------------
export function Ruler({ points }: { points: [number, number, number][] }) {
  if (!points.length) return null;
  const [a, b] = points;
  const distance = b ? new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b)) / mm : null;
  const middle: THREE.Vector3Tuple | null = b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] : null;
  return (
    <group>
      {points.map((p, index) => (
        <mesh key={index} position={p} renderOrder={21}>
          <sphereGeometry args={[2.2 * mm, 14, 10]} />
          <meshBasicMaterial color="#38bdf8" depthTest={false} />
        </mesh>
      ))}
      {b && <Line points={[a, b]} color="#38bdf8" lineWidth={2.5} depthTest={false} renderOrder={21} />}
      {middle && distance !== null && (
        <Tag position={middle} tone="sky">
          {distance.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mm
        </Tag>
      )}
    </group>
  );
}

// ---- skin markings and perforator zones ----------------------------------------------------------
function stripGeometry(left: [number, number, number][], right: [number, number, number][]) {
  const positions: number[] = [];
  const indices: number[] = [];
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i++) positions.push(...left[i], ...right[i]);
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

const centre = (points: [number, number, number][]): THREE.Vector3Tuple => {
  const c = points.reduce((sum, p) => [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]], [0, 0, 0]);
  return [c[0] / points.length, c[1] / points.length, c[2] / points.length];
};

const markingShort: Record<string, string> = {
  "borda-grande-dorsal": "Borda do GD",
  "prega-axilar-anterior": "Prega axilar ant.",
  clavicula: "Clavícula",
  "margem-medial-escapula": "Margem medial",
  "linha-esternal": "Linha esternal",
  "linha-hemiclavicular": "LHC",
  "sulco-inframamario": "Sulco inframamário",
  "pt-esterno.incisura-jugular": "Incisura jugular",
  "pt-esterno.angulo-esternal": "Âng. esternal · 2ª",
  "pt-esterno.xifoide": "Xifoide",
  "pt-escapula.coracoide": "Coracoide",
  "pt-escapula.acromio": "Acrômio",
  "pt-escapula.angulo-inferior": "Âng. inferior",
};

/** Small caption beside a marking (no box, so lines and points stay readable). */
function MarkLabel({ position, text, color }: { position: THREE.Vector3Tuple; text: string; color: string }) {
  return (
    <Html position={position} className="pointer-events-none" zIndexRange={[24, 0]}>
      <span className="ml-1.5 -translate-y-1/2 whitespace-nowrap rounded bg-slate-950/70 px-1 text-[10px] font-semibold leading-tight" style={{ color, display: "inline-block" }}>
        {text}
      </span>
    </Html>
  );
}

export function SkinMarkings({ markings, showLabels }: { markings: Marking[]; showLabels: boolean }) {
  return (
    <group>
      {markings.map((item) => {
        const text = markingShort[item.id] ?? item.label;
        if (item.kind === "line")
          return item.points.length > 1 ? (
            <group key={item.id}>
              <Line points={item.points} color={item.color} lineWidth={2.2} dashed dashSize={5 * mm} gapSize={3 * mm} renderOrder={6} raycast={() => undefined} />
              {showLabels && <MarkLabel position={item.points[Math.floor(item.points.length * 0.12)]} text={text} color={item.color} />}
            </group>
          ) : null;
        return (
          <group key={item.id}>
            <mesh position={item.points[0]} renderOrder={6} raycast={() => undefined}>
              <sphereGeometry args={[2.4 * mm, 14, 10]} />
              <meshBasicMaterial color={item.color} />
            </mesh>
            {showLabels && <MarkLabel position={item.points[0]} text={text} color={item.color} />}
          </group>
        );
      })}
    </group>
  );
}

export function PerforatorZones({ zones }: { zones: Zone[] }) {
  const built = useMemo(
    () =>
      zones.map((zone) => ({
        zone,
        main: stripGeometry(zone.strip.left, zone.strip.right),
        emphasis: zone.emphasis ? stripGeometry(zone.emphasis.left, zone.emphasis.right) : null,
      })),
    [zones],
  );
  useEffect(() => () => built.forEach((item) => [item.main, item.emphasis].forEach((g) => g?.dispose())), [built]);
  return (
    <group>
      {built.map(({ zone, main, emphasis }) => (
        <group key={zone.id}>
          <mesh geometry={main} renderOrder={7} raycast={() => undefined}>
            <meshBasicMaterial color={zone.color} transparent opacity={0.32} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          {emphasis && (
            <mesh geometry={emphasis} renderOrder={8} raycast={() => undefined}>
              <meshBasicMaterial color={zone.color} transparent opacity={0.6} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
          )}
          <MarkLabel position={centre([...zone.strip.left, ...zone.strip.right])} text={zone.label.split(" (")[1]?.replace(")", "") ?? zone.label} color={zone.color} />
        </group>
      ))}
    </group>
  );
}

// ---- landmark quiz --------------------------------------------------------------------------------
export function QuizFeedback({ target, guess, name }: { target: [number, number, number]; guess: [number, number, number] | null; name: string }) {
  if (!guess) return null;
  const error = new THREE.Vector3(...target).distanceTo(new THREE.Vector3(...guess)) / mm;
  return (
    <group>
      <mesh position={guess} renderOrder={22}>
        <sphereGeometry args={[2.2 * mm, 14, 10]} />
        <meshBasicMaterial color="#f472b6" depthTest={false} />
      </mesh>
      <mesh position={target} renderOrder={22}>
        <sphereGeometry args={[3 * mm, 14, 10]} />
        <meshBasicMaterial color="#4ade80" depthTest={false} />
      </mesh>
      <Line points={[guess, target]} color="#f472b6" lineWidth={2} dashed dashSize={3 * mm} gapSize={2 * mm} depthTest={false} renderOrder={22} />
      <Tag position={target} tone="amber">
        {name} · erro {error.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mm
      </Tag>
    </group>
  );
}
