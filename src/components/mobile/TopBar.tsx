"use client";

import { forwardRef } from "react";
import { Info, LayoutGrid } from "lucide-react";

type Props = { group: string; groupColor: string; pack: string; view: string; onLibrary: () => void; onAbout: () => void };

/** Compact translucent app bar: library, current pack/view, about. */
export const TopBar = forwardRef<HTMLElement, Props>(function TopBar({ group, groupColor, pack, view, onLibrary, onAbout }, ref) {
  const iconButton = "grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/5 text-slate-100 active:scale-95 active:bg-white/15";
  return (
    <header ref={ref} className="fixed inset-x-0 top-0 z-30 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] short:pl-[max(0.75rem,env(safe-area-inset-left))] short:pr-[max(0.75rem,env(safe-area-inset-right))] short:pt-1.5">
      <div className="flex items-center gap-2 rounded-[22px] border border-white/10 bg-slate-950/70 p-1.5 shadow-lg backdrop-blur-xl">
        <button type="button" onClick={onLibrary} className={iconButton} aria-label="Abrir biblioteca de packs">
          <LayoutGrid size={19} />
        </button>
        <button type="button" onClick={onLibrary} className="min-w-0 flex-1 text-left leading-tight">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] short:hidden" style={{ color: groupColor }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: groupColor }} />
            {group}
          </span>
          <span className="block truncate text-[15px] font-bold text-white">
            {pack}
            <span className="hidden text-[12px] font-medium text-slate-400 short:inline"> · {view}</span>
          </span>
          <span className="block truncate text-[11px] text-slate-400 short:hidden">{view}</span>
        </button>
        <button type="button" onClick={onAbout} className={iconButton} aria-label="Sobre o modelo e créditos">
          <Info size={19} />
        </button>
      </div>
    </header>
  );
});
