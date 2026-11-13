"use client";

import { useEffect, useRef, useState } from "react";
import { stretchSummary } from "@/lib/armPoseSummary";
import { armPoseById, armPoses } from "@/lib/armPoses";
import { breastStateById, breastStates, measurementsOf } from "@/lib/breastStates";
import { modelStructures } from "@/lib/modelConfig";
import { deleteNote } from "@/lib/store";
import { hiddenByLayer } from "@/lib/viewerTypes";
import { Icon } from "@/components/ui/Icon";
import { Btn, cx, Lbl, Pick, Stat, Switch, toneOfGroup } from "@/components/ui/kit";
import { layerGroups, type LayerPreset, type ViewerController } from "./useViewerController";

const cm = (mm: number) => (mm / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n))}`;

/** Measurements of the operated breast in a state, as measured on the deformed model (build_breast.py). */
export function breastStats(state: string | null) {
  const m = measurementsOf(state);
  return [
    { label: "Mamilo × sulco", value: signed(m.nippleToFoldMm), unit: "mm" },
    { label: "Fúrcula–mamilo", value: cm(m.notchToNippleMm), unit: "cm" },
    { label: "Mamilo–sulco", value: cm(m.nippleToFoldSkinMm), unit: "cm" },
    { label: "Volume", value: String(Math.round(m.volumeMl / 10) * 10), unit: "mL" },
  ];
}

/** Short name of a breast state ("Sem ptose", "Ptose II") and of an arm position ("Anatômica", "Abdução 90°"). */
export const breastShort = (id: string | null) => (id ? breastStateById.get(id)?.short ?? id : "Sem ptose");
export const poseShort = (id: string | null) => (id ? armPoseById.get(id)?.short ?? id : "Anatômica");

// ---- Forma da mama ---------------------------------------------------------------------------------------

export function ShapePanel({ ctl, columns = 3 }: { ctl: ViewerController; columns?: 2 | 3 | 4 }) {
  const state = ctl.breast;
  const active = state ? breastStateById.get(state) : undefined;
  const settled = ctl.breastSettled === state;
  const stats = breastStats(settled ? state : ctl.breastSettled);
  const measured = measurementsOf(settled ? state : ctl.breastSettled);
  const regnault = measured.regnault;
  // what a reduction to the breast this state aims at would remove: the hypertrophy grade (Berrocal Revueltas)
  const reduction = measured.berrocal ? `Redução a ${measured.reductionToMl} mL: ≈ ${measured.reductionG} g, hipertrofia ${measured.berrocal} de Berrocal.` : null;
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap gap-2">
        <Pick size="s" on={state === null} disabled={Boolean(ctl.breastLock) && state !== null} onClick={() => ctl.chooseBreast(null)}>
          Sem ptose
        </Pick>
        {breastStates.map((item) => (
          <Pick key={item.id} size="s" on={state === item.id} disabled={Boolean(ctl.breastLock) && state !== item.id} onClick={() => ctl.chooseBreast(item.id)} title={item.label}>
            {item.short.replace(/^Ptose /, "Grau ")}
          </Pick>
        ))}
      </div>
      {ctl.breastLock && <p className="rounded-2xl bg-rose-bg px-3.5 py-2.5 text-[13px] font-medium leading-snug text-rose-deep">{ctl.breastLock}</p>}
      <div className={cx("grid gap-x-3 gap-y-3 rounded-2xl bg-surface-alt px-3.5 py-3", columns === 4 ? "grid-cols-4" : columns === 2 ? "grid-cols-2" : "grid-cols-3")}>
        {(columns === 3 ? stats.slice(0, 3) : stats).map((item) => (
          <Stat key={item.label} label={item.label} value={item.value} unit={item.unit} size={20} />
        ))}
      </div>
      <p className="text-[13.5px] leading-normal text-ink-2">
        {!settled && <span className="font-semibold text-ink">Ajustando a forma… </span>}
        {active ? active.description : "Mama como no exame de origem (Visible Human Female): mamilo acima do sulco inframamário."}
        {columns === 3 && (
          <span className="text-muted">
            {" "}
            Volume ≈ {stats[3].value} mL · Regnault: {regnault}.
          </span>
        )}
        {reduction && <span className="text-muted"> {reduction}</span>}
      </p>
    </div>
  );
}

// ---- Posição do braço ------------------------------------------------------------------------------------

const poseTiles = [{ id: null as string | null, degrees: "0°", name: "Anatômica" }, ...armPoses.map((pose) => ({ id: pose.id as string | null, degrees: `${pose.elevation}°`, name: pose.short.replace(/ \d+°$/, "") }))];

/** First sentences of a description, as short facts. */
const facts = (text: string, count: number) =>
  text
    .split(/(?<=\.)\s+/)
    .map((item) => item.trim().replace(/\.$/, ""))
    .filter(Boolean)
    .slice(0, count);

export function ArmPanel({ ctl, factCount = 2 }: { ctl: ViewerController; factCount?: number }) {
  const pose = ctl.armPose;
  const active = pose ? armPoseById.get(pose) : undefined;
  const summary = ctl.poseSettled && ctl.poseSettled === pose ? stretchSummary(ctl.poseSettled, 4) : [];
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Posição do braço">
        {poseTiles.map((tile) => {
          const on = tile.id === pose;
          return (
            <button
              key={tile.id ?? "anatomica"}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => ctl.choosePose(tile.id)}
              className={cx("rounded-2xl px-1.5 py-3 text-center transition-colors", on ? "bg-ink text-on-ink" : "border border-line-soft bg-surface-alt text-ink active:bg-warm")}
            >
              <div className="text-lg font-semibold">{tile.degrees}</div>
              <div className="mt-[3px] truncate text-[11.5px] opacity-80">{tile.name}</div>
            </button>
          );
        })}
      </div>
      <div className="text-[13px] text-muted">{active ? active.label : "Braço pendente ao lado do corpo, como no modelo original"}</div>
      {active && (
        <ul className="flex flex-col gap-2">
          {facts(active.description, factCount).map((fact) => (
            <li key={fact} className="flex gap-2.5 text-sm leading-[1.45] text-ink-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rose" />
              {fact}
            </li>
          ))}
        </ul>
      )}
      {summary.length > 0 && (
        <p className="text-[12.5px] leading-snug text-muted">
          No modelo:{" "}
          {summary.map((item, index) => (
            <span key={item.label}>
              {index > 0 ? " · " : ""}
              {item.label} <span className={item.change > 0 ? "font-semibold text-sage-deep" : "font-semibold text-amber-deep"}>{item.change > 0 ? `+${item.change}` : item.change}%</span>
            </span>
          ))}
        </p>
      )}
      {active && <p className="text-[12px] leading-snug text-faint">Músculos, vasos e nervos são deformados pela posição; a pele do tronco não acompanha e fica oculta.</p>}
    </div>
  );
}

// ---- Camadas ---------------------------------------------------------------------------------------------

const presets: { id: LayerPreset; label: string }[] = [
  { id: "all", label: "Pele → osso" },
  { id: "breast", label: "Só a mama" },
  { id: "neuro", label: "Neurovascular" },
];

export function LayersPanel({ ctl, onStructures }: { ctl: ViewerController; onStructures?: () => void }) {
  const hidden = hiddenByLayer(ctl.dissection.layer);
  return (
    <div className="flex flex-col gap-3">
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
        {presets.map((preset) => (
          <Pick key={preset.id} size="s" onClick={() => ctl.applyPreset(preset.id)}>
            {preset.label}
          </Pick>
        ))}
      </div>
      <div className="flex flex-col">
        {layerGroups.map((entry) => {
          const ids = entry.ids.filter(ctl.allowed);
          if (!ids.length) return null;
          const shown = ids.filter((id) => ctl.visibility[id] && !hidden.has(id)).length;
          const on = shown > 0;
          const translucentSkin = entry.group === "Superfície" && on;
          return (
            <div key={entry.group} className="flex items-center gap-3 border-t border-line-soft py-[9px]">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: toneOfGroup(entry.group), opacity: on ? 1 : 0.35 }} />
              <div className={cx("min-w-0 flex-1 text-[15.5px] font-semibold", on ? "text-ink" : "text-muted")}>
                {entry.name}
                <span className="text-[13.5px] font-normal text-muted">
                  {" "}
                  · {shown} de {ids.length}
                  {translucentSkin ? " · translúcida" : ""}
                </span>
              </div>
              <Switch on={on} onChange={(next) => ctl.setGroupShown(entry.group, next)} label={`Mostrar ${entry.name}`} />
            </div>
          );
        })}
      </div>
      {ctl.dissection.layer > 0 && (
        <p className="rounded-2xl bg-amber-tint px-3.5 py-2.5 text-[13px] leading-snug text-amber-deep">
          Dissecção ativa: algumas camadas estão removidas.{" "}
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => ctl.setDissection({ ...ctl.dissection, layer: 0 })}>
            Restaurar
          </button>
        </p>
      )}
      {onStructures && (
        <button type="button" onClick={onStructures} className="flex items-center justify-between rounded-2xl border border-line px-4 py-3 text-left text-[14.5px] font-semibold text-ink active:bg-surface-alt">
          Escolher estrutura por estrutura
          <Icon name="chevR" size={17} color="#B6ADB1" />
        </button>
      )}
    </div>
  );
}

// ---- Anotar ----------------------------------------------------------------------------------------------

export function NotePanel({ ctl }: { ctl: ViewerController }) {
  const draft = ctl.draft;
  const area = useRef<HTMLTextAreaElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setConfirmDelete(false), [draft?.id]);
  if (!draft) return null;
  const pointMode = draft.awaitingPoint || Boolean(draft.point);
  const structureLabel = draft.structure ? modelStructures.find((item) => item.id === draft.structure)?.label : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {[
          { id: "point", label: "Ponto", icon: "pin" as const, on: pointMode },
          { id: "text", label: "Texto", icon: "label" as const, on: !pointMode },
        ].map((kind) => (
          <button
            key={kind.id}
            type="button"
            aria-pressed={kind.on}
            onClick={() => ctl.setDraft({ ...draft, awaitingPoint: kind.id === "point" && !draft.point, point: kind.id === "point" ? draft.point : null })}
            className={cx("flex items-center gap-[7px] rounded-full border px-3.5 py-2.5 text-sm font-semibold transition-colors", kind.on ? "border-transparent bg-ink text-on-ink" : "border-line bg-surface text-ink")}
          >
            <Icon name={kind.icon} size={17} />
            {kind.label}
          </button>
        ))}
      </div>
      {pointMode && (
        <div className={cx("flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-snug", draft.awaitingPoint ? "bg-rose-bg text-rose-deep" : "bg-surface-alt text-ink-2")}>
          <Icon name="pin" size={18} />
          <span className="flex-1">{draft.awaitingPoint ? "Toque no modelo para marcar o ponto da nota." : `Ponto marcado${structureLabel ? ` em ${structureLabel}` : ""}.`}</span>
          {!draft.awaitingPoint && (
            <button type="button" onClick={() => ctl.setDraft({ ...draft, awaitingPoint: true })} className="shrink-0 font-semibold text-ink underline underline-offset-2">
              Mudar
            </button>
          )}
        </div>
      )}
      <textarea
        ref={area}
        value={draft.text}
        onChange={(event) => ctl.setDraft({ ...draft, text: event.target.value })}
        placeholder="Escreva sua nota (fica presa a esta vista)"
        rows={3}
        maxLength={600}
        className="min-h-[76px] w-full resize-none rounded-2xl border border-line bg-surface px-3.5 py-3 text-[15px] leading-[1.45] text-ink outline-none placeholder:text-muted focus:border-ink"
      />
      <div className="flex gap-2.5">
        {draft.id && (
          <Btn
            variant="danger"
            full={false}
            className="h-[50px] px-4 text-[15px]"
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              deleteNote(draft.id!);
              ctl.cancelNote();
            }}
          >
            {confirmDelete ? "Confirmar" : <Icon name="trash" size={19} />}
          </Btn>
        )}
        <Btn variant="ghost" className="h-[50px] text-[15px]" onClick={ctl.cancelNote}>
          Cancelar
        </Btn>
        <Btn className="h-[50px] text-[15px]" disabled={!draft.text.trim() || draft.awaitingPoint} onClick={ctl.saveNote}>
          {draft.id ? "Salvar" : "Salvar nota"}
        </Btn>
      </div>
    </div>
  );
}

/** Eyebrow, title and header action of each tool (shared by the phone panel and the desktop popover). */
export function toolMeta(ctl: ViewerController): { eyebrow: string; title: string; action?: { label: string; run: () => void } } | null {
  switch (ctl.tool) {
    case "layers":
      return { eyebrow: "Ferramenta", title: "Camadas", action: { label: "Redefinir", run: ctl.showViewStructures } };
    case "cut":
      return { eyebrow: "Ferramenta", title: "Corte", action: ctl.cut.axis ? { label: "Sem corte", run: () => ctl.setCut({ ...ctl.cut, axis: null }) } : undefined };
    case "shape":
      return { eyebrow: "Ferramenta", title: "Forma da mama", action: ctl.breastLock ? undefined : { label: "Redefinir", run: () => ctl.chooseBreast(ctl.view.breast ?? null) } };
    case "arm":
      return { eyebrow: "Ferramenta", title: "Posição do braço", action: { label: "Redefinir", run: () => ctl.choosePose(ctl.view.pose ?? null) } };
    case "note":
      return { eyebrow: "Anotação pessoal", title: ctl.draft?.id ? "Editar nota" : "Nova nota nesta vista" };
    case "study":
      return { eyebrow: "Estudo", title: "Marcos, régua e autoavaliação" };
    case "dissection":
      return { eyebrow: "Dissecção", title: "Planos e espaços" };
    case "structures":
      return { eyebrow: "Camadas", title: "Estruturas", action: { label: "Redefinir", run: ctl.showViewStructures } };
    default:
      return null;
  }
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <Lbl className="text-rose-deep">{children}</Lbl>;
}
