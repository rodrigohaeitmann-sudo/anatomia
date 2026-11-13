"use client";

import { useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Circ, cx, ModeToggle, ToolButton } from "@/components/ui/kit";
import type { AppNav } from "../nav";
import { ViewerPrompts } from "../Prompts";
import { MoreList, ViewDetails, ViewNav, ViewText, usePackProgress } from "../shared";
import { LandmarkCard, StructureCard } from "../StructureCard";
import { ToolBody } from "../ToolBody";
import { toolMeta } from "../ToolPanels";
import { useElementSize } from "../useElementSize";
import type { StudyMode, ToolId, ViewerController } from "../useViewerController";
import { MSheet } from "./MobileScreens";

export const dockTools: { id: ToolId; icon: IconName; label: string }[] = [
  { id: "layers", icon: "layers", label: "Camadas" },
  { id: "cut", icon: "cut", label: "Corte" },
  { id: "shape", icon: "shape", label: "Forma" },
  { id: "arm", icon: "arm", label: "Braço" },
  { id: "note", icon: "pen", label: "Anotar" },
];
export const modeOptions: { value: StudyMode; label: string }[] = [
  { value: "guided", label: "Guiado" },
  { value: "free", label: "Livre" },
];

/** A tool whose effect is on while its panel is closed gets a dot (cut on, shape or arm changed, notes in the view). */
export function toolBadge(ctl: ViewerController, id: ToolId) {
  if (ctl.tool === id) return false;
  if (id === "cut") return Boolean(ctl.cut.axis);
  if (id === "shape") return ctl.breast !== (ctl.view.breast ?? null);
  if (id === "arm") return ctl.armPose !== (ctl.view.pose ?? null);
  if (id === "note") return ctl.viewNotes.length > 0;
  return false;
}

type Sheet = "views" | "info" | "more" | null;

