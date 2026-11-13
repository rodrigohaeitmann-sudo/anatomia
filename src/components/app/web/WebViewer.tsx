"use client";

import { useEffect, useRef, useState } from "react";
import { Cover } from "@/components/ui/Cover";
import { Icon } from "@/components/ui/Icon";
import { Btn, Circ, cx, Empty, Lbl, ModeToggle, ToolButton } from "@/components/ui/kit";
import { dockTools, modeOptions, toolBadge } from "../mobile/MobileViewer";
import type { AppNav } from "../nav";
import { ViewerPrompts } from "../Prompts";
import { MoreList, NoteCard, ViewDetails, usePackProgress } from "../shared";
import { LandmarkCard, StructureCard } from "../StructureCard";
import { ToolBody } from "../ToolBody";
import { toolMeta } from "../ToolPanels";
import type { ViewerController } from "../useViewerController";

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Keyboard of the viewer: ← → views, L labels, A note, R centre, F focus, Esc closes. */
function useViewerKeys(ctl: ViewerController, setFocus: (update: (on: boolean) => boolean) => void) {
  const latest = useRef(ctl);
  latest.current = ctl;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const c = latest.current;
      switch (event.key) {
        case "ArrowRight":
          if (!c.free) c.nextView();
          break;
        case "ArrowLeft":
          if (!c.free) c.prevView();
          break;
        case "l":
        case "L":
          c.toggleLabels();
          break;
        case "a":
        case "A":
          if (c.tool !== "note") c.openTool("note");
          break;
        case "r":
        case "R":
          c.resetCamera();
          break;
        case "f":
        case "F":
          setFocus((on) => !on);
          break;
        case "Escape":
          if (c.tool === "note") c.cancelNote();
          else if (c.tool && !c.free) c.setTool(null);
          else if (c.selected || c.selectedLandmark) c.deselect();
          else setFocus(() => false);
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setFocus]);
}

function TopBar({ ctl, nav, menu, onMenu }: { ctl: ViewerController; nav: AppNav; menu: boolean; onMenu: (open: boolean) => void }) {
  return (
    <header className="relative z-40 flex h-[60px] shrink-0 items-center gap-3.5 border-b border-line bg-surface px-5">
      <button type="button" onClick={() => (ctl.free ? nav.go({ name: "home" }) : nav.go({ name: "library", group: ctl.group.id }))} className="text-sm text-muted hover:text-ink">
        {ctl.free ? "Modo livre" : ctl.group.title}
      </button>
      <Icon name="chevR" size={14} color="#B6ADB1" />
      <h1 className="min-w-0 truncate text-base font-semibold">{ctl.free ? "Modelo completo" : ctl.pack.title}</h1>
      <div className="flex-1" />
      <ModeToggle options={modeOptions} value={ctl.mode} onChange={ctl.setMode} className="[&>button]:px-4 [&>button]:py-[7px] [&>button]:text-[13.5px]" />
      <Btn variant="ghost" full={false} leading="present" className="h-10 gap-2 px-3.5 text-sm" onClick={() => nav.present(true)}>
        Modo aula
      </Btn>
      <Circ icon="more" size={40} onClick={() => onMenu(!menu)} label="Mais ferramentas" active={menu} />
      {menu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => onMenu(false)} aria-hidden />
          <div className="absolute right-5 top-[56px] z-40 w-[360px] rounded-[18px] border border-line bg-surface px-4 py-2 shadow-menu" role="menu">
            <MoreList
              ctl={ctl}
              onTool={(tool) => {
                ctl.setTool(tool);
                onMenu(false);
              }}
            />
            <button type="button" onClick={() => nav.go({ name: "profile" })} className="flex w-full items-center gap-3 border-t border-line-soft py-3 text-left text-[14.5px] font-semibold">
              <Icon name="info" size={19} color="#8E5C68" />
              Sobre o modelo e créditos
            </button>
          </div>
        </>
      )}
    </header>
  );
}

