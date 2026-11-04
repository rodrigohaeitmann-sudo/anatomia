"use client";

import { useEffect, useState } from "react";

/** True on phones/tablets (coarse pointer or narrow screen): lighter model, no shadows, capped DPR. */
export function useLowPower() {
  const [lowPower, setLowPower] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse), (max-width: 900px)");
    const update = () => setLowPower(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return lowPower;
}

/** True below the desktop breakpoint: phones and portrait tablets get the full-screen mobile shell. */
export function useCompactLayout() {
  const [compact, setCompact] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return compact;
}
