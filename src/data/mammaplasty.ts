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
import { stepMeasurements, stepPillarVolumes, type StepMeasurements } from "@/lib/mammaplastySteps";

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

// ---- step by step: what leaves and where the rest goes (src/data/mammaplastySteps.json) ----------------------
type StepText = {
  /** what is cut and de-epithelialised */
  incision: string;
  /** what leaves the breast */
  resection: string;
  /** how the nipple-areola complex reaches point A */
  transposition: string;
  /** how the rest closes over it */
  closure: string;
  /** scars, in order of the scar meshes */
  scars: string[];
  pillar: "Pilar" | "Retalho";
  notes: { incision: string[]; resection: string[]; transposition: string[]; closure: string[]; result: string[] };
};
const stepText: Record<TechniqueId, StepText> = {
  pitanguy: {
    incision: "Incisão sobre toda a marcação. A pele entre os ramos e acima de B e C, onde fica o pedículo superior, é só desepitelizada: a derme fica e leva o plexo subdérmico ao complexo areolopapilar.",
    resection: "Sai em bloco a pele do polo inferior entre os ramos, até o sulco, junto com a quilha: o tecido central sob o pedículo e as cunhas sob os retalhos medial e lateral.",
    transposition: "O complexo areolopapilar sobe com o pedículo superior até o ponto A. A derme desepitelizada se dobra sob o novo sítio da aréola.",
    closure: "Os pilares medial e lateral giram para o centro e se encontram abaixo da aréola (sutura vertical); suas bordas inferiores, B–D e C–E, são suturadas na incisão do sulco (sutura horizontal). O pedículo fica coberto pelos pilares e pela pele.",
    scars: ["Cicatriz periareolar", "Cicatriz vertical", "Cicatriz no sulco"],
    pillar: "Pilar",
    notes: {
      incision: ["A incisão do sulco vai de D a E; os ramos A–B e A–C desenham o cone", "Na prática, B e C são confirmados pinçando a pele antes de incisar"],
      resection: ["A quilha tira a base glandular atrás do complexo areolopapilar: os ramos profundos não chegam mais ao mamilo", "O que fica: o pedículo superior e os pilares medial e lateral"],
      transposition: ["A subida é curta (o ponto A fica na projeção do sulco): o pedículo dobra sem tensão", "Pedículos espessos e subidas longas toleram mal a dobra"],
      closure: ["Os pilares formam o cone e dão a projeção", "A pele que sobra nos ramos horizontais é distribuída ao longo do sulco"],
      result: ["Cicatriz em T invertido com a periareolar", "O polo inferior encurta: a distância mamilo–sulco cai"],
    },
  },
  wise: {
    incision: "Incisão em toda a marcação, em volta da fechadura e dos ramos. O pedículo inferior, do complexo areolopapilar ao sulco, é desepitelizado: a derme fica sobre ele.",
    resection: "Saem a pele dentro do padrão (a fechadura e os triângulos medial e lateral, fora do pedículo) e a ressecção em ferradura: o tecido medial, lateral e superior ao pedículo e as cunhas sob os retalhos.",
    transposition: "O pedículo inferior, preso ao sulco e à parede, leva o complexo areolopapilar para cima até a fechadura, em volta do ponto A.",
    closure: "Os retalhos medial e lateral (pele com a glândula que ficou sob ela) descem e se fecham sobre o pedículo: encontram-se na linha vertical, da fechadura ao sulco, e suas bordas inferiores são suturadas ao longo do sulco. A aréola é suturada na fechadura.",
    scars: ["Cicatriz periareolar", "Cicatriz vertical", "Cicatriz no sulco"],
    pillar: "Retalho",
    notes: {
      incision: ["A base do pedículo fica no sulco, com a largura da marcação", "A soma dos ramos horizontais é maior que a incisão do sulco: o excesso é distribuído na sutura"],
      resection: ["O pedículo fica no centro e a ressecção o contorna", "O pedículo inferior é o maior dos três: carrega o polo inferior e a irrigação profunda pelo septo"],
      transposition: ["A raiz do pedículo não se move: sobem o complexo areolopapilar e a parte alta do pedículo", "Os perfurantes intercostais e o ramo da toracoacromial entram pela base"],
      closure: ["Os retalhos cobrem o pedículo como uma capa e dão a forma", "O pedículo fica sepultado sob os retalhos"],
      result: ["Cicatriz em T invertido com a periareolar", "O volume do pedículo fica no polo inferior: a projeção é mantida"],
    },
  },
  vertical: {
    incision: "Incisão em volta da cúpula e dos ramos. O pedículo superomedial, com base na metade medial da cúpula e no começo do ramo medial, é desepitelizado.",
    resection: "Saem a pele do padrão abaixo da cúpula (fora do pedículo) e a ressecção inferior e lateral: o polo inferior e o tecido sob o pilar lateral.",
    transposition: "O pedículo superomedial gira sobre a base e leva o complexo areolopapilar até a cúpula, no ponto A.",
    closure: "Os pilares medial e lateral são suturados entre si abaixo da aréola: estreitam a base e projetam a mama. A pele é fechada na linha vertical, que termina acima do sulco; a cúpula envolve a aréola.",
    scars: ["Cicatriz periareolar", "Cicatriz vertical"],
    pillar: "Pilar",
    notes: {
      incision: ["O perímetro da cúpula corresponde ao da nova aréola", "Os ramos terminam acima do sulco: não há incisão horizontal"],
      resection: ["Os ramos laterais (torácica lateral, cutâneos laterais superficiais) saem com a peça", "O que fica: o pedículo superomedial e os pilares"],
      transposition: ["É uma rotação, não uma dobra: a base fica medial e alta", "Perfurantes da torácica interna do 2º e 3º espaços entram pela base"],
      closure: ["A sutura dos pilares, não a da pele, sustenta a forma", "A pele que sobra na parte baixa da cicatriz vertical se acomoda em semanas"],
      result: ["Cicatriz periareolar e vertical, sem cicatriz no sulco", "O polo inferior esvaziado encurta a distância mamilo–sulco"],
    },
  },
};

