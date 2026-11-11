/**
 * Packs de visualização: conjuntos sistematizados de vistas do modelo, organizados por grupo.
 * Cada vista define exatamente quais estruturas aparecem, o enquadramento, rótulos ancorados em
 * estruturas reais e, quando útil, um corte, um espaço cirúrgico, uma manipulação rígida ou uma
 * zona projetada (polígono cujos vértices são pontos reais das estruturas de referência).
 */
import { breastStates, measurementsOf } from "@/lib/breastStates";
import type { SectionAxis } from "@/lib/sectioning";
import type { SkinWindow } from "@/lib/viewerTypes";

export type ViewOrientation = "anterior" | "anterolateral" | "lateral" | "profile" | "axillary" | "posterior" | "posterolateral";

/** A point: nearest vertex of `structure` to `near` (landmark key, "landmark.index" or structure id), plus an optional offset in mm. */
export type AnchoredPoint = { structure: string; near: string; nearOffsetMm?: [number, number, number]; offsetMm?: [number, number, number] };

export type PackLabel = AnchoredPoint & { text: string };

export type PackZone = {
  label: string;
  color: string;
  corners: AnchoredPoint[];
  /** draw each edge with its own caption (e.g. the dissection limits) */
  edgeLabels?: string[];
};

export type PackView = {
  id: string;
  title: string;
  description: string;
  structures: string[];
  /** structures emphasised (glow); the rest stays for context */
  focus?: string[];
  orientation: ViewOrientation;
  /** landmark key or structure id the camera orbits around */
  anchor?: string;
  /** < 1 = closer */
  distance?: number;
  labels?: PackLabel[];
  zones?: PackZone[];
  cut?: { axis: SectionAxis; at: string; offsetMm?: number; flip?: boolean; scope?: "all" | "superficial" };
  skinWindow?: SkinWindow;
  manipulations?: Record<string, number>;
  space?: string;
  /** key spatial relationships shown beside the view */
  relations: string[];
  /** upper-limb position (src/data/armPoses.json); omitted = anatomical position */
  pose?: string;
  /** breast state (src/data/breastModel.json: ptosis grades); omitted = breast as scanned */
  breast?: string;
  /** structures drawn opaque in this view (the skin, when the view is about the surface) */
  solid?: string[];
  /** false: the camera stays where it is when the arm pose or the breast state changes (default: it follows the anchor) */
  follow?: boolean;
};

export type Pack = { id: string; title: string; summary: string; views: PackView[] };
export type PackGroup = { id: string; title: string; description: string; packs: Pack[] };

const breastParts = ["breast", "breast-fat", "breast-ligaments", "nipple-areola"];
const thoracicCage = ["chest-wall", "costal-cartilages"];
const axillaryNerves = ["thoracodorsal-nerve", "long-thoracic-nerve", "intercostobrachial-nerve", "pectoral-nerves"];
const axillaryVessels = ["axillary-vessels", "lateral-thoracic-vessels", "subscapular-vessels", "thoracodorsal-vessels", "thoracoacromial-vessels"];
// Schematic structures traced from the literature (src/data/breastAnatomy.json).
const mammaryArteries = ["internal-thoracic-perforators", "lateral-mammary-branches", "intercostal-perforators", "thoracoacromial-mammary-branch"];
const mammaryNerves = ["fourth-intercostal-lateral-branch", "lateral-cutaneous-branches", "anterior-cutaneous-branches"];
const breastSuspension = ["horizontal-septum", "septum-ligaments", "inframammary-ligament"];
const arterialSources = ["internal-thoracic-vessels", "lateral-thoracic-vessels", "thoracoacromial-vessels"];
const schematicNote = "Camada esquemática: trajetos típicos da literatura, traçados sobre as costelas, os vasos de origem, a parede e a pele do modelo";

