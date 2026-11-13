"use client";

import { useMemo } from "react";
import { surgicalSpaces } from "@/data/surgicalSpaces";
import { allPacks, packEntry } from "@/lib/catalog";
import { hybridTorsoModel, modelStructures } from "@/lib/modelConfig";
import { FREE_PACK, useNotes, useProgress, useSettings, type Note, type TextSize } from "@/lib/store";
import { relativeDay } from "@/lib/text";
import { Cover } from "@/components/ui/Cover";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Circ, cx, Dots, Lbl, Stat, Switch } from "@/components/ui/kit";
import { breastShort, breastStats, poseShort } from "./ToolPanels";
import type { ToolId, ViewerController } from "./useViewerController";

export const textSizes: Record<TextSize, string> = { s: "text-[13.5px]", m: "text-[14.5px]", l: "text-[16px]" };
export const presentSizes: Record<TextSize, string> = { s: "text-[16px]", m: "text-[19px]", l: "text-[22px]" };

/** "Continue where I left off": the last guided view, or the first pack for a first visit. */
export function useContinue() {
  const progress = useProgress();
  const notes = useNotes();
  return useMemo(() => {
    const last = progress.last;
    const entry = (last && packEntry(last.packId)) || allPacks[0];
    const index = last && entry.pack.id === last.packId ? Math.max(0, entry.pack.views.findIndex((view) => view.id === last.viewId)) : 0;
    const view = entry.pack.views[index];
    const breast = last ? last.breast : view.breast ?? null;
    const pose = last ? last.pose : view.pose ?? null;
    const noteCount = notes.filter((note) => note.packId === entry.pack.id && note.viewId === view.id).length;
    const meta = [`Forma ${breastShort(breast).toLowerCase()}`, pose ? `braço: ${poseShort(pose).toLowerCase()}` : "braço anatômico", noteCount ? `${noteCount} ${noteCount === 1 ? "anotação sua" : "anotações suas"}` : null].filter(Boolean).join(" · ");
    return { fresh: !last, group: entry.group, pack: entry.pack, view, index, breast, pose, meta };
  }, [progress.last, notes]);
}

/** Views seen in a pack and where the user stopped. */
export function usePackProgress(packId: string) {
  const progress = useProgress();
  const entry = packEntry(packId);
  const seen = progress.visited[packId] ?? [];
  const total = entry?.pack.views.length ?? 0;
  const lastIndex = progress.last?.packId === packId ? entry?.pack.views.findIndex((view) => view.id === progress.last!.viewId) ?? -1 : -1;
  return { seen, count: seen.length, total, percent: total ? Math.round((seen.length / total) * 100) : 0, lastIndex };
}

export function ViewText({ ctl, clamp, className }: { ctl: ViewerController; clamp?: number; className?: string }) {
  const settings = useSettings();
  return (
    <p className={cx("text-pretty leading-normal text-ink-2", textSizes[settings.textSize], className)} style={clamp ? { display: "-webkit-box", WebkitLineClamp: clamp, WebkitBoxOrient: "vertical", overflow: "hidden" } : undefined}>
      {ctl.view.description}
    </p>
  );
}

/** Previous / title with progress dots / next. */
export function ViewNav({ ctl, className }: { ctl: ViewerController; className?: string }) {
  const count = ctl.pack.views.length;
  return (
    <div className={cx("flex items-center gap-2.5 rounded-[22px] border border-line bg-surface p-2 shadow-card", className)}>
      <Circ icon="chevL" tone="warm" onClick={ctl.prevView} disabled={ctl.viewIndex === 0} label="Vista anterior" />
      <div className="min-w-0 flex-1 text-center">
        <div className="truncate text-base font-semibold">{ctl.view.title}</div>
        <div className="mt-1.5 flex justify-center">
          <Dots count={count} active={ctl.viewIndex} />
        </div>
      </div>
      <Circ icon="chevR" tone="ink" onClick={ctl.nextView} disabled={ctl.viewIndex >= count - 1} label="Próxima vista" />
    </div>
  );
}