const tints = { excised: "#e9a27f", dermis: "#d97a82" };
const signed = (mm: number) => `${cm(Math.abs(mm))} cm ${mm >= 0 ? "acima" : "abaixo"} do sulco`;
/** Before and after, measured on the model as a tape would. */
const beforeAfter = (m: { before: StepMeasurements; after: StepMeasurements }) => [
  `Mamilo: ${signed(m.before.nippleToFoldMm)} → ${signed(m.after.nippleToFoldMm)}`,
  `Fúrcula–mamilo: ${cm(m.before.notchToNippleMm)} → ${cm(m.after.notchToNippleMm)} cm`,
  `Mamilo–sulco sobre a pele: ${cm(m.before.nippleToFoldSkinMm)} → ${cm(m.after.nippleToFoldSkinMm)} cm`,
  `Projeção: ${cm(m.before.projectionMm)} → ${cm(m.after.projectionMm)} cm; volume ≈ ${Math.round(m.before.volumeMl / 10) * 10} → ${Math.round(m.after.volumeMl / 10) * 10} mL`,
];
const stepNote = "Modelo geométrico em pé, não simulação física: a pele que fica se fecha nas linhas de sutura e a mama assume a forma da nova posição, sem edema, retração ou acomodação";

function stepViews(key: TechniqueId, points: string[]): PackView[] {
  const t = techniques[key];
  const m = t.measurements;
  const s = stepText[key];
  const result = stepMeasurements(key);
  const pillarsMl = stepPillarVolumes(key);
  const id = (part: string) => `mamo-step-${part}-${key}`;
  const skin = id("skin");
  const excised = id("excised");
  const dermis = id("dermis");
  const pedicle = id("pedicle");
  const resection = id("resection");
  const medial = id("pillar-medial");
  const lateral = id("pillar-lateral");
  const nac = id("nac");
  const scars = id("scars");
  const marking = `mamo-marking-${key}`;
  const skinParts = [skin, excised, dermis];
  const pieces = [pedicle, resection, medial, lateral];
  const label = (structure: string, piece: string, text: string): PackLabel => ({ structure, near: `step:${key}:${piece}`, text });
  const pillarLabels = [label(medial, "pillar-medial", `${s.pillar} medial (${pillarsMl.medial} mL)`), label(lateral, "pillar-lateral", `${s.pillar} lateral (${pillarsMl.lateral} mL)`)];
  // one camera for the whole sequence (see AnatomyViewer): the tissue moves, the point of view stays
  const common = { orientation: "frontal" as const, anchor: `step:${key}:centre`, distance: 0.55, breast: planState, follow: false };
  const removed = `Sai: ${m.resectionMl} mL de tecido (cerca de ${m.resectionG} g, ${m.resectionPct}% do monte) e a pele do padrão`;
  return [
    {
      ...common,
      id: `${key}-passo-marcacao`,
      title: "1. Marcação",
      description: `${text[key].markingSummary} Nesta sequência, cada passo anima o tecido a partir do anterior.`,
      structures: ["skin", "contralateral-breast", ...skinParts, nac, marking],
      solid: ["skin", ...skinParts],
      labels: pointLabels(key, points),
      surgery: { technique: key, frame: 0 },
      relations: [...measures(key), ...text[key].markingSteps, "A paciente está em pé, como na marcação"],
    },
    {
      ...common,
      id: `${key}-passo-incisao`,
      title: "2. Incisão",
      description: s.incision,
      structures: ["skin", "contralateral-breast", ...skinParts, nac, marking],
      solid: ["skin", ...skinParts],
      tint: { [excised]: tints.excised, [dermis]: tints.dermis },
      labels: [label(excised, "excised", "Pele a ressecar"), label(dermis, "dermis", "Derme desepitelizada (sobre o pedículo)")],
      surgery: { technique: key, frame: 1, replayFrom: null },
      relations: [`Pele laranja: sai com a peça. Pele rosada: perde só a epiderme e fica sobre o pedículo ${t.pedicle}`, ...s.notes.incision],
    },
    {
      ...common,
      id: `${key}-passo-resseccao`,
      title: "3. Ressecção",
      description: s.resection,
      structures: ["skin", "contralateral-breast", ...skinParts, nac, ...pieces],
      translucent: [skin],
      tint: { [excised]: tints.excised, [dermis]: tints.dermis },
      focus: [resection, excised],
      labels: [label(resection, "resection", `Ressecção ${t.resection}: ${m.resectionMl} mL`), label(excised, "excised", "Pele ressecada"), label(pedicle, "pedicle", `Pedículo ${t.pedicle} (${m.pedicleMl} mL)`), ...pillarLabels],
      surgery: { technique: key, frame: 2 },
      relations: [removed, `Fica: o pedículo ${t.pedicle} (verde, ${m.pedicleMl} mL) e os ${s.pillar === "Pilar" ? "pilares" : "retalhos"} medial (${pillarsMl.medial} mL) e lateral (${pillarsMl.lateral} mL)`, ...s.notes.resection],
    },
    {
      ...common,
      id: `${key}-passo-transposicao`,
      title: "4. Transposição",
      description: s.transposition,
      structures: ["skin", "contralateral-breast", ...skinParts, nac, ...pieces],
      translucent: [skin, excised, resection],
      tint: { [excised]: tints.excised, [dermis]: tints.dermis },
      focus: [pedicle, nac],
      labels: [label(nac, "nac", `Complexo areolopapilar: sobe ${cm(m.nippleRiseMm)} cm até A`), label(pedicle, "pedicle", `Pedículo ${t.pedicle}`)],
      surgery: { technique: key, frame: 3 },
      relations: [`O mamilo sobe ${cm(m.nippleRiseMm)} cm sobre a pele, até o ponto A (fúrcula–A: ${cm(m.notchToAMm)} cm)`, ...s.notes.transposition],
    },
    {
      ...common,
      id: `${key}-passo-fechamento`,
      title: "5. Fechamento",
      description: s.closure,
      structures: ["skin", "contralateral-breast", ...skinParts, nac, ...pieces],
      translucent: [skin, excised, resection],
      tint: { [excised]: tints.excised, [dermis]: tints.dermis },
      focus: [medial, lateral],
      labels: [...pillarLabels, label(pedicle, "pedicle", `Pedículo ${t.pedicle}, sepultado`)],
      surgery: { technique: key, frame: 4 },
      relations: [...s.notes.closure, `${s.pillar === "Pilar" ? "Pilares" : "Retalhos"}: medial ${pillarsMl.medial} mL, lateral ${pillarsMl.lateral} mL`, stepNote],
    },
    {
      ...common,
      id: `${key}-passo-resultado`,
      title: "6. Resultado esperado",
      description: `Mama operada em pé, com as cicatrizes da técnica: ${s.scars.map((item) => item.toLowerCase().replace("cicatriz ", "")).join(", ")}. A outra mama segue como antes, para comparar.`,
      structures: ["skin", "contralateral-breast", skin, nac, scars],
      solid: ["skin", skin],
      labels: [...s.scars.map((text, index) => label(scars, `scar-${index}`, text)), label(nac, "nac", "Mamilo no ponto A")],
      // only skin, nipple and scars: shown at once (the closure, view 5, is where the tissue moves)
      surgery: { technique: key, frame: 4, replayFrom: null, instant: true },
      relations: [...beforeAfter(result), ...s.notes.result, stepNote],
    },
  ];
}

