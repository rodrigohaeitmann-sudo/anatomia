/**
 * Reduction mammaplasty: pack and cards built from the surgical plans of the pipeline
 * (src/data/mammaplasty.json, written by scripts/hybrid/build_mammaplasty.py). Markings, pedicles and
 * resections are designed on the standing breast with ptosis grade II and moderate hypertrophy; every
 * number shown here was measured on those meshes. Dimensions are proposals to be confirmed.
 */
import anatomy from "@/data/breastAnatomy.json";
import type { AnatomyDetail } from "@/data/anatomyDetails";
import data from "@/data/mammaplasty.json";
import type { Pack, PackLabel, PackView } from "@/data/packs";

type Measurements = {
  notchToAMm: number;
  nippleRiseMm: number;
  linesMm: Record<string, number>;
  pedicleMl: number;
  pedicleG: number;
  resectionMl: number;
  resectionG: number;
  resectionPct: number;
  cut: string[];
  kept: string[];
  limbEndsApartMm?: number;
  horizontalMinusFoldMm?: number;
  openingMm?: number;
};
type Technique = { label: string; pattern: string; pedicle: string; resection: string; marking: string; measurements: Measurements };
type TechniqueId = "pitanguy" | "wise" | "vertical";

const techniques = data.techniques as unknown as Record<TechniqueId, Technique>;
const dims = data.dimensions;
/** Rest-pose anchors of the named points of every marking ("mamo:<technique>:<point>"), in model units. */
export const planPoints = data.points as unknown as Record<string, { rest: [number, number, number]; label: string; note: string }>;
export const planState = data.state;

