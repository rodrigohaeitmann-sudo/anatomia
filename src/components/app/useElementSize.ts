"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/** Height (and width) of an element, kept up to date with a ResizeObserver; 0 while it is not mounted. */
export function useElementSize(ref: RefObject<HTMLElement>, enabled = true) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !enabled) {
      setSize({ width: 0, height: 0 });
      return;
    }
    const update = () => setSize({ width: element.offsetWidth, height: element.offsetHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return size;
}
