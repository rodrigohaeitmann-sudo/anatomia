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
import { stepBranches, stepFramesOf, stepMeasurements, stepMeasures, stepPillarVolumes, type StepMeasurements } from "@/lib/mammaplastySteps";

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
const proposal = `Dimensões aceitas na revisão: aréola de ${dims.areolaMm} mm, ramos verticais de ${dims.limbMm / 10} cm, colar de ${dims.rimMm} mm em volta da aréola, ${dims.leftOnFasciaMm} mm de tecido deixados sobre a fáscia`;
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
const measures_ = (key: TechniqueId) => {
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
  planDetails[`mamo-marking-${key}`] = { summary: text[key].markingSummary, landmarks: measures_(key), surgical: [...text[key].markingSteps, proposal] };
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
      relations: [...measures_(key), ...text[key].markingSteps, proposal],
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

// ---- step by step: what leaves, where the rest goes, what is sutured to what (src/data/mammaplastySteps.json) ------
type Stage = { title: string; text: string; seams: string[]; notes: string[]; solid?: boolean };
type StepText = {
  /** what is cut and de-epithelialised */
  incision: string;
  /** what leaves the breast */
  resection: string;
  /** how the nipple-areola complex reaches point A */
  transposition: string;
  /** the stages of the closure, by key frame id */
  closure: Record<string, Stage>;
  /** what each suture joins */
  seams: Record<string, string>;
  /** labels of the lines of the marking (by line name; {mm} is replaced by the length) */
  lines: Record<string, string>;
  /** scars, in order of the scar meshes */
  scars: string[];
  pillar: "Pilar" | "Retalho";
  notes: { incision: string[]; resection: string[]; transposition: string[]; result: string[] };
};
const stepText: Record<TechniqueId, StepText> = {
  pitanguy: {
    incision: "Incisão sobre toda a marcação. A pele entre os ramos e acima de B e C, onde fica o pedículo superior, é só desepitelizada: a derme fica e leva o plexo subdérmico ao complexo areolopapilar. O anel da aréola além do areolótomo é desepitelizado com ela.",
    resection: "Sai em bloco a pele do polo inferior entre os ramos, até o sulco, junto com a quilha: o tecido central sob o pedículo e as cunhas sob os retalhos medial e lateral.",
    transposition: "O complexo areolopapilar sobe com o pedículo superior até o ponto A. A derme desepitelizada se dobra sob o novo sítio da aréola, e os perfurantes da torácica interna que entram pela base do pedículo se dobram com ela.",
    closure: {
      pilares: { title: "Pilares", text: "Os pilares medial e lateral giram para o centro e são unidos abaixo da aréola por pontos profundos (azul): formam o cone e cobrem o pedículo. A pele ainda está aberta.", seams: ["deep"], notes: ["Os pontos profundos unem o tecido dos pilares, não a pele", "A pele acompanha os pilares, mas as bordas ainda não se tocam"] },
      vertical: { title: "Ponto em T e sutura vertical", text: "Ponto-chave em T: B e C vão ao meio da incisão do sulco (laranja). Em seguida os ramos A–B e A–C são suturados um ao outro (amarelo): é a cicatriz vertical, de A até o sulco.", seams: ["T", "vertical"], notes: ["O ponto em T fixa o encontro das três cicatrizes", "As linhas ainda abertas mostram quem será suturado com quem"] },
      sulco: { title: "Sutura no sulco: pele fechada", text: "Os ramos horizontais B–D e C–E são suturados à incisão do sulco (ciano e verde); o excesso de pele dos ramos é distribuído ao longo dela. A pele fica fechada inteira: o complexo areolopapilar está sob ela, no vértice do cone.", seams: ["fold-medial", "fold-lateral"], notes: ["No Pitanguy não se abre espaço para a aréola antes: ela é posicionada no fim", "A pele que cobre a aréola é a dos dois retalhos, unidos na linha vertical"], solid: true },
      "marca-areola": { title: "Marcação da nova aréola", text: "Com a paciente sentada, a nova aréola é marcada no vértice do cone com o marcador de 4,2 cm, sobre o complexo areolopapilar.", seams: [], notes: ["A posição é conferida com a mama já moldada: é por isso que o Pitanguy não a desenha na marcação inicial"], solid: true },
      abertura: { title: "Abertura da aréola", text: "O disco de pele marcado é retirado e o complexo areolopapilar é exteriorizado pela abertura e suturado à pele em volta (rosa): a cicatriz periareolar.", seams: ["areola"], notes: ["A aréola reduzida pelo areolótomo cabe na abertura do mesmo diâmetro"], solid: true },
    },
    seams: { T: "Ponto em T: B e C no meio do sulco", vertical: "A–B com A–C: sutura vertical", "fold-medial": "B–D com o sulco, metade medial", "fold-lateral": "C–E com o sulco, metade lateral", areola: "Aréola com a abertura: periareolar", deep: "Pilar medial com pilar lateral: pontos profundos" },
    lines: { "ramo medial": "A–B {mm}", "ramo lateral": "A–C {mm}", "horizontal medial": "B–D {mm}", "horizontal lateral": "C–E {mm}", sulco: "D–E {mm}" },
    scars: ["Cicatriz periareolar", "Cicatriz vertical", "Cicatriz no sulco"],
    pillar: "Pilar",
    notes: {
      incision: ["A incisão do sulco vai de D a E; os ramos A–B e A–C desenham o cone", "Na prática, B e C são confirmados pinçando a pele antes de incisar"],
      resection: ["A quilha tira a base glandular atrás do complexo areolopapilar: os ramos profundos não chegam mais ao mamilo", "O que fica: o pedículo superior e os pilares medial e lateral"],
      transposition: ["A subida é curta (o ponto A fica na projeção do sulco): o pedículo dobra sem tensão", "Pedículos espessos e subidas longas toleram mal a dobra"],
      result: ["Cicatriz em T invertido com a periareolar", "O polo inferior encurta: a distância mamilo–sulco cai"],
    },
  },
  wise: {
    incision: "Incisão em toda a marcação, em volta da fechadura e dos ramos. O pedículo inferior, do complexo areolopapilar ao sulco, é desepitelizado: a derme fica sobre ele. O anel da aréola além do areolótomo é desepitelizado com ele.",
    resection: "Saem a pele dentro do padrão (a fechadura e os triângulos medial e lateral, fora do pedículo) e a ressecção em ferradura: o tecido medial, lateral e superior ao pedículo e as cunhas sob os retalhos.",
    transposition: "O pedículo inferior, preso ao sulco e à parede, leva o complexo areolopapilar para cima até a fechadura, em volta do ponto A. Os perfurantes intercostais e o ramo da toracoacromial sobem com ele.",
    closure: {
      "ponto-t": { title: "Ponto em T", text: "Ponto-chave em T: B e C, os fins dos ramos verticais, são levados ao meio da incisão do sulco (laranja). Os retalhos medial e lateral começam a cobrir o pedículo.", seams: ["T"], notes: ["O ponto em T define o encontro das três cicatrizes e reparte a tensão", "As linhas ainda abertas mostram quem será suturado com quem"] },
      vertical: { title: "Sutura vertical", text: "Os ramos verticais são suturados um ao outro sobre o pedículo (amarelo), da fechadura até o T. Por baixo, os retalhos são unidos por pontos profundos (azul).", seams: ["vertical", "deep"], notes: ["A sutura vertical fica sobre o pedículo, que segue irrigado pela base"] },
      sulco: { title: "Sutura no sulco", text: "Os ramos horizontais B–D e C–E são suturados à incisão do sulco (ciano e verde), distribuindo o excesso de pele ao longo dela. O pedículo fica sepultado sob os retalhos.", seams: ["fold-medial", "fold-lateral"], notes: ["A soma dos ramos horizontais é maior que o sulco: o excesso é distribuído ponto a ponto"] },
      areola: { title: "Sutura da aréola", text: "O complexo areolopapilar, no alto do pedículo, é suturado na fechadura (rosa): a cicatriz periareolar.", seams: ["areola"], notes: ["A fechadura de 4,2 cm recebe a aréola reduzida pelo areolótomo"] },
    },
    seams: { T: "Ponto em T: B e C no meio do sulco", vertical: "Ramo vertical medial com o lateral", "fold-medial": "B–D com o sulco, metade medial", "fold-lateral": "C–E com o sulco, metade lateral", areola: "Fechadura com a aréola: periareolar", deep: "Retalho medial com o lateral: pontos profundos" },
    lines: { fechadura: "Fechadura {mm}", "ramo medial": "Pilar vertical {mm}", "ramo lateral": "Pilar vertical {mm}", "horizontal medial": "B–D {mm}", "horizontal lateral": "C–E {mm}", sulco: "D–E {mm}" },
    scars: ["Cicatriz periareolar", "Cicatriz vertical", "Cicatriz no sulco"],
    pillar: "Retalho",
    notes: {
      incision: ["A base do pedículo fica no sulco, com a largura da marcação", "A soma dos ramos horizontais é maior que a incisão do sulco: a diferença é distribuída na sutura"],
      resection: ["O pedículo fica no centro e a ressecção o contorna", "O pedículo inferior é o maior dos três: carrega o polo inferior e a irrigação profunda pelo septo"],
      transposition: ["A raiz do pedículo não se move: sobem o complexo areolopapilar e a parte alta do pedículo, e os vasos se dobram com ela", "Os perfurantes intercostais e o ramo da toracoacromial entram pela base"],
      result: ["Cicatriz em T invertido com a periareolar", "O volume do pedículo fica no polo inferior: a projeção é mantida"],
    },
  },
  vertical: {
    incision: "Incisão em volta da cúpula e dos ramos. O pedículo superomedial, com base na metade medial da cúpula e no começo do ramo medial, é desepitelizado; o anel da aréola além do areolótomo também.",
    resection: "Saem a pele do padrão abaixo da cúpula (fora do pedículo) e a ressecção inferior e lateral: o polo inferior e o tecido sob o pilar lateral.",
    transposition: "O pedículo superomedial gira sobre a base e leva o complexo areolopapilar até a cúpula, no ponto A. Os perfurantes da torácica interna que entram pela base giram com ele.",
    closure: {
      pilares: { title: "Pilares", text: "Os pilares medial e lateral são suturados um ao outro abaixo da aréola (azul): estreitam a base e projetam a mama. A pele ainda está aberta.", seams: ["deep"], notes: ["É a sutura dos pilares, não a da pele, que sustenta a forma"] },
      vertical: { title: "Sutura vertical", text: "A pele é fechada na linha vertical (amarelo), sobre os pilares; a cicatriz termina acima do sulco e a pele que sobra se acomoda nela.", seams: ["vertical"], notes: ["O franzido da parte baixa da cicatriz se desfaz em semanas"] },
      areola: { title: "Sutura da aréola", text: "A cúpula envolve a aréola e é suturada em volta dela (rosa): a cicatriz periareolar.", seams: ["areola"], notes: ["O perímetro da cúpula corresponde ao da aréola de 4,2 cm"] },
    },
    seams: { vertical: "Ramo medial com o lateral: sutura vertical", areola: "Cúpula com a aréola: periareolar", deep: "Pilar medial com o lateral: pontos profundos" },
    lines: { "cúpula": "Cúpula {mm}", "ramo medial": "M–F {mm}", "ramo lateral": "L–F {mm}" },
    scars: ["Cicatriz periareolar", "Cicatriz vertical"],
    pillar: "Pilar",
    notes: {
      incision: ["O perímetro da cúpula corresponde ao da nova aréola", "Os ramos terminam acima do sulco: não há incisão horizontal"],
      resection: ["Os ramos laterais (torácica lateral, cutâneos laterais superficiais) saem com a peça", "O que fica: o pedículo superomedial e os pilares"],
      transposition: ["É uma rotação, não uma dobra: a base fica medial e alta", "Perfurantes da torácica interna do 2º e 3º espaços entram pela base"],
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
const branchList = (names: string[]) => names.map((name) => branchName[name] ?? name).join("; ") || "nenhum";

function stepViews(key: TechniqueId): PackView[] {
  const t = techniques[key];
  const m = t.measurements;
  const s = stepText[key];
  const frames = stepFramesOf(key);
  const frameOf = (frame: string) => frames.findIndex((item) => item.id === frame);
  const last = frames.length - 1;
  const result = stepMeasurements(key);
  const sizes = stepMeasures(key);
  const branches = stepBranches(key);
  const pillarsMl = stepPillarVolumes(key);
  const id = (part: string) => `mamo-step-${part}-${key}`;
  const [skin, excised, dermis, pedicle, resection, medial, lateral] = ["skin", "excised", "dermis", "pedicle", "resection", "pillar-medial", "pillar-lateral"].map(id);
  const [nac, ring, tome, measures, arteries, sutures, areolaSuture, cover, coverRing, scars] = ["nac", "areola-ring", "areolotome", "measures", "arteries", "sutures", "sutures-areola", "disc", "disc-ring", "scars"].map(id);
  const marking = `mamo-marking-${key}`;
  const skinParts = [skin, excised, dermis];
  const areola = [nac, ring];
  const pieces = [pedicle, resection, medial, lateral];
  const label = (structure: string, piece: string, text: string): PackLabel => ({ structure, near: `step:${key}:${piece}`, text });
  const tint = { [excised]: tints.excised, [dermis]: tints.dermis, [ring]: tints.dermis };
  const flaps = s.pillar === "Pilar" ? "pilares" : "retalhos";
  const pillarLabels = [label(medial, "pillar-medial", `${s.pillar} medial (${pillarsMl.medial} mL)`), label(lateral, "pillar-lateral", `${s.pillar} lateral (${pillarsMl.lateral} mL)`)];
  // one camera for the whole sequence (see AnatomyViewer): the tissue moves, the point of view stays
  const common = { orientation: "frontal" as const, anchor: `step:${key}:centre`, distance: 0.55, breast: planState, follow: false };
  const surgery = (frame: number, extra: Partial<NonNullable<PackView["surgery"]>> = {}) => ({ technique: key, frame, ...extra });
  const areolaText = `Aréola: ${cm(sizes.areolaNowMm)} cm, alargada pela hipertrofia → ${cm(sizes.areolaNewMm)} cm com o areolótomo`;
  const ascension = `Ascensão do complexo areolopapilar (mamilo → A, sobre a pele): ${cm(sizes.ascensionMm)} cm`;
  const lineLabels = Object.entries(s.lines).map(([line, text]) => ({ structure: marking, near: `step:${key}:line:${line}`, text: text.replace("{mm}", `${cm(m.linesMm[line] ?? 0)} cm`) }));
  const measureLabels: PackLabel[] = [label(measures, "measure-ascension", `Ascensão ${cm(sizes.ascensionMm)} cm`), ...(sizes.bcMm ? [label(measures, "measure-bc", `B–C ${cm(sizes.bcMm)} cm`)] : [])];
  const seamLabels = (seams: string[]) => seams.map((seam) => label(seam === "areola" ? areolaSuture : sutures, `seam-${seam}`, s.seams[seam]));
  const removed = `Sai: ${m.resectionMl} mL de tecido (cerca de ${m.resectionG} g, ${m.resectionPct}% do monte) e a pele do padrão`;
  const vessels = `Artérias da mama: em vermelho vivo as que o pedículo conserva até o mamilo (${branchList(branches.artery)}); em vermelho escuro as cortadas, cujo trecho na peça sai com ela. Os nervos (menu de estruturas ou botão Vasos) seguem a mesma regra`;

  const views: PackView[] = [
    {
      ...common,
      id: `${key}-passo-marcacao`,
      title: "1. Marcação",
      orientation: "inferior",
      distance: 0.5,
      description: `${text[key].markingSummary} As medidas estão sobre a pele, em pé; cada passo seguinte é animado a partir do anterior.`,
      structures: ["skin", "contralateral-breast", ...skinParts, ...areola, tome, marking, measures],
      solid: ["skin", ...skinParts],
      labels: [...lineLabels, ...measureLabels],
      surgery: surgery(0, { replayFrom: null }),
      relations: [...measures_(key), ascension, areolaText, ...text[key].markingSteps, "A paciente está em pé, como na marcação"],
    },
    {
      ...common,
      id: `${key}-passo-areolotomo`,
      title: "2. Areolótomo",
      orientation: "inferior",
      distance: 0.5,
      description: `A aréola deste caso tem ${cm(sizes.areolaNowMm)} cm: a hipertrofia e a ptose a alargam. O areolótomo de ${cm(sizes.areolaNewMm)} cm, centrado no mamilo com a pele sob tensão, marca a nova aréola; o anel de fora será desepitelizado com o pedículo.`,
      structures: ["skin", "contralateral-breast", ...skinParts, ...areola, tome, measures],
      solid: ["skin", ...skinParts],
      labels: [label(tome, "areolotome", `Areolótomo: ${cm(sizes.areolaNewMm)} cm`), label(ring, "areola-now", `Aréola atual: ${cm(sizes.areolaNowMm)} cm`), label(measures, "measure-ascension", `Ascensão: ${cm(sizes.ascensionMm)} cm`)],
      surgery: surgery(0, { replayFrom: null, caption: "Marcação da aréola com o areolótomo" }),
      relations: [areolaText, ascension, "O anel entre os dois círculos perde a epiderme e fica no pedículo", `No resultado a aréola mede ${cm(sizes.areolaResultMm)} cm: a abertura da pele é do mesmo tamanho`],
    },
    {
      ...common,
      id: `${key}-passo-incisao`,
      title: "3. Incisão",
      orientation: "inferior",
      distance: 0.5,
      description: s.incision,
      structures: ["skin", "contralateral-breast", ...skinParts, ...areola, tome, marking],
      solid: ["skin", ...skinParts],
      tint,
      labels: [label(excised, "excised", "Pele a ressecar"), label(dermis, "dermis", "Derme desepitelizada (sobre o pedículo)"), label(ring, "areola-ring", "Aréola além do areolótomo: desepitelizada")],
      surgery: surgery(frameOf("incisao"), { replayFrom: null }),
      relations: [`Pele laranja: sai com a peça. Pele rosada: perde só a epiderme e fica sobre o pedículo ${t.pedicle}`, ...s.notes.incision],
    },
    {
      ...common,
      id: `${key}-passo-resseccao`,
      title: "4. Ressecção",
      description: s.resection,
      structures: ["skin", "contralateral-breast", ...skinParts, ...areola, ...pieces, arteries],
      translucent: [skin],
      tint,
      focus: [resection, excised],
      labels: [label(resection, "resection", `Ressecção ${t.resection}: ${m.resectionMl} mL`), label(excised, "excised", "Pele ressecada"), label(pedicle, "pedicle", `Pedículo ${t.pedicle} (${m.pedicleMl} mL)`), label(arteries, "arteries", "Artérias que o pedículo conserva"), ...pillarLabels],
      surgery: surgery(frameOf("resseccao")),
      relations: [removed, `Fica: o pedículo ${t.pedicle} (verde, ${m.pedicleMl} mL) e os ${flaps} medial (${pillarsMl.medial} mL) e lateral (${pillarsMl.lateral} mL)`, vessels, ...s.notes.resection],
    },
    {
      ...common,
      id: `${key}-passo-transposicao`,
      title: "5. Transposição",
      description: s.transposition,
      structures: ["skin", "contralateral-breast", ...skinParts, ...areola, ...pieces, arteries],
      translucent: [skin, excised, resection],
      tint,
      focus: [pedicle, nac],
      labels: [label(nac, "nac", `Complexo areolopapilar: sobe ${cm(sizes.ascensionMm)} cm até A`), label(pedicle, "pedicle", `Pedículo ${t.pedicle}`), label(arteries, "arteries", "Vasos do pedículo: dobram-se com ele")],
      surgery: surgery(frameOf("transposicao")),
      relations: [ascension + ` (fúrcula–A: ${cm(m.notchToAMm)} cm)`, vessels, ...s.notes.transposition],
    },
  ];
  // the closure, stage by stage: what is sutured to what
  frames.slice(frameOf("transposicao") + 1).forEach((frame, index) => {
    const stage = s.closure[frame.id];
    const covered = key === "pitanguy" && ["sulco", "marca-areola"].includes(frame.id);
    // with the skin opaque only the surface counts: pieces and vessels stay inside
    const structures = stage.solid ? ["skin", "contralateral-breast", skin, nac, sutures] : ["skin", "contralateral-breast", skin, dermis, ...areola, pedicle, medial, lateral, arteries, sutures];
    // the opening round the areola is sutured at the end in Pitanguy's technique, from the start in the others
    if (key !== "pitanguy" || frame.id === "abertura") structures.push(areolaSuture);
    if (key === "pitanguy" && ["sulco", "marca-areola", "abertura"].includes(frame.id)) structures.push(cover);
    if (frame.id === "marca-areola") structures.push(coverRing);
    const labels = [...seamLabels(stage.seams)];
    if (frame.id === "pilares" || (key === "wise" && frame.id === "sulco")) labels.push(...pillarLabels);
    if (covered) labels.push(label(cover, "cover", frame.id === "sulco" ? "Pele fechada sobre o complexo areolopapilar" : "Pele a retirar"));
    if (frame.id === "marca-areola") labels.push(label(coverRing, "cover-ring", `Nova aréola: ${cm(sizes.areolaNewMm)} cm no vértice do cone`));
    if (frame.id === "abertura") labels.push(label(cover, "cover", "Disco de pele retirado"));
    views.push({
      ...common,
      id: `${key}-passo-${frame.id}`,
      title: `${6 + index}. ${stage.title}`,
      orientation: "inferior",
      distance: 0.42,
      description: stage.text,
      structures,
      ...(stage.solid ? { solid: ["skin", skin, dermis, cover] } : { translucent: [skin] }),
      tint,
      focus: stage.seams.includes("deep") ? [medial, lateral] : [],
      labels,
      surgery: surgery(frameOf(frame.id)),
      relations: [...stage.notes, `Cada cor liga as duas bordas que se encontram; os fios mostram os pontos, que se fecham quando a sutura é feita`, stepNote],
    });
  });
  views.push({
    ...common,
    id: `${key}-passo-resultado`,
    title: `${views.length + 1}. Resultado esperado`,
    description: `Mama operada em pé, com as cicatrizes da técnica: ${s.scars.map((item) => item.toLowerCase().replace("cicatriz ", "")).join(", ")}. A outra mama segue como antes, para comparar.`,
    structures: ["skin", "contralateral-breast", skin, nac, scars],
    solid: ["skin", skin],
    labels: [...s.scars.map((item, index) => label(scars, `scar-${index}`, item)), label(nac, "nac", `Aréola: ${cm(sizes.areolaResultMm)} cm`)],
    // only skin, nipple and scars: shown at once (the closure, before this view, is where the tissue moves)
    surgery: surgery(last, { replayFrom: null, instant: true, caption: "Resultado esperado" }),
    relations: [
      ...beforeAfter(result),
      `Aréola: ${cm(sizes.areolaNowMm)} cm antes, ${cm(sizes.areolaResultMm)} cm depois`,
      ...(sizes.verticalScarMm ? [`Pilar vertical (aréola–sulco, na cicatriz): ${cm(sizes.verticalScarMm)} cm`] : []),
      ...s.notes.result,
      stepNote,
    ],
  });
  return views;
}

// cards of the step pieces (tap on the model)
(Object.keys(techniques) as TechniqueId[]).forEach((key) => {
  const t = techniques[key];
  const m = t.measurements;
  const s = stepText[key];
  const pillarsMl = stepPillarVolumes(key);
  const sizes = stepMeasures(key);
  const branches = stepBranches(key);
  const after = stepMeasurements(key).after;
  const flaps = s.pillar === "Pilar" ? "pilares" : "retalhos";
  const closure = Object.values(s.closure).map((stage) => `${stage.title}: ${stage.text}`);
  planDetails[`mamo-step-skin-${key}`] = {
    summary: "Pele que fica: no fechamento, suas bordas se encontram nas linhas de sutura e ela recobre a nova forma da mama. Em volta, uma faixa de 15 mm leva a pele operada até a pele que não muda.",
    surgical: [...closure, stepNote],
  };
  planDetails[`mamo-step-excised-${key}`] = { summary: `Pele ressecada: a pele dentro do padrão de ${t.label}, fora do pedículo. Sai com a peça.`, surgical: [s.resection] };
  planDetails[`mamo-step-dermis-${key}`] = {
    summary: `Derme desepitelizada sobre o pedículo ${t.pedicle}: perde a epiderme e fica, levando o plexo subdérmico ao complexo areolopapilar. No fechamento fica sob a pele.`,
    surgical: [s.incision],
  };
  planDetails[`mamo-step-pedicle-${key}`] = { ...planDetails[`mamo-pedicle-${key}`], surgical: [s.transposition, ...(planDetails[`mamo-pedicle-${key}`].surgical ?? [])] };
  planDetails[`mamo-step-resection-${key}`] = planDetails[`mamo-resection-${key}`];
  for (const side of ["medial", "lateral"] as const) {
    planDetails[`mamo-step-pillar-${side}-${key}`] = {
      summary: `${s.pillar} ${side}: o tecido que fica sob a pele ${side} do padrão, com ${pillarsMl[side]} mL no modelo. No fechamento vai para o centro, abaixo da aréola.`,
      surgical: closure,
    };
  }
  planDetails[`mamo-step-nac-${key}`] = {
    summary: `Complexo areolopapilar: a aréola de ${cm(sizes.areolaNowMm)} cm é reduzida a ${cm(sizes.areolaNewMm)} cm pelo areolótomo; ela sobe ${cm(sizes.ascensionMm)} cm sobre a pele com o pedículo ${t.pedicle} e chega ao ponto A. No resultado, o mamilo fica ${cm(after.nippleToFoldMm)} cm acima do sulco e a aréola mede ${cm(sizes.areolaResultMm)} cm.`,
    surgical: [s.transposition],
  };
  planDetails[`mamo-step-areola-ring-${key}`] = {
    summary: `Aréola além do areolótomo: o anel entre ${cm(sizes.areolaNewMm)} e ${cm(sizes.areolaNowMm)} cm. Na incisão perde a epiderme e passa a fazer parte da derme do pedículo.`,
  };
  planDetails[`mamo-step-areolotome-${key}`] = {
    summary: `Areolótomo de ${cm(sizes.areolaNewMm)} cm: marca a nova aréola, centrado no mamilo, com a pele da aréola sob tensão.`,
    surgical: ["Diâmetros usuais de 38 a 45 mm; o mesmo diâmetro define a abertura da pele que receberá a aréola"],
  };
  planDetails[`mamo-step-measures-${key}`] = {
    summary: "Medidas da marcação sobre a pele, em pé: a ascensão do complexo areolopapilar (do mamilo ao ponto A, pelo meridiano) e, no T invertido, a distância entre B e C.",
    landmarks: [`Ascensão: ${cm(sizes.ascensionMm)} cm`, ...(sizes.bcMm ? [`B–C em linha reta: ${cm(sizes.bcMm)} cm`] : []), ...measures_(key)],
  };
  planDetails[`mamo-step-arteries-${key}`] = {
    summary: `Artérias da mama (camada esquemática) acompanhando a cirurgia: cada trecho vai com o tecido em que corre. O que está na peça ressecada sai com ela; o que está no pedículo se dobra e é sepultado com ele; o que está nos ${s.pillar === "Pilar" ? "pilares" : "retalhos"} e no resto da mama os acompanha; a origem na parede torácica não se move. Em vermelho vivo, as que o pedículo ${t.pedicle} conserva até o mamilo: ${branchList(branches.artery)}.`,
    surgical: ["Pode ser ocultado no menu de estruturas; a escolha vale para todos os passos da técnica", "Trajetos típicos da literatura, não os de uma pessoa"],
  };
  planDetails[`mamo-step-nerves-${key}`] = {
    summary: `Nervos da mama (camada esquemática) acompanhando a cirurgia, como as artérias. Em amarelo vivo, os que o pedículo ${t.pedicle} conserva: ${branchList(branches.nerve)}.`,
    surgical: ["Ligue no menu de estruturas ou no botão Vasos; a escolha vale para todos os passos da técnica"],
  };
  planDetails[`mamo-step-sutures-areola-${key}`] = {
    summary: `Sutura da aréola: ${s.seams.areola}. Cada fio liga um ponto da borda da pele a um ponto da borda da aréola.`,
    surgical: [key === "pitanguy" ? s.closure.abertura.text : s.closure.areola.text],
  };
  planDetails[`mamo-step-sutures-${key}`] = {
    summary: `O que é suturado com o quê: cada cor liga as duas bordas que se encontram, e os fios são os pontos, que se encurtam até sumir quando a sutura é feita. ${Object.values(s.seams).join("; ")}.`,
    surgical: closure,
  };
  if (key === "pitanguy") {
    planDetails[`mamo-step-disc-${key}`] = {
      summary: "Pele dos retalhos sobre o complexo areolopapilar: no Pitanguy a pele se fecha inteira antes de a aréola ser posicionada. O disco marcado no vértice do cone é retirado para exteriorizar a aréola.",
      surgical: [s.closure.sulco.text, s.closure.abertura.text],
    };
    planDetails[`mamo-step-disc-ring-${key}`] = { summary: s.closure["marca-areola"].text };
  }
  planDetails[`mamo-step-scars-${key}`] = {
    summary: `Cicatrizes do resultado esperado: ${s.scars.map((item) => item.toLowerCase().replace("cicatriz ", "")).join(", ")}.`,
    surgical: [...s.notes.result, `Os ${flaps} e a pele se fecham sem tensão no modelo; na paciente, a cicatriz amadurece em meses`],
  };
});

/** One pack per technique: from the marking to the expected result, every step animated from the one before. */
export const mammaplastyStepPacks: Pack[] = (["pitanguy", "wise", "vertical"] as TechniqueId[]).map((key) => {
  const t = techniques[key];
  return {
    id: `mamoplastia-${key}-passo-a-passo`,
    title: `${t.label}: passo a passo`,
    summary: `Da marcação ao resultado esperado, com a paciente em pé: medidas da marcação, redução da aréola com o areolótomo, o que é ressecado, para onde vão o complexo areolopapilar e o pedículo ${t.pedicle} com seus vasos, e o fechamento em etapas, com o que é suturado com o quê. Cada passo é animado a partir do anterior; "Rever" repete a animação.`,
    views: stepViews(key),
  };
});

export const mammaplastyPack: Pack = {
  id: "mamoplastia-redutora",
  title: "Mamoplastia redutora",
  summary: "Três técnicas sobre a mama com ptose grau II e hipertrofia moderada: Pitanguy (pedículo superior), Wise com pedículo inferior e vertical com pedículo superomedial. Para cada uma: a marcação na pele, o pedículo com os vasos que conserva e a peça ressecada, com volume e peso estimados.",
  views: [...views("pitanguy", ["A", "B", "C", "D", "E"]), ...views("wise", ["A", "B", "C", "D", "E"]), ...views("vertical", ["A", "T", "M", "L", "F"])],
};
