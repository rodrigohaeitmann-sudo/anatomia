"use client";

import { packEntry } from "@/lib/catalog";
import { useProgress } from "@/lib/store";
import { Icon, type IconName } from "@/components/ui/Icon";
import { asset, Brand, cx, Lbl, ToolButton } from "@/components/ui/kit";
import type { AppNav } from "../nav";

type NavId = "home" | "library" | "free" | "notes";
const items: { id: NavId; icon: IconName; label: string }[] = [
  { id: "home", icon: "home", label: "Início" },
  { id: "library", icon: "book", label: "Biblioteca" },
  { id: "free", icon: "cube", label: "Modo livre" },
  { id: "notes", icon: "pen", label: "Anotações" },
];

function activeItem(nav: AppNav): NavId | null {
  const route = nav.route;
  if (route.name === "home") return "home";
  if (route.name === "library" || route.name === "pack") return "library";
  if (route.name === "notes") return "notes";
  if (route.name === "viewer") return route.mode === "free" ? "free" : "library";
  return null;
}

/** Desktop sidebar: brand, search (⌘K), sections and recent packs; collapsed to icons beside the viewer. */
export function WebSide({ nav, collapsed = false, onSearch }: { nav: AppNav; collapsed?: boolean; onSearch: () => void }) {
  const progress = useProgress();
  const active = activeItem(nav);
  const run = (id: NavId) => {
    if (id === "free") nav.openFree();
    else nav.go({ name: id });
  };
  const settingsOn = nav.route.name === "profile";
  if (collapsed) {
    return (
      <nav aria-label="Navegação principal" className="flex w-[72px] shrink-0 flex-col items-center gap-1.5 border-r border-line bg-surface py-4">
        <button type="button" onClick={() => nav.go({ name: "home" })} aria-label="Início" className="mb-3.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset("/brand/logo-ink.png")} width={28} height={28} alt="" />
        </button>
        <button type="button" onClick={onSearch} title="Buscar (⌘K)" aria-label="Buscar" className="grid h-11 w-11 place-items-center rounded-[14px] text-ink-2 hover:bg-surface-alt">
          <Icon name="search" size={21} />
        </button>
        {items.map((item) => {
          const on = item.id === active;
          return (
            <button key={item.id} type="button" title={item.label} aria-label={item.label} aria-current={on ? "page" : undefined} onClick={() => run(item.id)} className={cx("grid h-11 w-11 place-items-center rounded-[14px] transition-colors", on ? "bg-warm text-ink" : "text-ink-2 hover:bg-surface-alt")}>
              <Icon name={item.icon} size={21} stroke={on ? 2 : 1.6} />
            </button>
          );
        })}
        <div className="flex-1" />
        <button type="button" onClick={() => nav.go({ name: "profile" })} title="Ajustes" aria-label="Ajustes" className={cx("grid h-[38px] w-[38px] place-items-center rounded-full", settingsOn ? "bg-rose-deep text-on-ink" : "bg-ink text-on-ink")}>
          <Icon name="user" size={18} />
        </button>
      </nav>
    );
  }
  return (
    <nav aria-label="Navegação principal" className="flex w-[256px] shrink-0 flex-col gap-1 border-r border-line bg-surface px-3.5 pb-4 pt-5">
      <button type="button" onClick={() => nav.go({ name: "home" })} className="px-2 pb-5 text-left" aria-label="Início">
        <Brand size={18} />
      </button>
      <button type="button" onClick={onSearch} className="mb-3.5 flex h-10 items-center gap-2.5 rounded-xl border border-line px-3 text-sm text-muted hover:bg-surface-alt">
        <Icon name="search" size={17} />
        <span className="flex-1 text-left">Buscar</span>
        <span className="rounded-md bg-surface-alt px-1.5 py-0.5 font-mono text-[11.5px]">⌘K</span>
      </button>
      {items.map((item) => (
        <ToolButton key={item.id} row icon={item.icon} label={item.label} on={item.id === active} onClick={() => run(item.id)} className="w-full" />
      ))}
      {progress.recent.length > 0 && (
        <>
          <Lbl className="px-3 pb-2 pt-[22px]">Recentes</Lbl>
          {progress.recent.slice(0, 4).map((packId) => {
            const entry = packEntry(packId);
            if (!entry) return null;
            const seen = progress.visited[packId]?.length ?? 0;
            return (
              <button key={packId} type="button" onClick={() => nav.openPack(packId)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-ink-2 hover:bg-surface-alt">
                <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-rose" />
                <span className="min-w-0 flex-1 truncate">{entry.pack.title}</span>
                <span className="text-xs text-muted">
                  {seen}/{entry.pack.views.length}
                </span>
              </button>
            );
          })}
        </>
      )}
      <div className="flex-1" />
      <button type="button" onClick={() => nav.go({ name: "profile" })} className={cx("flex items-center gap-2.5 rounded-xl border-t border-line-soft px-2 py-2.5 text-left", settingsOn && "bg-warm")}>
        <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-ink text-on-ink">
          <Icon name="user" size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Ajustes</span>
          <span className="block truncate text-xs text-muted">Salvo neste aparelho</span>
        </span>
        <Icon name="more" size={18} color="#8C8389" />
      </button>
    </nav>
  );
}
