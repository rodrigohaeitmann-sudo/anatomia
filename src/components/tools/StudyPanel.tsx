"use client";

import { Bone, Crosshair, Download, GraduationCap, Map as MapIcon, PenLine, Radar, Ruler, Spline, Waypoints } from "lucide-react";
import { references } from "@/data/literature";
import { boneFit, layerLandmarks, perforatorZones, skinMarkings } from "@/lib/anatomyLayers";
import { proximityRamp } from "@/components/viewer/HybridModel";
import { landmarkColors } from "@/components/viewer/StudyLayers";
import { modelStructures } from "@/lib/modelConfig";
import type { ReviewStore } from "@/lib/review";
import type { StudyState } from "@/lib/viewerTypes";

export type QuizState = {
  targetId: string | null;
  guess: [number, number, number] | null;
  errorMm: number | null;
  session: number[];
};

const structureLabel = new Map(modelStructures.map((item) => [item.id, item.label]));
const proximityTargets = modelStructures.filter((item) => item.group === "Nervos" || item.group === "Vasos");

type Props = {
  study: StudyState;
  onStudy: (next: StudyState) => void;
  onSkeleton: () => void;
  rulerPoints: [number, number, number][];
  rulerMm: number | null;
  onClearRuler: () => void;
  quiz: QuizState | null;
  quizPool: number;
  onQuizStart: () => void;
  onQuizNext: () => void;
  onQuizStop: () => void;
  review: ReviewStore;
  onExportReview: () => void;
};

