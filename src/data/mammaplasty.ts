/**
 * Reduction mammaplasty: packs and cards built from the surgical plans of the pipeline
 * (src/data/mammaplasty<-case>.json, written by scripts/hybrid/build_mammaplasty.py). Markings, pedicles and
 * resections are designed on the standing breast of each case: ptosis grades I, II and III and the hypertrophies G3
 * and G4, each with the techniques its degree of ptosis calls for (docs/plano-mamoplastia-tecnicas.md,
 * docs/plano-mamoplastia-g3-g4.md); every number shown here was measured on those meshes. Dimensions are proposals
 * to be confirmed.
 */
import anatomy from "@/data/breastAnatomy.json";
import type { AnatomyDetail } from "@/data/anatomyDetails";
import { planCaseIds, planCaseSuffix, planFiles, type PlanCaseId } from "@/data/planCases";
import type { Pack, PackGroup, PackLabel, PackView } from "@/data/packs";
import { measurementsOf } from "@/lib/breastStates";
import { stepBranches, stepFramesOf, stepMeasurements, stepMeasures, stepPillarVolumes, stepPoints, stepStructuresOf, type StepMeasurements } from "@/lib/mammaplastySteps";

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
  /** what stays of the breast, the hypertrophy grade the specimen makes, and the design of the large cases */
  leftMl?: number;
  berrocal?: string;
  pedicleDepthMm?: number;
  flapMm?: number;
  /** periareolar ring: skin taken above, below and beside the areola */
  ringMarginsMm?: { top: number; bottom: number; side: number };
};
type TechniqueId = "pitanguy" | "wise" | "vertical" | "lejour" | "orlando" | "periareolar" | "thorek";
/** Skin pattern: inverted T without keyhole, Wise keyhole, vertical dome, periareolar ring. */
type SkinPattern = "t" | "keyhole" | "dome" | "ring";
type Technique = { label: string; short?: string; skin?: SkinPattern; pattern: string; pedicle: string; resection: string; marking: string; technique?: TechniqueId; measurements: Measurements };
type Dimensions = {
  areolaMm: number;
  areolaNowMm?: number;
  limbMm: number;
  rimMm: number;
  inferiorBaseMm: number;
  superiorThicknessMm: number;
  superomedialBaseMm: number;
  leftOnFasciaMm: number;
  densityGPerMl: number;
  moundMl: number;
  resultMl?: number | null;
  /** dermoglandular layer under the areola in the periareolar reduction */
  centralThicknessMm?: number;
  /** how far point A was put above the nipple where the nipple is already at the height of the fold (ptosis I); else 0 */
  aRisenMm?: number;
};
type PlanFile = { case?: PlanCaseId; state: string; dimensions: Dimensions; techniques: Record<string, Technique>; points: Record<string, { rest: [number, number, number]; label: string; note: string }> };
/** A technique in a case: `key` names its structures and views (pitanguy, pitanguy-g3, ...), `technique` its texts. */
type CaseTechnique = Technique & { key: string; technique: TechniqueId; skin: SkinPattern; short: string; case: PlanCaseId; state: string; dims: Dimensions };

