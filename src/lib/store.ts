"use client";

import { useSyncExternalStore } from "react";
import type { Landmark } from "@/lib/modelConfig";

/**
 * Small persistent stores (localStorage) shared by every screen: progress ("continue where I left off"),
 * personal notes pinned to views, and settings. Everything stays on this device.
 */
type Store<T> = { get: () => T; set: (next: T | ((current: T) => T)) => void; subscribe: (listener: () => void) => () => void; initial: T };

function createStore<T extends object>(key: string, initial: T): Store<T> {
  let state = initial;
  let loaded = false;
  const listeners = new Set<() => void>();
  const load = () => {
    if (loaded || typeof window === "undefined") return;
    loaded = true;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) state = { ...initial, ...(JSON.parse(raw) as Partial<T>) };
    } catch {
      // storage unavailable or corrupt: start fresh
    }
  };
  return {
    initial,
    get: () => {
      load();
      return state;
    },
    set: (next) => {
      load();
      state = typeof next === "function" ? (next as (current: T) => T)(state) : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(state));
      } catch {
        // private mode or quota: keep the state for this session only
      }
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function useStore<T extends object>(store: Store<T>) {
  return useSyncExternalStore(store.subscribe, store.get, () => store.initial);
}

// ---- settings ----------------------------------------------------------------------------------------

export type StartScreen = "home" | "guided" | "free";
export type TextSize = "s" | "m" | "l";
export type Quality = "auto" | "low" | "high";
export type Settings = {
  /** what the app shows when it is opened without a link */
  startScreen: StartScreen;
  /** names beside the pins (off: numbered pins, tap to read) */
  labelNames: boolean;
  /** size of the view text in the panel and in the lecture mode */
  textSize: TextSize;
  /** model detail: automatic (light model on phones), always light or always full */
  quality: Quality;
  /** personal notes shown during the lecture mode */
  presentNotes: boolean;
  /** packs saved by the user */
  saved: string[];
};
const settingsStore = createStore<Settings>("anatomia.settings.v1", { startScreen: "home", labelNames: true, textSize: "m", quality: "auto", presentNotes: false, saved: [] });
export const useSettings = () => useStore(settingsStore);
export const setSettings = (patch: Partial<Settings>) => settingsStore.set((current) => ({ ...current, ...patch }));
export const toggleSaved = (packId: string) => settingsStore.set((current) => ({ ...current, saved: current.saved.includes(packId) ? current.saved.filter((id) => id !== packId) : [packId, ...current.saved] }));
export const readSettings = () => settingsStore.get();

// ---- progress ----------------------------------------------------------------------------------------

export type LastPosition = { packId: string; viewId: string; breast: string | null; pose: string | null; at: number };
export type Progress = {
  last: LastPosition | null;
  /** views seen, per pack */
  visited: Record<string, string[]>;
  /** packs opened, most recent first */
  recent: string[];
};
const progressStore = createStore<Progress>("anatomia.progress.v1", { last: null, visited: {}, recent: [] });
export const useProgress = () => useStore(progressStore);
export const readProgress = () => progressStore.get();

export function recordVisit(packId: string, viewId: string, breast: string | null, pose: string | null) {
  progressStore.set((current) => {
    const seen = current.visited[packId] ?? [];
    return {
      last: { packId, viewId, breast, pose, at: Date.now() },
      visited: seen.includes(viewId) ? current.visited : { ...current.visited, [packId]: [...seen, viewId] },
      recent: [packId, ...current.recent.filter((id) => id !== packId)].slice(0, 6),
    };
  });
}
/** keeps the shape and arm of the last position up to date while the user changes them */
export function recordState(breast: string | null, pose: string | null) {
  progressStore.set((current) => (current.last && (current.last.breast !== breast || current.last.pose !== pose) ? { ...current, last: { ...current.last, breast, pose } } : current));
}

// ---- notes -------------------------------------------------------------------------------------------

/** packId used by notes made in the free mode (whole model) */
export const FREE_PACK = "livre";
export const FREE_VIEW = "modelo";
export type Note = {
  id: string;
  packId: string;
  viewId: string;
  text: string;
  /** point on the model (model space, as shown when it was made); null: note about the whole view */
  point: Landmark | null;
  /** structure the note was made on, if any */
  structure: string | null;
  createdAt: number;
  updatedAt: number;
};
const notesStore = createStore<{ items: Note[] }>("anatomia.notes.v1", { items: [] });
export const useNotes = () => useStore(notesStore).items;

export function addNote(note: Omit<Note, "id" | "createdAt" | "updatedAt">) {
  const now = Date.now();
  const id = `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  notesStore.set((current) => ({ items: [{ ...note, id, createdAt: now, updatedAt: now }, ...current.items] }));
  return id;
}
export const updateNote = (id: string, patch: Partial<Pick<Note, "text" | "point">>) =>
  notesStore.set((current) => ({ items: current.items.map((note) => (note.id === id ? { ...note, ...patch, updatedAt: Date.now() } : note)) }));
export const deleteNote = (id: string) => notesStore.set((current) => ({ items: current.items.filter((note) => note.id !== id) }));
