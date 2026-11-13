"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useSettings } from "@/lib/store";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Brand, Btn, Chip, Circ, cx, Lbl } from "@/components/ui/kit";
import type { AppNav } from "./nav";
import { presentSizes } from "./shared";
import type { ViewerController } from "./useViewerController";

type Pointer = "laser" | "pen" | null;
type Stroke = { id: number; points: [number, number][] };

/** Fullscreen and landscape while presenting (where the browser allows it); undone on exit. */
function useFullscreen(landscape: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    let entered = false;
    if (!document.fullscreenElement && root.requestFullscreen) {
      root
        .requestFullscreen()
        .then(() => {
          entered = true;
          const orientation = screen.orientation as ScreenOrientation & { lock?: (value: string) => Promise<void> };
          if (landscape) orientation.lock?.("landscape").catch(() => undefined);
        })
        .catch(() => undefined);
    }
    return () => {
      const orientation = screen.orientation as ScreenOrientation & { unlock?: () => void };
      try {
        orientation.unlock?.();
      } catch {
        // not locked
      }
      if (entered && document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
  }, [landscape]);
}

/** Laser dot and pen strokes drawn over the model; while one of them is on, the model does not turn. */
function PointerLayer({ mode, strokes, onStrokes }: { mode: Pointer; strokes: Stroke[]; onStrokes: (next: Stroke[]) => void }) {
  const [dot, setDot] = useState<[number, number] | null>(null);
  const drawing = useRef<Stroke | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const at = (event: ReactPointerEvent): [number, number] => {
    const rect = box.current!.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  return (
    <div
      ref={box}
      className={cx("absolute inset-0 z-[25]", mode ? "pointer-events-auto touch-none" : "pointer-events-none", mode === "laser" && "cursor-none", mode === "pen" && "cursor-crosshair")}
      onPointerMove={(event) => {
        if (mode === "laser") setDot(at(event));
        if (mode === "pen" && drawing.current) {
          drawing.current = { ...drawing.current, points: [...drawing.current.points, at(event)] };
          onStrokes([...strokes.filter((stroke) => stroke.id !== drawing.current!.id), drawing.current]);
        }
      }}
      onPointerDown={(event) => {
        if (mode === "laser") setDot(at(event));
        if (mode === "pen") {
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = { id: Date.now(), points: [at(event)] };
          onStrokes([...strokes, drawing.current]);
        }
      }}
      onPointerUp={() => {
        drawing.current = null;
      }}
      onPointerLeave={() => setDot(null)}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        {strokes.map((stroke) => (
          <polyline key={stroke.id} points={stroke.points.map((point) => point.join(",")).join(" ")} fill="none" stroke="#8E5C68" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
      {mode === "laser" && dot && <div className="pointer-events-none absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgba(196,90,108,.28)] shadow-[0_0_0_10px_rgba(196,90,108,.12)]" style={{ left: dot[0], top: dot[1] }} />}
    </div>
  );
}

function usePresentation(ctl: ViewerController) {
  const [pointer, setPointer] = useState<Pointer>("laser");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  useEffect(() => setStrokes([]), [ctl.viewKey]);
  const toggle = (next: Pointer) => setPointer((current) => (current === next ? null : next));
  return { pointer, strokes, setStrokes, toggle };
}

const nextTitle = (ctl: ViewerController) => (ctl.free ? null : ctl.pack.views[ctl.viewIndex + 1]?.title ?? null);

/** Lecture mode on phones: model on the left (landscape), the presenter panel on the right. */
export function MobilePresent({ ctl, nav }: { ctl: ViewerController; nav: AppNav }) {
  const settings = useSettings();
  const state = usePresentation(ctl);
  useFullscreen(true);
  const next = nextTitle(ctl);
  const tools: { id: "laser" | "pen" | "labels"; icon: IconName; label: string; on: boolean; run: () => void }[] = [
    { id: "laser", icon: "laser", label: "Laser", on: state.pointer === "laser", run: () => state.toggle("laser") },
    { id: "pen", icon: "pen", label: "Caneta", on: state.pointer === "pen", run: () => state.toggle("pen") },
    { id: "labels", icon: "label", label: "Rótulos", on: !ctl.labelsHidden, run: ctl.toggleLabels },
  ];
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper landscape:flex-row" role="dialog" aria-label="Modo aula">
      <div className="relative min-h-0 min-w-0 flex-1">
        {ctl.renderViewer("mobile", { top: 56, bottom: 0, right: 0 }, { notes: settings.presentNotes })}
        <div className="absolute left-[18px] top-[max(16px,env(safe-area-inset-top))] z-30 flex items-center gap-2.5">
          <Chip tone="rose">Modo aula</Chip>
          <span className="text-sm font-medium text-ink-2">{ctl.free ? "Modelo completo" : `${ctl.pack.title} · ${ctl.viewIndex + 1}/${ctl.pack.views.length}`}</span>
        </div>
        <PointerLayer mode={state.pointer} strokes={state.strokes} onStrokes={state.setStrokes} />
        {state.strokes.length > 0 && (
          <button type="button" onClick={() => state.setStrokes([])} className="glass absolute bottom-4 left-4 z-30 flex items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-[13px] font-semibold text-ink shadow-glass">
            <Icon name="undo" size={16} /> Limpar traços
          </button>
        )}
      </div>
      <aside className="flex max-h-[46%] shrink-0 flex-col gap-3 overflow-y-auto border-t border-line bg-surface px-[22px] pb-[max(16px,env(safe-area-inset-bottom))] pt-5 landscape:max-h-none landscape:w-[300px] landscape:border-l landscape:border-t-0 landscape:pr-[max(22px,env(safe-area-inset-right))]">
        <div className="flex items-center">
          <Lbl className="flex-1">{ctl.free ? "Modo livre" : `Vista ${ctl.viewIndex + 1} de ${ctl.pack.views.length}`}</Lbl>
          <Circ icon="x" size={36} iconSize={18} onClick={() => nav.present(false)} label="Sair do modo aula" className="border-transparent" />
        </div>
        <div className="text-[28px] font-semibold leading-tight tracking-[-0.8px]">{ctl.view.title}</div>
        <p className={cx("text-pretty leading-normal text-ink-2", settings.textSize === "l" ? "text-[16px]" : settings.textSize === "s" ? "text-[13.5px]" : "text-[14.5px]")}>{ctl.view.description}</p>
        <div className="min-h-2 flex-1" />
        <div className="flex gap-2">
          {tools.map((tool) => (
            <button key={tool.id} type="button" aria-pressed={tool.on} onClick={tool.run} className={cx("flex flex-1 flex-col items-center gap-1 rounded-[14px] py-2 text-xs font-semibold", tool.on ? "bg-rose-tint text-rose-deep" : "bg-surface-alt text-ink-2")}>
              <Icon name={tool.icon} size={19} />
              {tool.label}
            </button>
          ))}
        </div>
        {!ctl.free && (
          <div className="flex gap-2.5">
            <Circ icon="chevL" size={48} tone="warm" onClick={ctl.prevView} disabled={ctl.viewIndex === 0} label="Vista anterior" />
            {next ? (
              <Btn icon="arrowR" className="h-12 min-w-0 flex-1 text-[15px]" onClick={ctl.nextView}>
                <span className="truncate">{next}</span>
              </Btn>
            ) : (
              <Btn className="h-12 flex-1 text-[15px]" onClick={() => nav.present(false)}>
                Encerrar aula
              </Btn>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

/** Lecture mode on desktop: the model fills the screen; title and text bottom left, presenter controls bottom right. */
export function WebPresent({ ctl, nav }: { ctl: ViewerController; nav: AppNav }) {
  const settings = useSettings();
  const state = usePresentation(ctl);
  useFullscreen(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") nav.present(false);
      else if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") ctl.nextView();
      else if (event.key === "ArrowLeft" || event.key === "PageUp") ctl.prevView();
      else if (event.key.toLowerCase() === "l") ctl.toggleLabels();
      else if (event.key.toLowerCase() === "p") state.toggle("pen");
      else if (event.key.toLowerCase() === "s") state.toggle("laser");
      else return;
      event.preventDefault();
    };
    const onFullscreen = () => {
      if (!document.fullscreenElement) nav.present(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [ctl, nav, state]);
  const controls: { icon: IconName; label: string; on?: boolean; run: () => void; disabled?: boolean }[] = [
    ...(ctl.free ? [] : [{ icon: "chevL" as const, label: "Vista anterior (←)", run: ctl.prevView, disabled: ctl.viewIndex === 0 }]),
    { icon: "laser", label: "Laser (S)", on: state.pointer === "laser", run: () => state.toggle("laser") },
    { icon: "pen", label: "Caneta (P)", on: state.pointer === "pen", run: () => state.toggle("pen") },
    { icon: "label", label: "Rótulos (L)", on: !ctl.labelsHidden, run: ctl.toggleLabels },
    ...(ctl.free ? [] : [{ icon: "chevR" as const, label: "Próxima vista (→)", run: ctl.nextView, disabled: ctl.viewIndex >= ctl.pack.views.length - 1 }]),
  ];
  return (
    <div className="fixed inset-0 z-50 bg-paper" role="dialog" aria-label="Modo aula">
      <div className="absolute inset-0">{ctl.renderViewer("desktop", { top: 80, bottom: 120, right: 0 }, { notes: settings.presentNotes })}</div>
      <PointerLayer mode={state.pointer} strokes={state.strokes} onStrokes={state.setStrokes} />
      <div className="pointer-events-none absolute left-7 top-6 z-30 flex items-center gap-3">
        <Brand size={17} />
        <span className="text-[15px] text-ink-2">{ctl.free ? "Modelo completo" : ctl.pack.title}</span>
      </div>
      <div className="pointer-events-none absolute bottom-7 left-7 z-30 max-w-[520px]">
        <div className="text-[44px] font-semibold leading-[1.05] tracking-[-1.4px]">{ctl.view.title}</div>
        <p className={cx("mt-2 leading-normal text-ink-2", presentSizes[settings.textSize])} style={{ display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {ctl.view.description}
        </p>
      </div>
      <div className="absolute bottom-7 right-7 z-30 flex items-center gap-1.5 rounded-[18px] bg-ink p-1.5 text-on-ink shadow-pop">
        {controls.map((control) => (
          <button key={control.label} type="button" title={control.label} aria-label={control.label} aria-pressed={control.on} disabled={control.disabled} onClick={control.run} className={cx("grid h-11 w-11 place-items-center rounded-[13px] transition-colors disabled:opacity-30", control.on ? "bg-white/[0.16]" : "hover:bg-white/[0.08]")}>
            <Icon name={control.icon} size={20} />
          </button>
        ))}
        {!ctl.free && (
          <div className="tabular px-3 text-sm">
            {ctl.viewIndex + 1} / {ctl.pack.views.length}
          </div>
        )}
        {state.strokes.length > 0 && (
          <button type="button" onClick={() => state.setStrokes([])} className="flex h-11 items-center border-l border-white/[0.18] px-3.5 text-sm font-semibold">
            Limpar
          </button>
        )}
        <button type="button" onClick={() => nav.present(false)} className="flex h-11 items-center border-l border-white/[0.18] px-3.5 text-sm font-semibold">
          Sair · Esc
        </button>
      </div>
    </div>
  );
}
