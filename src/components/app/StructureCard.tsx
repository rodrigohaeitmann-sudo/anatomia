"use client";

import { useState } from "react";
import { anatomyDetails, type AnatomyDetail } from "@/data/anatomyDetails";
import { literatureByStructure, references } from "@/data/literature";
import { partDetails, regionDetail } from "@/data/partDetails";
import { manipulations } from "@/data/surgicalSpaces";
import { attachmentsFor, attachmentsNear, boneFit, fibreStructures, kindLabel, landmarkById, partById, partsOf } from "@/lib/anatomyLayers";
import { allPacks, viewsOfStructure } from "@/lib/catalog";
import { modelMeshes, modelStructures } from "@/lib/modelConfig";
import { reviewTone, type ReviewStatus } from "@/lib/review";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Circ, cx, Lbl, Range, toneOfGroup } from "@/components/ui/kit";
import { mm } from "@/components/viewer/shared";
import type { ViewerController } from "./useViewerController";

const proximityGroups = new Set(["Nervos", "Vasos"]);
const fields: { key: keyof AnatomyDetail; label: string }[] = [
  { key: "origin", label: "Origem" },
  { key: "insertion", label: "Inserção" },
  { key: "course", label: "Trajeto" },
  { key: "branches", label: "Ramos" },
  { key: "innervation", label: "Inervação" },
  { key: "vascularization", label: "Irrigação" },
  { key: "drainage", label: "Drenagem" },
  { key: "action", label: "Ação" },
];
type Tab = "resumo" | "relacoes" | "cirurgia";
const tabs: { id: Tab; label: string }[] = [
  { id: "resumo", label: "Resumo" },
  { id: "relacoes", label: "Relações" },
  { id: "cirurgia", label: "Cirurgia" },
];

/** "Peitoral maior · parte esternocostal" → "Parte esternocostal" (the structure is in the eyebrow). */
const partTitle = (label: string) => {
  const name = label.split(" · ")[1] ?? label;
  return name.charAt(0).toUpperCase() + name.slice(1);
};

/** Presents source names on the displayed (right) side: the model is the reflected source left side. */
const displayName = (name: string) => name.replace(/\bLeft\b/g, "Right").replace(/\bleft\b/g, "right").replace(/_/g, " ");

function References({ ids }: { ids: string[] }) {
  return (
    <span className="mt-1 block text-[11.5px] text-muted">
      {ids.map((id, index) => {
        const ref = references[id];
        if (!ref) return null;
        return (
          <span key={id}>
            {index > 0 ? " · " : ""}
            <a href={ref.url} target="_blank" rel="noreferrer" className="underline decoration-line decoration-dotted underline-offset-2 hover:text-ink">
              {ref.label}
            </a>
            {ref.evidence === "resumo" ? " (resumo)" : ref.evidence === "fonte secundária" ? " (fonte secundária)" : ""}
          </span>
        );
      })}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <Lbl>{title}</Lbl>
      {children}
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-[14.5px] leading-[1.45] text-ink">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rose" />
          {item}
        </li>
      ))}
    </ul>
  );
}

function ToggleChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cx("rounded-full border px-3.5 py-2 text-[13.5px] font-semibold transition-colors", on ? "border-transparent bg-ink text-on-ink" : "border-line bg-surface text-ink active:bg-surface-alt")}>
      {children}
    </button>
  );
}

type Variant = "sheet" | "panel";

/** Header shared by the structure and landmark cards. */
function CardHeader({ color, eyebrow, title, subtitle, onClose, onFocus }: { color: string; eyebrow: string; title: string; subtitle?: string; onClose: () => void; onFocus?: () => void }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
          <Lbl className="truncate">{eyebrow}</Lbl>
        </div>
        <h2 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.7px] text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {onFocus && <Circ icon="focus" size={40} iconSize={19} onClick={onFocus} label="Enquadrar no modelo" />}
      <Circ icon="x" size={40} iconSize={18} onClick={onClose} label="Fechar ficha" />
    </div>
  );
}

