"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { search, type SearchHit } from "@/lib/catalog";
import { Icon } from "@/components/ui/Icon";
import { cx, Empty, Highlight, Lbl } from "@/components/ui/kit";
import { openHit } from "../mobile/MobileScreens";
import type { AppNav } from "../nav";
import { WebPresent } from "../Present";
import type { ViewerController } from "../useViewerController";
import { WebSide } from "./WebSide";
import { WHome, WLibrary, WNotes, WSettings } from "./WebScreens";
import { WebViewer } from "./WebViewer";

const kindLabel: Record<SearchHit["kind"], string> = { structure: "Estrutura · modo livre", view: "Vista", pack: "Pack" };

/** ⌘K: structures, views and packs; arrows to move, Enter to open. */
function SearchPalette({ nav, onClose }: { nav: AppNav; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => search(query).slice(0, 12), [query]);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setIndex(0), [query]);
  const open = (hit: SearchHit) => {
    onClose();
    openHit(nav, hit);
  };
  return (
    <div className="fixed inset-0 z-[60] flex justify-center bg-[rgba(20,15,17,.35)] px-4 pt-[12vh]" onClick={onClose} role="dialog" aria-modal="true" aria-label="Buscar">
      <div className="flex max-h-[70vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[22px] border border-line bg-surface shadow-pop" onClick={(event) => event.stopPropagation()}>
        <label className="flex shrink-0 items-center gap-3 border-b border-line-soft px-5 py-4">
          <Icon name="search" size={20} color="#8C8389" />
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              else if (event.key === "ArrowDown") setIndex((value) => Math.min(hits.length - 1, value + 1));
              else if (event.key === "ArrowUp") setIndex((value) => Math.max(0, value - 1));
              else if (event.key === "Enter" && hits[index]) open(hits[index]);
              else return;
              event.preventDefault();
            }}
            placeholder="Estrutura, vista ou pack"
            className="min-w-0 flex-1 bg-transparent text-[17px] font-medium outline-none placeholder:font-normal placeholder:text-muted"
          />
          <span className="rounded-md bg-surface-alt px-1.5 py-0.5 font-mono text-[11.5px] text-muted">Esc</span>
        </label>
        <div className="overflow-y-auto p-2">
          {query.trim().length < 2 ? (
            <div className="px-3 py-4">
              <Lbl className="mb-2">Dica</Lbl>
              <p className="text-sm text-ink-2">Estruturas abrem no modo livre, já selecionadas e enquadradas; vistas abrem no pack, no ponto certo.</p>
            </div>
          ) : hits.length === 0 ? (
            <Empty icon="search" title="Nada encontrado" sub={`Nenhuma estrutura, vista ou pack com “${query.trim()}”.`} />
          ) : (
            hits.map((hit, position) => (
              <button
                key={`${hit.kind}:${hit.kind === "structure" ? hit.id : hit.kind === "view" ? `${hit.packId}/${hit.viewIndex}` : hit.packId}`}
                type="button"
                onMouseEnter={() => setIndex(position)}
                onClick={() => open(hit)}
                className={cx("flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left", position === index && "bg-surface-alt")}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] border border-line-soft bg-surface text-ink-2">
                  {hit.kind === "structure" ? <span className="h-3 w-3 rounded-full shadow-[inset_0_0_0_1px_rgba(34,28,32,.18)]" style={{ background: hit.color }} /> : <Icon name={hit.kind === "view" ? "flow" : "book"} size={18} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">
                    <Highlight text={hit.title} query={query} />
                  </span>
                  <span className="block truncate text-[13px] text-muted">{hit.sub}</span>
                </span>
                <span className="shrink-0 text-xs text-faint">{kindLabel[hit.kind]}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** Desktop app: sidebar + screens; the viewer with the sidebar collapsed; the lecture mode full screen. */
export function WebApp({ ctl, nav }: { ctl: ViewerController; nav: AppNav }) {
  const [palette, setPalette] = useState(false);
  const route = nav.route;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // a pack link opens the pack in the viewer, where the user stopped
  useEffect(() => {
    if (route.name === "pack") nav.openPack(route.packId);
    // only when a pack route arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  if (route.name === "viewer" && nav.presenting) return <WebPresent ctl={ctl} nav={nav} />;
  const searchRoute = route.name === "search";
  const closePalette = () => {
    setPalette(false);
    if (searchRoute) nav.back();
  };
  return (
    <div className="fixed inset-0 flex bg-paper">
      <WebSide nav={nav} collapsed={route.name === "viewer"} onSearch={() => setPalette(true)} />
      {route.name === "viewer" ? (
        <WebViewer ctl={ctl} nav={nav} />
      ) : route.name === "library" ? (
        <WLibrary key={route.group ?? "all"} nav={nav} group={route.group ?? null} />
      ) : route.name === "notes" ? (
        <WNotes nav={nav} />
      ) : route.name === "profile" ? (
        <WSettings />
      ) : (
        <WHome nav={nav} />
      )}
      {(palette || searchRoute) && <SearchPalette nav={nav} onClose={closePalette} />}
    </div>
  );
}
