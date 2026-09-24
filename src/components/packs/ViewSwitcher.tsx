"use client";

import type { Pack } from "@/data/packs";

export function ViewSwitcher({ pack, activeIndex, onSelect }: { pack: Pack; activeIndex: number; onSelect: (index: number) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Vistas do pack">
      {pack.views.map((view, index) => (
        <button key={view.id} role="tab" aria-selected={index === activeIndex} onClick={() => onSelect(index)} className={`shrink-0 rounded-2xl border px-3 py-2 text-left ${index === activeIndex ? "border-pink-300 bg-pink-400/15" : "border-slate-800 bg-slate-900/70"}`}>
          <span className="block text-[10px] font-bold text-slate-400">Vista {index + 1}</span>
          <span className="block text-sm font-semibold text-white">{view.title}</span>
        </button>
      ))}
    </div>
  );
}