const plans = planFiles as PlanFile[];
const skinOf: Record<TechniqueId, SkinPattern> = { pitanguy: "t", thorek: "t", wise: "keyhole", orlando: "keyhole", vertical: "dome", lejour: "dome", periareolar: "ring" };
const techniques: Record<string, CaseTechnique> = {};
plans.forEach((plan) =>
  Object.entries(plan.techniques).forEach(([key, t]) => {
    const technique = t.technique ?? (key as TechniqueId);
    techniques[key] = { ...t, key, technique, skin: t.skin ?? skinOf[technique], short: t.short ?? t.label.split(" ")[0], case: plan.case ?? "ptose-2", state: plan.state, dims: plan.dimensions };
  }),
);
const keysOf = (planCase: PlanCaseId) => Object.keys(techniques).filter((key) => techniques[key].case === planCase);
/** Ptosis II is the reference case: its dimensions were the ones accepted in review. */
const reference = plans.find((plan) => (plan.case ?? "ptose-2") === "ptose-2") ?? plans[0];
const dims = reference.dimensions;
/** Rest-pose anchors of the named points of every marking ("mamo:<technique key>:<point>"), in model units. */
export const planPoints = Object.assign({}, ...plans.map((plan) => plan.points)) as Record<string, { rest: [number, number, number]; label: string; note: string }>;
export const planState = reference.state;

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
/** Dimensions of a technique: accepted in review (the first three), or proposed with the same values and still to be reviewed. */
const proposalOf = (t: CaseTechnique) => {
  if (t.technique === "pitanguy" || t.technique === "wise" || t.technique === "vertical") return proposal;
  if (t.skin === "ring") {
    const margins = t.measurements.ringMarginsMm ?? { top: 20, bottom: 10, side: 12 };
    return `Dimensões propostas, a confirmar na revisão: aréola de ${dims.areolaMm} mm; anel com ${cm(margins.top)} cm de pele acima da aréola, ${cm(margins.bottom)} cm abaixo e ${cm(margins.side)} cm de cada lado; camada de ${t.dims.centralThicknessMm ?? 20} mm sob a aréola; ${dims.leftOnFasciaMm} mm de tecido deixados sobre a fáscia`;
  }
  return proposal.replace("Dimensões aceitas na revisão", "Dimensões propostas com os valores das outras técnicas, a confirmar na revisão");
};
/** Words of each case: the breast, the suffix of the pack titles, the name of its group and why its techniques. */
type CaseWords = { breast: string; title: string; short: string; area: string; group: string; why: (t: CaseTechnique) => string };
const caseWords: Record<PlanCaseId, CaseWords> = {
  "ptose-1": {
    breast: "ptose grau I com hipertrofia leve",
    title: " na ptose grau I",
    short: "Ptose grau I",
    area: "ptose grau I",
    group: "Mama com ptose grau I e hipertrofia leve: o mamilo está na altura do sulco e sobe pouco.",
    why: (t) => `Ptose grau I com hipertrofia leve: o mamilo está na altura do sulco e sobe ${cm(t.measurements.nippleRiseMm)} cm. Cabem as técnicas de cicatriz reduzida: a periareolar de Benelli, para reduções pequenas, e a vertical de Lejour.`,
  },
  "ptose-2": {
    breast: "ptose grau II com hipertrofia moderada",
    title: " na ptose grau II",
    short: "Ptose grau II",
    area: "ptose grau II",
    group: "Mama com ptose grau II e hipertrofia moderada, com o mamilo abaixo do sulco: o caso de referência do atlas.",
    why: (t) => `Ptose grau II com hipertrofia moderada: o mamilo está abaixo do sulco e sobe ${cm(t.measurements.nippleRiseMm)} cm. É o caso de referência do atlas, em que cabem tanto o T invertido (Pitanguy, Wise com pedículo inferior) quanto as técnicas verticais (pedículo superomedial, Lejour).`,
  },
  "ptose-3": {
    breast: "ptose grau III com hipertrofia acentuada",
    title: " na ptose grau III",
    short: "Ptose grau III",
    area: "ptose grau III",
    group: "Mama com ptose grau III e hipertrofia acentuada: o mamilo aponta para baixo e a subida é longa.",
    why: (t) => `Ptose grau III com hipertrofia acentuada: o mamilo aponta para baixo e sobe ${cm(t.measurements.nippleRiseMm)} cm. A pele que sobra pede em geral o T invertido; o pedículo superomedial é mais curto que o inferior, e o superior de Pitanguy tem de se dobrar muito.`,
  },
  g3: {
    breast: "mama G3: ptose grau III com hipertrofia grau III",
    title: " em G3",
    short: "G3",
    area: "G3",
    group: "Ptose grau III com hipertrofia grau III de Berrocal Revueltas (peça de 800 a 1000 g por mama): pedículos afinados para chegar a uma mama menor, com os vasos e nervos alongados.",
    why: (t) => `Ptose grau III com hipertrofia grau III de Berrocal Revueltas (peça de 800 a 1000 g por mama). O complexo areolopapilar sobe ${cm(t.measurements.nippleRiseMm)} cm: os pedículos são longos e têm de ser afinados para a mama chegar a cerca de ${t.dims.resultMl ?? 700} mL.`,
  },
  g4: {
    breast: "mama G4: ptose grau III com gigantomastia",
    title: " em G4",
    short: "G4",
    area: "G4",
    group: "Ptose grau III com gigantomastia (peça acima de 1 kg por mama): as técnicas com pedículo e a amputação com enxerto livre do complexo areolopapilar.",
    why: (t) => `Gigantomastia (peça acima de 1 kg por mama), com subida do complexo areolopapilar de ${cm(t.measurements.nippleRiseMm)} cm. É a faixa em que muitos autores indicam a amputação com enxerto livre do complexo areolopapilar (Thorek); as técnicas com pedículo ficam no limite do comprimento.`,
  },
};
const planNoteOf = (t: CaseTechnique) => `Marcação e peças são desenhadas na mama em pé (${caseWords[t.case].breast}) e acompanham a forma da mama; os vasos e nervos são os da camada esquemática`;
/** The large breasts are seen from a little farther away (cube root of the volume against ptosis II). */
const zoomOf = (t: CaseTechnique) => Math.max(1, Math.cbrt(t.dims.moundMl / dims.moundMl));
/** How a large case was designed and what it removes (nothing for ptosis II, whose dimensions were accepted as they are). */
const designNotes = (t: CaseTechnique): string[] => {
  // only the large cases (G3, G4) are designed to a volume: the others use the dimensions as they are
  if (t.dims.resultMl == null) return [];
  const m = t.measurements;
  const target = t.dims.resultMl ?? 0;
  const pedicle = m.pedicleDepthMm
    ? `Pedículo afinado por trás até ${m.pedicleDepthMm.toLocaleString("pt-BR")} mm sob a pele${t.technique === "wise" ? ", sem entrar no plano do septo horizontal, por onde sobem os seus vasos" : ""}`
    : t.technique === "thorek"
      ? "Sem pedículo"
      : "Pedículo de espessura total";
  const flapKind = (m.flapMm ?? 0) > 20 ? "retalhos dermoglandulares" : "retalhos de pele";
  const flap = m.flapMm ? `${flapKind} de ${Math.round(m.flapMm)} mm em volta do padrão (${Math.round(m.flapMm + 10)} mm acima do ponto A): o tecido sob eles sai com a peça` : "sem afinamento dos retalhos";
  const left = m.leftMl !== undefined ? `fica uma mama de ${m.leftMl} mL${target && m.leftMl > target * 1.03 ? ` (o alvo era ${target} mL: retalhos de 15 mm e o pedículo não deixam tirar mais)` : ` (alvo de ${target} mL)`}` : "";
  return [`${pedicle}; ${flap}; ${left}`, `Peça de ${m.resectionG} g: hipertrofia ${m.berrocal ?? ""} de Berrocal Revueltas (pelo peso ressecado por mama)`];
};

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
  lejour: {
    markingSummary: "Padrão vertical de Lejour na mama em pé: uma cúpula sobre a nova aréola, com o topo acima do ponto A, e dois ramos que descem e se encontram acima do sulco. Não há incisão horizontal: a cicatriz é periareolar e vertical.",
    markingSteps: ["O perímetro da cúpula corresponde ao da nova aréola", "Os ramos terminam alguns centímetros acima do sulco: a pele que sobra no polo inferior se acomoda na cicatriz vertical"],
    pedicleSummary: `Pedículo superior dermoglandular, com ${dims.superiorThicknessMm} mm de espessura: da cúpula ao complexo areolopapilar. A pele da cúpula é só desepitelizada: toda ela é a base do pedículo.`,
    pedicleNotes: ["Irrigação pelo plexo subdérmico e pelos perfurantes da torácica interna do 2º e 3º espaços, que descem pela base", "Serve para subidas curtas do complexo areolopapilar: na subida longa o pedículo superior se dobra demais"],
    resectionSummary: "Ressecção central inferior: o polo inferior dentro do padrão, abaixo da cúpula, em espessura total, e sob o pedículo uma quilha central que se afina para cima. Os pilares medial e lateral ficam.",
    resectionNotes: ["Lejour associava lipoaspiração e descolamento amplo da pele do polo inferior; aqui só a ressecção em bloco é mostrada", "Os pilares medial e lateral são suturados um ao outro: é o que dá a projeção"],
  },
  orlando: {
    markingSummary: "Padrão de Wise na mama em pé: abertura circular para a nova aréola em torno do ponto A (a fechadura), dois ramos verticais e dois ramos horizontais até os extremos da incisão no sulco. A cicatriz final é um T invertido.",
    markingSteps: ["O ponto A, na projeção do sulco sobre o meridiano, é o centro da nova aréola", "A soma dos ramos horizontais é maior que a incisão no sulco: a diferença é compensada no fechamento"],
    pedicleSummary: `Pedículo superomedial (Orlando e Guthrie), com base de ${cm((techniques.wise.measurements.linesMm.fechadura ?? 88) / 2 + dims.limbMm)} cm: a metade medial da fechadura e todo o ramo vertical medial. Gira para levar o complexo areolopapilar à fechadura.`,
    pedicleNotes: [
      "Irrigação pelos perfurantes da torácica interna do 2º e 3º espaços, que entram pela base",
      "Na mama longa esses perfurantes chegam baixo, na altura do ramo vertical medial: por isso a base o inclui inteiro",
      "É mais curto que o pedículo inferior: o complexo areolopapilar gira até a fechadura em vez de subir do sulco",
      "Os ramos cutâneos anteriores entram pela base",
    ],
    resectionSummary: "Ressecção inferior e lateral: todo o padrão fora do pedículo, em espessura total, e as cunhas sob os retalhos medial e lateral. O polo inferior sai inteiro.",
    resectionNotes: ["O polo inferior, que é o que mais pesa na mama pendente, sai com a peça", "Os retalhos medial e lateral cobrem o pedículo no fechamento"],
  },
  periareolar: {
    markingSummary: "Marcação periareolar de Benelli na mama em pé: dois traços em volta da aréola. O de dentro é o do areolótomo, sobre a aréola; o de fora é um anel oval e excêntrico, com mais pele acima da aréola do que abaixo. A pele entre os dois é desepitelizada e a única cicatriz fica em volta da aréola.",
    markingSteps: ["O topo do anel é a borda superior da nova aréola: é ele que define quanto o complexo areolopapilar sobe", "O perímetro do anel não deve passar de cerca de duas vezes o da aréola, ou a cicatriz se alarga e a mama achata", "Indicada na ptose leve, com subida do complexo areolopapilar de até 2 cm"],
    pedicleSummary: "Pedículo central: o complexo areolopapilar não é transposto. Ele continua sobre a glândula, que não é descolada da fáscia peitoral; sobre a cunha ressecada fica uma camada dermoglandular que o sustenta.",
    pedicleNotes: ["A irrigação chega por todos os lados: perfurantes da torácica interna, ramos da torácica lateral e, pela profundidade, o que a cunha não leva", "A derme do anel é incisada só na metade inferior, por onde se chega à glândula; acima do mamilo ela fica inteira"],
    resectionSummary: "Ressecção em cunha central inferior, pelo acesso periareolar: uma cunha de glândula atrás e abaixo da aréola, sob a pele do polo inferior, que não é ressecada.",
    resectionNotes: ["É uma redução pequena: a técnica periareolar não comporta grandes ressecções", "As bordas medial e lateral da cunha são aproximadas com pontos profundos", "Os perfurantes intercostais que sobem pelo septo passam pela cunha e saem com ela"],
  },
  thorek: {
    markingSummary: "Marcação em T invertido para o enxerto livre do complexo areolopapilar (Thorek): ponto A no meridiano, na projeção do sulco, ramos A–B e A–C e as linhas até os extremos da incisão no sulco (D e E). Não há pedículo: o complexo areolopapilar é marcado com o areolótomo e retirado como enxerto de pele total.",
    markingSteps: ["Indicada quando o pedículo ficaria longo demais: gigantomastia, fúrcula–mamilo acima de 40 cm, ou quando a paciente precisa de uma operação curta", "O leito do enxerto é marcado no fim, no vértice do cone, com a mama já fechada"],
    pedicleSummary: "",
    pedicleNotes: [],
    resectionSummary: "Amputação do polo inferior: todo o tecido dentro do padrão, do ponto A ao sulco, em espessura total, com as cunhas sob os retalhos medial e lateral. O complexo areolopapilar não está na peça: foi retirado antes, como enxerto.",
    resectionNotes: ["É a técnica que mais reduz, e a mais rápida", "Sem pedículo sob os retalhos, a mama tende a ficar larga e com pouca projeção", "Todos os vasos e nervos que iam ao complexo areolopapilar são seccionados: o enxerto se nutre por embebição e depois por neovascularização; a sensibilidade e a lactação se perdem"],
  },
};

const lineText = (key: string) => {
  const m = techniques[key].measurements;
  const lines = m.linesMm;
  const skin = techniques[key].skin;
  if (skin === "dome") return [`Cúpula: ${cm(lines["cúpula"])} cm de perímetro`, `Ramos medial e lateral: ${cm(lines["ramo medial"])} e ${cm(lines["ramo lateral"])} cm sobre a pele`];
  if (skin === "ring") {
    const margins = m.ringMarginsMm ?? { top: 20, bottom: 10, side: 12 };
    return [
      `Anel: ${cm(lines["anel"])} cm de perímetro, para uma aréola de ${cm(Math.PI * dims.areolaMm)} cm (razão ${(lines["anel"] / (Math.PI * dims.areolaMm)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })})`,
      `Pele desepitelizada em volta da aréola: ${cm(margins.top)} cm acima, ${cm(margins.bottom)} cm abaixo e ${cm(margins.side)} cm de cada lado`,
    ];
  }
  return [
    skin === "keyhole" ? `Fechadura: ${cm(lines["fechadura"])} cm de arco; ramos verticais de ${cm(lines["ramo medial"])} cm` : `Ramos A–B e A–C: ${cm(lines["ramo medial"])} cm cada`,
    `B–C em linha reta: ${cm(m.limbEndsApartMm ?? 0)} cm`,
    `Linhas até D e E: ${cm(lines["horizontal medial"])} e ${cm(lines["horizontal lateral"])} cm; incisão no sulco: ${cm(lines["sulco"])} cm (sobram ${cm(m.horizontalMinusFoldMm ?? 0)} cm para compensar)`,
  ];
};
const measures_ = (key: string) => {
  const t = techniques[key];
  const m = t.measurements;
  // ptosis grade I: the nipple is already at the height of the fold, so point A goes a fixed distance above it
  const risen = t.dims.aRisenMm ? [`Ponto A: ${cm(t.dims.aRisenMm)} cm acima do mamilo. Nesta mama o mamilo já está na altura do sulco, e a projeção do sulco não daria subida`] : [];
  return [`Fúrcula–ponto A: ${cm(m.notchToAMm)} cm; subida do complexo areolopapilar: ${cm(m.nippleRiseMm)} cm sobre a pele`, ...risen, ...lineText(key)];
};