// cards of the step pieces (tap on the model)
(Object.keys(techniques) as TechniqueId[]).forEach((key) => {
  const t = techniques[key];
  const m = t.measurements;
  const s = stepText[key];
  const pillarsMl = stepPillarVolumes(key);
  const after = stepMeasurements(key).after;
  const flaps = s.pillar === "Pilar" ? "pilares" : "retalhos";
  planDetails[`mamo-step-skin-${key}`] = {
    summary: "Pele que fica: no fechamento, suas bordas se encontram nas linhas de sutura e ela recobre a nova forma da mama. Em volta, uma faixa de 15 mm leva a pele operada até a pele que não muda.",
    surgical: [s.closure, stepNote],
  };
  planDetails[`mamo-step-excised-${key}`] = {
    summary: `Pele ressecada: a pele dentro do padrão de ${t.label}, fora do pedículo. Sai com a peça.`,
    surgical: [s.resection],
  };
  planDetails[`mamo-step-dermis-${key}`] = {
    summary: `Derme desepitelizada sobre o pedículo ${t.pedicle}: perde a epiderme e fica, levando o plexo subdérmico ao complexo areolopapilar. No fechamento fica sob a pele.`,
    surgical: [s.incision],
  };
  planDetails[`mamo-step-pedicle-${key}`] = { ...planDetails[`mamo-pedicle-${key}`], surgical: [s.transposition, ...(planDetails[`mamo-pedicle-${key}`].surgical ?? [])] };
  planDetails[`mamo-step-resection-${key}`] = planDetails[`mamo-resection-${key}`];
  for (const side of ["medial", "lateral"] as const) {
    planDetails[`mamo-step-pillar-${side}-${key}`] = {
      summary: `${s.pillar} ${side}: o tecido que fica sob a pele ${side} do padrão, com ${pillarsMl[side]} mL no modelo. No fechamento vai para o centro, abaixo da aréola.`,
      surgical: [s.closure],
    };
  }
  planDetails[`mamo-step-nac-${key}`] = {
    summary: `Complexo areolopapilar: sobe ${cm(m.nippleRiseMm)} cm sobre a pele com o pedículo ${t.pedicle} e chega ao ponto A. No resultado, o mamilo fica ${cm(after.nippleToFoldMm)} cm acima do sulco.`,
    surgical: [s.transposition],
  };
  planDetails[`mamo-step-scars-${key}`] = {
    summary: `Cicatrizes do resultado esperado: ${s.scars.map((item) => item.toLowerCase().replace("cicatriz ", "")).join(", ")}.`,
    surgical: [...s.notes.result, `Os ${flaps} e a pele se fecham sem tensão no modelo; na paciente, a cicatriz amadurece em meses`],
  };
});

