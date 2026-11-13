import type { Note } from "@/lib/store";
import type { Route } from "./router";

/** Navigation actions shared by the phone and desktop layouts. */
export type AppNav = {
  route: Route;
  go: (route: Route) => void;
  back: (fallback?: Route) => void;
  /** a pack from the library: its screen on phones, the viewer on desktop */
  openPack: (packId: string) => void;
  openView: (packId: string, index: number, state?: { breast: string | null; pose: string | null }, replace?: boolean) => void;
  openFree: (structure?: string | null) => void;
  continueLast: (present?: boolean) => void;
  openNote: (note: Note) => void;
  presenting: boolean;
  present: (on: boolean) => void;
};
