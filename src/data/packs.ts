/**
 * Packs de visualização: conjuntos sistematizados de vistas do modelo, organizados por grupo.
 * Cada vista define exatamente quais estruturas aparecem, o enquadramento, rótulos ancorados em
 * estruturas reais e, quando útil, um corte, um espaço cirúrgico, uma manipulação rígida ou uma
 * zona projetada (polígono cujos vértices são pontos reais das estruturas de referência).
 */
import type { SectionAxis } from "@/lib/sectioning";
import type { SkinWindow } from "@/lib/viewerTypes";

export type ViewOrientation = "anterior" | "anterolateral" | "lateral" | "axillary" | "posterior" | "posterolateral";

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
};

export type Pack = { id: string; title: string; summary: string; views: PackView[] };
export type PackGroup = { id: string; title: string; description: string; packs: Pack[] };

const breastParts = ["breast", "breast-fat", "breast-ligaments", "nipple-areola"];
const thoracicCage = ["chest-wall", "costal-cartilages"];
const axillaryNerves = ["thoracodorsal-nerve", "long-thoracic-nerve", "intercostobrachial-nerve", "pectoral-nerves"];
const axillaryVessels = ["axillary-vessels", "lateral-thoracic-vessels", "subscapular-vessels", "thoracodorsal-vessels", "thoracoacromial-vessels"];

export const packGroups: PackGroup[] = [
  {
    id: "mama",
    title: "Mama",
    description: "Anatomia da glândula, irrigação, inervação, drenagem e planos de reconstrução.",
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
        id: "vascular-mama",
        title: "Irrigação e inervação da mama",
        summary: "Fontes arteriais (torácica interna, torácica lateral, toracoacromial, intercostais) e inervação sensitiva.",
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
