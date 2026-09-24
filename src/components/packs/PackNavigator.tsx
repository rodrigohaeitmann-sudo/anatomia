"use client";

import { packGroups } from "@/data/packs";

type Props = { activePackId: string; onSelect: (packId: string) => void; compact?: boolean };

/** Pack library organised by group. */
export function PackNavigator({ activePackId, onSelect, compact = false }: Props) {
  if (compact) {
    return (
      <div className="space-y-3">
        {packGroups.map((group) => (
          <div key={group.id}>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-sky-300">{group.title}</p>
            <div className="flex flex-wrap gap-2">
              {group.packs.map((pack) => (
                <button key={pack.id} onClick={() => onSelect(pack.id)} className={`rounded-full px-3 py-2 text-sm font-semibold ${pack.id === activePackId ? "bg-pink-500/30 text-white" : "bg-slate-900 text-slate-300"}`}>
                  {pack.title}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <aside className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-300">Packs de visualização</p>
      <div className="mt-3 space-y-4">
        {packGroups.map((group) => (
          <section key={group.id}>
            <h3 className="text-sm font-bold text-white">{group.title}</h3>
            <p className="text-[11px] leading-snug text-slate-500">{group.description}</p>
            <div className="mt-2 space-y-1.5">
              {group.packs.map((pack) => (
                <button key={pack.id} onClick={() => onSelect(pack.id)} className={`w-full rounded-2xl border px-3 py-2 text-left transition ${pack.id === activePackId ? "border-pink-300 bg-pink-400/10" : "border-slate-800 bg-slate-900/60 hover:border-slate-600"}`}>
                  <span className="block text-sm font-semibold text-white">{pack.title}</span>
                  <span className="block text-[11px] text-slate-400">{pack.views.length} vistas</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}
