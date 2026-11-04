"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type SheetSnap = "peek" | "half" | "full";

type Props = {
  snap: SheetSnap;
  onSnap: (snap: SheetSnap) => void;
  /** always-visible part: handle, view switcher and tab bar */
  header: React.ReactNode;
  children: React.ReactNode;
  /** height of the top bar, so "full" stops below it */
  topOffset: number;
  /** reports how much of the screen the sheet covers once it settles (px) */
  onCoverChange: (px: number) => void;
};

function useViewportHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const update = () => setHeight(window.visualViewport?.height ?? window.innerHeight);
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
  return height;
}

/**
 * Draggable bottom sheet with three resting heights (peek, half, full), in the style of map and
 * anatomy apps. Drag the handle/header vertically, or tap the handle to cycle.
 */
export function BottomSheet({ snap, onSnap, header, children, topOffset, onCoverChange }: Props) {
  const viewport = useViewportHeight();
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(120);
  const [drag, setDrag] = useState<number | null>(null);
  const gesture = useRef<{ startY: number; startX: number; lastY: number; lastT: number; velocity: number; axis: "y" | "x" | null } | null>(null);

  useLayoutEffect(() => {
    if (!headerRef.current) return;
    const observer = new ResizeObserver(() => setHeaderHeight(headerRef.current?.offsetHeight ?? 120));
    observer.observe(headerRef.current);
    return () => observer.disconnect();
  }, []);

  const fullHeight = Math.max(headerHeight, viewport - topOffset - 6);
  const heights: Record<SheetSnap, number> = {
    peek: headerHeight,
    half: Math.min(fullHeight, Math.max(headerHeight + 160, Math.round(viewport * 0.52))),
    full: fullHeight,
  };
  const visible = heights[snap];

  useEffect(() => {
    if (viewport) onCoverChange(snap === "full" ? heights.half : visible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, visible, viewport]);

  const settle = useCallback(
    (shown: number, velocity: number) => {
      const projected = shown - velocity * 180;
      const order: SheetSnap[] = ["peek", "half", "full"];
      const nearest = order.reduce((best, item) => (Math.abs(heights[item] - projected) < Math.abs(heights[best] - projected) ? item : best), "peek" as SheetSnap);
      onSnap(nearest);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [heights.peek, heights.half, heights.full, onSnap],
  );

  const suppressClick = useRef(false);
  const dragRef = useRef<number | null>(null);
  const live = useRef({ visible, fullHeight, headerHeight, settle });
  live.current = { visible, fullHeight, headerHeight, settle };

  // The gesture is tracked on the window so it keeps working once the pointer leaves the header
  // (mouse) — touch pointers are implicitly captured, mouse pointers are not.
  function onPointerDown(event: React.PointerEvent) {
    if (event.button !== 0) return;
    gesture.current = { startY: event.clientY, startX: event.clientX, lastY: event.clientY, lastT: performance.now(), velocity: 0, axis: null };
    const move = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const dy = e.clientY - g.startY;
      const dx = e.clientX - g.startX;
      if (!g.axis) {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        g.axis = Math.abs(dy) > Math.abs(dx) ? "y" : "x";
      }
      if (g.axis !== "y") return;
      e.preventDefault();
      const now = performance.now();
      g.velocity = (e.clientY - g.lastY) / Math.max(1, now - g.lastT);
      g.lastY = e.clientY;
      g.lastT = now;
      dragRef.current = dy;
      setDrag(dy);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const g = gesture.current;
      gesture.current = null;
      const delta = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!g || g.axis !== "y" || delta === null) return;
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 0);
      const { visible: v, fullHeight: f, headerHeight: h, settle: settleTo } = live.current;
      settleTo(Math.min(f, Math.max(h * 0.6, v - delta)), g.velocity);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  const shown = drag === null ? visible : Math.min(fullHeight, Math.max(headerHeight * 0.6, visible - drag));
  const translate = fullHeight - shown;

  return (
    <section
      aria-label="Painel de informações"
      className="fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-[28px] border-t border-white/10 bg-slate-950/[0.88] shadow-[0_-12px_40px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
      style={{ height: fullHeight, transform: `translateY(${translate}px)`, transition: drag === null ? "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)" : "none" }}
    >
      <div
        ref={headerRef}
        className="shrink-0 touch-none select-none"
        onPointerDown={onPointerDown}
        onClickCapture={(event) => {
          // a drag that ends over a tab must not also press it
          if (suppressClick.current) {
            event.stopPropagation();
            event.preventDefault();
          }
        }}
      >
        <button
          type="button"
          aria-label={snap === "peek" ? "Expandir painel" : "Recolher painel"}
          onClick={() => onSnap(snap === "peek" ? "half" : snap === "half" ? "full" : "peek")}
          className="flex h-6 w-full items-center justify-center"
        >
          <span className="h-1.5 w-11 rounded-full bg-white/25" />
        </button>
        {header}
        <div className="pb-[env(safe-area-inset-bottom)]" style={{ display: snap === "peek" ? "block" : "none" }} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-1" style={{ visibility: snap === "peek" && drag === null ? "hidden" : "visible" }}>
        {children}
      </div>
    </section>
  );
}