/** Numbered legend of the pins of the view ("Nesta vista"). */
export function ViewLegend({ ctl }: { ctl: ViewerController }) {
  if (!ctl.entries.length) return null;
  return (
    <div>
      <Lbl className="mb-2">Nesta vista</Lbl>
      {ctl.entries.map((entry) => {
        const on = ctl.activePin === entry.key;
        return (
          <button key={entry.key} type="button" onClick={() => ctl.pickLegend(entry)} className={cx("flex w-full items-center gap-2.5 border-t border-line-soft py-2 text-left", on && "text-rose-deep")}>
            <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[11.5px] font-bold text-on-ink" style={{ background: on ? "#8E5C68" : entry.kind === "label" ? "#221C20" : entry.color }}>
              {entry.number}
            </span>
            <span className="min-w-0 flex-1 text-[14.5px] font-medium leading-snug">
              {entry.text}
              {entry.group && <span className="block text-xs font-normal text-muted">{entry.group}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Measurements of the breast in views about its shape (ptosis), as on the model. */
export function ViewMeasures({ ctl, columns = 2 }: { ctl: ViewerController; columns?: 2 | 4 }) {
  if (!ctl.breastSettled && !ctl.view.breast) return null;
  const stats = breastStats(ctl.breastSettled);
  return (
    <div className={cx("grid gap-3 rounded-2xl bg-surface-alt px-4 py-3.5", columns === 4 ? "grid-cols-4" : "grid-cols-2")}>
      {stats.map((item) => (
        <Stat key={item.label} label={item.label} value={item.value} unit={item.unit} size={20} />
      ))}
    </div>
  );
}

/** Everything the view has to say: text, legend, measurements, spatial relations and its structures. */
export function ViewDetails({ ctl, showText = true }: { ctl: ViewerController; showText?: boolean }) {
  const space = surgicalSpaces.find((item) => item.id === ctl.view.space);
  const shown = [...new Set([...ctl.view.structures, ...(space ? [...space.walls.flatMap((wall) => wall.structures), ...space.contents] : [])])].filter((id) => !space?.hide?.includes(id));
  return (
    <div className="flex flex-col gap-5">
      {showText && <ViewText ctl={ctl} />}
      <ViewLegend ctl={ctl} />
      <ViewMeasures ctl={ctl} />
      {(ctl.view.relations.length > 0 || space) && (
        <div>
          <Lbl className="mb-2">Relações</Lbl>
          <ul className="flex flex-col gap-2">
            {[...ctl.view.relations, ...(space?.pearls ?? [])].map((item) => (
              <li key={item} className="flex gap-2.5 text-sm leading-[1.45] text-ink-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rose" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!ctl.free && (
        <div>
          <Lbl className="mb-2">Estruturas nesta vista</Lbl>
          <div className="flex flex-wrap gap-1.5">
            {shown.map((id) => {
              const structure = modelStructures.find((item) => item.id === id);
              if (!structure) return null;
              return (
                <button key={id} type="button" onClick={() => ctl.openDetails(id)} className={cx("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-medium", id === ctl.selected ? "border-transparent bg-ink text-on-ink" : "border-line bg-surface text-ink-2")}>
                  <span className="h-2 w-2 rounded-full shadow-[inset_0_0_0_1px_rgba(34,28,32,.18)]" style={{ background: structure.color }} />
                  {structure.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

type MoreItem = { id: string; icon: IconName; label: string; sub: string; tool?: ToolId; on?: boolean; toggle?: () => void };

/** Panels and switches that do not fit the five tools: study layers, dissection, single structures, skin, vessels. */
export function moreItems(ctl: ViewerController): MoreItem[] {
  return [
    { id: "study", icon: "study", label: "Estudo", sub: "Marcos ósseos, fibras, zonas de perfurantes, régua e autoavaliação", tool: "study" },
    { id: "dissection", icon: "scalpel", label: "Dissecção", sub: "Profundidade, janelas de pele, rebater estruturas e espaços cirúrgicos", tool: "dissection" },
    { id: "structures", icon: "layers", label: "Estruturas", sub: "Ligar e desligar cada estrutura do modelo", tool: "structures" },
    { id: "skin", icon: "skin", label: "Pele", sub: "Mostrar a pele do tronco", on: Boolean(ctl.visibility.skin), toggle: () => ctl.toggleStructure("skin") },
    { id: "neuro", icon: "vessel", label: "Vasos e nervos", sub: "Acrescentar os feixes neurovasculares à vista", on: ctl.neuro, toggle: ctl.toggleNeuro },
    { id: "focus", icon: "target", label: "Foco cirúrgico", sub: "Destaca as estruturas da vista e esmaece o resto", on: ctl.viewMode === "surgical", toggle: () => ctl.setViewMode(ctl.viewMode === "surgical" ? "anatomical" : "surgical") },
  ];
}

export function MoreList({ ctl, onTool }: { ctl: ViewerController; onTool: (tool: ToolId) => void }) {
  return (
    <div className="flex flex-col">
      {moreItems(ctl).map((item, index) => (
        <div key={item.id} className={cx("flex items-center gap-3 py-3", index > 0 && "border-t border-line-soft")}>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-tint text-rose-deep">
            <Icon name={item.icon} size={19} />
          </div>
          {item.toggle ? (
            <>
              <div className="min-w-0 flex-1">
                <div className="text-[15.5px] font-semibold">{item.label}</div>
                <div className="text-[13px] leading-snug text-muted">{item.sub}</div>
              </div>
              <Switch on={Boolean(item.on)} onChange={() => item.toggle!()} label={item.label} />
            </>
          ) : (
            <button type="button" onClick={() => onTool(item.tool!)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <div className="min-w-0 flex-1">
                <div className="text-[15.5px] font-semibold">{item.label}</div>
                <div className="text-[13px] leading-snug text-muted">{item.sub}</div>
              </div>
              <Icon name="chevR" size={17} color="#B6ADB1" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Model description, credits and licences. */
export function AboutContent() {
  return (
    <div className="flex flex-col gap-5 text-[14.5px] leading-relaxed text-ink-2">
      <section>
        <Lbl className="mb-1.5">Como usar</Lbl>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>Arraste para girar, pince ou role para aproximar, dois dedos (ou botão direito) para deslocar.</li>
          <li>Toque numa estrutura para abrir a ficha. Os pinos numerados são os rótulos da vista.</li>
          <li>No modo guiado as vistas trazem câmera, rótulos e texto prontos; no modo livre o modelo inteiro fica aberto.</li>
        </ul>
      </section>
      <section>
        <Lbl className="mb-1.5">Modelo</Lbl>
        <p>
          Modelo híbrido feminino com {(hybridTorsoModel.totalTriangles / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} milhões de triângulos: pele e mamas do Visible Human Female (HRA/NIH); esqueleto, músculos, vasos e nervos do BodyParts3D 4.3 (DBCLS); grande dorsal do
          BodyParts3D 3.0; linfonodos e fáscias do Z-Anatomy. As malhas vêm de exames e atlas publicados. A exceção, marcada como esquemática, são os ramos vasculares e nervosos que entram na mama, o septo de Würinger e seus ligamentos, traçados pela
          literatura sobre marcos das malhas reais.
        </p>
      </section>
      <section>
        <Lbl className="mb-1.5">Créditos e licenças</Lbl>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>HRA / NIH Visible Human Female — CC BY 4.0</li>
          <li>BodyParts3D, © The Database Center for Life Science</li>
          <li>Z-Anatomy — CC BY-SA 4.0</li>
          <li>Obra derivada distribuída sob CC BY-SA 4.0</li>
        </ul>
      </section>
      <p className="rounded-2xl bg-amber-tint px-4 py-3 text-[13px] text-amber-deep">Conteúdo didático. Textos, zonas e relações devem ser revisados por especialistas antes de uso formal ou clínico.</p>
    </div>
  );
}

/** Where a note lives (pack and view titles), for lists. */
export function noteWhere(note: Note) {
  if (note.packId === FREE_PACK) return { packTitle: "Modo livre", viewTitle: "Modelo completo", groupId: "parede-ombro", index: -1 };
  const entry = packEntry(note.packId);
  const index = entry ? entry.pack.views.findIndex((view) => view.id === note.viewId) : -1;
  return { packTitle: entry?.pack.title ?? note.packId, viewTitle: index >= 0 ? entry!.pack.views[index].title : note.viewId, groupId: entry?.group.id ?? "mama", index };
}

export function NoteCard({ note, onOpen, compact = false }: { note: Note; onOpen: () => void; compact?: boolean }) {
  const where = noteWhere(note);
  const structure = note.structure ? modelStructures.find((item) => item.id === note.structure)?.label : null;
  return (
    <button type="button" onClick={onOpen} className="flex w-full gap-3 rounded-card border border-line bg-surface p-3 text-left shadow-card active:bg-surface-alt">
      <Cover packId={note.packId} groupId={where.groupId} viewId={note.viewId} className={compact ? "h-[72px] w-[64px]" : "h-[84px] w-[72px]"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Lbl className="min-w-0 flex-1 truncate text-rose-deep">
            {where.packTitle} · {where.viewTitle}
          </Lbl>
          <span className="shrink-0 text-xs text-muted">{relativeDay(note.updatedAt)}</span>
        </div>
        <p className="mt-1.5 text-[14.5px] leading-[1.4] text-ink" style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {note.text}
        </p>
        {structure && <p className="mt-1 truncate text-xs text-muted">{structure}</p>}
      </div>
    </button>
  );
}
