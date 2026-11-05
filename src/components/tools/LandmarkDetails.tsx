"use client";

import { useState } from "react";
import { attachmentsNear, boneFit, kindLabel, landmarkById } from "@/lib/anatomyLayers";
import { modelStructures } from "@/lib/modelConfig";
import { partById } from "@/lib/anatomyLayers";
import { reviewTone, type ReviewEntry, type ReviewStatus } from "@/lib/review";
import { mm } from "@/components/viewer/shared";

const categoryLabel = { osseo: "Marco ósseo", costela: "Costela", hilo: "Hilo neurovascular" } as const;
const structureLabel = new Map(modelStructures.map((item) => [item.id, item.label]));

type Props = {
  id: string;
  review?: ReviewEntry;
  adjusting: boolean;
  onReview: (id: string, entry: Partial<ReviewEntry> | null) => void;
  onAdjust: (id: string | null) => void;
  onFocus: (point: [number, number, number]) => void;
  onSelectMuscle: (structure: string, part: string | null) => void;
  onClose: () => void;
};

/** Card for a bony landmark or computed hilum: what attaches there, provenance and specialist review. */
export function LandmarkDetails({ id, review, adjusting, onReview, onAdjust, onFocus, onSelectMuscle, onClose }: Props) {
  const item = landmarkById.get(id);
  const [comment, setComment] = useState(review?.comment ?? "");
  if (!item) return null;
  const near = item.category === "hilo" ? [] : attachmentsNear(item, mm);
  const fit = boneFit[item.bone];
  const chip = "rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/15";
  const setStatus = (status: ReviewStatus) => onReview(id, { status, comment: comment || undefined });

  return (
    <article className="space-y-3">
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
            {categoryLabel[item.category]} · {item.bone}
          </p>
          <h3 className="text-lg font-bold text-white">{item.name}</h3>
        </div>
        <button onClick={onClose} className="rounded-full bg-white/10 px-2 py-1 text-xs text-slate-200" aria-label="Fechar ficha">
          ✕
        </button>
      </header>
      <div className="flex flex-wrap gap-2">
        <button className={chip} onClick={() => onFocus(review?.point ?? item.point)}>
          Focar
        </button>
        {item.palpable && <span className="rounded-full bg-amber-300/15 px-3 py-1.5 text-xs font-semibold text-amber-100">Palpável</span>}
      </div>
      {item.note && <p className="text-sm leading-relaxed text-slate-200">{item.note}</p>}
      {near.length > 0 && (
        <section>
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-sky-300">Fixações musculares próximas</h4>
          <ul className="mt-1 space-y-1">
            {near.map((att) => (
              <li key={att.id}>
                <button onClick={() => onSelectMuscle(att.muscle, att.part)} className="flex w-full items-center gap-2 rounded-xl bg-slate-900/80 px-2 py-1.5 text-left text-sm text-slate-100 hover:bg-slate-800">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${att.kind === "origin" ? "bg-red-500" : "bg-blue-500"}`} />
                  <span className="min-w-0 flex-1">
                    {(att.part && partById.get(att.part)?.label) || structureLabel.get(att.muscle)} · {kindLabel[att.kind].toLowerCase()}
                  </span>
                  {att.source !== "Z-Anatomy" && <span className="text-[10px] text-amber-200">calculado</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="rounded-xl border border-white/10 p-2 text-xs text-slate-300">
        <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-300">Origem do dado</h4>
        {item.source === "Z-Anatomy" ? (
          <p>
            Marco do Z-Anatomy transferido para o osso do modelo.
            {fit ? ` Ajuste do osso: erro mediano ${fit.medianMm.toLocaleString("pt-BR")} mm (p95 ${fit.p95Mm.toLocaleString("pt-BR")} mm).` : ""}
            {typeof item.sourceOffsetMm === "number" ? ` O ponto foi projetado na superfície (deslocamento ${item.sourceOffsetMm.toLocaleString("pt-BR")} mm).` : ""}
          </p>
        ) : (
          <p>Calculado a partir das malhas do modelo (BodyParts3D). Confira com a sua experiência e corrija na revisão.</p>
        )}
      </section>
      <section className="space-y-2 rounded-xl border border-violet-300/20 bg-violet-500/5 p-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-violet-200">Revisão do especialista</h4>
        {review && (
          <p className={`text-xs font-semibold ${reviewTone[review.status]}`}>
            {review.status === "ajustado" ? "Posição ajustada" : review.status === "confirmado" ? "Confirmado" : "Marcado como incorreto"} · {new Date(review.at).toLocaleDateString("pt-BR")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button className={chip} onClick={() => setStatus("confirmado")}>
            Confirmar
          </button>
          <button className={`${chip} ${adjusting ? "bg-violet-400/30" : ""}`} onClick={() => onAdjust(adjusting ? null : id)}>
            {adjusting ? "Toque no osso…" : "Ajustar posição"}
          </button>
          <button className={chip} onClick={() => setStatus("incorreto")}>
            Incorreto
          </button>
          {review && (
            <button className={chip} onClick={() => onReview(id, null)}>
              Limpar
            </button>
          )}
        </div>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          onBlur={() => review && onReview(id, { comment: comment || undefined })}
          placeholder="Comentário (opcional)"
          rows={2}
          className="w-full rounded-lg border border-white/10 bg-slate-900/80 p-2 text-sm text-slate-100 placeholder:text-slate-500"
        />
      </section>
    </article>
  );
}
