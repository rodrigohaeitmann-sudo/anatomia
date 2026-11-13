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

const ink = "#221C20";
const roseDeep = "#8E5C68";
const GAP = 4;
const MAX_TEXT = 210;

/**
 * Width of a pin with a pill (dot, gap, badge, text), estimated from the text for the declutter (Geist semibold:
 * ≈ 7.3 px per character at 13 px, 6.8 at 12 px). The pill itself takes its natural width.
 */
function pillWidth(text: string, compact: boolean) {
  const perChar = compact ? 6.8 : 7.3;
  const chrome = compact ? 12 + 8 + 2 + 3 + 18 + 6 + 9 : 12 + 8 + 2 + 4 + 20 + 6 + 11;
  return Math.round(Math.min(MAX_TEXT, text.length * perChar) + chrome);
}

type Box = { key: string; ax: number; ay: number; x: number; y: number; w: number; h: number; flip: boolean; offscreen: boolean; dot: boolean };

const offsets: [number, number][] = [[0, 0]];
for (const dy of [30, 60, 90, 120]) offsets.push([0, -dy], [0, dy]);
for (const dx of [40, 80]) for (const dy of [0, -30, 30, -60, 60]) offsets.push([dx, dy], [-dx, dy]);
const DISC = 28;
/** notes keep their pill short: the full text opens on tap */
const NOTE_TEXT = 22;

/**
 * Greedy screen-space declutter: each pin (a dot on its anchor and a pill beside it, or a numbered disc) takes the
 * nearest free slot; a pill that would leave the visible area turns to the other side of its dot, and one that finds
 * no room becomes a disc. No pin is dropped: anchors outside the visible area are held at the edge with a dashed
 * leader, and a pin with no free slot at all is drawn on its anchor.
 */
function declutter(pins: ProjectedPin[], entries: Map<string, AnnotationEntry>, width: number, height: number, safe: { top: number; bottom: number; right: number }, names: boolean, compact: boolean, order: string[]): Box[] {
  const placed: Box[] = [];
  const minX = 8;
  const maxX = width - safe.right - 8;
  const minY = safe.top + 6;
  const maxY = height - safe.bottom - 6;
  const sorted = [...pins].filter((pin) => pin.visible && entries.has(pin.key)).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  const hit = (a: { x: number; y: number; w: number; h: number }) => placed.some((b) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP);
  for (const pin of sorted) {
    const entry = entries.get(pin.key)!;
    const note = entry.kind === "note";
    const wantsPill = names || note;
    const pillW = pillWidth(note ? entry.text.slice(0, NOTE_TEXT) : entry.text, compact);
    const pillH = compact ? 26 : 28;
    const cx = Math.min(maxX - DISC / 2, Math.max(minX + DISC / 2, pin.x));
    const cy = Math.min(maxY - DISC / 2, Math.max(minY + DISC / 2, pin.y));
    const offscreen = Math.abs(cx - pin.x) > 1 || Math.abs(cy - pin.y) > 1;
    let best: Box | null = null;
    for (const pill of wantsPill ? [true, false] : [false]) {
      const w = pill ? pillW : DISC;
      const h = pill ? pillH : DISC;
      for (const [dx, dy] of offsets) {
        const x0 = cx + dx;
        const y0 = cy + dy;
        for (const flip of pill ? [false, true] : [false]) {
          // pill: the dot sits on the slot (x0) and the pill extends to the right (or to the left when flipped)
          const x = pill ? (flip ? x0 - w + 6 : x0 - 6) : x0 - w / 2;
          const box = { x, y: y0 - h / 2, w, h };
          if (box.x < minX || box.x + w > maxX || box.y < minY || box.y + h > maxY) continue;
          if (hit(box)) continue;
          best = { key: pin.key, ax: pin.x, ay: pin.y, ...box, flip, offscreen, dot: pill };
          break;
        }
        if (best) break;
      }
      if (best) break;
    }
    placed.push(best ?? { key: pin.key, ax: pin.x, ay: pin.y, x: cx - DISC / 2, y: cy - DISC / 2, w: DISC, h: DISC, flip: false, offscreen, dot: false });
  }
  return placed;
}

