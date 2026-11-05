"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { GraduationCap, Info, Layers, ListTree, Scissors, SlidersHorizontal, type LucideIcon } from "lucide-react";
import type { Pack } from "@/data/packs";
import { BottomSheet, type SheetSnap } from "./BottomSheet";
import { CoachMark } from "./CoachMark";
import { SelectionBar, type SelectionChip } from "./SelectionBar";
import { ToolRail, type RailItem } from "./ToolRail";
import { TopBar } from "./TopBar";

export type MobileTab = "pack" | "details" | "study" | "cut" | "dissection" | "structures";

const tabs: { id: MobileTab; label: string; icon: LucideIcon }[] = [
  { id: "pack", label: "Vista", icon: Layers },
  { id: "details", label: "Ficha", icon: Info },
  { id: "study", label: "Estudo", icon: GraduationCap },
  { id: "cut", label: "Corte", icon: Scissors },
  { id: "dissection", label: "Dissecar", icon: SlidersHorizontal },
  { id: "structures", label: "Estruturas", icon: ListTree },
];

type Props = {
  groupTitle: string;
  groupColor: string;
  pack: Pack;
  viewIndex: number;
  onViewIndex: (index: number) => void;
  tab: MobileTab;
  onTab: (tab: MobileTab) => void;
  snap: SheetSnap;
  onSnap: (snap: SheetSnap) => void;
  rail: RailItem[];
  /** current selection (structure, portion or landmark), shown as a chip */
  selection: SelectionChip | null;
  onOpenDetails: () => void;
  /** isolate the selected structure (absent for landmarks) */
  onIsolate?: () => void;
  onDeselect: () => void;
  onLibrary: () => void;
  onAbout: () => void;
  /** viewer rendered full-bleed behind the chrome; receives the screen insets it must keep clear */
  renderViewer: (insets: { top: number; bottom: number; right: number }) => React.ReactNode;
  content: React.ReactNode;
  overlays: React.ReactNode;
};

/**
 * Phone layout modelled on established anatomy apps: the 3D model fills the screen; a slim top bar,
 * a floating tool rail and a draggable bottom sheet (views + tabs) float over it. Information is
 * never dropped, only moved: details open on demand instead of covering the model.
 */
export function MobileShell(props: Props) {
  const { groupTitle, groupColor, pack, viewIndex, onViewIndex, tab, onTab, snap, onSnap, rail, selection, onOpenDetails, onIsolate, onDeselect, onLibrary, onAbout, renderViewer, content, overlays } = props;
  const selected = selection !== null;
  const topRef = useRef<HTMLElement>(null);
  const [topHeight, setTopHeight] = useState(64);
  const [cover, setCover] = useState(140);
  const [viewportHeight, setViewportHeight] = useState(700);
  useLayoutEffect(() => {
    const update = () => setViewportHeight(window.visualViewport?.height ?? window.innerHeight);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useLayoutEffect(() => {
    if (!topRef.current) return;
    const observer = new ResizeObserver(() => setTopHeight(topRef.current?.offsetHeight ?? 64));
    observer.observe(topRef.current);
    return () => observer.disconnect();
  }, []);

  const view = pack.views[viewIndex] ?? pack.views[0];
  // with the sheet open the Ficha tab carries the selection (amber dot), keeping the model clear
  const showSelection = selected && snap === "peek";

  const header = (
    <div className="px-3 short:flex short:items-center short:gap-2 short:pb-1">
      <div className="-mx-3 flex touch-pan-x gap-2 overflow-x-auto px-3 pb-2 [scrollbar-width:none] short:mx-0 short:min-w-0 short:flex-1 short:px-0 short:pb-0" role="tablist" aria-label="Vistas do pack">
        {pack.views.map((item, index) => {
          const active = index === viewIndex;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onViewIndex(index)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition ${active ? "border-transparent bg-white text-slate-950" : "border-white/10 bg-white/5 text-slate-300"}`}
            >
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-black ${active ? "bg-slate-950 text-white" : "bg-white/10 text-slate-200"}`}>{index + 1}</span>
              {item.title}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-6 gap-0.5 border-t border-white/5 pt-1.5 short:w-[330px] short:shrink-0 short:border-t-0 short:pt-0" role="tablist" aria-label="Painéis">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = tab === id && snap !== "peek";
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                if (tab === id && snap !== "peek") onSnap("peek");
                else {
                  onTab(id);
                  if (snap === "peek") onSnap("half");
                }
              }}
              className={`relative flex flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[9.5px] font-semibold transition ${active ? "bg-white/10 text-white" : "text-slate-400"}`}
            >
              <Icon size={19} strokeWidth={active ? 2.4 : 2} />
              <span className="short:sr-only">{label}</span>
              {id === "details" && selected && <span className="absolute right-[22%] top-1 h-2 w-2 rounded-full bg-amber-300" />}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-950">
      {renderViewer({ top: topHeight, bottom: cover, right: snap === "full" ? 0 : 72 })}
      <TopBar ref={topRef} group={groupTitle} groupColor={groupColor} pack={pack.title} view={`Vista ${viewIndex + 1}/${pack.views.length} · ${view.title}`} onLibrary={onLibrary} onAbout={onAbout} />
      {snap !== "full" && <ToolRail items={rail} top={topHeight + 10} maxHeight={Math.max(120, viewportHeight - topHeight - cover - 24)} />}
      {!selected && snap === "peek" && viewportHeight > 500 && <CoachMark bottom={cover + 10} />}
      {showSelection && selection && <SelectionBar chip={selection} bottom={cover + 10} onDetails={onOpenDetails} onIsolate={onIsolate} onClose={onDeselect} />}
      <BottomSheet snap={snap} onSnap={onSnap} header={header} topOffset={topHeight} onCoverChange={setCover}>
        {content}
      </BottomSheet>
      {overlays}
    </div>
  );
}
