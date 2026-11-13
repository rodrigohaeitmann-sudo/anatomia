"use client";

import { useCallback, useEffect, useState } from "react";
import { allPacks } from "@/data/packs";

/**
 * Hash routes (static export on GitHub Pages: no server routes). The guided viewer keeps the historical
 * "#pack/view" form, so links shared before the redesign still open the same view.
 */
export type Route =
  | { name: "home" }
  | { name: "library"; group?: string | null }
  | { name: "search" }
  | { name: "notes" }
  | { name: "profile" }
  | { name: "pack"; packId: string }
  | { name: "viewer"; mode: "guided"; packId: string; viewId: string | null }
  | { name: "viewer"; mode: "free"; structure: string | null };

export function parseHash(hash: string): Route | null {
  const raw = decodeURIComponent(hash.replace(/^#/, ""));
  if (!raw || raw === "/") return null;
  if (raw.startsWith("/")) {
    const [head, a, b] = raw.slice(1).split("/");
    switch (head) {
      case "biblioteca":
        return { name: "library", group: a || null };
      case "busca":
        return { name: "search" };
      case "anotacoes":
        return { name: "notes" };
      case "perfil":
      case "ajustes":
        return { name: "profile" };
      case "pack":
        return a && allPacks.some((entry) => entry.pack.id === a) ? { name: "pack", packId: a } : { name: "library" };
      case "livre":
        return { name: "viewer", mode: "free", structure: a || null };
      case "vista":
        return a && allPacks.some((entry) => entry.pack.id === a) ? { name: "viewer", mode: "guided", packId: a, viewId: b || null } : { name: "library" };
      default:
        return { name: "home" };
    }
  }
  const [packId, viewId] = raw.split("/");
  if (allPacks.some((entry) => entry.pack.id === packId)) return { name: "viewer", mode: "guided", packId, viewId: viewId || null };
  return { name: "home" };
}

export function formatRoute(route: Route): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "library":
      return route.group ? `#/biblioteca/${route.group}` : "#/biblioteca";
    case "search":
      return "#/busca";
    case "notes":
      return "#/anotacoes";
    case "profile":
      return "#/perfil";
    case "pack":
      return `#/pack/${route.packId}`;
    case "viewer":
      return route.mode === "free" ? (route.structure ? `#/livre/${route.structure}` : "#/livre") : `#${route.packId}${route.viewId ? `/${route.viewId}` : ""}`;
  }
}

type HistoryState = { idx: number; present?: boolean };
const stateOf = (value: unknown): HistoryState => (value && typeof value === "object" && "idx" in value ? (value as HistoryState) : { idx: 0 });

/** Route + history: pushes an entry per screen so the Android back button walks back through the app. */
export function useRouter(initial: () => Route) {
  const [route, setRoute] = useState<Route | null>(null);
  const [presenting, setPresenting] = useState(false);

  useEffect(() => {
    const first = parseHash(window.location.hash) ?? initial();
    const state = stateOf(window.history.state);
    window.history.replaceState({ idx: state.idx, present: false }, "", formatRoute(first));
    setRoute(first);
    const onPop = (event: PopStateEvent) => {
      const next = parseHash(window.location.hash) ?? { name: "home" };
      setRoute(next);
      setPresenting(Boolean(stateOf(event.state).present));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // the initial route is read once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = useCallback((next: Route, options?: { replace?: boolean }) => {
    const state = stateOf(window.history.state);
    if (options?.replace) window.history.replaceState({ idx: state.idx }, "", formatRoute(next));
    else window.history.pushState({ idx: state.idx + 1 }, "", formatRoute(next));
    setPresenting(false);
    setRoute(next);
  }, []);

  /** keeps the address in step with the viewer (view changes) without adding history entries */
  const sync = useCallback((next: Route) => {
    const state = stateOf(window.history.state);
    const hash = formatRoute(next);
    if (window.location.hash !== hash) window.history.replaceState(state, "", hash);
    setRoute((current) => (current && formatRoute(current) === hash ? current : next));
  }, []);

  const back = useCallback(
    (fallback: Route = { name: "home" }) => {
      if (stateOf(window.history.state).idx > 0) window.history.back();
      else navigate(fallback, { replace: true });
    },
    [navigate],
  );

  const present = useCallback((on: boolean) => {
    const state = stateOf(window.history.state);
    if (on && !state.present) {
      window.history.pushState({ idx: state.idx + 1, present: true }, "", window.location.hash);
      setPresenting(true);
    } else if (!on && state.present) {
      window.history.back();
    } else {
      setPresenting(on);
    }
  }, []);

  return { route, navigate, back, sync, presenting, present };
}

export type Router = ReturnType<typeof useRouter>;
