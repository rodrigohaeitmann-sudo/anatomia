/** Lower case without accents (search). Keeps the string length, so match positions map back to the text. */
export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** "há 3 dias"-style relative date in Portuguese, short. */
export function relativeDay(at: number, now = Date.now()) {
  const day = 86_400_000;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (at >= start.getTime()) return "Hoje";
  if (at >= start.getTime() - day) return "Ontem";
  return new Date(at).toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "");
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