function ViewList({ ctl }: { ctl: ViewerController }) {
  const progress = usePackProgress(ctl.pack.id);
  const noteCount = ctl.viewNotes.length;
  return (
    <aside aria-label="Vistas do pack" className="flex w-[280px] shrink-0 flex-col border-r border-line bg-surface narrow:w-[236px]">
      <div className="px-[18px] pb-3 pt-[18px]">
        <Lbl>
          {ctl.pack.views.length} vistas · {progress.count} já {progress.count === 1 ? "vista" : "vistas"}
        </Lbl>
      </div>
      <div className="flex flex-col overflow-y-auto pb-4">
        {ctl.pack.views.map((view, index) => {
          const here = index === ctl.viewIndex;
          const seen = progress.seen.includes(view.id);
          return (
            <button key={view.id} type="button" onClick={() => ctl.setViewIndex(index)} aria-current={here ? "step" : undefined} className={cx("mx-2 flex items-center gap-3 rounded-[14px] px-3.5 py-[9px] text-left transition-colors", here ? "bg-warm" : "hover:bg-surface-alt")}>
              <Cover packId={ctl.pack.id} groupId={ctl.group.id} viewId={view.id} className="h-[52px] w-[52px]" rounded="rounded-[11px]" />
              <span className="min-w-0 flex-1">
                <span className={cx("block text-[14.5px] leading-snug", here ? "font-semibold" : "font-medium")}>{view.title}</span>
                <span className="block text-xs text-muted">{here ? `Atual${noteCount ? ` · ${noteCount} ${noteCount === 1 ? "nota" : "notas"}` : ""}` : `Vista ${index + 1}`}</span>
              </span>
              {seen && !here && <Icon name="check" size={16} stroke={2} color="#3F5E51" />}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function ViewInfo({ ctl }: { ctl: ViewerController }) {
  const next = ctl.pack.views[ctl.viewIndex + 1];
  return (
    <>
      <div className="flex flex-col gap-4 overflow-y-auto px-6 pb-4 pt-[22px]">
        <div>
          <Lbl className="text-rose-deep">
            Vista {ctl.viewIndex + 1} de {ctl.pack.views.length}
          </Lbl>
          <h2 className="mt-1 text-[28px] font-semibold leading-tight tracking-[-0.8px]">{ctl.view.title}</h2>
        </div>
        <ViewDetails ctl={ctl} />
      </div>
      <div className="mt-auto shrink-0 border-t border-line-soft px-6 pb-4 pt-3.5">
        <div className="flex gap-2.5">
          <Btn variant="warm" full={false} className="h-12 w-14" onClick={ctl.prevView} disabled={ctl.viewIndex === 0} aria-label="Vista anterior">
            <Icon name="arrowL" size={19} />
          </Btn>
          <Btn icon={next ? "arrowR" : undefined} className="h-12 min-w-0 text-[15px]" onClick={ctl.nextView} disabled={!next}>
            <span className="truncate">{next ? next.title : "Última vista do pack"}</span>
          </Btn>
        </div>
        <div className="mt-2.5 text-center text-[12.5px] text-muted">← → troca de vista · L rótulos · A anotar</div>
      </div>
    </>
  );
}

function FreeHint({ ctl, nav }: { ctl: ViewerController; nav: AppNav }) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <Empty icon="cube" title="Toque em uma estrutura" sub="A ficha abre aqui: origem, inserção, inervação, irrigação, relações e relevância cirúrgica. Use as ferramentas à esquerda para camadas, corte, forma e braço." />
      {ctl.viewNotes.length > 0 && (
        <div className="flex flex-col gap-3 px-6 pb-6">
          <Lbl>Suas notas no modo livre</Lbl>
          {ctl.viewNotes.map((note) => (
            <NoteCard key={note.id} note={note} compact onOpen={() => nav.openNote(note)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Header (eyebrow, title, action, close) and body of the open tool. */
function ToolFrame({ ctl, closable = true }: { ctl: ViewerController; closable?: boolean }) {
  const meta = toolMeta(ctl);
  if (!meta) return null;
  return (
    <>
      <div className="flex shrink-0 items-center gap-3 px-5 pb-1 pt-4">
        <div className="min-w-0 flex-1">
          <Lbl className="text-rose-deep">{meta.eyebrow}</Lbl>
          <div className="mt-0.5 truncate text-lg font-semibold tracking-[-0.3px]">{meta.title}</div>
        </div>
        {meta.action && (
          <button type="button" onClick={meta.action.run} className="shrink-0 text-sm font-semibold text-ink-2 hover:text-ink">
            {meta.action.label}
          </button>
        )}
        {closable && <Circ icon="x" size={34} iconSize={16} onClick={() => (ctl.tool === "note" ? ctl.cancelNote() : ctl.setTool(null))} label="Fechar ferramenta" />}
      </div>
      <div className="min-h-0 overflow-y-auto px-5 pb-5 pt-3">
        <ToolBody ctl={ctl} wide />
      </div>
    </>
  );
}

/** Desktop viewer, "three panels" layout: views | model with tools | view text or anatomical card. */
export function WebViewer({ ctl, nav }: { ctl: ViewerController; nav: AppNav }) {
  const [focus, setFocus] = useState(false);
  const [menu, setMenu] = useState(false);
  useViewerKeys(ctl, setFocus);
  const card = Boolean(ctl.selected || ctl.selectedLandmark);
  // the free mode keeps a tool in its left column (Camadas by default)
  useEffect(() => {
    if (ctl.free && !ctl.tool) ctl.setTool("layers");
  }, [ctl, ctl.free, ctl.tool]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <TopBar ctl={ctl} nav={nav} menu={menu} onMenu={setMenu} />
      <div className="flex min-h-0 flex-1">
        {!focus &&
          (ctl.free ? (
            <aside aria-label="Ferramentas" className="flex w-[300px] shrink-0 flex-col border-r border-line bg-surface">
              <div className="grid shrink-0 grid-cols-5 gap-0.5 border-b border-line-soft px-2 py-2">
                {dockTools.map((item) => (
                  <ToolButton key={item.id} icon={item.icon} label={item.label} on={ctl.tool === item.id || (item.id === "layers" && ctl.tool === "structures")} badge={toolBadge(ctl, item.id)} onClick={() => (item.id === "note" ? ctl.openTool("note") : ctl.setTool(item.id))} />
                ))}
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                <ToolFrame ctl={ctl} closable={ctl.tool !== "layers"} />
              </div>
            </aside>
          ) : (
            <ViewList ctl={ctl} />
          ))}
        <div className="relative min-w-0 flex-1">
          {ctl.renderViewer("desktop", { top: 0, bottom: ctl.free ? 16 : 92, right: 72 })}
          <div className="absolute right-[18px] top-[18px] z-20 flex flex-col gap-2">
            <Circ icon="rotate" tone="glass" size={40} iconSize={18} onClick={ctl.resetCamera} label="Centralizar o modelo (R)" />
            <Circ icon={ctl.labelsHidden ? "eyeOff" : "label"} tone="glass" size={40} iconSize={18} onClick={ctl.toggleLabels} label={ctl.labelsHidden ? "Mostrar rótulos (L)" : "Ocultar rótulos (L)"} />
            <Circ icon={focus ? "collapse" : "expand"} tone="glass" size={40} iconSize={18} onClick={() => setFocus((on) => !on)} label={focus ? "Mostrar painéis (F)" : "Foco no modelo (F)"} />
          </div>
          <ViewerPrompts ctl={ctl} top={18} className="left-[18px] right-[80px] mx-auto max-w-[560px]" />
          {!ctl.free && (
            <>
              {ctl.tool && (
                <section aria-label={toolMeta(ctl)?.title} className="absolute bottom-[86px] left-1/2 z-30 flex max-h-[calc(100%-120px)] w-[400px] -translate-x-1/2 flex-col rounded-[22px] border border-line bg-surface shadow-menu">
                  <ToolFrame ctl={ctl} />
                </section>
              )}
              <nav aria-label="Ferramentas" className="absolute bottom-[18px] left-1/2 z-20 flex -translate-x-1/2 gap-0.5 rounded-[18px] border border-line bg-surface p-[5px] shadow-card">
                {dockTools.map((item) => (
                  <ToolButton key={item.id} row icon={item.icon} label={item.label} on={ctl.tool === item.id || (item.id === "layers" && ctl.tool === "structures")} badge={toolBadge(ctl, item.id)} onClick={() => ctl.openTool(item.id)} />
                ))}
              </nav>
            </>
          )}
        </div>
        {!focus && (
          <aside aria-label={card ? "Ficha anatômica" : "Vista"} className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface narrow:w-[320px]">
            {card ? (
              <div className="overflow-y-auto px-6 pb-6 pt-[22px]">{ctl.selectedLandmark ? <LandmarkCard key={ctl.selectedLandmark} ctl={ctl} /> : <StructureCard key={`${ctl.selected}`} ctl={ctl} variant="panel" />}</div>
            ) : ctl.free ? (
              <FreeHint ctl={ctl} nav={nav} />
            ) : (
              <ViewInfo ctl={ctl} />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
