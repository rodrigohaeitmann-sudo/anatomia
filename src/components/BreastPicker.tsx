"use client";

import { CircleDot, X } from "lucide-react";
import { breastStateById, breastStates, measurementsOf, type BreastMeasurement } from "@/lib/breastStates";

const cm = (mm: number) => (mm / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Clinical measurements of a breast state, as measured on the deformed model (build_breast.py). */
export function breastSummary(m: BreastMeasurement) {
  const level = Math.round(Math.abs(m.nippleToFoldMm));
  return [
    { label: "Mamilo", value: level < 3 ? "na altura do sulco" : `${level} mm ${m.nippleToFoldMm > 0 ? "acima" : "abaixo"} do sulco` },
    { label: "Fúrcula–mamilo", value: `${cm(m.notchToNippleMm)} cm` },
    { label: "Mamilo–sulco", value: `${cm(m.nippleToFoldSkinMm)} cm` },
    { label: "Regnault", value: m.regnault },
  ];
}

type Props = {
  state: string | null;
  settled: string | null;
  onState: (state: string | null) => void;
  variant: "floating" | "inline";
  bottom?: number;
  onClose?: () => void;
};

/** Breast shape: as scanned, or one of the ptosis grades (skin and every breast structure are deformed). */
export function BreastPicker({ state, settled, onState, variant, bottom = 0, onClose }: Props) {
  const active = state ? breastStateById.get(state) : undefined;
  const floating = variant === "floating";
  const shown = settled === state ? measurementsOf(state) : null;
  const chip = (id: string | null, label: string) => (
    <button
      key={id ?? "repouso"}
      type="button"
      onClick={() => onState(id)}
      aria-pressed={state === id}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition ${state === id ? "border-transparent bg-white text-slate-950" : "border-white/10 bg-white/5 text-slate-200"}`}
    >
      {label}
    </button>
  );
  const body = (
    <>
      <div className="flex items-center gap-2">
        <CircleDot size={18} className="shrink-0 text-pink-300" />
        <p className="flex-1 text-sm font-bold text-white">Forma da mama</p>
        {onClose && (
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-xl text-slate-400 active:bg-white/10" aria-label="Fechar">
            <X size={18} />
          </button>
        )}
      </div>
      <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {chip(null, "Sem ptose")}
        {breastStates.map((item) => chip(item.id, item.short))}
      </div>
      <p className={`mt-2 text-xs leading-snug text-slate-300 ${floating ? "line-clamp-2" : ""}`}>
        {active ? active.description : "Mama como no exame de origem (Visible Human Female): mamilo acima do sulco inframamário."}
      </p>
      {shown && (
        <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
          No modelo:{" "}
          {breastSummary(shown).map((item, index) => (
            <span key={item.label}>
              {index > 0 ? " · " : ""}
              {item.label} <span className="text-pink-200">{item.value}</span>
            </span>
          ))}
        </p>
      )}
      {active && !floating && <p className="mt-1.5 text-[11px] text-slate-500">Pele, gordura, glândula, ductos e ligamentos são deformados pelo mesmo mapa; a parede torácica não se move. Modelo geométrico, não é simulação física.</p>}
    </>
  );
  if (variant === "inline") return <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3">{body}</div>;
  return (
    <div className="fixed inset-x-3 z-30 rounded-[22px] border border-pink-300/20 bg-slate-950/[0.92] p-3 shadow-2xl backdrop-blur-xl" style={{ bottom }} role="dialog" aria-label="Forma da mama">
      {body}
    </div>
  );
}