function Toggle({ on, onClick, icon: Icon, title, text }: { on: boolean; onClick: () => void; icon: typeof Bone; title: string; text: string }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={`flex w-full items-start gap-3 rounded-2xl border p-2.5 text-left transition ${on ? "border-transparent bg-warm" : "border-line bg-surface hover:bg-surface-alt"}`}>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${on ? "bg-ink text-on-ink" : "bg-surface-alt text-ink-2"}`}>
        <Icon size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="block text-xs leading-snug text-muted">{text}</span>
      </span>
      <span className={`ml-auto mt-1 h-5 w-9 shrink-0 rounded-full p-0.5 transition ${on ? "bg-ink" : "bg-line"}`}>
        <span className={`block h-4 w-4 rounded-full bg-white transition ${on ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}

/** "Estudo" tab: bony landmarks, attachments, fibres, skin marking, perforator zones and tools. */
export function StudyPanel({ study, onStudy, onSkeleton, rulerPoints, rulerMm, onClearRuler, quiz, quizPool, onQuizStart, onQuizNext, onQuizStop, review, onExportReview }: Props) {
  const set = (patch: Partial<StudyState>) => onStudy({ ...study, ...patch });
  const reviewed = Object.values(review);
  const target = quiz?.targetId ? layerLandmarks.find((item) => item.id === quiz.targetId) : null;
  const mean = quiz?.session.length ? quiz.session.reduce((a, b) => a + b, 0) / quiz.session.length : null;
  const sectionTitle = "text-[11.5px] font-semibold uppercase tracking-[1.5px]";

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className={`${sectionTitle} text-muted`}>Camadas</h3>
        <Toggle on={study.landmarks} onClick={() => set({ landmarks: !study.landmarks })} icon={Bone} title="Marcos ósseos" text={`${layerLandmarks.length} pontos nomeados: tubérculos, cristas, ângulos, costelas e hilos. Toque num ponto para a ficha.`} />
        {study.landmarks && (
          <p className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-ink-2">
            {[
              [landmarkColors.palpable, "palpável"],
              [landmarkColors.deep, "profundo"],
              [landmarkColors.rib, "costela"],
              [landmarkColors.hilum, "hilo neurovascular"],
            ].map(([color, label]) => (
              <span key={label} className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                {label}
              </span>
            ))}
          </p>
        )}
        <button onClick={onSkeleton} className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink hover:bg-surface-alt">
          Mostrar só os ossos (com marcos e fixações)
        </button>
        <Toggle
          on={study.attachments === "all"}
          onClick={() => set({ attachments: study.attachments === "all" ? "selected" : "all" })}
          icon={Crosshair}
          title="Todas as áreas de fixação"
          text="Origens (vermelho) e inserções (azul) sobre os ossos visíveis. Desligado: só as do músculo selecionado (botão “Ver fixações” na ficha)."
        />
        <Toggle
          on={study.fibres === "all"}
          onClick={() => set({ fibres: study.fibres === "all" ? "selected" : "all" })}
          icon={Spline}
          title="Direção das fibras"
          text="Linhas calculadas entre origem e inserção (campo laplaciano) nos músculos peitorais, serrátil, grande dorsal, redondo maior, subescapular e deltoide."
        />
        <Toggle on={study.markings} onClick={() => set({ markings: !study.markings })} icon={PenLine} title="Marcação na pele" text={`${skinMarkings.length} referências pré-operatórias projetadas na pele: borda do grande dorsal, pregas axilares, sulco inframamário, linha hemiclavicular, EIC.`} />
      </section>

      <section className="space-y-2">
        <h3 className={`${sectionTitle} text-muted`}>Zonas de perfurantes (probabilísticas)</h3>
        <p className="text-xs text-muted">Faixas onde a literatura encontra as perfurantes, desenhadas a partir das referências do modelo. Não são vasos modelados.</p>
        {perforatorZones.map((zone) => {
          const on = study.zones.includes(zone.id);
          return (
            <button
              key={zone.id}
              onClick={() => set({ zones: on ? study.zones.filter((id) => id !== zone.id) : [...study.zones, zone.id] })}
              className={`w-full rounded-2xl border p-2.5 text-left ${on ? "border-ink bg-warm" : "border-line bg-surface"}`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: zone.color }} />
                {zone.label}
              </span>
              <span className="mt-1 block text-xs leading-snug text-muted">{zone.note}</span>
              {zone.emphasisLabel && <span className="mt-1 block text-xs font-semibold text-ink-2">Faixa mais intensa: {zone.emphasisLabel}</span>}
              <span className="mt-1 block text-[11px] text-faint">{zone.refs.map((id) => references[id]?.label).join(" · ")} (resumo)</span>
            </button>
          );
        })}
      </section>

      <section className="space-y-2">
        <h3 className={`${sectionTitle} text-muted`}>Ferramentas</h3>
        <Toggle on={study.ruler} onClick={() => set({ ruler: !study.ruler })} icon={Ruler} title="Régua" text="Toque dois pontos no modelo para medir a distância em linha reta (mm). O modelo está em escala real." />
        {study.ruler && (
          <div className="flex items-center justify-between rounded-xl bg-surface-alt px-3 py-2 text-sm text-ink">
            <span>{rulerPoints.length === 0 ? "Toque o primeiro ponto" : rulerPoints.length === 1 ? "Toque o segundo ponto" : `${rulerMm?.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mm`}</span>
            {rulerPoints.length > 0 && (
              <button onClick={onClearRuler} className="text-xs font-semibold text-ink">
                Limpar
              </button>
            )}
          </div>
        )}
        <div className="rounded-2xl border border-line bg-surface p-2.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Radar size={16} /> Mapa de distância
          </p>
          <p className="mt-0.5 text-xs text-muted">Colore músculos, gordura e ossos pela distância até a estrutura escolhida. Também disponível na ficha de nervos e vasos.</p>
          <select
            value={study.proximity?.[0] ?? ""}
            onChange={(event) => set({ proximity: event.target.value ? [event.target.value] : null })}
            className="mt-2 w-full rounded-xl border border-line bg-surface p-2 text-sm text-ink"
          >
            <option value="">Desligado</option>
            {proximityTargets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          {study.proximity && (
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-ink-2">
              {proximityRamp.map((step) => (
                <span key={step.label} className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: step.color }} />
                  {step.label}
                </span>
              ))}
              <span className="text-faint">até {study.proximity.map((id) => structureLabel.get(id)).join(", ")}</span>
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-line bg-surface p-2.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <GraduationCap size={16} /> Autoavaliação: encontre o marco
          </p>
          {!quiz ? (
            <>
              <p className="mt-0.5 text-xs text-muted">O app pede um marco e você toca onde acha que ele está. O erro é medido em mm sobre o modelo. Os marcos com maior erro voltam primeiro.</p>
              <button onClick={onQuizStart} disabled={!quizPool} className="mt-2 w-full rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-on-ink disabled:opacity-40">
                {quizPool ? `Começar (${quizPool} marcos visíveis)` : "Mostre os ossos para começar"}
              </button>
            </>
          ) : (
            <div className="mt-2 space-y-2 text-sm text-ink">
              <p>
                {target ? (
                  <>
                    Toque: <strong className="text-amber-deep">{target.name}</strong> <span className="text-muted">({target.bone})</span>
                  </>
                ) : (
                  "Sem marcos visíveis."
                )}
              </p>
              {quiz.errorMm !== null && (
                <p className="rounded-lg bg-surface-alt px-2 py-1">
                  Erro: <strong>{quiz.errorMm.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mm</strong>
                  {mean !== null && <span className="text-muted"> · média da sessão {mean.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mm ({quiz.session.length})</span>}
                </p>
              )}
              <div className="flex gap-2">
                <button onClick={onQuizNext} className="flex-1 rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-on-ink">
                  {quiz.errorMm === null ? "Pular" : "Próximo"}
                </button>
                <button onClick={onQuizStop} className="rounded-xl bg-surface-alt px-3 py-2 text-sm font-semibold text-ink">
                  Encerrar
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className={`${sectionTitle} text-muted`}>Revisão do especialista</h3>
        <p className="text-xs text-muted">Na ficha de cada marco: confirmar, ajustar a posição (toque no osso) ou marcar como incorreto. Fica salvo neste aparelho; exporte para incorporar ao modelo.</p>
        <div className="flex items-center justify-between rounded-xl bg-surface-alt px-3 py-2 text-sm text-ink">
          <span>
            {reviewed.length} revisado(s) · {reviewed.filter((item) => item.status === "confirmado").length} confirmados · {reviewed.filter((item) => item.status === "ajustado").length} ajustados ·{" "}
            {reviewed.filter((item) => item.status === "incorreto").length} incorretos
          </span>
        </div>
        <button onClick={onExportReview} disabled={!reviewed.length} className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-on-ink disabled:opacity-40">
          <Download size={16} /> Exportar revisão (JSON)
        </button>
      </section>

      <section className="space-y-1 rounded-2xl border border-line p-2.5 text-xs text-muted">
        <h3 className={`${sectionTitle} flex items-center gap-1.5 text-muted`}>
          <MapIcon size={13} /> Precisão dos dados
        </h3>
        <p>
          Marcos e áreas de fixação vêm do Z-Anatomy, cujos ossos derivam do mesmo BodyParts3D do modelo. Cada osso foi ajustado ao do modelo; erro mediano:
        </p>
        <p className="text-ink-2">
          {Object.entries(boneFit)
            .filter(([bone]) => !bone.includes("costela") || bone.startsWith("1ª") || bone.startsWith("6ª"))
            .map(([bone, fit]) => `${bone} ${fit.medianMm.toLocaleString("pt-BR")} mm`)
            .join(" · ")}
        </p>
        <p className="flex items-start gap-1.5">
          <Waypoints size={13} className="mt-0.5 shrink-0" /> Limites: esqueleto e músculos de um homem (BodyParts3D) com pele e mama de uma mulher (Visible Human); úmero e clavícula têm malha de baixa resolução, que suaviza cristas e tubérculos.
        </p>
      </section>
    </div>
  );
}

/** Banner over the model for modes that need taps on it (quiz, adjusting a landmark, placing a note). */
export function FloatingPrompt({ top, title, detail, actions, className = "left-3 right-3" }: { top: number; title: React.ReactNode; detail?: React.ReactNode; actions: { label: string; onPress: () => void; primary?: boolean }[]; className?: string }) {
  return (
    <div className={`glass absolute z-30 rounded-[20px] border border-line p-2.5 pl-3.5 shadow-menu ${className}`} style={{ top }} role="status">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-sm leading-snug text-ink">
          <p className="font-semibold">{title}</p>
          {detail && <p className="text-xs text-muted">{detail}</p>}
        </div>
        {actions.map((action) => (
          <button key={action.label} type="button" onClick={action.onPress} className={`shrink-0 rounded-xl px-3 py-2 text-xs font-semibold ${action.primary ? "bg-ink text-on-ink" : "bg-surface-alt text-ink"}`}>
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}