/** Anatomical card of the selected structure (or portion): actions, summary, relations and surgical relevance. */
export function StructureCard({ ctl, variant = "sheet" }: { ctl: ViewerController; variant?: Variant }) {
  const structure = ctl.selected;
  const [tab, setTab] = useState<Tab>("resumo");
  const [viewsOpen, setViewsOpen] = useState(false);
  if (!structure) return null;
  const part = ctl.selectedPart;
  const info = modelStructures.find((item) => item.id === structure);
  const partInfo = part ? partById.get(part) : undefined;
  const detail: AnatomyDetail | undefined = (part && (partDetails[part] ?? regionDetail(part, partInfo?.label ?? ""))) || anatomyDetails[structure];
  const parts = partsOf(structure);
  const attachments = attachmentsFor(structure, part);
  const literature = literatureByStructure[structure];
  const meshes = modelMeshes.filter((mesh) => mesh.structure === structure);
  const related = manipulations.filter((m) => m.kind !== "retract" && m.structures.includes(structure));
  const retract = ctl.dissection.retracted[structure] ?? 0;
  const appearsIn = viewsOfStructure(structure);
  const translucent = ctl.userTranslucent.includes(structure);
  const isolated = ctl.visibleCount <= 1;
  const attachmentsShown = ctl.attachmentFocus === structure;
  const proximityShown = Boolean(ctl.study.proximity?.includes(structure));
  const fibresShown = ctl.study.fibres !== "off";

  const actions: { id: string; icon: IconName; label: string; on?: boolean; run: () => void }[] = [
    { id: "isolate", icon: "isolate", label: isolated ? "Mostrar" : "Isolar", on: isolated, run: () => (isolated ? ctl.showViewStructures() : ctl.isolate(structure)) },
    { id: "hide", icon: "eyeOff", label: "Ocultar", run: () => ctl.hideStructure(structure) },
    { id: "translucent", icon: "eye", label: "Transparência", on: translucent, run: () => ctl.toggleTranslucent(structure) },
    { id: "note", icon: "pen", label: "Anotar", run: () => ctl.startNote({ onStructure: true }) },
  ];

  return (
    <article className="flex flex-col">
      <CardHeader color={toneOfGroup(info?.group)} eyebrow={partInfo ? info?.label ?? "" : info?.group ?? "Estrutura"} title={partInfo ? partTitle(partInfo.label) : info?.label ?? structure} onClose={ctl.deselect} onFocus={() => ctl.focusStructure(structure)} />
      <div className={cx("flex gap-2", variant === "sheet" ? "pt-4" : "pt-4")}>
        {actions.map((action, index) =>
          variant === "sheet" ? (
            <button
              key={action.id}
              type="button"
              onClick={action.run}
              aria-pressed={action.on}
              className={cx("flex flex-1 flex-col items-center gap-1.5 rounded-2xl py-[11px] transition-colors", (index === 0 && !isolated) || action.on ? "bg-ink text-on-ink" : "border border-line-soft bg-surface-alt text-ink active:bg-warm")}
            >
              <Icon name={action.icon} size={20} />
              <span className="text-xs font-semibold">{action.label}</span>
            </button>
          ) : (
            <button
              key={action.id}
              type="button"
              onClick={action.run}
              aria-pressed={action.on}
              title={action.label}
              className={cx("flex h-[38px] flex-1 items-center justify-center gap-1.5 rounded-[11px] text-[13px] font-semibold transition-colors", (index === 0 && !isolated) || action.on ? "bg-ink text-on-ink" : "bg-surface-alt text-ink active:bg-warm")}
            >
              <Icon name={action.icon} size={16} />
              {action.id === "translucent" ? "Transp." : action.label}
            </button>
          ),
        )}
      </div>
      {(info?.schematic || info?.plan) && (
        <p className={cx("mt-3 rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-snug", info.schematic ? "bg-amber-tint text-amber-deep" : "bg-sage-tint text-sage-deep")}>
          {info.schematic ? (
            <>
              <b>Estrutura esquemática.</b> Traçada pela literatura sobre marcos das malhas reais do modelo; mostra o trajeto típico, não a anatomia de uma pessoa.
            </>
          ) : (
            <>
              <b>Plano cirúrgico.</b> Marcação, peça ou passo gerado sobre a mama do modelo em pé, na forma em que a técnica foi planejada (graus de ptose I a III, G3 ou G4). Não substitui o planejamento do caso.
            </>
          )}
        </p>
      )}
      <div className="mt-4 flex gap-[22px] border-b border-line-soft" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cx("-mb-px border-b-2 pb-3 pt-2.5 text-[15px] font-semibold transition-colors", tab === item.id ? "border-ink text-ink" : "border-transparent text-muted")}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-[18px] pt-4">
        {tab === "resumo" && (
          <>
            {detail ? <p className="text-[14.5px] leading-normal text-ink-2">{detail.summary}</p> : <p className="text-sm text-muted">Sem ficha descritiva para esta estrutura.</p>}
            {parts.length > 0 && (
              <Section title="Porções">
                <div className="flex flex-wrap gap-1.5">
                  <ToggleChip on={!part} onClick={() => ctl.setSelectedPart(null)}>
                    Inteiro
                  </ToggleChip>
                  {parts.map((item) => (
                    <ToggleChip key={item.id} on={part === item.id} onClick={() => ctl.setSelectedPart(item.id)}>
                      {item.label.split(" · ")[1] ?? item.label}
                    </ToggleChip>
                  ))}
                </div>
              </Section>
            )}
            {detail && (
              <dl className="flex flex-col gap-3.5">
                {fields.map(({ key, label }) =>
                  detail[key] ? (
                    <div key={key} className={variant === "sheet" ? "grid grid-cols-[96px_1fr] gap-2.5" : ""}>
                      <dt className={variant === "sheet" ? "text-[13px] font-semibold text-muted" : "text-xs font-semibold uppercase tracking-[0.8px] text-muted"}>{label}</dt>
                      <dd className={cx("text-[14.5px] leading-[1.45] text-ink", variant === "panel" && "mt-[3px]")}>{detail[key] as string}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
            )}
          </>
        )}
        {tab === "relacoes" && (
          <>
            {detail?.landmarks?.length ? (
              <Section title="Marcos anatômicos">
                <Bullets items={detail.landmarks} />
              </Section>
            ) : null}
            <Section title="No modelo">
              <div className="flex flex-wrap gap-2">
                {attachments.length > 0 && (
                  <ToggleChip on={attachmentsShown} onClick={() => ctl.showAttachments(attachmentsShown ? null : structure)}>
                    {attachmentsShown ? "Ocultar fixações" : "Ver fixações"}
                  </ToggleChip>
                )}
                {fibreStructures.has(structure) && (
                  <ToggleChip on={fibresShown} onClick={() => ctl.setStudy({ ...ctl.study, fibres: fibresShown ? "off" : "selected" })}>
                    Direção das fibras
                  </ToggleChip>
                )}
                {info && proximityGroups.has(info.group) && (
                  <ToggleChip on={proximityShown} onClick={() => ctl.setStudy({ ...ctl.study, proximity: proximityShown ? null : [structure] })}>
                    Mapa de distância
                  </ToggleChip>
                )}
              </div>
              {attachments.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {attachments.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 rounded-xl bg-surface-alt px-3 py-2 text-[13.5px] text-ink">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.kind === "origin" ? "#A4453E" : "#2a5bb8" }} />
                      <span className="min-w-0 flex-1">
                        {kindLabel[item.kind]} · {item.bone}
                        {item.part && !part && partById.get(item.part) ? <span className="text-muted"> · {partById.get(item.part)!.label.split(" · ")[1]}</span> : null}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{item.areaMm2.toLocaleString("pt-BR")} mm²</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Manipular">
                {related.map((m) => (
                  <label key={m.id} className="block text-[13.5px] text-ink-2">
                    {m.label}
                    <Range label={m.label} value={ctl.dissection.manipulations[m.id] ?? 0} onChange={(value) => ctl.setDissection({ ...ctl.dissection, manipulations: { ...ctl.dissection.manipulations, [m.id]: value } })} />
                  </label>
                ))}
                <label className="block text-[13.5px] text-ink-2">
                  Afastar (vista explodida)
                  <Range label="Afastar" value={retract} onChange={(value) => ctl.setDissection({ ...ctl.dissection, retracted: { ...ctl.dissection.retracted, [structure]: value } })} />
                </label>
            </Section>
            {appearsIn.length > 0 && (
              <div className="border-t border-line-soft pt-3 text-[13.5px] text-ink-2">
                Aparece em {appearsIn.length} {appearsIn.length === 1 ? "vista" : "vistas"} ·{" "}
                <button type="button" className="font-semibold text-ink" onClick={() => setViewsOpen((open) => !open)}>
                  {viewsOpen ? "ocultar lista" : "ver lista"}
                </button>
                {viewsOpen && (
                  <ul className="mt-2 flex flex-col">
                    {appearsIn.map(({ packId, viewIndex }) => {
                      const entry = allPacks.find((item) => item.pack.id === packId);
                      if (!entry) return null;
                      return (
                        <li key={`${packId}/${viewIndex}`}>
                          <button type="button" onClick={() => ctl.openGuided(packId, viewIndex)} className="flex w-full items-center gap-2 border-t border-line-soft py-2 text-left">
                            <Icon name="flow" size={16} color="#8C8389" />
                            <span className="min-w-0 flex-1 truncate">
                              <span className="font-semibold text-ink">{entry.pack.views[viewIndex].title}</span> <span className="text-muted">· {entry.pack.title}</span>
                            </span>
                            <Icon name="chevR" size={15} color="#B6ADB1" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
        {tab === "cirurgia" && (
          <>
            {detail?.surgical?.length ? (
              <Section title="Relevância cirúrgica">
                <Bullets items={detail.surgical} />
              </Section>
            ) : (
              <p className="text-sm text-muted">Sem notas cirúrgicas para esta estrutura.</p>
            )}
            {literature?.comparisons?.length ? (
              <Section title="Modelo × literatura">
                {literature.comparisons.map((row) => (
                  <div key={row.label} className="rounded-2xl bg-surface-alt px-3.5 py-3 text-[13.5px] text-ink">
                    <p className="text-[12.5px] font-semibold text-ink-2">{row.label}</p>
                    <div className="mt-1.5 grid grid-cols-2 gap-3">
                      <span>
                        <span className="block text-[10.5px] font-semibold uppercase tracking-[0.6px] text-muted">Modelo</span>
                        {row.model ?? "—"}
                      </span>
                      <span>
                        <span className="block text-[10.5px] font-semibold uppercase tracking-[0.6px] text-muted">Literatura</span>
                        {row.literature}
                      </span>
                    </div>
                    {row.note && <p className="mt-1.5 text-xs text-muted">{row.note}</p>}
                    <References ids={row.refs} />
                  </div>
                ))}
              </Section>
            ) : null}
            {literature?.variations?.length ? (
              <Section title="Variações">
                {literature.variations.map((row) => (
                  <div key={row.label} className="rounded-2xl bg-surface-alt px-3.5 py-3 text-[13.5px] text-ink">
                    <p className="text-[12.5px] font-semibold text-ink-2">{row.label}</p>
                    <p className="mt-1 leading-relaxed">{row.text}</p>
                    <References ids={row.refs} />
                  </div>
                ))}
              </Section>
            ) : null}
            <details className="text-[12.5px] text-muted">
              <summary className="cursor-pointer font-semibold text-ink-2">Fonte das malhas ({meshes.length})</summary>
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {meshes.map((mesh) => (
                  <li key={mesh.name}>
                    {displayName(mesh.sourceName)} · {mesh.source}
                    {mesh.fma ? ` · ${mesh.fma}` : ""} · {mesh.triangles.toLocaleString("pt-BR")} triângulos
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </div>
    </article>
  );
}

const categoryLabel = { osseo: "Marco ósseo", costela: "Costela", hilo: "Hilo neurovascular" } as const;
const structureLabel = new Map(modelStructures.map((item) => [item.id, item.label]));
const statusText: Record<ReviewStatus, string> = { ajustado: "Posição ajustada", confirmado: "Confirmado", incorreto: "Marcado como incorreto" };

/** Card of a bony landmark or computed hilum: nearby attachments, provenance and specialist review. */
export function LandmarkCard({ ctl }: { ctl: ViewerController }) {
  const id = ctl.selectedLandmark;
  const review = id ? ctl.review.store[id] : undefined;
  const [comment, setComment] = useState(review?.comment ?? "");
  const item = id ? landmarkById.get(id) : undefined;
  if (!id || !item) return null;
  const near = item.category === "hilo" ? [] : attachmentsNear(item, mm);
  const fit = boneFit[item.bone];
  const adjusting = ctl.adjusting === id;
  const setStatus = (status: ReviewStatus) => ctl.review.update(id, { status, comment: comment || undefined });
  const chip = "rounded-full border border-line bg-surface px-3.5 py-2 text-[13.5px] font-semibold text-ink active:bg-surface-alt";
  return (
    <article className="flex flex-col gap-4">
      <CardHeader
        color="#9C6E2E"
        eyebrow={`${categoryLabel[item.category]} · ${item.bone}`}
        title={item.name}
        subtitle={item.palpable ? "Palpável" : undefined}
        onClose={() => ctl.setSelectedLandmark(null)}
        onFocus={() => ctl.setFocusPoint(review?.point ?? item.point, item.structure)}
      />
      {item.note && <p className="text-[14.5px] leading-normal text-ink-2">{item.note}</p>}
      {near.length > 0 && (
        <Section title="Fixações musculares próximas">
          <ul className="flex flex-col gap-1.5">
            {near.map((att) => (
              <li key={att.id}>
                <button
                  type="button"
                  onClick={() => {
                    ctl.setSelectedLandmark(null);
                    ctl.openDetails(att.muscle);
                    ctl.setSelectedPart(att.part);
                  }}
                  className="flex w-full items-center gap-2 rounded-xl bg-surface-alt px-3 py-2 text-left text-[13.5px] text-ink active:bg-warm"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: att.kind === "origin" ? "#A4453E" : "#2a5bb8" }} />
                  <span className="min-w-0 flex-1">
                    {(att.part && partById.get(att.part)?.label) || structureLabel.get(att.muscle)} · {kindLabel[att.kind].toLowerCase()}
                  </span>
                  {att.source !== "Z-Anatomy" && <span className="text-[11px] font-semibold text-amber-deep">calculado</span>}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Origem do dado">
        <p className="text-[13px] leading-snug text-ink-2">
          {item.source === "Z-Anatomy"
            ? `Marco do Z-Anatomy transferido para o osso do modelo.${fit ? ` Ajuste do osso: erro mediano ${fit.medianMm.toLocaleString("pt-BR")} mm (p95 ${fit.p95Mm.toLocaleString("pt-BR")} mm).` : ""}${typeof item.sourceOffsetMm === "number" ? ` Projetado na superfície (deslocamento ${item.sourceOffsetMm.toLocaleString("pt-BR")} mm).` : ""}`
            : "Calculado a partir das malhas do modelo (BodyParts3D). Confira com a sua experiência e corrija na revisão."}
        </p>
      </Section>
      <Section title="Revisão do especialista">
        {review && (
          <p className={cx("text-[13px] font-semibold", reviewTone[review.status])}>
            {statusText[review.status]} · {new Date(review.at).toLocaleDateString("pt-BR")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip} onClick={() => setStatus("confirmado")}>
            Confirmar
          </button>
          <button type="button" className={cx(chip, adjusting && "border-transparent bg-ink text-on-ink")} onClick={() => ctl.setAdjusting(adjusting ? null : id)}>
            {adjusting ? "Toque no osso…" : "Ajustar posição"}
          </button>
          <button type="button" className={chip} onClick={() => setStatus("incorreto")}>
            Incorreto
          </button>
          {review && (
            <button type="button" className={chip} onClick={() => ctl.review.update(id, null)}>
              Limpar
            </button>
          )}
        </div>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          onBlur={() => review && ctl.review.update(id, { comment: comment || undefined })}
          placeholder="Comentário (opcional)"
          rows={2}
          className="w-full resize-none rounded-2xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-ink"
        />
      </Section>
    </article>
  );
}
