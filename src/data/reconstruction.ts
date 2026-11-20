/**
 * Mastectomia e reconstrução imediata com retalhos miocutâneos pediculados: os passos de
 * src/data/reconstructionSteps.json (escritos por scripts/hybrid/build_flaps.py; docs/plano-retalhos-miocutaneos.md).
 * Cada vista é um quadro da sequência; entre duas vistas o tecido é animado de um quadro ao outro. Os números vêm do
 * pipeline (medidos nas malhas).
 */
import type { Pack, PackGroup, PackLabel, PackView } from "@/data/packs";
import { reconstructionMeasures, stepFramesOf, stepPoints } from "@/lib/mammaplastySteps";

const cm = (mm: number) => (mm / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ml = (value: number) => `${Math.round(value / 5) * 5} mL`;

/** Points of a sequence for labels (only those the pipeline wrote). */
const label = (key: string, structure: string, point: string, text: string): PackLabel => ({ structure, near: `step:${key}:${point}`, text });
const withPoints = (labels: PackLabel[]) => labels.filter((item) => item.near in stepPoints);
const frameOf = (key: string, id: string) => stepFramesOf(key).findIndex((frame) => frame.id === id);
/** "Rever" replays from the stage before (in-between frames such as "tunel:1" only shape the way). */
const stageBefore = (key: string, frame: number) => {
  const frames = stepFramesOf(key);
  for (let k = frame - 1; k >= 0; k--) if (!frames[k].id.includes(":")) return k;
  return 0;
};
const surgery = (key: string, id: string, extra: Partial<NonNullable<PackView["surgery"]>> = {}) => {
  const frame = frameOf(key, id);
  return { technique: key, frame, replayFrom: stageBefore(key, frame), ...extra };
};

const modelNote = "Modelo geométrico, não simulação física: retalhos, peça e pele se movem por mapas suaves na carta do tronco; não há edema, retração nem sangramento";
const chestWall = ["chest-wall", "costal-cartilages", "intercostal-muscles"];

// ---- mastectomia -----------------------------------------------------------------------------------------
const M = "mastectomia";
const mid = (part: string) => `recon-${part}-${M}`;
const mm = reconstructionMeasures(M);
const mastSkin = [mid("skin"), mid("specimen-skin")];
const mastCommon = { orientation: "frontal" as const, anchor: `step:${M}:centre`, distance: 0.62, follow: false };
const specimenText = `mama inteira (${ml(mm.breastMl ?? 0)}), com a fáscia do peitoral maior, a pele da elipse (${mm.skinAreaCm2 ?? 0} cm²) e o complexo areolopapilar`;

const mastectomyViews: PackView[] = [
  {
    ...mastCommon,
    id: "mastectomia-marcacao",
    title: "1. Marcação",
    description: `Com a paciente sentada, marca-se a elipse transversa que inclui o complexo areolopapilar: ${cm(mm.ellipseLengthMm ?? 0)} × ${cm(mm.ellipseHeightMm ?? 0)} cm sobre a pele, inclinada ${mm.ellipseTiltDeg ?? 0}° para a axila. A altura é escolhida pelo pinçamento, para os retalhos fecharem sem tensão. Em verde, os limites da dissecção.`,
    structures: ["skin", "contralateral-breast", ...mastSkin, mid("marking"), mid("limits")],
    solid: ["skin", ...mastSkin],
    labels: withPoints([
      label(M, mid("marking"), "ellipse", `Elipse: ${cm(mm.ellipseLengthMm ?? 0)} × ${cm(mm.ellipseHeightMm ?? 0)} cm`),
      label(M, mid("specimen-skin"), "nac", "Complexo areolopapilar (sai com a peça)"),
      label(M, mid("limits"), "limit-top", "Superior: 2 cm abaixo da clavícula"),
      label(M, mid("limits"), "limit-medial", "Medial: borda do esterno"),
      label(M, mid("limits"), "limit-bottom", "Inferior: abaixo do sulco inframamário"),
      label(M, mid("limits"), "limit-lateral", "Lateral: borda anterior do grande dorsal"),
    ]),
    surgery: surgery(M, "marcacao", { replayFrom: null }),
    relations: [
      "Mastectomia total (simples) com incisão elíptica transversa, do tipo Stewart: tira a pele do complexo areolopapilar e a cicatriz de biópsia, se houver",
      "A elipse é oblíqua para a axila: a cicatriz fica sob o sutiã e dá acesso à cauda axilar",
      "Limites da dissecção: clavícula (2 cm abaixo), borda lateral do esterno, sulco inframamário (até a bainha do reto) e borda anterior do grande dorsal",
      "A paciente é a mama do modelo como escaneada: sem ptose, 427 mL. A contralateral fica para comparar",
      "Variantes não modeladas: poupadora de pele (incisão periareolar), poupadora do complexo areolopapilar e radical modificada (com esvaziamento axilar)",
    ],
  },
  {
    ...mastCommon,
    id: "mastectomia-incisao",
    title: "2. Incisão",
    description: "Incisão da pele e da derme em toda a elipse, até o subcutâneo. Ganchos nas bordas tracionam a pele para cima e para baixo, para começar os retalhos no plano certo.",
    structures: ["skin", "contralateral-breast", ...mastSkin, mid("incision"), mid("limits")],
    solid: ["skin", ...mastSkin],
    labels: withPoints([label(M, mid("incision"), "ellipse", "Incisão na elipse"), label(M, mid("specimen-skin"), "nac", "Pele da elipse: fica na peça")]),
    surgery: surgery(M, "incisao", { replayFrom: null }),
    relations: ["A pele dentro da elipse não é separada da mama: sai em bloco com ela", "O bisturi frio na derme; o eletrocautério a partir do subcutâneo"],
  },
  {
    ...mastCommon,
    id: "mastectomia-retalhos",
    title: "3. Retalhos cutâneos",
    description: `Os retalhos superior e inferior são levantados no plano entre o subcutâneo e a glândula, com espessura uniforme (no modelo, ${mm.flapMm ?? 6} mm de pele e subcutâneo), até os limites marcados. Os afastadores mostram a face interna dos retalhos (amarelo) e a mama inteira por baixo.`,
    structures: ["skin", "contralateral-breast", ...mastSkin, mid("flap-fat"), mid("specimen"), mid("limits")],
    translucent: ["skin"],
    solid: mastSkin,
    focus: [mid("flap-fat")],
    labels: withPoints([
      label(M, mid("flap-fat"), "flap-upper", `Retalho superior: pele + ${mm.flapMm ?? 6} mm de subcutâneo`),
      label(M, mid("flap-fat"), "flap-lower", "Retalho inferior"),
      label(M, mid("specimen"), "specimen", "Mama (ainda na fáscia peitoral)"),
    ]),
    surgery: surgery(M, "retalhos"),
    relations: [
      "Plano: entre o subcutâneo e a glândula (fáscia superficial, quando existe; ela é inconstante)",
      "Espessura: não há uma ideal para todas. As séries vão de 4 mm a mais de 20 mm, conforme a paciente. Retalhos finos demais necrosam sem ganho oncológico",
      "Espessura uniforme: degraus no retalho comprometem a irrigação do plexo subdérmico",
      "O retalho superior vai até 2 cm abaixo da clavícula; o inferior, até o sulco",
      modelNote,
    ],
  },
  {
    ...mastCommon,
    distance: 0.78,
    id: "mastectomia-exerese",
    title: "4. Exérese da mama",
    description: `A mama sai em bloco: ${specimenText}. A dissecção vai de medial para lateral, junto ao músculo, e inclui a cauda axilar.`,
    structures: ["skin", "contralateral-breast", ...mastSkin, mid("flap-fat"), mid("specimen"), mid("fascia"), "pectoralis-major", "serratus-anterior", "latissimus-dorsi", "internal-thoracic-vessels", "lateral-thoracic-vessels", ...chestWall],
    translucent: ["skin"],
    solid: mastSkin,
    focus: [mid("specimen"), "pectoralis-major"],
    labels: withPoints([
      label(M, mid("specimen"), "specimen-out", `Peça: mama (${ml(mm.breastMl ?? 0)}) com a fáscia peitoral`),
      label(M, "pectoralis-major", "pectoralis", "Peitoral maior, sem a fáscia"),
      label(M, mid("flap-fat"), "flap-upper", "Retalho superior"),
    ]),
    surgery: surgery(M, "resseccao"),
    relations: [
      "Junto ao esterno são ligadas as perfurantes da torácica interna (2º a 4º espaços); lateralmente, os ramos da torácica lateral",
      "O peitoral maior fica (na mastectomia radical de Halsted ele também sairia)",
      "O nervo torácico longo (sobre o serrátil) e o toracodorsal (com os vasos, na borda do grande dorsal) são preservados na parte lateral",
      "A axila (linfonodo sentinela ou esvaziamento) é abordada pela mesma incisão ou por outra: fora da simulação",
    ],
  },
  {
    ...mastCommon,
    id: "mastectomia-leito",
    title: "5. Leito da mastectomia",
    description: `Os retalhos voltam à parede: só pele e ${mm.flapMm ?? 6} mm de subcutâneo sobre o peitoral maior. O contorno fica côncavo onde estava a mama, e a elipse fica aberta. É deste leito que partem as reconstruções imediatas com o grande dorsal e com o TRAM.`,
    structures: ["skin", "contralateral-breast", mid("skin"), mid("flap-fat"), "pectoralis-major", "serratus-anterior", "latissimus-dorsi", ...chestWall],
    solid: ["skin", mid("skin")],
    labels: withPoints([label(M, "pectoralis-major", "bed", "Peitoral maior no fundo do defeito"), label(M, mid("skin"), "flap-upper", "Retalhos sobre a parede")]),
    surgery: surgery(M, "leito"),
    relations: [
      "Sai também o coxim gorduroso atrás da mama: por isso a pele fica abaixo do contorno que o tronco teria sem a mama",
      "Falta pele (a da elipse) e falta volume (a mama): a reconstrução imediata repõe os dois de uma vez",
      "Grande dorsal: músculo e ilha de pele do dorso, com implante. TRAM: pele e gordura do abdome inferior sobre o reto do abdome",
    ],
  },
  {
    ...mastCommon,
    id: "mastectomia-fechamento",
    title: "6. Fechamento sem reconstrução",
    description: `Sem reconstrução, os retalhos são aproximados sobre um dreno aspirativo. A cicatriz é transversa, com ${cm(mm.scarMm ?? 0)} cm: passa um pouco das pontas da elipse para não deixar orelhas. O tórax fica plano, um pouco côncavo.`,
    structures: ["skin", "contralateral-breast", mid("skin"), mid("scar")],
    solid: ["skin", mid("skin")],
    labels: withPoints([label(M, mid("scar"), "scar", `Cicatriz transversa: ${cm(mm.scarMm ?? 0)} cm`)]),
    surgery: surgery(M, "fechamento"),
    relations: [
      "A pele que sobrava (a da elipse) saiu: as bordas superior e inferior se encontram no eixo da elipse",
      "Este é o ponto de partida de uma reconstrução tardia, meses depois, com a pele que ficou",
      modelNote,
    ],
  },
];

const mastectomyPack: Pack = {
  id: "mastectomia-passo-a-passo",
  title: "Mastectomia total",
  summary: "Incisão elíptica com o complexo areolopapilar, retalhos cutâneos, exérese com a fáscia peitoral, leito e fechamento.",
  views: mastectomyViews,
};

export const reconstructionGroup: PackGroup = {
  id: "reconstrucao-mamaria",
  title: "Reconstrução mamária",
  description: "Mastectomia total e reconstrução imediata com retalhos miocutâneos pediculados: grande dorsal (com implante) e TRAM, passo a passo.",
  packs: [mastectomyPack],
};
