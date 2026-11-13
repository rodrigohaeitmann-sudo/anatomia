"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { allPacks, packEntry } from "@/lib/catalog";
import { FREE_PACK, readProgress, readSettings, type Note } from "@/lib/store";
import { useCompactLayout } from "@/lib/useLowPower";
import { Brand } from "@/components/ui/kit";
import { MobileApp } from "./mobile/MobileApp";
import type { AppNav } from "./nav";
import { useRouter, type Route } from "./router";
import { useViewerController } from "./useViewerController";
import { WebApp } from "./web/WebApp";

/** On desktop a pack opens in the viewer; when it is asked for by a pack link, that link is replaced (no loop on back). */
const nav0Replace = (route: Route) => route.name === "pack";

/** Route of the last guided view (or the first pack on a first visit). */
function lastGuidedRoute(): Route {
  const last = readProgress().last;
  const entry = (last && packEntry(last.packId)) || allPacks[0];
  return { name: "viewer", mode: "guided", packId: entry.pack.id, viewId: last && last.packId === entry.pack.id ? last.viewId : entry.pack.views[0].id };
}

function initialRoute(): Route {
  const start = readSettings().startScreen;
  if (start === "free") return { name: "viewer", mode: "free", structure: null };
  if (start === "guided") return lastGuidedRoute();
  return { name: "home" };
}

/**
 * MamaFlow Anatomia: phone layout (Android tabs and dock) below 1024 px, desktop layout (sidebar and panels) above.
 * Both share the router, the viewer controller and the local stores.
 */
export function AnatomiaApp() {
  const compact = useCompactLayout();
  const router = useRouter(initialRoute);
  const { route } = router;
  const ctl = useViewerController({ compact: Boolean(compact), active: route?.name === "viewer" });

  // route -> viewer (deep links, back/forward); viewer -> route (view changes inside the viewer)
  const applied = useRef<string | null>(null);
  const pending = useRef(false);
  const ctlKey = ctl.free ? FREE_PACK : `${ctl.pack.id}/${ctl.view.id}`;
  useEffect(() => {
    if (!route || route.name !== "viewer") return;
    let key: string;
    if (route.mode === "free") {
      key = FREE_PACK;
      if (key !== applied.current) {
        applied.current = key;
        if (key !== ctlKey) {
          pending.current = true;
          ctl.openFree(route.structure);
        }
      }
      return;
    }
    const entry = packEntry(route.packId);
    if (!entry) return;
    const index = Math.max(0, route.viewId ? entry.pack.views.findIndex((view) => view.id === route.viewId) : 0);
    key = `${entry.pack.id}/${entry.pack.views[index].id}`;
    if (key === applied.current) return;
    applied.current = key;
    if (key !== ctlKey) {
      pending.current = true;
      ctl.openGuided(entry.pack.id, index);
    }
    // only route changes drive this effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);
  useEffect(() => {
    if (!route || route.name !== "viewer") return;
    if (pending.current) {
      if (ctlKey === applied.current) pending.current = false;
      return;
    }
    if (ctlKey === applied.current) return;
    applied.current = ctlKey;
    router.sync(ctl.free ? { name: "viewer", mode: "free", structure: null } : { name: "viewer", mode: "guided", packId: ctl.pack.id, viewId: ctl.view.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctlKey]);

  const openView = useCallback(
    (packId: string, index: number, state?: { breast: string | null; pose: string | null }, replace = false) => {
      const entry = packEntry(packId);
      if (!entry) return;
      const safe = Math.max(0, Math.min(entry.pack.views.length - 1, index));
      const key = `${packId}/${entry.pack.views[safe].id}`;
      applied.current = key;
      pending.current = key !== ctlKey;
      ctl.openGuided(packId, safe, state);
      router.navigate({ name: "viewer", mode: "guided", packId, viewId: entry.pack.views[safe].id }, { replace });
    },
    [ctl, ctlKey, router],
  );
  const openFree = useCallback(
    (structure?: string | null) => {
      applied.current = FREE_PACK;
      pending.current = ctlKey !== FREE_PACK;
      ctl.openFree(structure ?? null);
      router.navigate({ name: "viewer", mode: "free", structure: null });
    },
    [ctl, ctlKey, router],
  );

  const nav: AppNav | null = useMemo(() => {
    if (!route) return null;
    const resumeIndex = (packId: string) => {
      const last = readProgress().last;
      const entry = packEntry(packId);
      if (!entry || !last || last.packId !== packId) return 0;
      return Math.max(0, entry.pack.views.findIndex((view) => view.id === last.viewId));
    };
    return {
      route,
      go: (next) => router.navigate(next),
      back: (fallback) => router.back(fallback),
      openPack: (packId) => (compact ? router.navigate({ name: "pack", packId }) : openView(packId, resumeIndex(packId), undefined, nav0Replace(route))),
      openView,
      openFree,
      continueLast: (present) => {
        const last = readProgress().last;
        const entry = (last && packEntry(last.packId)) || allPacks[0];
        openView(entry.pack.id, last ? resumeIndex(entry.pack.id) : 0, last ? { breast: last.breast, pose: last.pose } : undefined);
        if (present) window.setTimeout(() => router.present(true), 0);
      },
      openNote: (note: Note) => {
        if (note.packId === FREE_PACK) openFree();
        else {
          const entry = packEntry(note.packId);
          if (!entry) return;
          openView(note.packId, Math.max(0, entry.pack.views.findIndex((view) => view.id === note.viewId)));
        }
        ctl.showNote(`note:${note.id}`);
      },
      presenting: router.presenting,
      present: router.present,
    };
  }, [route, router, compact, openView, openFree, ctl]);

  if (compact === null || !route || !nav) {
    return (
      <main className="fixed inset-0 grid place-items-center bg-paper">
        <Brand size={22} />
      </main>
    );
  }
  return compact ? <MobileApp ctl={ctl} nav={nav} /> : <WebApp ctl={ctl} nav={nav} />;
}
