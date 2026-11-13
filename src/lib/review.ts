"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Specialist review of the study layers (landmarks, attachment areas, computed items). Stored only
 * in this browser; exported as JSON so corrections can be applied to the build.
 */
export type ReviewStatus = "confirmado" | "ajustado" | "incorreto";
export type ReviewEntry = { status: ReviewStatus; point?: [number, number, number]; comment?: string; at: string };
export type ReviewStore = Record<string, ReviewEntry>;

const KEY = "anatomia.review.v1";

function read(): ReviewStore {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ReviewStore) : {};
  } catch {
    return {};
  }
}

function write(store: ReviewStore) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // private mode / storage blocked: the review stays in memory for this visit
  }
}

export function useReview() {
  const [store, setStore] = useState<ReviewStore>({});
  useEffect(() => setStore(read()), []);
  const update = useCallback((id: string, entry: Partial<ReviewEntry> | null) => {
    setStore((current) => {
      const next = { ...current };
      if (entry === null) delete next[id];
      else next[id] = { ...(current[id] ?? { status: "confirmado" }), ...entry, at: new Date().toISOString() } as ReviewEntry;
      write(next);
      return next;
    });
  }, []);
  const exportJson = useCallback(
    () => JSON.stringify({ app: "anatomia", kind: "revisao-camadas", version: 1, exportedAt: new Date().toISOString(), items: store }, null, 2),
    [store],
  );
  return { store, update, exportJson };
}

export const reviewTone: Record<ReviewStatus, string> = {
  confirmado: "text-sage-deep",
  ajustado: "text-[#6B4E8E]",
  incorreto: "text-danger",
};
