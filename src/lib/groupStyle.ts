/** Accent colour per pack group (library cards, top bar). */
export const groupColors: Record<string, string> = {
  mama: "#f472b6",
  axila: "#22d3ee",
  retalhos: "#f59e0b",
  "parede-ombro": "#a78bfa",
};
export const groupColor = (id: string) => groupColors[id] ?? "#38bdf8";