/** What a long pedicle means (the large cases): Pitanguy's superior pedicle has to fold over a long climb. */
function longPedicle(t: CaseTechnique): string[] {
  // a climb of 8 cm or more: ptosis III, G3 and G4 (the free graft has no pedicle to speak of)
  if (t.measurements.nippleRiseMm < 80 || t.technique === "thorek") return [];
  const rise = cm(t.measurements.nippleRiseMm);
  const notes: Partial<Record<TechniqueId, string>> = {
    pitanguy: `Subida de ${rise} cm: o pedículo superior dobra-se sobre si mesmo. Pedículos superiores longos são descritos como pouco confiáveis em mamas muito grandes; no modelo, as perfurantes da torácica interna cruzam o padrão e não chegam ao mamilo`,
    wise: `Pedículo inferior longo: do sulco ao mamilo, ${cm(measurementsOf(t.state).nippleToFoldSkinMm)} cm sobre a pele, para uma base de ${cm(t.dims.inferiorBaseMm)} cm. Séries clínicas não mostram mais necrose com distância mamilo–sulco acima de 15 cm`,
    vertical: `Subida de ${rise} cm: o pedículo superomedial gira mais e fica mais longo; os ramos da torácica interna que entram pela base o acompanham`,
    orlando: `Subida de ${rise} cm: o pedículo superomedial gira mais e fica mais longo, mas continua mais curto que o inferior (${cm(measurementsOf(t.state).nippleToFoldSkinMm)} cm do sulco ao mamilo)`,
  };
  const note = notes[t.technique];
  // Pitanguy's note already says it; for the others, say that it is the model and not a measure of perfusion
  const none = t.technique !== "pitanguy" && !t.measurements.kept.some((name) => tissueOf.get(name) === "artery");
  const model = none ? ["No modelo, nenhuma artéria da camada esquemática chega ao mamilo sem cruzar a ressecção ou as incisões: é o desenho geométrico deste caso, não uma medida da perfusão do pedículo"] : [];
  const extra = t.case === "g4" ? ["Fúrcula–mamilo de 44 cm, mamilo–sulco de 19 cm e peça acima de 1 kg: faixa em que muitos autores indicam o enxerto livre do complexo areolopapilar"] : [];
  return note ? [note, ...model, ...extra] : [];
}

/** Cards of the plan structures, keyed by structure id. */
const referenceCard: AnatomyDetail = {
  summary: "Linhas de referência da marcação: linha média, meridiano da mama (passa pelo mamilo) e sulco inframamário. Acompanham a forma da mama.",
  landmarks: ["O ponto A é a projeção do sulco sobre o meridiano, na face anterior da mama", "O sulco fica oculto pela mama ptótica: veja de baixo ou com a pele translúcida"],
};
/** Reference lines of a case (the structure id carries the suffix of the case). */
const referencesOf = (planCase: PlanCaseId) => `mamo-reference-lines${planCaseSuffix[planCase]}`;
/** A technique with a pedicle (all but the free nipple graft). */
const hasPedicle = (t: CaseTechnique) => t.measurements.pedicleMl > 0;
export const planDetails: Record<string, AnatomyDetail> = Object.fromEntries(planCaseIds.map((planCase) => [referencesOf(planCase), referenceCard]));
Object.keys(techniques).forEach((key) => {
  const t = techniques[key];
  const m = t.measurements;
  const words = text[t.technique];
  planDetails[`mamo-marking-${key}`] = { summary: words.markingSummary, landmarks: measures_(key), surgical: [...words.markingSteps, proposalOf(t)] };
  if (hasPedicle(t)) {
    planDetails[`mamo-pedicle-${key}`] = {
      summary: words.pedicleSummary,
      vascularization: supply(m)[0].replace(" (no modelo)", "") + ".",
      innervation: `Conservados: ${list(m.kept, "nerve")}.`,
      landmarks: [`Volume no modelo: ${m.pedicleMl} mL, cerca de ${m.pedicleG} g`, ...designNotes(t).slice(0, 1)],
      surgical: [...words.pedicleNotes, ...longPedicle(t), planNoteOf(t)],
    };
  }
  planDetails[`mamo-resection-${key}`] = {
    summary: words.resectionSummary,
    landmarks: [`Volume no modelo: ${m.resectionMl} mL, cerca de ${m.resectionG} g (densidade ${t.dims.densityGPerMl.toLocaleString("pt-BR")} g/mL): ${m.resectionPct}% do monte de ${t.dims.moundMl} mL`, ...designNotes(t), `Leva consigo: ${list(m.cut, "artery")}`],
    surgical: [...words.resectionNotes, proposalOf(t)],
  };
});

// ---- pack ------------------------------------------------------------------------------------------------
const pointLabels = (key: string, names: string[]): PackLabel[] =>
  names.map((name) => ({ structure: `mamo-marking-${key}`, near: `mamo:${key}:${name}`, text: `${name}: ${planPoints[`mamo:${key}:${name}`].note}` }));
const arteries = ["internal-thoracic-perforators", "lateral-mammary-branches", "intercostal-perforators", "thoracoacromial-mammary-branch"];

function views(key: string, points: string[]): PackView[] {
  const t = techniques[key];
  const m = t.measurements;
  const words = text[t.technique];
  const zoom = zoomOf(t);
  const references = referencesOf(t.case);
  const marking = `mamo-marking-${key}`;
  const pedicle = `mamo-pedicle-${key}`;
  const resection = `mamo-resection-${key}`;
  const short = t.short;
  const pedicled = hasPedicle(t);
  const all: PackView[] = [
    {
      id: `${key}-marcacao`,
      title: `${short}: marcação`,
      description: words.markingSummary,
      structures: ["skin", "nipple-areola", "contralateral-breast", references, marking],
      solid: ["skin"],
      orientation: "anterior",
      anchor: "nipple",
      distance: 0.4 * zoom,
      breast: t.state,
      labels: pointLabels(key, points),
      relations: [...measures_(key), ...words.markingSteps, proposalOf(t)],
    },
    {
      id: `${key}-pediculo`,
      title: `${short}: pedículo ${t.pedicle}`,
      description: words.pedicleSummary,
      structures: ["skin", "nipple-areola", marking, pedicle, ...arteries, "fourth-intercostal-lateral-branch", "horizontal-septum", "internal-thoracic-vessels", "lateral-thoracic-vessels", "chest-wall", "costal-cartilages"],
      focus: [pedicle],
      orientation: "anterolateral",
      anchor: "nipple",
      distance: 0.55 * zoom,
      breast: t.state,
      labels: [
        { structure: pedicle, near: "nipple", text: `Pedículo ${t.pedicle}` },
        { structure: marking, near: `mamo:${key}:A`, text: "A: novo mamilo" },
      ],
      relations: [`Volume do pedículo no modelo: ${m.pedicleMl} mL, cerca de ${m.pedicleG} g`, ...designNotes(t).slice(0, 1), ...supply(m), ...words.pedicleNotes, ...longPedicle(t), planNoteOf(t)],
    },
    {
      id: `${key}-resseccao`,
      title: `${short}: ressecção ${t.resection}`,
      description: words.resectionSummary,
      structures: ["skin", "nipple-areola", marking, ...(pedicled ? [pedicle] : []), resection],
      focus: [resection],
      orientation: "anterolateral",
      anchor: "nipple",
      distance: 0.55 * zoom,
      breast: t.state,
      labels: [
        { structure: resection, near: "inframammaryFold", nearOffsetMm: [0, -30, 30], text: `Ressecção ${t.resection}` },
        ...(pedicled ? [{ structure: pedicle, near: "nipple", text: `Pedículo ${t.pedicle}` }] : []),
      ],
      relations: [
        `Peça ressecada no modelo: ${m.resectionMl} mL, cerca de ${m.resectionG} g: ${m.resectionPct}% do monte de ${t.dims.moundMl} mL`,
        ...designNotes(t),
        ...(pedicled ? [] : supply(m).slice(1)),
        ...words.resectionNotes,
        proposalOf(t),
        planNoteOf(t),
      ],
    },
  ];
  // the free nipple graft has no pedicle to show
  return pedicled ? all : all.filter((view) => view.id !== `${key}-pediculo`);
}

