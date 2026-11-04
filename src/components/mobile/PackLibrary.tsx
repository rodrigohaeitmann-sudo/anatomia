"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { packGroups } from "@/data/packs";
import { groupColor } from "@/lib/groupStyle";

function normalise(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Full-screen pack library: grouped cards with search across packs and their views. */
export function PackLibrary({ open, activePackId, onSelect, onClose }: { open: boolean; activePackId: string; onSelect: (packId: string, viewIndex?: number) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = normalise(query.trim());
    if (!q) return packGroups;
    return packGroups
      .map((group) => ({ ...group, packs: group.packs.filter((pack) => normalise([pack.title, pack.summary, ...pack.views.map((view) => view.title)].join(" ")).includes(q)) }))
      .filter((group) => group.packs.length);
  }, [query]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Biblioteca de packs"
      className={`fixed inset-0 z-50 flex flex-col bg-slate-950/[0.96] backdrop-blur-2xl transition duration-300 ${open ? "pointer-events-auto opacity-100" : "pointer-events-none translate-y-6 opacity-0"}`}
    >
      <div className="flex items-center gap-2 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-sky-300">Atlas anatômico</p>
          <h2 className="text-xl font-black text-white">Packs de visualização</h2>
        </div>
        <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 text-white" aria-label="Fechar biblioteca">
          <X size={20} />
        </button>
      </div>
      <label className="mx-4 mb-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-slate-300">
        <Search size={17} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar: axila, pedículo, Berg…" className="min-w-0 flex-1 bg-transparent text-[15px] text-white placeholder:text-slate-500 focus:outline-none" />
      </label>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {groups.map((group) => {
          const color = groupColor(group.id);
          return (
            <section key={group.id}>
              <div className="mb-2 flex items-center gap-2">
                <span className="h-5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                <h3 className="text-sm font-black uppercase tracking-wider text-white">{group.title}</h3>
              </div>
              <p className="mb-3 text-xs text-slate-400">{group.description}</p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {group.packs.map((pack) => {
                  const active = pack.id === activePackId;
                  return (
                    <article key={pack.id} className={`rounded-3xl border p-3.5 ${active ? "border-white/25 bg-white/[0.08]" : "border-white/10 bg-white/[0.03]"}`} style={{ boxShadow: active ? `inset 0 0 0 1px ${color}55` : undefined }}>
                      <button type="button" onClick={() => onSelect(pack.id)} className="block w-full text-left">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-base font-bold text-white">{pack.title}</span>
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: `${color}22`, color }}>
                            {pack.views.length} vistas
                          </span>
                        </span>
                        <span className="mt-1 block text-[13px] leading-snug text-slate-400">{pack.summary}</span>
                      </button>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {pack.views.map((view, index) => (
                          <button key={view.id} type="button" onClick={() => onSelect(pack.id, index)} className="rounded-full bg-slate-800/80 px-2.5 py-1 text-[11px] text-slate-300 active:bg-slate-700">
                            {index + 1}. {view.title}
                          </button>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
        {!groups.length && <p className="text-center text-sm text-slate-400">Nenhum pack encontrado.</p>}
      </div>
    </div>
  );
}