const cm = (mm: number) => (mm / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// ---- what a technique keeps and cuts, in words ---------------------------------------------------------
const tissueOf = new Map(anatomy.meshes.map((mesh) => [mesh.name, mesh.tissue]));
const branchName: Record<string, string> = {
  lit_ita_perforator_2: "perfurante da torácica interna do 2º espaço",
  lit_ita_perforator_3: "perfurante da torácica interna do 3º espaço",
  lit_ita_perforator_4: "perfurante da torácica interna do 4º espaço",
  lit_lateral_mammary_1: "ramo mamário lateral superior",
  lit_lateral_mammary_2: "ramo mamário lateral inferior",
  lit_intercostal_perforator_4: "perfurante intercostal do 4º espaço",
  lit_intercostal_perforator_5: "perfurante intercostal do 5º espaço",
  lit_intercostal_perforator_6: "perfurante intercostal do 6º espaço",
  lit_thoracoacromial_branch: "ramo da toracoacromial",
  lit_lcb4_deep: "ramo profundo do 4º intercostal",
  lit_lcb4_superficial: "ramo superficial do 4º intercostal",
  lit_lcb_3: "ramo cutâneo lateral do 3º",
  lit_lcb_5: "ramo cutâneo lateral do 5º",
  lit_acb_3: "ramo cutâneo anterior do 3º",
  lit_acb_4: "ramo cutâneo anterior do 4º",
  lit_acb_5: "ramo cutâneo anterior do 5º",
};
const list = (names: string[], tissue: string) => {
  const items = names.filter((name) => tissueOf.get(name) === tissue).map((name) => branchName[name] ?? name);
  return items.length ? items.join("; ") : "nenhum";
};
const supply = (m: Measurements) => [
  `Artérias que chegam ao complexo areolopapilar sem serem cortadas (no modelo): ${list(m.kept, "artery")}`,
  `Artérias seccionadas pela ressecção ou pelas incisões: ${list(m.cut, "artery")}`,
  `Nervos conservados: ${list(m.kept, "nerve")}. Seccionados: ${list(m.cut, "nerve")}`,
];
const proposal = `Dimensões propostas, a confirmar: aréola de ${dims.areolaMm} mm, ramos verticais de ${dims.limbMm / 10} cm, colar de ${dims.rimMm} mm em volta da aréola, ${dims.leftOnFasciaMm} mm de tecido deixados sobre a fáscia`;
const planNote = "Marcação e peças são desenhadas na mama em pé (ptose grau II com hipertrofia moderada) e acompanham a forma da mama; os vasos e nervos são os da camada esquemática";

// ---- cards -----------------------------------------------------------------------------------------------
const text: Record<TechniqueId, { markingSummary: string; markingSteps: string[]; pedicleSummary: string; pedicleNotes: string[]; resectionSummary: string; resectionNotes: string[] }> = {
  pitanguy: {
    markingSummary: "Marcação de Pitanguy na mama em pé. O ponto A fica no meridiano da mama, na projeção do sulco inframamário, e marca a nova posição do mamilo. Dele saem os ramos A–B e A–C; de B e C, as linhas até os extremos da incisão no sulco (D e E). A cicatriz final é um T invertido.",
    markingSteps: ["Não há abertura pré-desenhada para a aréola: sua posição é confirmada no fim, no vértice do cone", "No paciente, B e C são achados pinçando a pele; no modelo, pelo comprimento e pelo ângulo dos ramos"],
    pedicleSummary: `Pedículo superior dermoglandular, com ${dims.superiorThicknessMm} mm de espessura: do sítio da nova aréola ao complexo areolopapilar. A parte alta dos ramos, dentro do pedículo, é só desepitelizada.`,
    pedicleNotes: ["Irrigação pelo plexo subdérmico e pelos perfurantes da torácica interna que descem por cima e por dentro", "A subida do complexo areolopapilar dobra o pedículo: subidas longas e pedículos espessos toleram mal a dobra"],
    resectionSummary: "Ressecção em quilha: o polo inferior entre os ramos, as cunhas sob os retalhos medial e lateral e, sob o pedículo, uma quilha central que se afina para cima.",
    resectionNotes: ["A quilha retira a base glandular atrás do complexo areolopapilar: por isso os ramos profundos (perfurantes intercostais, ramo profundo do 4º intercostal) não chegam ao mamilo nesta técnica", "Os pilares medial e lateral são aproximados sobre o defeito, formando o cone"],
  },
  wise: {
    markingSummary: "Padrão de Wise na mama em pé: abertura circular para a nova aréola em torno do ponto A (a fechadura), dois ramos verticais e dois ramos horizontais até os extremos da incisão no sulco. A cicatriz final é um T invertido.",
    markingSteps: ["O ponto A, na projeção do sulco sobre o meridiano, é o centro da nova aréola", "A soma dos ramos horizontais é maior que a incisão no sulco: a diferença é compensada no fechamento"],
    pedicleSummary: `Pedículo inferior de espessura total: do complexo areolopapilar à base de ${dims.inferiorBaseMm / 10} cm sobre o sulco. Sua raiz continua presa à parede acima do sulco, sob o plano do septo horizontal.`,
    pedicleNotes: ["Irrigação profunda: perfurantes intercostais e ramo da toracoacromial, que sobem pelo septo de Würinger", "Por isso a base não é descolada da fáscia peitoral e mantém a largura", "Os ramos superficiais (torácica interna, torácica lateral) são cortados em volta do pedículo: irrigam os retalhos, não o complexo areolopapilar"],
    resectionSummary: "Ressecção em ferradura: as partes medial e lateral dentro do padrão, o crescente acima do plano do pedículo e as cunhas sob os retalhos medial e lateral.",
    resectionNotes: ["O pedículo fica no centro e a ressecção o contorna por dentro, por fora e por cima", "Os retalhos medial e lateral cobrem o pedículo no fechamento"],
  },
  vertical: {
    markingSummary: "Padrão vertical na mama em pé: uma cúpula sobre a nova aréola, com o topo acima do ponto A, e dois ramos que descem e se encontram acima do sulco. Não há incisão horizontal: a cicatriz é periareolar e vertical.",
    markingSteps: ["O perímetro da cúpula corresponde ao da nova aréola", "Os ramos terminam alguns centímetros acima do sulco, na face inferior da mama: a pele que sobra se acomoda na cicatriz vertical"],
    pedicleSummary: `Pedículo superomedial de espessura total, com base de ${dims.superomedialBaseMm / 10} cm na metade medial da cúpula e no começo do ramo medial. Gira para levar o complexo areolopapilar à nova posição.`,
    pedicleNotes: ["Irrigação pelos perfurantes da torácica interna (2º e 3º espaços), que entram pela base, e pelos ramos profundos que a espessura total conserva", "Os ramos cutâneos anteriores entram pela base"],
    resectionSummary: "Ressecção inferior e lateral: a parte do padrão abaixo da cúpula que não é pedículo e o tecido sob o pilar lateral. Os pilares medial e lateral são unidos na linha vertical.",
    resectionNotes: ["Os ramos laterais (torácica lateral, ramos cutâneos laterais superficiais) ficam na peça ressecada", "O polo inferior é esvaziado: é o que dá a projeção e encurta a distância mamilo–sulco"],
  },
};

const lineText = (key: TechniqueId) => {
  const m = techniques[key].measurements;
  const lines = m.linesMm;
  if (key === "vertical") return [`Cúpula: ${cm(lines["cúpula"])} cm de perímetro`, `Ramos medial e lateral: ${cm(lines["ramo medial"])} e ${cm(lines["ramo lateral"])} cm sobre a pele`];
  return [
    key === "wise" ? `Fechadura: ${cm(lines["fechadura"])} cm de arco; ramos verticais de ${cm(lines["ramo medial"])} cm` : `Ramos A–B e A–C: ${cm(lines["ramo medial"])} cm cada`,
    `B–C em linha reta: ${cm(m.limbEndsApartMm ?? 0)} cm`,
    `Linhas até D e E: ${cm(lines["horizontal medial"])} e ${cm(lines["horizontal lateral"])} cm; incisão no sulco: ${cm(lines["sulco"])} cm (sobram ${cm(m.horizontalMinusFoldMm ?? 0)} cm para compensar)`,
  ];
};
const measures = (key: TechniqueId) => {
  const m = techniques[key].measurements;
  return [`Fúrcula–ponto A: ${cm(m.notchToAMm)} cm; subida do complexo areolopapilar: ${cm(m.nippleRiseMm)} cm sobre a pele`, ...lineText(key)];
};

/** Cards of the plan structures, keyed by structure id. */
export const planDetails: Record<string, AnatomyDetail> = {
  "mamo-reference-lines": {
    summary: "Linhas de referência da marcação: linha média, meridiano da mama (passa pelo mamilo) e sulco inframamário. Acompanham a forma da mama.",
    landmarks: ["O ponto A é a projeção do sulco sobre o meridiano, na face anterior da mama", "O sulco fica oculto pela mama ptótica: veja de baixo ou com a pele translúcida"],
  },
};
(Object.keys(techniques) as TechniqueId[]).forEach((key) => {
  const t = techniques[key];
  const m = t.measurements;
  planDetails[`mamo-marking-${key}`] = { summary: text[key].markingSummary, landmarks: measures(key), surgical: [...text[key].markingSteps, proposal] };
  planDetails[`mamo-pedicle-${key}`] = {
    summary: text[key].pedicleSummary,
    vascularization: supply(m)[0].replace(" (no modelo)", "") + ".",
    innervation: `Conservados: ${list(m.kept, "nerve")}.`,
    landmarks: [`Volume no modelo: ${m.pedicleMl} mL, cerca de ${m.pedicleG} g`],
    surgical: [...text[key].pedicleNotes, planNote],
  };
  planDetails[`mamo-resection-${key}`] = {
    summary: text[key].resectionSummary,
    landmarks: [`Volume no modelo: ${m.resectionMl} mL, cerca de ${m.resectionG} g (densidade ${dims.densityGPerMl.toLocaleString("pt-BR")} g/mL): ${m.resectionPct}% do monte de ${dims.moundMl} mL`, `Leva consigo: ${list(m.cut, "artery")}`],
    surgical: [...text[key].resectionNotes, proposal],
  };
});

// ---- pack ------------------------------------------------------------------------------------------------
const pointLabels = (key: TechniqueId, names: string[]): PackLabel[] =>
  names.map((name) => ({ structure: `mamo-marking-${key}`, near: `mamo:${key}:${name}`, text: `${name}: ${planPoints[`mamo:${key}:${name}`].note}` }));
const arteries = ["internal-thoracic-perforators", "lateral-mammary-branches", "intercostal-perforators", "thoracoacromial-mammary-branch"];

function views(key: TechniqueId, points: string[]): PackView[] {
  const t = techniques[key];
  const m = t.measurements;
  const marking = `mamo-marking-${key}`;
  const pedicle = `mamo-pedicle-${key}`;
  const resection = `mamo-resection-${key}`;
  const short = t.label.split(" ")[0];
  return [
    {
      id: `${key}-marcacao`,
      title: `${short}: marcação`,
      description: text[key].markingSummary,
      structures: ["skin", "nipple-areola", "contralateral-breast", "mamo-reference-lines", marking],
      solid: ["skin"],
      orientation: "anterior",
      anchor: "nipple",
      distance: 0.4,
      breast: planState,
      labels: pointLabels(key, points),
      relations: [...measures(key), ...text[key].markingSteps, proposal],
    },
    {
      id: `${key}-pediculo`,
      title: `${short}: pedículo ${t.pedicle}`,
      description: text[key].pedicleSummary,
      structures: ["skin", "nipple-areola", marking, pedicle, ...arteries, "fourth-intercostal-lateral-branch", "horizontal-septum", "internal-thoracic-vessels", "lateral-thoracic-vessels", "chest-wall", "costal-cartilages"],
      focus: [pedicle],
      orientation: "anterolateral",
      anchor: "nipple",
      distance: 0.55,
      breast: planState,
      labels: [
        { structure: pedicle, near: "nipple", text: `Pedículo ${t.pedicle}` },
        { structure: marking, near: `mamo:${key}:A`, text: "A: novo mamilo" },
      ],
      relations: [`Volume do pedículo no modelo: ${m.pedicleMl} mL, cerca de ${m.pedicleG} g`, ...supply(m), ...text[key].pedicleNotes, planNote],
    },
    {
      id: `${key}-resseccao`,
      title: `${short}: ressecção ${t.resection}`,
      description: text[key].resectionSummary,
      structures: ["skin", "nipple-areola", marking, pedicle, resection],
      focus: [resection],
      orientation: "anterolateral",
      anchor: "nipple",
      distance: 0.55,
      breast: planState,
      labels: [
        { structure: resection, near: "inframammaryFold", nearOffsetMm: [0, -30, 30], text: `Ressecção ${t.resection}` },
        { structure: pedicle, near: "nipple", text: `Pedículo ${t.pedicle}` },
      ],
      relations: [`Peça ressecada no modelo: ${m.resectionMl} mL, cerca de ${m.resectionG} g: ${m.resectionPct}% do monte de ${dims.moundMl} mL`, ...text[key].resectionNotes, proposal, planNote],
    },
  ];
}

export const mammaplastyPack: Pack = {
  id: "mamoplastia-redutora",
  title: "Mamoplastia redutora",
  summary: "Três técnicas sobre a mama com ptose grau II e hipertrofia moderada: Pitanguy (pedículo superior), Wise com pedículo inferior e vertical com pedículo superomedial. Para cada uma: a marcação na pele, o pedículo com os vasos que conserva e a peça ressecada, com volume e peso estimados.",
  views: [...views("pitanguy", ["A", "B", "C", "D", "E"]), ...views("wise", ["A", "B", "C", "D", "E"]), ...views("vertical", ["A", "T", "M", "L", "F"])],
};