/** One pack per technique: from the marking to the expected result, every step animated from the one before. */
export const mammaplastyStepPacks: Pack[] = (["pitanguy", "wise", "vertical"] as TechniqueId[]).map((key) => {
  const t = techniques[key];
  const points = key === "vertical" ? ["A", "T", "M", "L", "F"] : ["A", "B", "C", "D", "E"];
  return {
    id: `mamoplastia-${key}-passo-a-passo`,
    title: `${t.label}: passo a passo`,
    summary: `Da marcação ao resultado esperado, com a paciente em pé: o que é ressecado, para onde vão o complexo areolopapilar, o pedículo ${t.pedicle} e os ${stepText[key].pillar === "Pilar" ? "pilares" : "retalhos"}, e como a pele se fecha. Cada passo é animado a partir do anterior; "Rever" repete a animação.`,
    views: stepViews(key, points),
  };
});

export const mammaplastyPack: Pack = {
  id: "mamoplastia-redutora",
  title: "Mamoplastia redutora",
  summary: "Três técnicas sobre a mama com ptose grau II e hipertrofia moderada: Pitanguy (pedículo superior), Wise com pedículo inferior e vertical com pedículo superomedial. Para cada uma: a marcação na pele, o pedículo com os vasos que conserva e a peça ressecada, com volume e peso estimados.",
  views: [...views("pitanguy", ["A", "B", "C", "D", "E"]), ...views("wise", ["A", "B", "C", "D", "E"]), ...views("vertical", ["A", "T", "M", "L", "F"])],
};
