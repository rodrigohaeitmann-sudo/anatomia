"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { AnnotationEntry } from "@/lib/annotations";
import type { Landmark } from "@/lib/modelConfig";

export type ProjectedPin = { key: string; x: number; y: number; visible: boolean };

/** Projects annotation anchors to canvas pixels on every rendered frame (inside the Canvas). */
export function PinProjector({ anchors, rotation, onProject }: { anchors: Map<string, Landmark>; rotation: THREE.Euler; onProject: (pins: ProjectedPin[]) => void }) {
  const { invalidate } = useThree();
  const last = useRef("");
  const vector = useRef(new THREE.Vector3()).current;
  useEffect(() => invalidate(), [anchors, invalidate]);
  useFrame(({ camera, size }) => {
    const pins: ProjectedPin[] = [];
    anchors.forEach((point, key) => {
      vector.set(point[0], point[1], point[2]).applyEuler(rotation).project(camera);
      pins.push({ key, x: ((vector.x + 1) / 2) * size.width, y: ((1 - vector.y) / 2) * size.height, visible: vector.z < 1 && vector.z > -1 });
    });
    const signature = pins.map((pin) => `${pin.key}:${Math.round(pin.x)}:${Math.round(pin.y)}:${pin.visible}`).join("|");
    if (signature !== last.current) {
      last.current = signature;
      onProject(pins);
    }
  });
  return null;
}

const PIN = 28;
const GAP = 4;
const candidates: [number, number][] = [[0, 0]];
for (const radius of [34, 58, 84]) {
  for (let i = 0; i < 8; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 4;
    candidates.push([Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius)]);
  }
}

type Placed = { key: string; ax: number; ay: number; x: number; y: number; offscreen: boolean };

/**
 * Greedy screen-space declutter: each pin takes the nearest free slot around its anchor. Anchors
 * outside the visible area are not dropped: their pin is held at the edge, pointing to the anchor.
 */
function declutter(pins: ProjectedPin[], width: number, height: number, safe: { top: number; bottom: number; right: number }, order: string[]): Placed[] {
  const placed: Placed[] = [];
  const minX = PIN / 2 + 6, maxX = width - PIN / 2 - safe.right - 6;
  const minY = safe.top + PIN / 2 + 4, maxY = height - safe.bottom - PIN / 2 - 4;
  const sorted = [...pins].filter((pin) => pin.visible).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  for (const pin of sorted) {
    const cx = Math.min(maxX, Math.max(minX, pin.x));
    const cy = Math.min(maxY, Math.max(minY, pin.y));
    const offscreen = cx !== pin.x || cy !== pin.y;
    let best: Placed | null = null;
    for (const [dx, dy] of candidates) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      if (placed.some((other) => Math.hypot(other.x - x, other.y - y) < PIN + GAP)) continue;
      best = { key: pin.key, ax: pin.x, ay: pin.y, x, y, offscreen };
      break;
    }
    if (best) placed.push(best);
  }
  return placed;
}

type OverlayProps = {
  pins: ProjectedPin[];
  entries: Map<string, AnnotationEntry>;
  activePin: string | null;
  onPin: (key: string | null) => void;
  onOpenDetails: (structure: string) => void;
  width: number;
  height: number;
  insets: { top: number; bottom: number; right?: number };
};

/** Numbered pins with leader lines and a tap-to-read bubble, kept inside the visible area. */
export function PinOverlay({ pins, entries, activePin, onPin, onOpenDetails, width, height, insets }: OverlayProps) {
  if (!width || !height) return null;
  const order = [...entries.keys()];
  const right = insets.right ?? 0;
  const placed = declutter(pins, width, height, { top: insets.top, bottom: insets.bottom, right }, order);
  const active = placed.find((pin) => pin.key === activePin);
  const activeEntry = activePin ? entries.get(activePin) : undefined;
  const bubbleWidth = Math.min(260, width - right - 24);
  const bubbleLeft = active ? Math.max(12, Math.min(width - right - bubbleWidth - 12, active.x - bubbleWidth / 2)) : 0;
  const above = active ? active.y - PIN / 2 - 10 > insets.top + 80 : true;

  return (
    <div className="pointer-events-none absolute inset-0 z-[15]">
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        {placed.map((pin) => {
          const entry = entries.get(pin.key);
          if (!entry || (pin.x === pin.ax && pin.y === pin.ay)) return null;
          return (
            <g key={pin.key}>
              <line x1={pin.ax} y1={pin.ay} x2={pin.x} y2={pin.y} stroke={entry.color} strokeOpacity={pin.offscreen ? 0.6 : 0.85} strokeWidth={1.5} strokeDasharray={pin.offscreen ? "4 4" : undefined} />
              {!pin.offscreen && <circle cx={pin.ax} cy={pin.ay} r={3} fill={entry.color} />}
            </g>
          );
        })}
      </svg>
      {placed.map((pin) => {
        const entry = entries.get(pin.key);
        if (!entry) return null;
        const isActive = pin.key === activePin;
        return (
          <button
            key={pin.key}
            type="button"
            aria-label={`${entry.number}. ${entry.text}`}
            onClick={() => onPin(isActive ? null : pin.key)}
            title={pin.offscreen ? "Estrutura fora da área visível" : undefined}
            className={`pointer-events-auto absolute grid place-items-center rounded-full border-2 bg-slate-950/85 text-[11px] font-black text-white shadow-[0_2px_10px_rgba(0,0,0,0.6)] backdrop-blur transition-transform ${isActive ? "z-10 scale-[1.18]" : ""} ${pin.offscreen ? "border-dashed opacity-80" : ""}`}
            style={{ width: PIN, height: PIN, left: pin.x - PIN / 2, top: pin.y - PIN / 2, borderColor: entry.color }}
          >
            {entry.number}
          </button>
        );
      })}
      {active && activeEntry && (
        <div
          className="pointer-events-auto absolute z-20 rounded-2xl border border-white/10 bg-slate-950/[0.92] px-3 py-2.5 text-left text-[13px] font-semibold leading-snug text-white shadow-2xl backdrop-blur-xl"
          style={{ width: "max-content", maxWidth: bubbleWidth, left: bubbleLeft, ...(above ? { bottom: height - (active.y - PIN / 2 - 8) } : { top: active.y + PIN / 2 + 8 }) }}
        >
          <span className="flex items-start gap-2">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: activeEntry.color }} />
            <span>
              {activeEntry.group && <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-400">{activeEntry.group}</span>}
              {activeEntry.text}
            </span>
          </span>
          {activeEntry.structure && (
            <button type="button" onClick={() => onOpenDetails(activeEntry.structure!)} className="mt-1.5 text-[12px] font-bold text-sky-300">
              Ver ficha ›
            </button>
          )}
        </div>
      )}
    </div>
  );
}