const cm = (mm: number) => (mm / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** Measurements taken on the deformed model by scripts/hybrid/build_breast.py, as one sentence. */
const breastFacts = (state: string | null) => {
  const m = measurementsOf(state);
  const level = Math.round(Math.abs(m.nippleToFoldMm));
  const nipple = level < 3 ? "mamilo na altura do sulco" : `mamilo ${level} mm ${m.nippleToFoldMm > 0 ? "acima" : "abaixo"} do sulco`;
  const volume = `volume ≈ ${Math.round(m.volumeMl / 10) * 10} mL${m.volumeGainPct > 0 ? ` (+${m.volumeGainPct}%)` : ""}`;
  return `${nipple}, fúrcula–mamilo ${cm(m.notchToNippleMm)} cm, mamilo–sulco ${cm(m.nippleToFoldSkinMm)} cm, ${volume}`;
};
// Surface views: opaque skin with the nipple-areola complex on it. Profiles leave the far nipple out:
// at eye level it would show beside the near breast.
const ptosisProfileStructures = ["skin", "nipple-areola"];
const ptosisSurface = [...ptosisProfileStructures, "contralateral-breast"];
const ptosisLabels: PackLabel[] = [
  { structure: "nipple-areola", near: "nipple", text: "Mamilo" },
  { structure: "skin", near: "inframammaryFold", text: "Sulco inframamário (fixo)" },
  { structure: "skin", near: "nipple", nearOffsetMm: [0, 60, -25], text: "Polo superior" },
  { structure: "skin", near: "nipple", nearOffsetMm: [0, -32, -8], text: "Polo inferior" },
];
const ptosisProfile = (index: number, extra: string[]): PackView => {
  const state = breastStates[index];
  return {
    id: state.id,
    title: state.short,
    description: state.description,
    structures: ptosisProfileStructures,
    solid: ["skin"],
    orientation: "profile",
    // same fixed frame for every grade: the nipple is seen going down past the fold
    anchor: "breastProfile",
    follow: false,
    distance: 0.9,
    breast: state.id,
    labels: ptosisLabels,
    relations: [`No modelo: ${breastFacts(state.id)}`, ...extra],
  };
};

export const packGroups: PackGroup[] = [
  {
    id: "mama",
    title: "Mama",
    description: "Anatomia da glândula, ptose, irrigação, inervação, drenagem e planos de reconstrução.",
    packs: [
      {
        id: "anatomia-mama",
        title: "Anatomia da mama",
        summary: "Camadas da mama e sua relação com a parede torácica, do tegumento ao plano costal.",
        views: [
          {
            id: "camadas",
            title: "Camadas e relações",
            description: "Pele translúcida, corpo adiposo, parênquima e ligamentos de Cooper sobre a fáscia e o peitoral maior.",
            structures: ["skin", ...breastParts, "pectoral-fascia", "pectoralis-major", "serratus-anterior", ...thoracicCage, "contralateral-breast"],
            focus: ["breast", "breast-fat"],
            orientation: "anterolateral",
            anchor: "breastCenter",
            distance: 0.75,
            labels: [
              { structure: "breast", near: "breastCenter", text: "Parênquima (lobos)" },
              { structure: "breast-fat", near: "breastLateral", text: "Corpo adiposo" },
              { structure: "nipple-areola", near: "nipple", text: "Complexo areolopapilar" },
              { structure: "pectoralis-major", near: "breastCenter", text: "Peitoral maior" },
              { structure: "serratus-anterior", near: "breastLateral", text: "Serrátil anterior" },
            ],
            relations: [
              "A mama ocupa da 2ª à 6ª costela, da borda esternal à linha axilar média",
              "Cerca de 2/3 repousam sobre o peitoral maior e 1/3 sobre o serrátil anterior",
              "A cauda axilar (Spence) se estende pela borda inferolateral do peitoral maior até a axila",
            ],
          },
          {
            id: "parenquima",
            title: "Parênquima e ductos",
            description: "Sem pele e sem gordura: lobos convergindo por ductos e seios lactíferos para o mamilo.",
            structures: ["breast", "breast-ligaments", "nipple-areola", "pectoralis-major", ...thoracicCage],
            focus: ["breast", "nipple-areola"],
            orientation: "anterolateral",
            anchor: "nipple",
            distance: 0.5,
            labels: [
              { structure: "breast", near: "nipple", text: "Seios e ductos lactíferos" },
              { structure: "breast", near: "breastLateral", text: "Lobos" },
              { structure: "breast-ligaments", near: "breastCenter", text: "Ligamentos de Cooper" },
            ],
            relations: ["Os ductos principais convergem radialmente para o mamilo, com dilatação (seio lactífero) subareolar", "Os ligamentos de Cooper unem a fáscia superficial à pele e à fáscia peitoral"],
          },
          {
            id: "sagital",
            title: "Corte sagital pelo mamilo",
            description: "Plano sagital no eixo do mamilo mostrando a espessura da mama sobre o peitoral e as costelas.",
            structures: ["skin", ...breastParts, "pectoral-fascia", "pectoralis-major", "pectoralis-minor", "intercostal-muscles", ...thoracicCage, "internal-thoracic-vessels"],
            orientation: "lateral",
            anchor: "nipple",
            distance: 0.7,
            cut: { axis: "sagittal", at: "nipple" },
            relations: ["Sequência anteroposterior: pele → gordura subcutânea → glândula → espaço retromamário → fáscia peitoral → peitoral maior → peitoral menor/costelas", "A espessura do corpo adiposo define a cobertura em reconstrução pré-peitoral"],
          },
          {
            id: "transversal",
            title: "Corte transversal no nível do mamilo",
            description: "Plano axial mostrando mama, peitorais, parede costal, vasos torácicos internos e o grande dorsal no mesmo nível.",
            structures: ["skin", ...breastParts, "contralateral-breast", "pectoralis-major", "contralateral-pectoral", "serratus-anterior", "latissimus-dorsi", "intercostal-muscles", ...thoracicCage, "internal-thoracic-vessels", "axilla"],
            orientation: "anterior",
            anchor: "breastCenter",
            cut: { axis: "transverse", at: "nipple" },
            relations: ["Os vasos torácicos internos ficam ~1–2 cm lateral ao esterno, profundos às cartilagens", "Lateralmente, a mama alcança a borda anterior do grande dorsal"],
          },
        ],
      },
      {
        id: "ptose-mamaria",
        title: "Ptose mamária",
        summary: "Do perfil sem ptose aos graus I–III de Regnault, cada um com a hipertrofia que costuma acompanhá-lo: o que desce, o que cresce e o que continua preso à parede. A forma muda em qualquer vista pelo seletor Forma da mama.",
        views: [
          {
            id: "sem-ptose",
            title: "Sem ptose",
            description: "Perfil de referência: a mama como no exame de origem, com o mamilo acima do sulco inframamário.",
            structures: ptosisProfileStructures,
            solid: ["skin"],
            orientation: "profile",
            anchor: "breastProfile",
            follow: false,
            distance: 0.9,
            labels: ptosisLabels,
            relations: [
              `No modelo: ${breastFacts(null)}`,
              "Regnault classifica a ptose pela posição do mamilo em relação ao sulco inframamário e ao contorno inferior da mama",
              "O sulco é uma zona de aderência dermofascial: é o ponto fixo sobre o qual a mama pende",
            ],
          },
          ptosisProfile(0, ["Grau I: mamilo na altura do sulco (até 1 cm), acima do contorno inferior", "Hipertrofia leve: a mama já pesa mais e o polo inferior ultrapassa o sulco", "Pseudoptose é diferente: o mamilo fica acima do sulco e só o polo inferior desce"]),
          ptosisProfile(1, ["Grau II: mamilo 1–3 cm abaixo do sulco, ainda acima do contorno inferior", "Hipertrofia moderada: é o quadro mais comum de quem procura a mamoplastia redutora", "A distância fúrcula–mamilo e o segmento mamilo–sulco definem a pele a ressecar e a subida do complexo areolopapilar"]),
          ptosisProfile(2, ["Grau III: mamilo mais de 3 cm abaixo do sulco, no contorno mais baixo, apontando para baixo", "Hipertrofia acentuada: mama pendente, larga na base e pesada; o eixo da mama aponta para baixo", "Subidas longas do complexo areolopapilar exigem pedículo mais confiável ou enxerto livre de aréola"]),
          {
            id: "frente",
            title: "Frente",
            description: "As duas mamas com ptose grau II e hipertrofia moderada: polo superior esvaziado e bolsa pendente sobre o sulco, que passa a ficar oculto.",
            structures: ptosisSurface,
            solid: ["skin"],
            orientation: "anterior",
            anchor: "breastCenter",
            breast: "ptose-2",
            labels: [
              { structure: "nipple-areola", near: "nipple", text: "Mamilo" },
              { structure: "skin", near: "nipple", nearOffsetMm: [0, 60, -25], text: "Polo superior esvaziado" },
              { structure: "skin", near: "nipple", nearOffsetMm: [0, -32, -8], text: "Polo inferior pendente" },
            ],
            relations: [`No modelo: ${breastFacts("ptose-2")}`, "A base da mama (pegada sobre o tórax) continua no lugar: o volume, agora maior, acumula-se no polo inferior e alarga a mama"],
          },
          {
            id: "por-dentro",
            title: "Por dentro",
            description: "Pele translúcida: corpo adiposo, lobos, ductos e ligamentos de Cooper acompanham a descida sobre a fáscia peitoral, que permanece no lugar.",
            structures: ["skin", "breast", "breast-fat", "breast-ligaments", "nipple-areola", "pectoral-fascia", "pectoralis-major", "serratus-anterior", ...thoracicCage],
            focus: ["breast", "breast-ligaments"],
            orientation: "anterolateral",
            anchor: "nipple",
            distance: 0.7,
            breast: "ptose-2",
            labels: [
              { structure: "breast", near: "nipple", text: "Glândula deslizada" },
              { structure: "breast-ligaments", near: "breastCenter", text: "Ligamentos de Cooper alongados" },
              { structure: "pectoralis-major", near: "breastCenter", nearOffsetMm: [0, 60, 0], text: "Peitoral maior (não se move)" },
              { structure: "skin", near: "inframammaryFold", text: "Sulco inframamário" },
            ],
            relations: [
              "O plano de deslizamento é o espaço retromamário, entre a fáscia superficial profunda e a fáscia peitoral",
              "O tecido junto à parede quase não se desloca; o superficial desce mais (no modelo, camada de cisalhamento de 0,7 cm sobre a fáscia e 2 cm junto ao sulco)",
              "Modelo geométrico: o mesmo mapa é aplicado à pele e a todas as estruturas reais da mama; o deslizamento conserva o volume e a hipertrofia é um crescimento somado a ele",
            ],
          },
          {
            id: "corte-sagital",
            title: "Corte sagital",
            description: "Plano sagital pelo meridiano da mama com ptose grau II e hipertrofia moderada: polo superior fino, polo inferior espesso e pendente à frente da parede abdominal.",
            structures: ["skin", ...breastParts, "pectoral-fascia", "pectoralis-major", "pectoralis-minor", "intercostal-muscles", ...thoracicCage],
            orientation: "lateral",
            anchor: "nipple",
            distance: 0.75,
            breast: "ptose-2",
            cut: { axis: "sagittal", at: "nipple" },
            relations: ["O polo inferior pende à frente da pele abaixo do sulco, sem atravessá-la", "Compare com Anatomia da mama → Corte sagital pelo mamilo (mesmo plano, sem ptose)"],
          },
        ],
      },
      {
        id: "vascular-mama",
        title: "Irrigação e inervação da mama",
        summary: "Fontes arteriais (torácica interna, torácica lateral, toracoacromial, intercostais), os ramos que entram na mama, o septo de Würinger com seus ligamentos e a inervação do complexo areolopapilar.",
        views: [
          {
            id: "arterial",
            title: "Irrigação",
            description: "Mama translúcida sobre as fontes vasculares reais.",
            structures: ["breast", "nipple-areola", "internal-thoracic-vessels", "lateral-thoracic-vessels", "thoracoacromial-vessels", "intercostal-vessels", "axillary-vessels", "subclavian-vessels", ...thoracicCage],
            focus: ["internal-thoracic-vessels", "lateral-thoracic-vessels", "thoracoacromial-vessels"],
            orientation: "anterolateral",
            anchor: "breastCenter",
            distance: 0.85,
            labels: [
              { structure: "internal-thoracic-vessels", near: "breastCenter", text: "Torácica interna (~60%)" },
              { structure: "lateral-thoracic-vessels", near: "breastLateral", text: "Torácica lateral (~30%)" },
              { structure: "thoracoacromial-vessels", near: "axillaryArteryCenter", text: "Toracoacromial (ramo peitoral)" },
              { structure: "intercostal-vessels", near: "breastLateral", text: "Intercostais" },
            ],
            relations: ["Perfurantes mediais da torácica interna emergem do 2º ao 4º espaços intercostais", "A torácica lateral desce pela borda lateral do peitoral menor e irriga o quadrante lateral"],
          },
          {
            id: "inervacao",
            title: "Inervação",
            description: "Nervos intercostais, intercostobraquial e peitorais em relação à mama.",
            structures: ["breast", "nipple-areola", "intercostal-nerves", "intercostobrachial-nerve", "pectoral-nerves", "brachial-plexus", ...thoracicCage],
            focus: ["intercostal-nerves", "intercostobrachial-nerve", "pectoral-nerves"],
            orientation: "anterolateral",
            anchor: "breastCenter",
            distance: 0.85,
            labels: [
              { structure: "intercostal-nerves", near: "breastLateral", text: "Nervos intercostais" },
              { structure: "intercostobrachial-nerve", near: "axillaryArteryCenter", text: "Intercostobraquial" },
              { structure: "pectoral-nerves", near: "axillaryArteryCenter", text: "Nervos peitorais" },
            ],
            relations: ["O CAP recebe principalmente o ramo cutâneo lateral do 4º intercostal", "Os nervos peitorais são motores do peitoral maior e menor (não da mama)"],
          },
          {
            id: "ramos-mamarios",
            title: "Ramos que entram na mama",
            description: "Dos troncos reais ao complexo areolopapilar: perfurantes da torácica interna, ramos da torácica lateral, perfurantes intercostais e ramo da toracoacromial.",
            structures: ["skin", "nipple-areola", ...arterialSources, ...mammaryArteries, ...thoracicCage],
            focus: mammaryArteries,
            orientation: "anterolateral",
            anchor: "nipple",
            distance: 0.5,
            labels: [
              { structure: "internal-thoracic-perforators", near: "breastMedial", nearOffsetMm: [0, 40, 0], text: "Perfurantes da torácica interna (2º–4º EIC)" },
              { structure: "lateral-mammary-branches", near: "breastLateral", nearOffsetMm: [-20, -10, -30], text: "Ramos mamários laterais" },
              { structure: "intercostal-perforators", near: "inframammaryFold", nearOffsetMm: [10, 0, -30], text: "Perfurantes intercostais (4º–6º EIC)" },
              { structure: "thoracoacromial-mammary-branch", near: "breastLateral", nearOffsetMm: [-20, 60, -30], text: "Ramo da toracoacromial" },
            ],
            relations: [
              "Medial: perfurantes da torácica interna, superficiais, do esterno à borda medial e superior da aréola: base dos pedículos superomedial, medial e superior",
              "Lateral: ramos da torácica lateral contornam a borda do peitoral maior: base do pedículo lateral",
              "Profundo: perfurantes intercostais e ramo da toracoacromial atravessam o peitoral maior e seguem pelo septo: base dos pedículos inferior e central",
              schematicNote,
            ],
          },
          {
            id: "septo",
            title: "Septo de Würinger e ligamentos",
            description: "Septo horizontal da 5ª costela ao mamilo, ligamentos medial e lateral e ligamento do sulco inframamário: a suspensão fascial da glândula.",
            structures: ["skin", "nipple-areola", ...breastSuspension, "intercostal-perforators", "thoracoacromial-mammary-branch", "fourth-intercostal-lateral-branch", "pectoralis-major", "serratus-anterior", ...thoracicCage],
            focus: breastSuspension,
            orientation: "anterolateral",
            anchor: "nipple",
            distance: 0.5,
            labels: [
              { structure: "horizontal-septum", near: "nipple", nearOffsetMm: [10, 0, -30], text: "Septo horizontal" },
              { structure: "septum-ligaments", near: "breastMedial", nearOffsetMm: [0, 50, 0], text: "Ligamento medial" },
              { structure: "septum-ligaments", near: "breastLateral", nearOffsetMm: [0, 50, 0], text: "Ligamento lateral" },
              { structure: "inframammary-ligament", near: "inframammaryFold", text: "Ligamento do sulco" },
              { structure: "fourth-intercostal-lateral-branch", near: "breastLateral", text: "Ramo lateral do 4º intercostal" },
            ],
            relations: [
              "O septo nasce da fáscia peitoral ao longo da 5ª costela e vai até o mamilo; suas bordas sobem como ligamentos verticais: o conjunto funciona como uma tipoia",
              "Camada cranial do septo: toracoacromial e ramo da torácica lateral. Camada caudal: perfurantes intercostais do 4º ao 6º espaços",
              "O nervo principal do mamilo corre junto ao septo",
              schematicNote,
            ],
          },
          {
            id: "inervacao-cap",
            title: "Inervação do complexo areolopapilar",
            description: "Ramos cutâneos laterais (3º–5º) e anteriores (3º–5º) dos nervos intercostais convergindo para o mamilo e a aréola.",
            structures: ["skin", "nipple-areola", ...mammaryNerves, "horizontal-septum", "pectoralis-major", "serratus-anterior", ...thoracicCage],
            focus: mammaryNerves,
            orientation: "anterolateral",
            anchor: "nipple",
            distance: 0.55,
            labels: [
              { structure: "fourth-intercostal-lateral-branch", near: "breastLateral", nearOffsetMm: [-30, 20, -50], text: "Ramo cutâneo lateral do 4º intercostal" },
              { structure: "lateral-cutaneous-branches", near: "breastLateral", nearOffsetMm: [-30, -40, -50], text: "Ramo lateral do 5º (e do 3º, acima)" },
              { structure: "anterior-cutaneous-branches", near: "breastMedial", nearOffsetMm: [20, 0, 0], text: "Ramos cutâneos anteriores" },
            ],
            relations: [
              "Ramo profundo do 4º intercostal: na fáscia peitoral até o meio da mama, depois para a frente, chegando ao mamilo por trás (93% em Schlenz et al., 2000)",
              "Ramo superficial: pelo subcutâneo até a borda lateral da aréola (7%)",
              "Ramos anteriores: superficiais, do esterno à borda medial da aréola",
              schematicNote,
            ],
          },
          {
            id: "corte-septo",
            title: "Corte sagital: septo e vasos",
            description: "Plano sagital pelo mamilo: o septo horizontal entre a camada vascular cranial e a caudal, da parede ao mamilo.",
            structures: ["skin", "breast", "nipple-areola", "horizontal-septum", "inframammary-ligament", "intercostal-perforators", "thoracoacromial-mammary-branch", "fourth-intercostal-lateral-branch", "pectoral-fascia", "pectoralis-major", "intercostal-muscles", ...thoracicCage],
            focus: ["horizontal-septum", "intercostal-perforators", "thoracoacromial-mammary-branch"],
            orientation: "lateral",
            anchor: "nipple",
            distance: 0.6,
            cut: { axis: "sagittal", at: "nipple" },
            relations: [
              "Acima do septo: glândula cranial e ramo da toracoacromial. Abaixo: glândula caudal e perfurantes intercostais",
              "O pedículo inferior leva a parte caudal com as perfurantes; o superior, a parte cranial sem a base profunda",
              schematicNote,
            ],
          },
          {
            id: "septo-ptose",
            title: "Septo e vasos na ptose",
            description: "Mama com ptose grau II: o mamilo desce, o septo deixa de ser horizontal e os ramos que chegam ao complexo areolopapilar se alongam.",
            structures: ["skin", "nipple-areola", ...breastSuspension, ...mammaryArteries, "fourth-intercostal-lateral-branch", ...arterialSources, ...thoracicCage],
            focus: ["horizontal-septum", ...mammaryArteries],
            orientation: "anterolateral",
            anchor: "nipple",
            distance: 0.6,
            breast: "ptose-2",
            labels: [
              { structure: "horizontal-septum", near: "nipple", nearOffsetMm: [10, 0, -30], text: "Septo, agora oblíquo" },
              { structure: "internal-thoracic-perforators", near: "breastMedial", nearOffsetMm: [0, 40, 0], text: "Perfurantes mediais alongados" },
              { structure: "lateral-mammary-branches", near: "breastLateral", nearOffsetMm: [-20, -10, -30], text: "Ramos laterais" },
            ],
            relations: [
              "As origens na parede não se movem; o que se alonga é o trecho dentro da mama",
              "Quanto maior a distância até o mamilo, mais longo o pedículo e maior a subida do complexo areolopapilar na cirurgia",
              "Vasos e nervos são levados pelo mesmo mapa da mama e mantêm o calibre; o septo acompanha a glândula",
              schematicNote,
            ],
          },
        ],
      },
      {
        id: "linfatica",
        title: "Drenagem linfática",
        summary: "Linfonodos axilares, interpeitorais e paraesternais e sua referência ao peitoral menor.",
        views: [
          {
            id: "grupos",
            title: "Grupos linfonodais",
            description: "Linfonodos em relação à mama, à veia axilar e à cadeia torácica interna.",
            structures: ["breast", "nipple-areola", "axillary-lymph-nodes", "axillary-vessels", "internal-thoracic-vessels", "pectoralis-minor", ...thoracicCage],
            focus: ["axillary-lymph-nodes"],
            orientation: "anterolateral",
            anchor: "axillaryArteryCenter",
            distance: 0.8,
            labels: [
              { structure: "axillary-lymph-nodes", near: "breastLateral", text: "Grupo anterior (peitoral)" },
              { structure: "axillary-lymph-nodes", near: "axillaryArteryCenter", text: "Central / apical" },
              { structure: "axillary-lymph-nodes", near: "internal-thoracic-vessels", text: "Paraesternais" },
              { structure: "pectoralis-minor", near: "axillaryArteryCenter", text: "Peitoral menor" },
            ],
            relations: ["~75% da linfa mamária drena para a axila; quadrantes mediais também para a cadeia paraesternal", "O sentinela costuma estar no nível I, no grupo anterior"],
          },
          {
            id: "berg",
            title: "Níveis de Berg",
            description: "Peitoral menor como referência para os níveis I, II e III.",
            structures: ["pectoralis-minor", "axillary-lymph-nodes", "axillary-vessels", "serratus-anterior", ...thoracicCage],
            orientation: "anterolateral",
            space: "berg-levels",
            relations: ["Nível I: lateral à borda lateral do peitoral menor", "Nível II: posterior ao peitoral menor", "Nível III: medial à borda medial, até o ápice"],
          },
        ],
      },
      {
        id: "planos-reconstrucao",
        title: "Planos de reconstrução",
        summary: "Plano pré-peitoral e loja subpeitoral: limites e estruturas em risco.",
        views: [
          {
            id: "pre-peitoral",
            title: "Plano pré-peitoral",
            description: "Mama afastada medialmente expondo a fáscia peitoral; paredes coloridas.",
            structures: [...breastParts, "pectoral-fascia", "pectoralis-major", "serratus-anterior", "latissimus-dorsi", ...thoracicCage, "internal-thoracic-vessels"],
            orientation: "anterolateral",
            space: "prepectoral",
            manipulations: { breast: 0.7 },
            relations: ["Limites: sulco inframamário, clavícula, borda esternal e linha axilar anterior", "Perfurantes da torácica interna na borda medial da loja"],
          },
          {
            id: "subpeitoral",
            title: "Loja subpeitoral",
            description: "Peitoral maior rebatido expondo o peitoral menor e a parede costal.",
            structures: ["pectoralis-major", "pectoralis-minor", "serratus-anterior", "intercostal-muscles", ...thoracicCage, "thoracoacromial-vessels", "pectoral-nerves", "internal-thoracic-vessels"],
            orientation: "anterolateral",
            space: "subpectoral",
            manipulations: { "pec-major": 0.6 },
            relations: ["Ramo peitoral da toracoacromial e nervos peitorais na face profunda do peitoral maior", "Liberação das origens inferiores do peitoral maior define o dual-plane"],
          },
        ],
      },
    ],
  },
  {
    id: "axila",
    title: "Axila",
    description: "Dissecção axilar e seus marcos: fáscias, paredes, conteúdo neurovascular e zona de dissecção.",
    packs: [
      {
        id: "disseccao-axilar",
        title: "Dissecção axilar",
        summary: "Da fáscia aos limites: como a axila se apresenta em cada plano.",
        views: [
          {
            id: "fascia-musculo",
            title: "Fáscia e músculos",
            description: "Fáscias peitoral e clavipeitoral sobre a musculatura que forma as paredes da axila.",
            structures: ["pectoral-fascia", "deltoid-fascia", "pectoralis-major", "pectoralis-minor", "latissimus-dorsi", "serratus-anterior", "teres-major", "subscapularis", "coracobrachialis-biceps", ...thoracicCage, "axilla"],
            focus: ["pectoral-fascia"],
            orientation: "axillary",
            anchor: "axillaryArteryCenter",
            distance: 0.7,
            labels: [
              { structure: "pectoral-fascia", near: "axillaryArteryCenter", text: "Fáscia clavipeitoral" },
              { structure: "pectoralis-major", near: "axillaryArteryCenter", text: "Peitoral maior (prega anterior)" },
              { structure: "latissimus-dorsi", near: "latissimusAnteriorBorder.0", text: "Grande dorsal (prega posterior)" },
            ],
            relations: ["A fáscia clavipeitoral continua como ligamento suspensor da axila até a fáscia axilar", "As pregas axilares anterior e posterior são formadas pelo peitoral maior e pelo grande dorsal"],
          },
          {
            id: "limites",
            title: "Limites sem fáscia",
            description: "Sem fáscias: paredes da pirâmide axilar destacadas por cor e o conteúdo neurovascular.",
            structures: ["pectoralis-major", "pectoralis-minor", "subclavius", "subscapularis", "teres-major", "latissimus-dorsi", "serratus-anterior", "coracobrachialis-biceps", "axilla", ...axillaryVessels, ...axillaryNerves, "brachial-plexus", "axillary-lymph-nodes"],
            orientation: "axillary",
            space: "axilla",
            relations: ["Anterior: peitorais e subclávio · Posterior: subescapular, redondo maior e GD · Medial: serrátil · Lateral: sulco intertubercular"],
          },
          {
            id: "abducao",
            title: "Braço a 90° (braçadeira)",
            description: "Posição operatória da linfadenectomia: abdução de 90° com leve rotação externa. Peitoral maior, grande dorsal e redondo maior alongam-se e a base da axila se abre.",
            structures: ["pectoralis-major", "pectoralis-minor", "latissimus-dorsi", "teres-major", "subscapularis", "serratus-anterior", "coracobrachialis-biceps", "deltoid", "axilla", ...axillaryVessels, ...axillaryNerves, "brachial-plexus", "axillary-lymph-nodes", ...thoracicCage],
            focus: ["pectoralis-major", "latissimus-dorsi", "axillary-vessels"],
            orientation: "axillary",
            anchor: "axillaryArteryCenter",
            distance: 0.85,
            pose: "abducao-90",
            labels: [
              { structure: "pectoralis-major", near: "axillaryArteryCenter", nearOffsetMm: [0, -40, 30], text: "Prega anterior (peitoral maior)" },
              { structure: "latissimus-dorsi", near: "latissimusAnteriorBorder.0", text: "Prega posterior (GD)" },
              { structure: "axillary-vessels", near: "axillaryArteryCenter", text: "Veia/artéria axilares" },
              { structure: "intercostobrachial-nerve", near: "axillaryArteryCenter", text: "Intercostobraquial" },
            ],
            relations: [
              "Na abdução, as pregas axilares (peitoral maior e GD) se afastam e a base da axila se abre",
              "O feixe axilar acompanha o úmero: no modelo, a veia axilar sobe cerca de 4 cm",
              "Abdução acima de 90° na braçadeira tensiona o plexo braquial contra a cabeça do úmero (risco de neuropraxia)",
            ],
          },
          {
            id: "zona",
            title: "Zona de dissecção",
            description: "Polígono projetado cujos vértices são pontos reais das estruturas-limite da linfadenectomia (níveis I–II).",
            structures: ["axillary-vessels", "thoracodorsal-vessels", "thoracodorsal-nerve", "long-thoracic-nerve", "intercostobrachial-nerve", "serratus-anterior", "latissimus-dorsi", "pectoralis-minor", "subscapularis", "axillary-lymph-nodes", ...thoracicCage],
            focus: ["thoracodorsal-nerve", "long-thoracic-nerve", "axillary-vessels"],
            orientation: "axillary",
            anchor: "thoracodorsalArteryOrigin",
            distance: 0.85,
            zones: [
              {
                label: "Zona de dissecção axilar (níveis I–II)",
                color: "#22d3ee",
                corners: [
                  { structure: "axillary-vessels", near: "latissimusAnteriorBorder.0", nearOffsetMm: [-45, 0, 0] },
                  { structure: "axillary-vessels", near: "pectoralis-minor" },
                  { structure: "serratus-anterior", near: "pectoralis-minor", nearOffsetMm: [0, -100, 0] },
                  { structure: "latissimus-dorsi", near: "latissimusAnteriorBorder.0", nearOffsetMm: [0, -100, 0] },
                ],
                edgeLabels: ["Superior: veia axilar", "Medial: peitoral menor / parede torácica", "Inferior: n. intercostobraquial / 4º espaço", "Lateral: borda anterior do GD"],
              },
            ],
            relations: ["Limite superior: face inferior da veia axilar", "Medial: parede torácica com o nervo torácico longo aderido ao serrátil", "Lateral: borda anterior do grande dorsal", "Posterior: subescapular com o pedículo toracodorsal", "Zona aproximada: vértices em pontos reais das estruturas, não um volume segmentado"],
          },
          {
            id: "berg",
            title: "Níveis de Berg",
            description: "Peitoral maior removido; peitoral menor como referência dos níveis.",
            structures: ["pectoralis-minor", "axillary-lymph-nodes", "axillary-vessels", "serratus-anterior", "long-thoracic-nerve", "thoracodorsal-nerve", ...thoracicCage],
            orientation: "anterolateral",
            space: "berg-levels",
            relations: ["O nível III exige afastar ou seccionar o peitoral menor", "Veia axilar é o limite superior dos níveis I e II"],
          },
        ],
      },
      {
        id: "marcos-axila",
        title: "Marcos anatômicos da axila",
        summary: "Nervos a preservar, eixo vascular e espaço interpeitoral.",
        views: [
          {
            id: "nervos",
            title: "Nervos a preservar",
            description: "Torácico longo, toracodorsal, intercostobraquial e peitorais no contexto do plexo braquial.",
            structures: [...axillaryNerves, "brachial-plexus", "axillary-vessels", "serratus-anterior", "subscapularis", ...thoracicCage],
            focus: axillaryNerves,
            orientation: "axillary",
            anchor: "thoracodorsalArteryOrigin",
            distance: 0.6,
            labels: [
              { structure: "long-thoracic-nerve", near: "thoracodorsalArteryDistal", text: "Torácico longo (serrátil)" },
              { structure: "thoracodorsal-nerve", near: "thoracodorsalArteryOrigin", text: "Toracodorsal (GD)" },
              { structure: "intercostobrachial-nerve", near: "axillaryArteryCenter", text: "Intercostobraquial (T2)" },
              { structure: "pectoral-nerves", near: "axillaryArteryCenter", text: "Peitorais medial e lateral" },
            ],
            relations: ["O torácico longo corre na face superficial do serrátil, na linha axilar média", "O toracodorsal acompanha os vasos toracodorsais sobre o subescapular", "O intercostobraquial cruza a axila transversalmente abaixo da veia axilar"],
          },
          {
            id: "axila-aberta",
            title: "Mão atrás da cabeça",
            description: "Abdução de 130° com rotação externa: a axila fica mais rasa e o feixe neurovascular é estirado em torno do coracoide e do peitoral menor.",
            structures: [...axillaryNerves, "brachial-plexus", ...axillaryVessels, "pectoralis-minor", "pectoralis-major", "latissimus-dorsi", "serratus-anterior", "subscapularis", "teres-major", "axilla", ...thoracicCage],
            focus: ["brachial-plexus", "axillary-vessels", "pectoralis-minor"],
            orientation: "axillary",
            anchor: "axillaryArteryCenter",
            distance: 0.9,
            pose: "abducao-130",
            labels: [
              { structure: "pectoralis-minor", near: "axillaryArteryCenter", text: "Peitoral menor (fulcro)" },
              { structure: "brachial-plexus", near: "axillaryArteryCenter", nearOffsetMm: [-20, 10, 0], text: "Plexo braquial estirado" },
              { structure: "long-thoracic-nerve", near: "thoracodorsalArteryDistal", text: "Torácico longo" },
              { structure: "thoracodorsal-nerve", near: "thoracodorsalArteryOrigin", text: "Toracodorsal" },
            ],
            relations: [
              "Em hiperabdução o feixe axilar angula sob o peitoral menor e o coracoide (mecanismo da síndrome de hiperabdução)",
              "A escápula roda para cima: o ângulo inferior e o pedículo toracodorsal deslocam-se lateral e anteriormente",
              "Os nervos torácico longo e toracodorsal permanecem nos seus planos (serrátil e face profunda do GD)",
            ],
          },
          {
            id: "vascular",
            title: "Eixo vascular axilar",
            description: "Artéria e veia axilares e seus ramos em relação ao peitoral menor.",
            structures: [...axillaryVessels, "circumflex-humeral-vessels", "subclavian-vessels", "pectoralis-minor", "axilla", ...thoracicCage],
            focus: ["axillary-vessels"],
            orientation: "anterolateral",
            anchor: "axillaryArteryCenter",
            distance: 0.6,
            labels: [
              { structure: "axillary-vessels", near: "axillaryArteryCenter", text: "Artéria/veia axilares" },
              { structure: "thoracoacromial-vessels", near: "axillaryArteryCenter", text: "Toracoacromial (2ª parte)" },
              { structure: "lateral-thoracic-vessels", near: "breastLateral", text: "Torácica lateral (2ª parte)" },
              { structure: "subscapular-vessels", near: "thoracodorsalArteryOrigin", text: "Subescapular (3ª parte)" },
            ],
            relations: ["O peitoral menor divide a artéria axilar em três partes", "A veia axilar fica anteromedial à artéria"],
          },
          {
            id: "rotter",
            title: "Espaço de Rotter",
            description: "Peitoral maior rebatido: espaço entre os peitorais com linfonodos e nervos.",
            structures: ["pectoralis-major", "pectoralis-minor", "pectoral-nerves", "thoracoacromial-vessels", "axillary-lymph-nodes", ...thoracicCage],
            orientation: "anterolateral",
            space: "rotter",
            manipulations: { "pec-major": 0.55 },
            relations: ["Nervo peitoral lateral e ramos peitorais da toracoacromial atravessam o espaço", "Linfonodos interpeitorais: considerados nível II"],
          },
          {
            id: "corte",
            title: "Corte transversal da axila",
            description: "Plano axial no nível da artéria axilar: paredes e conteúdo no mesmo corte.",
            structures: ["pectoralis-major", "pectoralis-minor", "subscapularis", "teres-major", "latissimus-dorsi", "serratus-anterior", "coracobrachialis-biceps", "axilla", ...thoracicCage, ...axillaryVessels, "brachial-plexus", ...axillaryNerves, "axillary-lymph-nodes", "skin"],
            orientation: "anterior",
            anchor: "axillaryArteryCenter",
            cut: { axis: "transverse", at: "axillaryArteryCenter", offsetMm: -15 },
            relations: ["No corte, o feixe axilar fica entre as paredes anterior (peitorais) e posterior (subescapular)"],
          },
        ],
      },
    ],
  },
  {
    id: "retalhos",
    title: "Retalhos",
    description: "Anatomia aplicada aos retalhos do grande dorsal e toracolateral.",
    packs: [
      {
        id: "grande-dorsal",
        title: "Grande dorsal",
        summary: "Músculo, origens e inserção, pedículo toracodorsal, planos e triângulos de referência.",
        views: [
          {
            id: "musculo",
            title: "Músculo e origens",
            description: "Grande dorsal com trapézio, fáscia toracolombar, crista ilíaca e escápula.",
            structures: ["latissimus-dorsi", "trapezius", "thoracolumbar-fascia", "iliac-crest", "teres-major", "axilla", ...thoracicCage, "skin"],
            focus: ["latissimus-dorsi"],
            orientation: "posterior",
            anchor: "latissimusCenter",
            labels: [
              { structure: "latissimus-dorsi", near: "latissimusInferior", text: "Origem: fáscia toracolombar / crista ilíaca" },
              { structure: "latissimus-dorsi", near: "latissimusAnteriorBorder.0", text: "Borda anterior livre" },
              { structure: "latissimus-dorsi", near: "scapulaInferiorAngle", text: "Sobre o ângulo inferior da escápula" },
              { structure: "trapezius", near: "trapeziusInferiorBorder", text: "Trapézio (borda inferior)" },
            ],
            relations: ["O trapézio recobre a porção superomedial do GD", "O tendão contorna o redondo maior até o sulco intertubercular"],
          },
          {
            id: "pediculo",
            title: "Pedículo toracodorsal",
            description: "Eixo subescapular–toracodorsal e ramo do serrátil até o hilo do músculo.",
            structures: ["latissimus-dorsi", "thoracodorsal-vessels", "thoracodorsal-nerve", "subscapular-vessels", "axillary-vessels", "serratus-anterior", "teres-major", "subscapularis", "long-thoracic-nerve", ...thoracicCage],
            focus: ["thoracodorsal-vessels", "thoracodorsal-nerve", "subscapular-vessels"],
            orientation: "axillary",
            anchor: "thoracodorsalArteryOrigin",
            distance: 0.6,
            labels: [
              { structure: "subscapular-vessels", near: "thoracodorsalArteryOrigin", text: "Subescapular" },
              { structure: "subscapular-vessels", near: "scapulaInferiorAngle", text: "Circunflexa da escápula" },
              { structure: "thoracodorsal-vessels", near: "thoracodorsalArteryDistal", text: "Toracodorsais (hilo)" },
              { structure: "thoracodorsal-nerve", near: "thoracodorsalNerveDistal", text: "N. toracodorsal" },
            ],
            relations: ["Hilo na face profunda, ~8–10 cm abaixo da axila e 2–3 cm medial à borda anterior", "O ramo do serrátil permite fluxo retrógrado se o tronco for ligado"],
          },
          {
            id: "decubito-lateral",
            title: "Decúbito lateral (braço fletido 90°)",
            description: "Posição de coleta do retalho: ombro fletido a 90° sobre o apoio. A escápula roda e se protrai; o grande dorsal e o redondo maior alongam-se.",
            structures: ["latissimus-dorsi", "teres-major", "trapezius", "rhomboids", "serratus-anterior", "infraspinatus", "teres-minor", "deltoid", "triceps", "axilla", "thoracodorsal-vessels", "thoracodorsal-nerve", "subscapular-vessels", ...thoracicCage],
            focus: ["latissimus-dorsi", "teres-major"],
            orientation: "posterolateral",
            anchor: "latissimusCenter",
            pose: "flexao-90",
            labels: [
              { structure: "latissimus-dorsi", near: "latissimusAnteriorBorder.0", text: "Borda anterior do GD" },
              { structure: "latissimus-dorsi", near: "scapulaInferiorAngle", text: "Sobre a ponta da escápula" },
              { structure: "teres-major", near: "scapulaInferiorAngle", text: "Redondo maior" },
              { structure: "trapezius", near: "trapeziusInferiorBorder", text: "Trapézio" },
            ],
            relations: [
              "Com o ombro fletido, o ângulo inferior da escápula desliza lateral e anteriormente sobre o tórax",
              "GD e redondo maior (adutores/extensores) alongam-se: a borda anterior do GD fica mais evidente",
              "O tendão do GD gira com o úmero em torno do redondo maior até o sulco intertubercular",
            ],
          },
          {
            id: "plano",
            title: "Plano GD–serrátil",
            description: "Plano de descolamento da face profunda do GD, com o pedículo.",
            structures: ["latissimus-dorsi", "serratus-anterior", "teres-major", "intercostal-muscles", ...thoracicCage, "thoracodorsal-vessels", "thoracodorsal-nerve", "long-thoracic-nerve"],
            orientation: "posterolateral",
            space: "ld-serratus-plane",
            relations: ["Descolar de lateral para medial a partir da borda anterior", "O serrátil (e o torácico longo) ficam no plano profundo"],
          },
          {
            id: "triangulos",
            title: "Triângulos de ausculta e de Petit",
            description: "Marcos de superfície do dorso relacionados às bordas do GD.",
            structures: ["latissimus-dorsi", "trapezius", "rhomboids", "external-oblique", "iliac-crest", "axilla", ...thoracicCage],
            orientation: "posterolateral",
            space: "auscultation-triangle",
            labels: [{ structure: "external-oblique", near: "iliacCrestTop", text: "Triângulo lombar (Petit)" }],
            relations: ["Ausculta: trapézio, borda superior do GD e borda medial da escápula", "Petit: borda anterior do GD, oblíquo externo e crista ilíaca"],
          },
          {
            id: "arco",
            title: "Arco de rotação",
            description: "Posição didática do músculo transposto para a parede anterior, com o pedículo real na axila.",
            structures: ["latissimus-dorsi", "thoracodorsal-vessels", "thoracodorsal-nerve", "axillary-vessels", "pectoralis-major", ...thoracicCage, "breast", "breast-fat", "nipple-areola"],
            focus: ["latissimus-dorsi", "thoracodorsal-vessels"],
            orientation: "anterolateral",
            anchor: "breastCenter",
            manipulations: { "ld-flap": 1 },
            relations: ["O pedículo é o pivô: a liberação até a subescapular aumenta o arco", "Transformação rígida didática: não representa a dobra real do músculo"],
          },
        ],
      },
      {
        id: "toracolateral",
        title: "Retalho toracolateral",
        summary: "Parede torácica lateral: pedículos (torácica lateral, perfurantes intercostais e toracodorsais) e zona doadora.",
        views: [
          {
            id: "pediculos",
            title: "Pedículos",
            description: "Fontes vasculares da parede torácica lateral entre a mama e a borda anterior do GD.",
            structures: ["lateral-thoracic-vessels", "thoracodorsal-vessels", "intercostal-vessels", "axillary-vessels", "serratus-anterior", "latissimus-dorsi", "pectoralis-major", "breast", "breast-fat", ...thoracicCage],
            focus: ["lateral-thoracic-vessels", "intercostal-vessels", "thoracodorsal-vessels"],
            orientation: "lateral",
            anchor: "breastLateral",
            distance: 0.75,
            labels: [
              { structure: "lateral-thoracic-vessels", near: "breastLateral", text: "Torácica lateral" },
              { structure: "intercostal-vessels", near: "breastLateral", text: "Perfurantes intercostais laterais (LICAP)" },
              { structure: "thoracodorsal-vessels", near: "thoracodorsalArteryDistal", text: "Toracodorsais (TDAP)" },
              { structure: "latissimus-dorsi", near: "latissimusAnteriorBorder.0", text: "Borda anterior do GD" },
            ],
            relations: ["Perfurantes intercostais laterais emergem ao longo da borda anterior do GD (4º–8º espaços)", "A torácica lateral corre sobre o serrátil, na borda lateral do peitoral menor"],
          },
          {
            id: "zona",
            title: "Zona doadora",
            description: "Polígono sobre a pele lateral delimitado por pontos reais: sulco inframamário, mama lateral, axila e borda do GD.",
            structures: ["skin", "breast", "breast-fat", "latissimus-dorsi", "serratus-anterior", "lateral-thoracic-vessels", "intercostal-vessels", ...thoracicCage],
            orientation: "lateral",
            anchor: "breastLateral",
            distance: 0.8,
            zones: [
              {
                label: "Zona doadora toracolateral (aproximada)",
                color: "#f472b6",
                corners: [
                  { structure: "skin", near: "axillaryArteryCenter", offsetMm: [0, -40, 0] },
                  { structure: "skin", near: "latissimusAnteriorBorder.0", offsetMm: [0, -50, 0] },
                  { structure: "skin", near: "inframammaryFold", offsetMm: [-60, -20, -40] },
                  { structure: "skin", near: "inframammaryFold" },
                ],
                edgeLabels: ["Superior: prega axilar", "Posterior: borda anterior do GD", "Inferior: prolongamento do sulco", "Anterior: sulco inframamário / mama"],
              },
            ],
            relations: ["O retalho gira para o quadrante lateral/inferior da mama", "Zona aproximada: depende da frouxidão cutânea (pinch test)"],
          },
          {
            id: "corte",
            title: "Corte transversal lateral",
            description: "Camadas da parede lateral no nível do sulco: pele, gordura, serrátil, GD e costelas.",
            structures: ["skin", ...breastParts, "serratus-anterior", "latissimus-dorsi", "external-oblique", "intercostal-muscles", ...thoracicCage, "intercostal-vessels", "lateral-thoracic-vessels"],
            orientation: "lateral",
            anchor: "inframammaryFold",
            cut: { axis: "transverse", at: "inframammaryFold", offsetMm: 20 },
            relations: ["Da superfície: pele → subcutâneo → fáscia → serrátil/GD → costelas e intercostais"],
          },
        ],
      },
    ],
  },
  {
    id: "parede-ombro",
    title: "Parede torácica e ombro",
    description: "Estruturas de referência da parede torácica e dos espaços posteriores do ombro.",
    packs: [
      {
        id: "parede-toracica",
        title: "Parede torácica",
        summary: "Arcabouço costal, músculos intercostais e feixes intercostais.",
        views: [
          {
            id: "arcabouco",
            title: "Arcabouço e músculos",
            description: "Costelas, cartilagens, esterno e músculos da parede.",
            structures: [...thoracicCage, "intercostal-muscles", "serratus-anterior", "pectoralis-minor", "external-oblique", "axilla"],
            orientation: "anterolateral",
            anchor: "breastCenter",
            relations: ["O serrátil interdigita com o oblíquo externo nas costelas inferiores"],
          },
          {
            id: "feixes",
            title: "Feixes intercostais (corte)",
            description: "Corte transversal mostrando vasos e nervos intercostais e torácicos internos.",
            structures: [...thoracicCage, "intercostal-muscles", "intercostal-vessels", "intercostal-nerves", "internal-thoracic-vessels", "serratus-anterior", "pectoralis-major"],
            orientation: "anterior",
            anchor: "breastCenter",
            cut: { axis: "transverse", at: "nipple", offsetMm: 10 },
            relations: ["O feixe intercostal corre no sulco costal (veia, artéria, nervo de cima para baixo)"],
          },
        ],
      },
      {
        id: "espacos-ombro",
        title: "Espaços posteriores do ombro",
        summary: "Espaços quadrangular e triangular e suas estruturas.",
        views: [
          {
            id: "quadrangular",
            title: "Quadrangular e triangular",
            description: "Redondos, cabeça longa do tríceps e úmero com os vasos circunflexos.",
            structures: ["teres-major", "teres-minor", "triceps", "axilla", "circumflex-humeral-vessels", "subscapular-vessels", "arm-nerves", "infraspinatus"],
            orientation: "posterior",
            space: "quadrangular-space",
            relations: ["Quadrangular: nervo axilar e circunflexa posterior do úmero", "Triangular: circunflexa da escápula"],
          },
        ],
      },
    ],
  },
];

export const allPacks = packGroups.flatMap((group) => group.packs.map((pack) => ({ group, pack })));