// ---- step by step: what leaves, where the rest goes, what is sutured to what (src/data/mammaplastySteps<-case>.json) ------
type Stage = { title: string; text: string; seams: string[]; notes: string[]; solid?: boolean };
type StepText = {
  /** what is cut and de-epithelialised */
  incision: string;
  /** what leaves the breast */
  resection: string;
  /** how the nipple-areola complex reaches point A (empty for the free graft, which is not transposed) */
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
      resection: ["O pedículo fica no centro e a ressecção o contorna", "É o maior dos pedículos: carrega o polo inferior e a irrigação profunda pelo septo"],
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
  lejour: {
    incision: "Incisão em volta da cúpula e dos ramos. A pele da cúpula, acima da aréola, é só desepitelizada: é a base do pedículo superior, e a derme leva o plexo subdérmico ao complexo areolopapilar. O anel da aréola além do areolótomo é desepitelizado com ela.",
    resection: "Saem a pele do padrão abaixo da cúpula e a ressecção central inferior: o polo inferior entre os ramos, em espessura total, e a quilha central sob o pedículo.",
    transposition: "O complexo areolopapilar sobe com o pedículo superior até a cúpula, no ponto A. A derme desepitelizada se dobra sob a nova aréola, e os perfurantes da torácica interna que descem pela base se dobram com ela.",
    closure: {
      pilares: { title: "Pilares", text: "Os pilares medial e lateral são suturados um ao outro abaixo da aréola (azul): fecham o defeito central, estreitam a base e projetam a mama. A pele ainda está aberta.", seams: ["deep"], notes: ["É a sutura dos pilares, não a da pele, que sustenta a forma", "O pedículo superior fica sobre os pilares, sob a nova aréola"] },
      vertical: { title: "Sutura vertical", text: "A pele é fechada na linha vertical (amarelo), sobre os pilares; a cicatriz termina acima do sulco e a pele que sobra no polo inferior se acomoda nela.", seams: ["vertical"], notes: ["O franzido da parte baixa da cicatriz se desfaz em semanas a meses"] },
      areola: { title: "Sutura da aréola", text: "A cúpula envolve a aréola e é suturada em volta dela (rosa): a cicatriz periareolar.", seams: ["areola"], notes: ["O perímetro da cúpula corresponde ao da aréola de 4,2 cm"] },
    },
    seams: { vertical: "Ramo medial com o lateral: sutura vertical", areola: "Cúpula com a aréola: periareolar", deep: "Pilar medial com o lateral: pontos profundos" },
    lines: { "cúpula": "Cúpula {mm}", "ramo medial": "M–F {mm}", "ramo lateral": "L–F {mm}" },
    scars: ["Cicatriz periareolar", "Cicatriz vertical"],
    pillar: "Pilar",
    notes: {
      incision: ["O perímetro da cúpula corresponde ao da nova aréola", "Os ramos terminam acima do sulco: não há incisão horizontal"],
      resection: ["A quilha tira a base glandular atrás do complexo areolopapilar: os ramos profundos não chegam mais ao mamilo", "O que fica: o pedículo superior e os pilares medial e lateral"],
      transposition: ["A subida é curta: o pedículo superior dobra sem tensão", "Lejour associava lipoaspiração e descolamento da pele do polo inferior: não são mostrados"],
      result: ["Cicatriz periareolar e vertical, sem cicatriz no sulco", "O polo inferior esvaziado encurta a distância mamilo–sulco"],
    },
  },
  orlando: {
    incision: "Incisão em toda a marcação, em volta da fechadura e dos ramos. O pedículo superomedial, com base na metade medial da fechadura e em todo o ramo vertical medial, é desepitelizado: a derme fica sobre ele. O anel da aréola além do areolótomo é desepitelizado com ele.",
    resection: "Saem a pele dentro do padrão, fora do pedículo, e a ressecção inferior e lateral: o polo inferior em espessura total, o tecido lateral ao pedículo e as cunhas sob os retalhos.",
    transposition: "O pedículo superomedial gira sobre a base e leva o complexo areolopapilar até a fechadura, em volta do ponto A. Os perfurantes da torácica interna que entram pela base giram com ele.",
    closure: {
      "ponto-t": { title: "Ponto em T", text: "Ponto-chave em T: B e C, os fins dos ramos verticais, são levados ao meio da incisão do sulco (laranja). Os retalhos medial e lateral começam a fechar o polo inferior, abaixo do pedículo.", seams: ["T"], notes: ["O ponto em T define o encontro das três cicatrizes e reparte a tensão", "As linhas ainda abertas mostram quem será suturado com quem"] },
      vertical: { title: "Sutura vertical", text: "Os ramos verticais são suturados um ao outro (amarelo), da fechadura até o T. Por baixo, os retalhos são unidos por pontos profundos (azul): são eles que passam a formar o polo inferior.", seams: ["vertical", "deep"], notes: ["O pedículo fica acima, sob a fechadura; o polo inferior é feito dos retalhos"] },
      sulco: { title: "Sutura no sulco", text: "Os ramos horizontais B–D e C–E são suturados à incisão do sulco (ciano e verde), distribuindo o excesso de pele ao longo dela.", seams: ["fold-medial", "fold-lateral"], notes: ["A soma dos ramos horizontais é maior que o sulco: o excesso é distribuído ponto a ponto"] },
      areola: { title: "Sutura da aréola", text: "O complexo areolopapilar, na ponta do pedículo, é suturado na fechadura (rosa): a cicatriz periareolar.", seams: ["areola"], notes: ["A fechadura de 4,2 cm recebe a aréola reduzida pelo areolótomo"] },
    },
    seams: { T: "Ponto em T: B e C no meio do sulco", vertical: "Ramo vertical medial com o lateral", "fold-medial": "B–D com o sulco, metade medial", "fold-lateral": "C–E com o sulco, metade lateral", areola: "Fechadura com a aréola: periareolar", deep: "Retalho medial com o lateral: pontos profundos" },
    lines: { fechadura: "Fechadura {mm}", "ramo medial": "Pilar vertical {mm}", "ramo lateral": "Pilar vertical {mm}", "horizontal medial": "B–D {mm}", "horizontal lateral": "C–E {mm}", sulco: "D–E {mm}" },
    scars: ["Cicatriz periareolar", "Cicatriz vertical", "Cicatriz no sulco"],
    pillar: "Retalho",
    notes: {
      incision: ["A base do pedículo fica alta e medial: não depende do sulco", "A soma dos ramos horizontais é maior que a incisão do sulco: a diferença é distribuída na sutura"],
      resection: ["O polo inferior, que é o que mais pesa na mama pendente, sai inteiro com a peça", "O que fica: o pedículo superomedial e os retalhos medial e lateral"],
      transposition: ["É uma rotação, não uma dobra: a base fica medial e alta", "Perfurantes da torácica interna do 2º e 3º espaços entram pela base"],
      result: ["Cicatriz em T invertido com a periareolar", "O polo inferior é feito dos retalhos: é descrito como menos sujeito a descer com o tempo do que com o pedículo inferior"],
    },
  },
  periareolar: {
    incision: "Incisão nos dois traços: o do areolótomo, sobre a aréola, e o anel de fora. A pele entre os dois é desepitelizada: a derme fica em toda a volta e leva o plexo subdérmico ao complexo areolopapilar. Na metade inferior do anel a derme é incisada para chegar à glândula.",
    resection: "Sai uma cunha central inferior de glândula, atrás e abaixo da aréola, pelo acesso periareolar. Nenhuma pele é ressecada: a do polo inferior é descolada da glândula para dar acesso e depois se redistribui.",
    transposition: "O complexo areolopapilar não é transposto: sobe até o ponto A com o cone glandular, que é remontado mais alto. A derme do anel desepitelizado se acomoda em volta dele, sob a pele.",
    closure: {
      "round-block": { title: "Pilares e round block", text: "Os pilares medial e lateral, de cada lado da cunha, são aproximados com pontos profundos (azul): fecham o defeito e estreitam a base. Em seguida um fio passado pela derme em toda a borda do anel (a cerclagem em bolsa, o round block de Benelli) reduz a abertura da pele até o diâmetro da aréola.", seams: ["deep", "areola"], notes: ["O fio da cerclagem é inabsorvível: segura o diâmetro da aréola e evita que a cicatriz se alargue", "A pele do anel franze em volta da aréola: o franzido se acomoda em semanas a meses"] },
      areola: { title: "Sutura da aréola", text: "A borda da pele, já reduzida pela cerclagem, é suturada à aréola (rosa): a única cicatriz, em volta da aréola.", seams: ["areola"], notes: ["A abertura da pele, de 4,2 cm depois da cerclagem, recebe a aréola reduzida pelo areolótomo"] },
    },
    seams: { areola: "Anel com a aréola: cerclagem e sutura periareolar", deep: "Pilar medial com o lateral: pontos profundos" },
    lines: { anel: "Anel {mm}" },
    scars: ["Cicatriz periareolar"],
    pillar: "Pilar",
    notes: {
      incision: ["O anel é excêntrico: sai mais pele acima da aréola do que abaixo, e é isso que a faz subir", "Só a epiderme é retirada: a derme do anel fica"],
      resection: ["É uma redução pequena: a técnica periareolar não comporta grandes ressecções", "O que fica: o cone central com o complexo areolopapilar e os pilares medial e lateral"],
      transposition: ["Não há pedículo a dobrar ou girar: a irrigação do complexo areolopapilar continua vindo de todos os lados", "A subida é a que o anel permite: cerca de 2 cm"],
      result: ["Uma só cicatriz, em volta da aréola", "A mama tende a ficar mais achatada, com menos projeção do cone, do que nas técnicas com cicatriz vertical"],
    },
  },
  thorek: {
    incision: "O complexo areolopapilar é retirado primeiro, como enxerto de pele total: incisão no círculo do areolótomo, descolamento no plano da derme, e o enxerto é guardado em gaze úmida. Em seguida, incisão em toda a marcação do T invertido.",
    resection: "Amputação do polo inferior: sai em bloco todo o tecido dentro do padrão, do ponto A ao sulco, com a pele, o sítio antigo da aréola e as cunhas sob os retalhos medial e lateral.",
    transposition: "",
    closure: {
      "ponto-t": { title: "Ponto em T", text: "Ponto-chave em T: B e C vão ao meio da incisão do sulco (laranja). Os retalhos medial e lateral giram para o centro e são unidos por pontos profundos (azul): são eles que formam o novo cone, sem pedículo por baixo.", seams: ["T", "deep"], notes: ["O ponto em T fixa o encontro das três cicatrizes", "As linhas ainda abertas mostram quem será suturado com quem"] },
      vertical: { title: "Sutura vertical", text: "Os ramos A–B e A–C são suturados um ao outro (amarelo): é a cicatriz vertical, de A até o sulco.", seams: ["vertical"], notes: ["Sem pedículo sob os retalhos, a projeção depende só deles"] },
      sulco: { title: "Sutura no sulco: pele fechada", text: "Os ramos horizontais B–D e C–E são suturados à incisão do sulco (ciano e verde). A pele fica fechada inteira; o enxerto ainda está fora da mama.", seams: ["fold-medial", "fold-lateral"], notes: ["A soma dos ramos horizontais é maior que o sulco: o excesso é distribuído ponto a ponto"], solid: true },
      leito: { title: "Leito do enxerto", text: "Com a paciente sentada, a nova aréola é marcada no vértice do cone com o marcador de 4,2 cm. O círculo é desepitelizado: a derme que fica é o leito do enxerto.", seams: [], notes: ["O leito é derme vascularizada: é dela que o enxerto vai se nutrir", "A posição é conferida com a mama já moldada"], solid: true },
      enxerto: { title: "Enxerto do complexo areolopapilar", text: "O enxerto é afinado, colocado sobre o leito e suturado à pele em volta (rosa). Um curativo de Brown, amarrado sobre ele, o mantém imóvel e em contato com o leito nos primeiros dias.", seams: ["areola"], notes: ["Nos primeiros dias o enxerto vive por embebição; depois os vasos do leito o invadem", "A sensibilidade do mamilo e a lactação se perdem; a projeção do mamilo e a pigmentação da aréola podem diminuir"], solid: true },
    },
    seams: { T: "Ponto em T: B e C no meio do sulco", vertical: "A–B com A–C: sutura vertical", "fold-medial": "B–D com o sulco, metade medial", "fold-lateral": "C–E com o sulco, metade lateral", areola: "Enxerto com a pele em volta do leito", deep: "Retalho medial com o lateral: pontos profundos" },
    lines: { "ramo medial": "A–B {mm}", "ramo lateral": "A–C {mm}", "horizontal medial": "B–D {mm}", "horizontal lateral": "C–E {mm}", sulco: "D–E {mm}" },
    scars: ["Cicatriz em volta do enxerto", "Cicatriz vertical", "Cicatriz no sulco"],
    pillar: "Retalho",
    notes: {
      incision: ["O enxerto é de pele total: aréola e mamilo, sem a glândula por baixo", "Sem pedículo a preservar, a operação é mais curta: é um dos motivos de indicá-la em pacientes de maior risco"],
      resection: ["É a técnica que mais reduz: não há pedículo a preservar", "O que fica: os retalhos medial e lateral e o polo superior"],
      transposition: [],
      result: ["Cicatriz em T invertido e, em volta do enxerto, a periareolar", "A mama tende a ficar mais larga e com menos projeção: não há pedículo sob os retalhos", "Hipopigmentação da aréola e perda de projeção do mamilo são as sequelas mais comuns do enxerto"],
    },
  },
};

