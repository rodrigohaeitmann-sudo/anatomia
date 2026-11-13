/**
 * Catalogue helpers over the packs (src/data/packs.ts): lookups, covers, search index.
 */
import { allPacks, packGroups, type Pack, type PackGroup, type PackView } from "@/data/packs";
import type { IconName } from "@/components/ui/Icon";
import { fold } from "@/lib/text";
import { modelStructures } from "@/lib/modelConfig";

/**
 * Cover of each pack (public/covers). Provisional crops of the renders in docs/img where one exists;
 * packs without a cover get a tile in the colour of their group. Replace or add files here.
 */
const covers: Record<string, string> = {
  "ptose-mamaria": "/covers/ptose-2.jpg",
  "mamoplastia-redutora": "/covers/mamoplastia-marcacao.jpg",
  "mamoplastia-pitanguy-passo-a-passo": "/covers/passos-pitanguy.jpg",
  "mamoplastia-wise-passo-a-passo": "/covers/passos-wise.jpg",
  "mamoplastia-vertical-passo-a-passo": "/covers/passos-vertical.jpg",
  "vascular-mama": "/covers/irrigacao-0.jpg",
};
/** Optional per-view covers (thumbnails in the view list); default: the pack cover. */
const viewCovers: Record<string, string> = {
  "ptose-mamaria/sem-ptose": "/covers/ptose-0.jpg",
  "ptose-mamaria/ptose-1": "/covers/ptose-1.jpg",
  "ptose-mamaria/ptose-2": "/covers/ptose-2.jpg",
  "ptose-mamaria/ptose-3": "/covers/ptose-3.jpg",
  "vascular-mama/ramos-mamarios": "/covers/irrigacao-0.jpg",
  "vascular-mama/septo": "/covers/irrigacao-1.jpg",
  "vascular-mama/inervacao-cap": "/covers/irrigacao-2.jpg",
  "vascular-mama/septo-ptose": "/covers/irrigacao-3.jpg",
  "mamoplastia-redutora/pitanguy-marcacao": "/covers/mamoplastia-marcacao.jpg",
  "mamoplastia-redutora/pitanguy-pediculo": "/covers/mamoplastia-pediculo.jpg",
};

export const coverOf = (packId: string): string | null => covers[packId] ?? null;
export const viewCoverOf = (packId: string, viewId: string): string | null => viewCovers[`${packId}/${viewId}`] ?? covers[packId] ?? null;

export const groupIcons: Record<string, IconName> = { mama: "heart", axila: "target", retalhos: "layers", "parede-ombro": "cube" };
export const groupIcon = (groupId: string): IconName => groupIcons[groupId] ?? "book";

/** Short title of each group for filter chips. */
export const groupShort: Record<string, string> = { mama: "Mama", axila: "Axila", retalhos: "Retalhos", "parede-ombro": "Parede e ombro" };

export const packEntry = (packId: string) => allPacks.find((entry) => entry.pack.id === packId) ?? null;
export const viewCount = (group: PackGroup) => group.packs.reduce((sum, pack) => sum + pack.views.length, 0);

export type { Pack, PackGroup, PackView };
export { allPacks, packGroups };

// ---- search ------------------------------------------------------------------------------------------

/** Views showing each structure (structure lists of the pack views). */
const viewsByStructure = new Map<string, { packId: string; viewIndex: number }[]>();
for (const { pack } of allPacks) {
  pack.views.forEach((view, viewIndex) => {
    for (const id of new Set(view.structures)) viewsByStructure.set(id, [...(viewsByStructure.get(id) ?? []), { packId: pack.id, viewIndex }]);
  });
}
export const viewsOfStructure = (id: string) => viewsByStructure.get(id) ?? [];

export type SearchHit =
  | { kind: "structure"; id: string; title: string; sub: string; group: string; color: string; score: number }
  | { kind: "view"; packId: string; viewIndex: number; title: string; sub: string; score: number }
  | { kind: "pack"; packId: string; title: string; sub: string; score: number };

const searchableStructures = modelStructures.filter((structure) => structure.listed && !structure.plan);

/** Accent-insensitive search over structures, views and packs; prefix matches first. */
export function search(query: string): SearchHit[] {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const score = (text: string) => {
    const t = fold(text);
    const index = t.indexOf(q);
    if (index < 0) return -1;
    return index === 0 ? 3 : t[index - 1] === " " ? 2 : 1;
  };
  const hits: SearchHit[] = [];
  for (const structure of searchableStructures) {
    const s = score(structure.label);
    if (s < 0) continue;
    const count = viewsOfStructure(structure.id).length;
    hits.push({ kind: "structure", id: structure.id, title: structure.label, sub: `${structure.group}${count ? ` · em ${count} ${count === 1 ? "vista" : "vistas"}` : ""}`, group: structure.group, color: structure.color, score: s });
  }
  for (const { pack } of allPacks) {
    const ps = Math.max(score(pack.title), score(pack.summary) >= 0 ? 0 : -1);
    if (ps >= 0) hits.push({ kind: "pack", packId: pack.id, title: pack.title, sub: `${pack.views.length} vistas`, score: ps });
    pack.views.forEach((view, viewIndex) => {
      const s = score(view.title);
      if (s >= 0) hits.push({ kind: "view", packId: pack.id, viewIndex, title: view.title, sub: `${pack.title} · ${viewIndex + 1}/${pack.views.length}`, score: s });
    });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "pt-BR"));
}
