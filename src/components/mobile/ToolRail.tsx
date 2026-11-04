"use client";

import type { LucideIcon } from "lucide-react";

export type RailItem = { id: string; label: string; icon: LucideIcon; active?: boolean; onPress: () => void };

/** Vertical floating tool rail (right edge), icon + short caption, like anatomy app toolbars. */
export function ToolRail({ items, top, maxHeight }: { items: RailItem[]; top: number; maxHeight: number }) {
  return (
    <nav aria-label="Ferramentas do modelo" className="fixed right-3 z-30 flex flex-col gap-1.5 overflow-y-auto overscroll-contain rounded-[22px] border border-white/10 bg-slate-950/60 p-1.5 shadow-lg backdrop-blur-xl [scrollbar-width:none]" style={{ top, maxHeight }}>
      {items.map(({ id, label, icon: Icon, active, onPress }) => (
        <button
          key={id}
          type="button"
          onClick={onPress}
          aria-pressed={active}
          className={`flex w-12 flex-col items-center gap-0.5 rounded-2xl px-1 py-1.5 text-[9px] font-semibold leading-none transition active:scale-95 ${active ? "bg-sky-400/25 text-sky-100 ring-1 ring-sky-300/40" : "text-slate-300"}`}
        >
          <Icon size={18} strokeWidth={2} />
          <span className="max-w-full truncate short:hidden">{label}</span>
        </button>
      ))}
    </nav>
  );
}