/** Phone viewer, "dock" layout: the model fills the screen; title and mode on top, tools docked at the bottom. */
export function MobileViewer({ ctl, nav }: { ctl: ViewerController; nav: AppNav }) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const card = Boolean(ctl.selected || ctl.selectedLandmark) && ctl.tool !== "note";
  const overlay = !ctl.tool && !card;
  const top = useElementSize(topRef);
  const bottom = useElementSize(bottomRef, overlay);
  const cardSize = useElementSize(cardRef, card);
  const dock = useElementSize(dockRef);
  const topInset = (topRef.current?.offsetTop ?? 8) + top.height + 6;
  const bottomInset = card ? Math.max(0, cardSize.height - dock.height) : overlay ? bottom.height + 18 : 26;
  const meta = toolMeta(ctl);
  const progress = usePackProgress(ctl.pack.id);
  const leave = () => nav.back(ctl.free ? { name: "home" } : { name: "pack", packId: ctl.pack.id });
  const subtitle = ctl.free ? (ctl.tool === "layers" || ctl.tool === "structures" ? `Modo livre · ${ctl.visibleCount} de ${ctl.listedCount} visíveis` : ctl.draft?.awaitingPoint ? "Toque no modelo para marcar" : "Toque em uma estrutura") : `Vista ${ctl.viewIndex + 1} de ${ctl.pack.views.length}${ctl.draft ? " · anotando" : ""}`;

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-paper">
      <div className="relative min-h-0 flex-1">
        {ctl.renderViewer("mobile", { top: topInset, bottom: bottomInset, right: 64 })}
        <div ref={topRef} className="absolute inset-x-3.5 top-[calc(env(safe-area-inset-top)+8px)] z-20 flex items-center gap-2.5">
          <Circ icon="chevL" tone="glass" onClick={leave} label="Voltar" />
          <button
            type="button"
            onClick={() => (ctl.free ? setSheet("info") : setSheet("views"))}
            className="glass min-w-0 flex-1 rounded-full border border-line px-3.5 py-1.5 text-left shadow-glass"
            aria-label={ctl.free ? "Sobre o modo livre" : "Vistas do pack"}
          >
            <div className="truncate text-[14.5px] font-semibold">{ctl.free ? "Modo livre" : ctl.pack.title}</div>
            <div className="truncate text-xs text-muted">{subtitle}</div>
          </button>
          <ModeToggle glass options={modeOptions} value={ctl.mode} onChange={ctl.setMode} />
        </div>
        <div className="absolute right-3.5 z-20 flex flex-col gap-2.5 short:gap-1.5" style={{ top: topInset + 4 }}>
          <Circ icon="rotate" tone="glass" onClick={ctl.resetCamera} label="Centralizar o modelo" />
          <Circ icon={ctl.labelsHidden ? "eyeOff" : "label"} tone="glass" onClick={ctl.toggleLabels} label={ctl.labelsHidden ? "Mostrar rótulos" : "Ocultar rótulos"} active={false} />
          <Circ icon="present" tone="glass" onClick={() => nav.present(true)} label="Modo aula" />
          <Circ icon="more" tone="glass" onClick={() => setSheet("more")} label="Mais ferramentas" />
        </div>
        <ViewerPrompts ctl={ctl} top={topInset + 2} className="left-3.5 right-[70px]" />
        {overlay && (
          <div ref={bottomRef} className="absolute inset-x-3.5 bottom-3 z-20 mx-auto flex max-w-[560px] flex-col gap-2.5">
            {ctl.free ? (
              <div className="glass mx-auto flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-[13.5px] font-medium text-ink-2 shadow-glass">
                <Icon name="cube" size={17} />
                Toque em uma estrutura para abrir a ficha
              </div>
            ) : (
              <>
                <button type="button" onClick={() => setSheet("info")} className="rounded-[20px] border border-line bg-white/[0.92] px-4 py-3.5 text-left short:hidden" aria-label="Ler a vista completa">
                  <ViewText ctl={ctl} clamp={2} />
                </button>
                <ViewNav ctl={ctl} />
              </>
            )}
          </div>
        )}
      </div>
      {ctl.tool && meta && (
        <section aria-label={meta.title} className="relative z-10 -mt-[26px] flex max-h-[min(54dvh,480px)] shrink-0 flex-col rounded-t-[26px] bg-surface shadow-sheet">
          <div className="flex shrink-0 items-center gap-3 px-5 pb-1 pt-4">
            <div className="min-w-0 flex-1">
              <div className="text-[11.5px] font-semibold uppercase tracking-[1.5px] text-rose-deep">{meta.eyebrow}</div>
              <div className="mt-0.5 truncate text-xl font-semibold tracking-[-0.4px]">{meta.title}</div>
            </div>
            {meta.action && (
              <button type="button" onClick={meta.action.run} className="shrink-0 text-sm font-semibold text-ink-2">
                {meta.action.label}
              </button>
            )}
            <Circ icon="x" size={36} iconSize={16} onClick={() => (ctl.tool === "note" ? ctl.cancelNote() : ctl.setTool(null))} label="Fechar ferramenta" />
          </div>
          <div className="overflow-y-auto px-5 pb-4 pt-3">
            <ToolBody ctl={ctl} />
          </div>
        </section>
      )}
      <nav ref={dockRef} aria-label="Ferramentas" className="relative z-20 grid shrink-0 grid-cols-5 border-t border-line bg-surface px-2.5 pb-[max(6px,env(safe-area-inset-bottom))] pt-2">
        {dockTools.map((item) => (
          <ToolButton key={item.id} icon={item.icon} label={item.label} on={ctl.tool === item.id || (item.id === "layers" && ctl.tool === "structures")} badge={toolBadge(ctl, item.id)} onClick={() => ctl.openTool(item.id)} />
        ))}
      </nav>
      {card && (
        <section ref={cardRef} aria-label="Ficha anatômica" className="absolute inset-x-0 bottom-0 z-40 mx-auto flex max-h-[64dvh] max-w-[640px] flex-col rounded-t-[28px] bg-surface shadow-sheet-lg">
          <div className="flex shrink-0 justify-center pb-1 pt-2.5">
            <div className="h-[5px] w-11 rounded-[3px] bg-line" />
          </div>
          <div className="overflow-y-auto px-[22px] pb-[calc(18px+env(safe-area-inset-bottom))] pt-2">{ctl.selectedLandmark ? <LandmarkCard key={ctl.selectedLandmark} ctl={ctl} /> : <StructureCard key={`${ctl.selected}`} ctl={ctl} />}</div>
        </section>
      )}
      <MSheet open={sheet === "views"} onClose={() => setSheet(null)} eyebrow={ctl.group.title} title={ctl.pack.title}>
        <div className="flex flex-col">
          {ctl.pack.views.map((view, index) => {
            const here = index === ctl.viewIndex;
            const seen = progress.seen.includes(view.id);
            return (
              <button
                key={view.id}
                type="button"
                onClick={() => {
                  ctl.setViewIndex(index);
                  setSheet(null);
                }}
                className={cx("flex items-center gap-3.5 border-t border-line-soft py-3 text-left first:border-t-0", here && "font-semibold")}
              >
                <span className={cx("grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-[13px] font-bold", here ? "bg-ink text-on-ink" : seen ? "bg-sage-tint text-sage-deep" : "border border-line bg-surface-alt text-muted")}>
                  {seen && !here ? <Icon name="check" size={15} stroke={2.2} /> : index + 1}
                </span>
                <span className="min-w-0 flex-1 text-[15.5px] leading-snug">{view.title}</span>
              </button>
            );
          })}
        </div>
      </MSheet>
      <MSheet open={sheet === "info"} onClose={() => setSheet(null)} eyebrow={ctl.free ? "Modo livre" : `Vista ${ctl.viewIndex + 1} de ${ctl.pack.views.length}`} title={ctl.view.title}>
        <ViewDetails ctl={ctl} />
      </MSheet>
      <MSheet open={sheet === "more"} onClose={() => setSheet(null)} eyebrow="Visualizador" title="Mais ferramentas">
        <MoreList
          ctl={ctl}
          onTool={(tool) => {
            setSheet(null);
            ctl.setTool(tool);
          }}
        />
      </MSheet>
    </div>
  );
}
