"use client";

import type { AnnotationEntry } from "@/lib/annotations";

/** Numbered legend matching the pins drawn on the model. */
export function AnnotationLegend({ entries, activePin, onPick }: { entries: AnnotationEntry[]; activePin: string | null; onPick: (entry: AnnotationEntry) => void }) {
  if (!entries.length) return null;
  const groups = [...new Set(entries.map((entry) => entry.group ?? ""))];
  return (
    <section>
      <h4 className="text-[11px] font-bold uppercase tracking-wide text-sky-300">Rótulos no modelo</h4>
      {groups.map((group) => (
        <div key={group || "labels"} className="mt-2">
          {group && <p className="mb-1 text-[11px] font-semibold text-slate-400">{group}</p>}
          <ol className="space-y-1">
            {entries
              .filter((entry) => (entry.group ?? "") === group)
              .map((entry) => (
                <li key={entry.key}>
                  <button type="button" onClick={() => onPick(entry)} className={`flex w-full items-center gap-2.5 rounded-2xl px-2 py-1.5 text-left text-sm ${activePin === entry.key ? "bg-white/10 text-white" : "text-slate-200 active:bg-white/5"}`}>
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 bg-slate-950 text-[11px] font-black text-white" style={{ borderColor: entry.color }}>
                      {entry.number}
                    </span>
                    <span className="leading-snug">{entry.text}</span>
                  </button>
                </li>
              ))}
          </ol>
        </div>
      ))}
    </section>
  );
}
