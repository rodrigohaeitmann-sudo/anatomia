"use client";

import type { CSSProperties } from "react";
import { coverOf, groupIcon, viewCoverOf } from "@/lib/catalog";
import { Icon } from "./Icon";
import { asset, cx } from "./kit";

const tileTones: Record<string, [string, string, string]> = {
  mama: ["#F8E7E9", "#F4E1E5", "#8E5C68"],
  axila: ["#E7EEE9", "#DDE7E0", "#3F5E51"],
  retalhos: ["#F6EBDA", "#EFDFC4", "#6F4D1E"],
  "parede-ombro": ["#F4EEE7", "#E9DFD3", "#5A5057"],
};

type Props = { packId: string; groupId: string; viewId?: string; className?: string; style?: CSSProperties; rounded?: string; label?: string };

/** Pack (or view) cover: a render of the model, or a tile in the colour of the group when there is none yet. */
export function Cover({ packId, groupId, viewId, className, style, rounded = "rounded-[14px]", label }: Props) {
  const src = viewId ? viewCoverOf(packId, viewId) : coverOf(packId);
  if (src) {
    return (
      <div role={label ? "img" : undefined} aria-label={label} className={cx("shrink-0 overflow-hidden bg-[#1B1A24] bg-cover bg-center bg-no-repeat", rounded, className)} style={{ backgroundImage: `url(${asset(src)})`, ...style }} />
    );
  }
  const [from, to, ink] = tileTones[groupId] ?? tileTones["parede-ombro"];
  return (
    <div role={label ? "img" : undefined} aria-label={label} className={cx("relative grid shrink-0 place-items-center overflow-hidden", rounded, className)} style={{ background: `radial-gradient(120% 90% at 30% 20%, #FFFFFF 0%, ${from} 45%, ${to} 100%)`, color: ink, ...style }}>
      <Icon name={groupIcon(groupId)} size={28} stroke={1.3} style={{ opacity: 0.55, width: "38%", height: "38%", maxWidth: 64, maxHeight: 64 }} />
    </div>
  );
}