type OverlayProps = {
  pins: ProjectedPin[];
  entries: Map<string, AnnotationEntry>;
  activePin: string | null;
  onPin: (key: string | null) => void;
  onOpenDetails: (structure: string) => void;
  onOpenNote?: (key: string) => void;
  /** names beside the pins (pills); off: numbered discs, tap to read */
  showNames: boolean;
  compact?: boolean;
  width: number;
  height: number;
  insets: { top: number; bottom: number; right?: number };
};

function PenGlyph({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20l1-4L16 5l3 3L8 19z" />
      <path d="M14 7l3 3" />
    </svg>
  );
}

/** Pins of the view (MamaFlow style): a dot on the anchor and a pill with the number and the name; the user's notes in rose. */
export function PinOverlay({ pins, entries, activePin, onPin, onOpenDetails, onOpenNote, showNames, compact = false, width, height, insets }: OverlayProps) {
  if (!width || !height) return null;
  const order = [...entries.keys()];
  const right = insets.right ?? 0;
  const placed = declutter(pins, entries, width, height, { top: insets.top, bottom: insets.bottom, right }, showNames, compact, order);
  const active = placed.find((pin) => pin.key === activePin);
  const activeEntry = activePin ? entries.get(activePin) : undefined;
  const bubbleWidth = Math.min(280, width - right - 24);
  const bubbleLeft = active ? Math.max(12, Math.min(width - right - bubbleWidth - 12, active.x + active.w / 2 - bubbleWidth / 2)) : 0;
  const above = active ? active.y - 10 > insets.top + 90 : true;
  // a pill already shows the name: the bubble only adds the way to the card (or the note text)
  const bubble = active && activeEntry && (!showNames || activeEntry.kind === "note" || activeEntry.structure || activeEntry.group);

  return (
    <div className="pointer-events-none absolute inset-0 z-[15]">
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        {placed.map((pin) => {
          const entry = entries.get(pin.key);
          if (!entry) return null;
          const dotX = pin.dot ? (pin.flip ? pin.x + pin.w - 6 : pin.x + 6) : pin.x + pin.w / 2;
          const dotY = pin.y + pin.h / 2;
          if (Math.hypot(dotX - pin.ax, dotY - pin.ay) < 2) return null;
          const color = entry.kind === "note" ? roseDeep : entry.kind === "label" ? ink : entry.color;
          return (
            <g key={pin.key}>
              <line x1={pin.ax} y1={pin.ay} x2={dotX} y2={dotY} stroke={color} strokeOpacity={pin.offscreen ? 0.5 : 0.75} strokeWidth={1.4} strokeDasharray={pin.offscreen ? "4 4" : undefined} />
              {!pin.offscreen && <circle cx={pin.ax} cy={pin.ay} r={3} fill={color} />}
            </g>
          );
        })}
      </svg>
      {placed.map((pin) => {
        const entry = entries.get(pin.key);
        if (!entry) return null;
        const isActive = pin.key === activePin;
        const note = entry.kind === "note";
        const tone = note ? roseDeep : entry.kind === "label" ? ink : entry.color;
        const strong = isActive || note;
        const press = () => onPin(isActive ? null : pin.key);
        if (!pin.dot) {
          const filled = isActive || note;
          return (
            <button
              key={pin.key}
              type="button"
              aria-label={note ? `Sua anotação: ${entry.text}` : `${entry.number}. ${entry.text}`}
              onClick={press}
              title={pin.offscreen ? "Fora da área visível" : entry.text}
              className={`pointer-events-auto absolute grid place-items-center rounded-full border-[2.5px] text-[11px] font-bold shadow-pin transition-transform ${isActive ? "z-10 scale-110" : ""} ${pin.offscreen ? "border-dashed opacity-80" : ""}`}
              style={{ width: pin.w, height: pin.h, left: pin.x, top: pin.y, borderColor: filled ? roseDeep : tone, background: filled ? roseDeep : "#FFFFFF", color: filled ? "#FCF9F6" : "#221C20" }}
            >
              {note ? <PenGlyph size={13} color="#FCF9F6" /> : entry.number}
            </button>
          );
        }
        const badge = compact ? 18 : 20;
        return (
          <button
            key={pin.key}
            type="button"
            aria-label={note ? `Sua anotação: ${entry.text}` : `${entry.number}. ${entry.text}`}
            onClick={press}
            title={pin.offscreen ? "Estrutura fora da área visível" : entry.text}
            className={`pointer-events-auto absolute flex w-max items-center gap-2 ${pin.flip ? "flex-row-reverse" : ""} ${isActive ? "z-10" : ""}`}
            // the dot sits on the slot's anchor side; the pill grows away from it
            style={pin.flip ? { right: width - (pin.x + pin.w), top: pin.y, height: pin.h } : { left: pin.x, top: pin.y, height: pin.h }}
          >
            <span className="h-3 w-3 shrink-0 rounded-full bg-white" style={{ border: `2.5px solid ${strong ? roseDeep : tone}`, boxShadow: strong ? "0 0 0 6px #F4E1E5" : "none" }} />
            <span
              className={`flex min-w-0 items-center gap-1.5 rounded-full border font-semibold shadow-pin ${pin.flip ? "flex-row-reverse" : ""} ${compact ? "py-[3px] text-[12px]" : "py-1 text-[13px]"} ${pin.flip ? (compact ? "pl-[9px] pr-[3px]" : "pl-[11px] pr-1") : compact ? "pl-[3px] pr-[9px]" : "pl-1 pr-[11px]"}`}
              style={{ background: strong ? roseDeep : "#FFFFFF", color: strong ? "#FCF9F6" : "#221C20", borderColor: strong ? "transparent" : "#E3D8CB" }}
            >
              <span className="grid shrink-0 place-items-center rounded-full text-[11px] font-bold" style={{ width: badge, height: badge, background: strong ? "#FFFFFF" : tone, color: strong ? roseDeep : "#FCF9F6" }}>
                {note ? <PenGlyph size={11} color={roseDeep} /> : entry.number}
              </span>
              <span className="truncate" style={{ maxWidth: note ? NOTE_TEXT * (compact ? 6.8 : 7.3) : MAX_TEXT }}>
                {entry.text}
              </span>
            </span>
          </button>
        );
      })}
      {bubble && active && activeEntry && (
        <div
          className="pointer-events-auto absolute z-20 rounded-2xl border border-line bg-surface px-3.5 py-3 text-left text-[13.5px] font-medium leading-snug text-ink shadow-menu"
          style={{ width: "max-content", maxWidth: bubbleWidth, left: bubbleLeft, ...(above ? { bottom: height - (active.y - 8) } : { top: active.y + active.h + 8 }) }}
        >
          {activeEntry.kind === "note" ? (
            <>
              <span className="block text-[10.5px] font-semibold uppercase tracking-[1px] text-rose-deep">Sua anotação</span>
              <span className="mt-1 block whitespace-pre-wrap">{activeEntry.text}</span>
              {onOpenNote && activeEntry.key !== "note:draft" && (
                <button type="button" onClick={() => onOpenNote(activeEntry.key)} className="mt-2 text-[13px] font-semibold text-ink underline decoration-line underline-offset-4">
                  Editar ou apagar
                </button>
              )}
            </>
          ) : (
            <>
              <span className="flex items-start gap-2">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: activeEntry.kind === "label" ? ink : activeEntry.color }} />
                <span>
                  {activeEntry.group && <span className="block text-[10.5px] font-semibold uppercase tracking-[1px] text-muted">{activeEntry.group}</span>}
                  {activeEntry.text}
                </span>
              </span>
              {activeEntry.structure && (
                <button type="button" onClick={() => onOpenDetails(activeEntry.structure!)} className="mt-2 text-[13px] font-semibold text-rose-deep">
                  Ver ficha ›
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
