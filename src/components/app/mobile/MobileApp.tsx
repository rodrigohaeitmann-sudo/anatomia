"use client";

import type { AppNav } from "../nav";
import { MobilePresent } from "../Present";
import type { ViewerController } from "../useViewerController";
import { folderOf } from "@/lib/catalog";
import { MDegree, MHome, MLibrary, MNotes, MPack, MProfile, MSearch, MTechnique } from "./MobileScreens";
import { MobileViewer } from "./MobileViewer";

/** Phone app (Android design): four tabs, pushed screens for search and packs, the viewer full screen. */
export function MobileApp({ ctl, nav }: { ctl: ViewerController; nav: AppNav }) {
  const route = nav.route;
  switch (route.name) {
    case "home":
      return <MHome nav={nav} />;
    case "library":
      // a degree of the reduction mammaplasty (a group inside a folder) and each of its techniques: subfolders
      if (route.group && folderOf(route.group)) return route.technique ? <MTechnique key={`${route.group}/${route.technique}`} nav={nav} group={route.group} technique={route.technique} /> : <MDegree key={route.group} nav={nav} group={route.group} />;
      return <MLibrary key={route.group ?? "all"} nav={nav} group={route.group ?? null} />;
    case "search":
      return <MSearch nav={nav} />;
    case "notes":
      return <MNotes nav={nav} />;
    case "profile":
      return <MProfile nav={nav} />;
    case "pack":
      return <MPack nav={nav} packId={route.packId} />;
    case "viewer":
      return nav.presenting ? <MobilePresent ctl={ctl} nav={nav} /> : <MobileViewer ctl={ctl} nav={nav} />;
  }
}