/** The step texts of a technique in a case: a long climb changes the transposition, a designed case (G3, G4) the specimen. */
function stepNotesOf(t: CaseTechnique): StepText {
  const base = stepText[t.technique];
  const long = longPedicle(t);
  const design = designNotes(t).slice(1);
  if (!long.length && !design.length) return base;
  const transposition = !long.length
    ? base.notes.transposition
    : t.technique === "pitanguy"
      ? [`A subida é longa (${cm(t.measurements.nippleRiseMm)} cm): o pedículo dobra-se sobre si mesmo`, ...long.slice(1), base.notes.transposition[1]]
      : [...base.notes.transposition, ...long];
  // a pedicle thinned to reach the target is no longer the largest of them
  const resection = [...base.notes.resection.filter((note) => !design.length || !note.startsWith("É o maior dos pedículos")), ...design];
  return { ...base, notes: { ...base.notes, transposition, resection } };
}

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

function stepViews(key: string): PackView[] {
  const t = techniques[key];
  const m = t.measurements;
  const technique = t.technique;
  const s = stepNotesOf(t);
  const words = text[technique];
  const zoom = zoomOf(t);
  const frames = stepFramesOf(key);
  const frameOf = (frame: string) => frames.findIndex((item) => item.id === frame);
  const last = frames.length - 1;
  const result = stepMeasurements(key);
  const sizes = stepMeasures(key);
  const branches = stepBranches(key);
  const pillarsMl = stepPillarVolumes(key);
  // the free graft has no pedicle; the periareolar reduction resects no skin and works round the areola
  const graft = !hasPedicle(t);
  const ringSkin = t.skin === "ring";
  const own = new Set(stepStructuresOf(key));
  const mine = (structure: string) => !structure.startsWith("mamo-step-") || own.has(structure);
  const id = (part: string) => `mamo-step-${part}-${key}`;
  const [skin, excised, dermis, pedicle, resection, medial, lateral] = ["skin", "excised", "dermis", "pedicle", "resection", "pillar-medial", "pillar-lateral"].map(id);
  const [nac, ring, tome, measures, arteries, sutures, areolaSuture, cover, coverRing, scars] = ["nac", "areola-ring", "areolotome", "measures", "arteries", "sutures", "sutures-areola", "disc", "disc-ring", "scars"].map(id);
  const marking = `mamo-marking-${key}`;
  // "dermis" is the de-epithelialised skin over the pedicle or, in the free graft, the bed of the graft: a part of
  // the skin that stays, shown with it from the start and tinted only once it is de-epithelialised
  const skinParts = [skin, excised, dermis];
  const areola = [nac, ring];
  const pieces = [pedicle, resection, medial, lateral];
  const label = (structure: string, piece: string, text: string): PackLabel => ({ structure, near: `step:${key}:${piece}`, text });
  // the areola beyond the areolotome stays as dermis, or leaves with the specimen (free graft)
  const tint = { [excised]: tints.excised, [ring]: graft ? tints.excised : tints.dermis, ...(graft ? {} : { [dermis]: tints.dermis }) };
  const flaps = s.pillar === "Pilar" ? "pilares" : "retalhos";
  const pillarLabels = [label(medial, "pillar-medial", `${s.pillar} medial (${pillarsMl.medial} mL)`), label(lateral, "pillar-lateral", `${s.pillar} lateral (${pillarsMl.lateral} mL)`)];
  // one camera for the whole sequence (see AnatomyViewer): the tissue moves, the point of view stays
  const common = { orientation: "frontal" as const, anchor: `step:${key}:centre`, distance: (ringSkin ? 0.48 : 0.55) * zoom, breast: t.state, follow: false };
  // the lower pole is seen from below; the periareolar ring, on the front of the breast, from the front
  const below = (distance: number) => (ringSkin ? {} : { orientation: "inferior" as const, distance: distance * zoom });
  const surgery = (frame: number, extra: Partial<NonNullable<PackView["surgery"]>> = {}) => ({ technique: key, frame, ...extra });
  const areolaText = `Aréola: ${cm(sizes.areolaNowMm)} cm, alargada pela hipertrofia → ${cm(sizes.areolaNewMm)} cm com o areolótomo`;
  const ascension = `Ascensão do complexo areolopapilar (mamilo → A, sobre a pele): ${cm(sizes.ascensionMm)} cm`;
  const lineLabels = Object.entries(s.lines).map(([line, text]) => ({ structure: marking, near: `step:${key}:line:${line}`, text: text.replace("{mm}", `${cm(m.linesMm[line] ?? 0)} cm`) }));
  const measureLabels: PackLabel[] = [label(measures, "measure-ascension", `Ascensão ${cm(sizes.ascensionMm)} cm`), ...(sizes.bcMm ? [label(measures, "measure-bc", `B–C ${cm(sizes.bcMm)} cm`)] : [])];
  const seamLabels = (seams: string[]) => seams.map((seam) => label(seam === "areola" ? areolaSuture : sutures, `seam-${seam}`, s.seams[seam]));
  const removed = ringSkin
    ? `Sai: ${m.resectionMl} mL de glândula (cerca de ${m.resectionG} g, ${m.resectionPct}% do monte); nenhuma pele é ressecada`
    : `Sai: ${m.resectionMl} mL de tecido (cerca de ${m.resectionG} g, ${m.resectionPct}% do monte) e a pele do padrão`;
  const stays = graft
    ? `Ficam: os retalhos medial (${pillarsMl.medial} mL) e lateral (${pillarsMl.lateral} mL) e o polo superior; não há pedículo`
    : `Fica: o pedículo ${t.pedicle} (verde, ${m.pedicleMl} mL) e os ${flaps} medial (${pillarsMl.medial} mL) e lateral (${pillarsMl.lateral} mL)`;
  const nerves = "Os nervos (menu de estruturas ou botão Vasos) seguem a mesma regra";
  const vessels = graft
    ? `Artérias da mama: o enxerto não tem pedículo, e nenhuma artéria chega a ele. Em vermelho escuro, as cortadas pela ressecção: o trecho que está na peça sai com ela. ${nerves}`
    : branches.artery.length
      ? `Artérias da mama: em vermelho vivo as que o pedículo conserva até o mamilo (${branchList(branches.artery)}); em vermelho escuro as cortadas, cujo trecho na peça sai com ela. ${nerves}`
      : `Artérias da mama: no modelo, nenhuma chega ao mamilo sem cruzar a ressecção ou as incisões; em vermelho escuro as cortadas, cujo trecho na peça sai com ela. ${nerves}`;
  const arteryLabel = !graft && branches.artery.length ? "Artérias que o pedículo conserva" : "Artérias cortadas pela ressecção";
  const outerRing = graft ? "o anel de fora sai com a peça" : ringSkin ? "o anel de fora é desepitelizado com a pele em volta" : "o anel de fora será desepitelizado com o pedículo";

  const views: PackView[] = [
    {
      ...common,
      ...below(0.5),
      id: `${key}-passo-marcacao`,
      title: "1. Marcação",
      description: `${words.markingSummary} As medidas estão sobre a pele, em pé; cada passo seguinte é animado a partir do anterior.`,
      structures: ["skin", "contralateral-breast", ...skinParts, ...areola, tome, marking, measures],
      solid: ["skin", ...skinParts],
      labels: [...lineLabels, ...measureLabels],
      surgery: surgery(0, { replayFrom: null }),
      relations: [...measures_(key), ascension, areolaText, ...words.markingSteps, "A paciente está em pé, como na marcação"],
    },
    {
      ...common,
      ...below(0.5),
      id: `${key}-passo-areolotomo`,
      title: "2. Areolótomo",
      description: `A aréola deste caso tem ${cm(sizes.areolaNowMm)} cm: a hipertrofia e a ptose a alargam. O areolótomo de ${cm(sizes.areolaNewMm)} cm, centrado no mamilo com a pele sob tensão, marca a nova aréola; ${outerRing}.`,
      structures: ["skin", "contralateral-breast", ...skinParts, ...areola, tome, measures],
      solid: ["skin", ...skinParts],
      labels: [label(tome, "areolotome", `Areolótomo: ${cm(sizes.areolaNewMm)} cm`), label(ring, "areola-now", `Aréola atual: ${cm(sizes.areolaNowMm)} cm`), label(measures, "measure-ascension", `Ascensão: ${cm(sizes.ascensionMm)} cm`)],
      surgery: surgery(0, { replayFrom: null, caption: "Marcação da aréola com o areolótomo" }),
      relations: [
        areolaText,
        ascension,
        graft ? "O anel entre os dois círculos sai com a peça: só o disco do areolótomo vira enxerto" : ringSkin ? "O anel entre os dois círculos perde a epiderme e fica sob a pele, em volta da aréola" : "O anel entre os dois círculos perde a epiderme e fica no pedículo",
        graft ? `No resultado o enxerto mede ${cm(sizes.areolaResultMm)} cm: o leito é marcado com o mesmo marcador` : `No resultado a aréola mede ${cm(sizes.areolaResultMm)} cm: a abertura da pele é do mesmo tamanho`,
      ],
    },
    {
      ...common,
      ...below(0.5),
      id: `${key}-passo-incisao`,
      title: graft ? "3. Enxerto e incisão" : ringSkin ? "3. Desepitelização" : "3. Incisão",
      description: s.incision,
      structures: ["skin", "contralateral-breast", ...skinParts, ...areola, tome, marking],
      solid: ["skin", ...skinParts],
      tint,
      labels: graft
        ? [label(excised, "excised", "Pele a ressecar"), label(nac, "nac", "Enxerto: retirado e guardado"), label(ring, "areola-ring", "Aréola além do areolótomo: sai com a peça")]
        : ringSkin
          ? [label(dermis, "dermis", "Anel desepitelizado"), label(ring, "areola-ring", "Aréola além do areolótomo: desepitelizada")]
          : [label(excised, "excised", "Pele a ressecar"), label(dermis, "dermis", "Derme desepitelizada (sobre o pedículo)"), label(ring, "areola-ring", "Aréola além do areolótomo: desepitelizada")],
      surgery: surgery(frameOf("incisao"), { replayFrom: null }),
      relations: [
        graft
          ? "Pele laranja: sai com a peça. O enxerto fica fora da mama até o fim da operação"
          : ringSkin
            ? "Pele rosada: perde só a epiderme e fica em volta da aréola. Nenhuma pele é ressecada"
            : `Pele laranja: sai com a peça. Pele rosada: perde só a epiderme e fica sobre o pedículo ${t.pedicle}`,
        ...s.notes.incision,
      ],
    },
    {
      ...common,
      id: `${key}-passo-resseccao`,
      title: graft ? "4. Amputação do polo inferior" : "4. Ressecção",
      description: s.resection,
      structures: ["skin", "contralateral-breast", ...skinParts, ...areola, ...pieces, arteries],
      translucent: [skin, ...(graft ? [dermis] : [])],
      tint,
      focus: [resection, excised],
      labels: [label(resection, "resection", `Ressecção ${t.resection}: ${m.resectionMl} mL`), label(excised, "excised", "Pele ressecada"), label(pedicle, "pedicle", `Pedículo ${t.pedicle} (${m.pedicleMl} mL)`), label(arteries, "arteries", arteryLabel), ...pillarLabels],
      surgery: surgery(frameOf("resseccao")),
      relations: [removed, stays, ...designNotes(t), vessels, ...s.notes.resection],
    },
  ];
  if (frameOf("transposicao") >= 0) {
    views.push({
      ...common,
      id: `${key}-passo-transposicao`,
      title: ringSkin ? "5. Montagem da glândula" : "5. Transposição",
      description: s.transposition,
      structures: ["skin", "contralateral-breast", ...skinParts, ...areola, ...pieces, arteries],
      translucent: [skin, excised, resection],
      tint,
      focus: [pedicle, nac],
      labels: [label(nac, "nac", `Complexo areolopapilar: sobe ${cm(sizes.ascensionMm)} cm até A`), label(pedicle, "pedicle", `Pedículo ${t.pedicle}`), label(arteries, "arteries", ringSkin ? "Vasos do pedículo: sobem com a glândula" : "Vasos do pedículo: dobram-se com ele")],
      surgery: surgery(frameOf("transposicao")),
      relations: [ascension + ` (fúrcula–A: ${cm(m.notchToAMm)} cm)`, vessels, ...s.notes.transposition],
    });
  }
  // the closure, stage by stage: what is sutured to what
  // the areola is sutured at the end where the skin is closed first (Pitanguy, free graft), from the start in the others
  const lateAreola = technique === "pitanguy" || graft;
  frames.slice(Math.max(frameOf("transposicao"), frameOf("resseccao")) + 1).forEach((frame, index, stages) => {
    const stage = s.closure[frame.id];
    const covered = technique === "pitanguy" && ["sulco", "marca-areola"].includes(frame.id);
    // with the skin opaque only the surface counts: pieces and vessels stay inside
    const structures = stage.solid
      ? ["skin", "contralateral-breast", skin, nac, sutures, ...(graft ? [dermis] : [])]
      : ["skin", "contralateral-breast", skin, dermis, nac, ...(graft ? [] : [ring]), pedicle, medial, lateral, arteries, sutures];
    if (!lateAreola || index === stages.length - 1) structures.push(areolaSuture);
    if (technique === "pitanguy" && ["sulco", "marca-areola", "abertura"].includes(frame.id)) structures.push(cover);
    if (frame.id === "marca-areola" || frame.id === "leito") structures.push(coverRing);
    const labels = [...seamLabels(stage.seams)];
    // where the pillars (or the flaps of an inverted T) come together
    if (frame.id === "pilares" || frame.id === "round-block" || (s.pillar === "Retalho" && frame.id === (graft ? "ponto-t" : "sulco"))) labels.push(...pillarLabels);
    if (covered) labels.push(label(cover, "cover", frame.id === "sulco" ? "Pele fechada sobre o complexo areolopapilar" : "Pele a retirar"));
    if (frame.id === "marca-areola") labels.push(label(coverRing, "cover-ring", `Nova aréola: ${cm(sizes.areolaNewMm)} cm no vértice do cone`));
    if (frame.id === "abertura") labels.push(label(cover, "cover", "Disco de pele retirado"));
    if (frame.id === "leito") labels.push(label(coverRing, "cover-ring", `Leito do enxerto: ${cm(sizes.areolaNewMm)} cm no vértice do cone`), label(dermis, "bed", "Derme desepitelizada"));
    if (frame.id === "enxerto") labels.push(label(nac, "nac", "Enxerto do complexo areolopapilar"));
    views.push({
      ...common,
      ...below(0.42),
      id: `${key}-passo-${frame.id}`,
      title: `${views.length + 1}. ${stage.title}`,
      description: stage.text,
      structures,
      ...(stage.solid ? { solid: ["skin", skin, dermis, cover] } : { translucent: [skin, ...(graft ? [dermis] : [])] }),
      // the bed of the graft turns to dermis when it is de-epithelialised
      tint: graft && ["leito", "enxerto"].includes(frame.id) ? { ...tint, [dermis]: tints.dermis } : tint,
      focus: stage.seams.includes("deep") ? [medial, lateral] : [],
      labels,
      surgery: surgery(frameOf(frame.id)),
      relations: [...stage.notes, ...(stage.seams.length ? ["Cada cor liga as duas bordas que se encontram; os fios mostram os pontos, que se fecham quando a sutura é feita"] : []), stepNote],
    });
  });
  const scarWords = s.scars.map((item) => item.toLowerCase().replace("cicatriz ", "")).join(", ");
  views.push({
    ...common,
    id: `${key}-passo-resultado`,
    title: `${views.length + 1}. Resultado esperado`,
    description: `Mama operada em pé, com ${s.scars.length > 1 ? "as cicatrizes da técnica" : "a única cicatriz da técnica"}: ${scarWords}. A outra mama segue como antes, para comparar.`,
    structures: ["skin", "contralateral-breast", skin, nac, scars, ...(graft ? [dermis] : [])],
    solid: ["skin", skin, ...(graft ? [dermis] : [])],
    labels: [...s.scars.map((item, index) => label(scars, `scar-${index}`, item)), label(nac, "nac", `${graft ? "Enxerto" : "Aréola"}: ${cm(sizes.areolaResultMm)} cm`)],
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
  // only what this technique has: structures and label anchors differ (no resected skin, no pedicle)
  return views.map((view) => ({
    ...view,
    structures: view.structures.filter(mine),
    ...(view.focus ? { focus: view.focus.filter(mine) } : {}),
    labels: view.labels?.filter((item) => mine(item.structure) && item.near in stepPoints),
  }));
}

// cards of the step pieces (tap on the model)
Object.keys(techniques).forEach((key) => {
  const t = techniques[key];
  const m = t.measurements;
  const technique = t.technique;
  const s = stepNotesOf(t);
  const pillarsMl = stepPillarVolumes(key);
  const sizes = stepMeasures(key);
  const branches = stepBranches(key);
  const after = stepMeasurements(key).after;
  const graft = !hasPedicle(t);
  const ringSkin = t.skin === "ring";
  const flaps = s.pillar === "Pilar" ? "pilares" : "retalhos";
  const stages = Object.values(s.closure);
  const closure = stages.map((stage) => `${stage.title}: ${stage.text}`);
  const areolaStage = [...stages].reverse().find((stage) => stage.seams.includes("areola"));
  planDetails[`mamo-step-skin-${key}`] = {
    summary: "Pele que fica: no fechamento, suas bordas se encontram nas linhas de sutura e ela recobre a nova forma da mama. Em volta, uma faixa de transição leva a pele operada até a pele que não muda.",
    surgical: [...closure, stepNote],
  };
  planDetails[`mamo-step-excised-${key}`] = {
    summary: graft ? `Pele ressecada: a pele dentro do padrão de ${t.short}, com o sítio antigo da aréola. Sai com a peça.` : `Pele ressecada: a pele dentro do padrão de ${t.label}, fora do pedículo. Sai com a peça.`,
    surgical: [s.resection],
  };
  planDetails[`mamo-step-dermis-${key}`] = graft
    ? {
        summary: `Leito do enxerto: o disco de ${cm(sizes.areolaNewMm)} cm marcado no vértice do cone, com a mama já fechada. É desepitelizado, e a derme que fica recebe o enxerto do complexo areolopapilar.`,
        surgical: [s.closure.leito.text, s.closure.enxerto.text],
      }
    : ringSkin
      ? {
          summary: "Anel desepitelizado: a pele entre o traço do areolótomo e o anel de fora perde a epiderme e fica. Leva o plexo subdérmico ao complexo areolopapilar; no fechamento fica sob a pele, franzida pela cerclagem.",
          surgical: [s.incision],
        }
      : {
          summary: `Derme desepitelizada sobre o pedículo ${t.pedicle}: perde a epiderme e fica, levando o plexo subdérmico ao complexo areolopapilar. No fechamento fica sob a pele.`,
          surgical: [s.incision],
        };
  if (!graft) planDetails[`mamo-step-pedicle-${key}`] = { ...planDetails[`mamo-pedicle-${key}`], surgical: [s.transposition, ...(planDetails[`mamo-pedicle-${key}`].surgical ?? [])] };
  planDetails[`mamo-step-resection-${key}`] = planDetails[`mamo-resection-${key}`];
  for (const side of ["medial", "lateral"] as const) {
    planDetails[`mamo-step-pillar-${side}-${key}`] = {
      summary: ringSkin
        ? `Pilar ${side}: a glândula que fica do lado ${side} da cunha, com ${pillarsMl[side]} mL no modelo. No fechamento é aproximado do outro pilar com pontos profundos.`
        : `${s.pillar} ${side}: o tecido que fica sob a pele ${side} do padrão, com ${pillarsMl[side]} mL no modelo. No fechamento vai para o centro, abaixo da aréola.`,
      surgical: closure,
    };
  }
  planDetails[`mamo-step-nac-${key}`] = graft
    ? {
        summary: `Enxerto do complexo areolopapilar: a aréola de ${cm(sizes.areolaNowMm)} cm é reduzida a ${cm(sizes.areolaNewMm)} cm pelo areolótomo e retirada como enxerto de pele total, antes da ressecção. No fim é suturada sobre o leito, no vértice do cone: o mamilo fica ${cm(after.nippleToFoldMm)} cm acima do sulco e o enxerto mede ${cm(sizes.areolaResultMm)} cm.`,
        surgical: [s.incision, s.closure.enxerto.text],
      }
    : {
        summary: `Complexo areolopapilar: a aréola de ${cm(sizes.areolaNowMm)} cm é reduzida a ${cm(sizes.areolaNewMm)} cm pelo areolótomo; ela sobe ${cm(sizes.ascensionMm)} cm sobre a pele com o pedículo ${t.pedicle} e chega ao ponto A. No resultado, o mamilo fica ${cm(after.nippleToFoldMm)} cm acima do sulco e a aréola mede ${cm(sizes.areolaResultMm)} cm.`,
        surgical: [s.transposition],
      };
  planDetails[`mamo-step-areola-ring-${key}`] = {
    summary: `Aréola além do areolótomo: o anel entre ${cm(sizes.areolaNewMm)} e ${cm(sizes.areolaNowMm)} cm. ${
      graft ? "Não faz parte do enxerto: sai com a peça." : ringSkin ? "Na incisão perde a epiderme, com o resto do anel, e fica sob a pele em volta da aréola." : "Na incisão perde a epiderme e passa a fazer parte da derme do pedículo."
    }`,
  };
  planDetails[`mamo-step-areolotome-${key}`] = {
    summary: `Areolótomo de ${cm(sizes.areolaNewMm)} cm: marca a nova aréola, centrado no mamilo, com a pele da aréola sob tensão.`,
    surgical: ["Diâmetros usuais de 38 a 45 mm; o mesmo diâmetro define a abertura da pele que receberá a aréola"],
  };
  planDetails[`mamo-step-measures-${key}`] = {
    summary: "Medidas da marcação sobre a pele, em pé: a ascensão do complexo areolopapilar (do mamilo ao ponto A, pelo meridiano) e, no T invertido, a distância entre B e C.",
    landmarks: [`Ascensão: ${cm(sizes.ascensionMm)} cm`, ...(sizes.bcMm ? [`B–C em linha reta: ${cm(sizes.bcMm)} cm`] : []), ...measures_(key)],
  };
  const travel = `cada trecho vai com o tecido em que corre. O que está na peça ressecada sai com ela;${graft ? "" : " o que está no pedículo o acompanha e é sepultado com ele;"} o que está nos ${flaps} e no resto da mama os acompanha; a origem na parede torácica não se move`;
  planDetails[`mamo-step-arteries-${key}`] = {
    summary: `Artérias da mama (camada esquemática) acompanhando a cirurgia: ${travel}. ${
      graft
        ? "O enxerto não tem pedículo: nenhuma artéria chega a ele."
        : branches.artery.length
          ? `Em vermelho vivo, as que o pedículo ${t.pedicle} conserva até o mamilo: ${branchList(branches.artery)}.`
          : "No modelo, nenhuma chega ao mamilo sem cruzar a ressecção ou as incisões."
    }`,
    surgical: ["Pode ser ocultado no menu de estruturas; a escolha vale para todos os passos da técnica", "Trajetos típicos da literatura, não os de uma pessoa"],
  };
  planDetails[`mamo-step-nerves-${key}`] = {
    summary: `Nervos da mama (camada esquemática) acompanhando a cirurgia, como as artérias. ${
      graft ? "O enxerto não leva nervos: a sensibilidade do mamilo se perde." : `Em amarelo vivo, os que o pedículo ${t.pedicle} conserva: ${branchList(branches.nerve)}.`
    }`,
    surgical: ["Ligue no menu de estruturas ou no botão Vasos; a escolha vale para todos os passos da técnica"],
  };
  planDetails[`mamo-step-sutures-areola-${key}`] = {
    summary: `${graft ? "Sutura do enxerto" : "Sutura da aréola"}: ${s.seams.areola}. Cada fio liga um ponto da borda da pele a um ponto da borda da aréola.`,
    surgical: areolaStage ? [areolaStage.text] : [],
  };
  planDetails[`mamo-step-sutures-${key}`] = {
    summary: `O que é suturado com o quê: cada cor liga as duas bordas que se encontram, e os fios são os pontos, que se encurtam até sumir quando a sutura é feita. ${Object.values(s.seams).join("; ")}.`,
    surgical: closure,
  };
  if (technique === "pitanguy") {
    planDetails[`mamo-step-disc-${key}`] = {
      summary: "Pele dos retalhos sobre o complexo areolopapilar: no Pitanguy a pele se fecha inteira antes de a aréola ser posicionada. O disco marcado no vértice do cone é retirado para exteriorizar a aréola.",
      surgical: [s.closure.sulco.text, s.closure.abertura.text],
    };
    planDetails[`mamo-step-disc-ring-${key}`] = { summary: s.closure["marca-areola"].text };
  }
  if (graft) planDetails[`mamo-step-disc-ring-${key}`] = { summary: s.closure.leito.text };
  planDetails[`mamo-step-scars-${key}`] = {
    summary: `${s.scars.length > 1 ? "Cicatrizes" : "Cicatriz"} do resultado esperado: ${s.scars.map((item) => item.toLowerCase().replace("cicatriz ", "")).join(", ")}.`,
    surgical: [...s.notes.result, `Os ${flaps} e a pele se fecham sem tensão no modelo; na paciente, a cicatriz amadurece em meses`],
  };
});

const markingPoints: Record<TechniqueId, string[]> = {
  pitanguy: ["A", "B", "C", "D", "E"],
  wise: ["A", "B", "C", "D", "E"],
  orlando: ["A", "B", "C", "D", "E"],
  thorek: ["A", "B", "C", "D", "E"],
  vertical: ["A", "T", "M", "L", "F"],
  lejour: ["A", "T", "M", "L", "F"],
  periareolar: ["A", "S", "I", "M", "L"],
};

// ---- packs: one group per degree of ptosis --------------------------------------------------------------------------
const countWords: Record<number, string> = { 1: "Uma técnica", 2: "Duas técnicas", 3: "Três técnicas", 4: "Quatro técnicas", 5: "Cinco técnicas" };
/** A technique label inside a sentence. */
const inSentence = (label: string) => label.replace(/^(Vertical|Periareolar)/, (word) => word.toLowerCase());
const sentenceList = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}` : (items[0] ?? ""));
const techniqueList = (planCase: PlanCaseId) => sentenceList(keysOf(planCase).map((key) => inSentence(techniques[key].label)));
const moundOf = (planCase: PlanCaseId) => techniques[keysOf(planCase)[0]].dims.moundMl;

/** One pack per technique and case: from the marking to the expected result, every step animated from the one before. */
export const mammaplastyStepPacksOf = (planCase: PlanCaseId): Pack[] =>
  keysOf(planCase).map((key) => {
    const t = techniques[key];
    const moves = hasPedicle(t) ? `para onde vão o complexo areolopapilar e o pedículo ${t.pedicle} com seus vasos` : "o complexo areolopapilar retirado como enxerto livre";
    return {
      id: `mamoplastia-${key}-passo-a-passo`,
      title: `${t.label}${caseWords[planCase].title}: passo a passo`,
      summary: `Na ${caseWords[planCase].breast} (${t.dims.moundMl} mL). Da marcação ao resultado esperado, com a paciente em pé: medidas da marcação, redução da aréola com o areolótomo, o que é ressecado, ${moves}, e o fechamento em etapas, com o que é suturado com o quê. Cada passo é animado a partir do anterior; "Rever" repete a animação.`,
      views: stepViews(key),
    };
  });

/** Marking, pedicle and resection of the techniques of a case. */
export const mammaplastyPackOf = (planCase: PlanCaseId): Pack => {
  const keys = keysOf(planCase);
  const weights = sentenceList(keys.map((key) => `${techniques[key].short} ${techniques[key].measurements.resectionG} g`));
  const designed = techniques[keys[0]].dims.resultMl != null;
  return {
    id: planCase === "ptose-2" ? "mamoplastia-redutora" : `mamoplastia-redutora-${planCase}`,
    title: `Mamoplastia redutora${caseWords[planCase].title}: marcação, pedículo e ressecção`,
    summary: `${countWords[keys.length] ?? `${keys.length} técnicas`} na ${caseWords[planCase].breast}, de ${moundOf(planCase)} mL: ${techniqueList(planCase)}. ${
      designed ? "Pedículos afinados e retalhos de 15 mm ou mais para chegar a uma mama menor. " : ""
    }Peças no modelo: ${weights}. Para cada técnica: a marcação na pele, o pedículo com os vasos que conserva e a peça ressecada, com volume e peso estimados.`,
    views: keys.flatMap((key) => views(key, markingPoints[techniques[key].technique])),
  };
};

/** The marking shown for each degree in the overview. */
const overviewMarking: Record<PlanCaseId, string> = { "ptose-1": "periareolar-p1", "ptose-2": "vertical", "ptose-3": "wise-p3", g3: "wise-g3", g4: "thorek-g4" };
/** What each technique does to a breast, in one line (measured on the model). */
const techniqueLine = (key: string) => {
  const t = techniques[key];
  const m = t.measurements;
  const supplyLine = hasPedicle(t) ? `chegam ao mamilo sem serem cortadas: ${list(m.kept, "artery").replace("nenhum", "nenhuma artéria da camada esquemática")}` : "sem pedículo: o complexo areolopapilar vai como enxerto livre";
  return `${t.label}: peça de ${m.resectionMl} mL (cerca de ${m.resectionG} g, ${m.resectionPct}% do monte); fica uma mama de ${m.leftMl ?? t.dims.moundMl - m.resectionMl} mL; ${supplyLine}`;
};
/** Which techniques for which breast: one view per degree of ptosis, with what each technique removes and keeps. */
export const mammaplastyOverviewPack: Pack = {
  id: "mamoplastia-tecnica-por-grau",
  title: "Mamoplastia redutora: técnica por grau de ptose",
  summary:
    "Que técnica para que mama: da ptose grau I à gigantomastia, as técnicas modeladas em cada grau, com a subida do complexo areolopapilar, o peso da peça, o que fica da mama e as artérias que chegam ao mamilo. Cada grau tem os seus packs, com a marcação, o pedículo, a ressecção e o passo a passo de cada técnica.",
  views: planCaseIds.map((planCase) => {
    const keys = keysOf(planCase);
    const main = techniques[overviewMarking[planCase]] ?? techniques[keys[0]];
    return {
      id: `tecnicas-${planCase}`,
      title: `${caseWords[planCase].short}: ${sentenceList(keys.map((key) => inSentence(techniques[key].short)))}`,
      description: caseWords[planCase].why(main),
      structures: ["skin", "nipple-areola", "contralateral-breast", referencesOf(planCase), `mamo-marking-${main.key}`],
      solid: ["skin"],
      orientation: "anterior" as const,
      anchor: "nipple",
      distance: 0.62 * zoomOf(main),
      breast: main.state,
      labels: pointLabels(main.key, ["A"]),
      relations: [
        `Monte de ${moundOf(planCase)} mL; subida do complexo areolopapilar até o ponto A: ${cm(main.measurements.nippleRiseMm)} cm sobre a pele`,
        ...keys.map(techniqueLine),
        `Marcação mostrada: ${inSentence(main.label)}. As outras estão nos packs deste grau`,
        planNoteOf(main),
      ],
    };
  }),
};

/** One group of the library per degree: the plan of its techniques, then each technique step by step. */
export const mammaplastyGroups: PackGroup[] = planCaseIds.map((planCase) => ({
  id: `mamoplastia-${planCase}`,
  title: `Mamoplastia redutora: ${caseWords[planCase].area}`,
  description: `${caseWords[planCase].group} ${countWords[keysOf(planCase).length] ?? "Técnicas"}: ${techniqueList(planCase)}.`,
  packs: [mammaplastyPackOf(planCase), ...mammaplastyStepPacksOf(planCase)],
}));
