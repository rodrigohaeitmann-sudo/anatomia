/**
 * Espaços e planos de interesse cirúrgico. Cada parede é formada por estruturas reais do modelo;
 * o visualizador destaca cada parede com uma cor e rotula o ponto da estrutura mais próximo do espaço.
 */
export type SpaceWall = { label: string; structures: string[] };

export type SurgicalSpace = {
  id: string;
  label: string;
  description: string;
  /** landmark key (see ModelLandmarks) or structure id used as the space centre */
  centre: string;
  walls: SpaceWall[];
  contents: string[];
  view: "anterior" | "posterior" | "posterolateral" | "axillary-closeup";
  /** structures hidden to open the space (e.g. the skin and the superficial muscle) */
  hide?: string[];
  pearls: string[];
};

export const surgicalSpaces: SurgicalSpace[] = [
  {
    id: "axilla",
    label: "Axila (pirâmide axilar)",
    description: "Espaço piramidal entre o braço e a parede torácica, com ápice no canal cervicoaxilar e base na pele axilar.",
    centre: "axillaryArteryCenter",
    walls: [
      { label: "Parede anterior", structures: ["pectoralis-major", "pectoralis-minor", "subclavius", "pectoral-fascia"] },
      { label: "Parede posterior", structures: ["subscapularis", "teres-major", "latissimus-dorsi"] },
      { label: "Parede medial", structures: ["serratus-anterior"] },
      { label: "Parede lateral", structures: ["coracobrachialis-biceps", "axilla"] },
    ],
    contents: ["axillary-vessels", "brachial-plexus", "axillary-lymph-nodes", "thoracodorsal-vessels", "thoracodorsal-nerve", "long-thoracic-nerve", "intercostobrachial-nerve", "lateral-thoracic-vessels", "subscapular-vessels"],
    view: "axillary-closeup",
    hide: ["skin", "breast", "breast-fat", "nipple-areola", "breast-ligaments", "deltoid", "deltoid-fascia"],
    pearls: ["Ápice: margem externa da 1ª costela, borda superior da escápula e borda posterior da clavícula", "Base: fáscia e pele axilares", "O pedículo toracodorsal desce na parede posterior; o nervo torácico longo, na medial"],
  },
  {
    id: "berg-levels",
    label: "Níveis axilares de Berg",
    description: "Divisão da axila pelo peitoral menor: nível I lateral, II posterior e III medial ao músculo.",
    centre: "pectoralis-minor",
    walls: [
      { label: "Peitoral menor (referência dos níveis)", structures: ["pectoralis-minor"] },
      { label: "Veia axilar (limite superior da linfadenectomia)", structures: ["axillary-vessels"] },
      { label: "Parede torácica", structures: ["serratus-anterior"] },
    ],
    contents: ["axillary-lymph-nodes", "thoracodorsal-nerve", "long-thoracic-nerve", "intercostobrachial-nerve"],
    view: "anterior",
    hide: ["skin", "breast", "breast-fat", "nipple-areola", "breast-ligaments", "pectoralis-major", "pectoral-fascia"],
    pearls: ["Nível I: lateral à borda lateral do peitoral menor (sentinela, grupos anterior, posterior e lateral)", "Nível II: posterior ao peitoral menor (grupo central, Rotter)", "Nível III: medial à borda medial (apical, infraclavicular)"],
  },
  {
    id: "rotter",
    label: "Espaço interpeitoral (Rotter)",
    description: "Espaço entre o peitoral maior e o peitoral menor, com linfonodos interpeitorais, nervo peitoral lateral e ramos peitorais da toracoacromial.",
    centre: "pectoralis-minor",
    walls: [
      { label: "Parede anterior", structures: ["pectoralis-major"] },
      { label: "Parede posterior", structures: ["pectoralis-minor", "pectoral-fascia"] },
    ],
    contents: ["axillary-lymph-nodes", "pectoral-nerves", "thoracoacromial-vessels"],
    view: "anterior",
    hide: ["skin", "breast", "breast-fat", "nipple-areola", "breast-ligaments"],
    pearls: ["Preservar os nervos peitorais ao dissecar os linfonodos de Rotter", "Acessível afastando o peitoral maior (use Rebater)"],
  },
  {
    id: "prepectoral",
    label: "Plano pré-peitoral / retromamário",
    description: "Plano entre a face posterior da mama e a fáscia peitoral: loja para implante pré-peitoral.",
    centre: "breastCenter",
    walls: [
      { label: "Anterior: corpo adiposo e glândula", structures: ["breast-fat", "breast"] },
      { label: "Posterior: fáscia e peitoral maior", structures: ["pectoral-fascia", "pectoralis-major"] },
      { label: "Lateral: borda anterior do GD / serrátil", structures: ["serratus-anterior", "latissimus-dorsi"] },
      { label: "Medial: esterno", structures: ["chest-wall"] },
    ],
    contents: ["internal-thoracic-vessels", "lateral-thoracic-vessels"],
    view: "anterior",
    hide: ["skin"],
    pearls: ["Limites da loja: sulco inframamário (inferior), clavícula (superior), borda esternal (medial) e linha axilar anterior (lateral)", "Perfurantes da torácica interna nos 2º–4º espaços na borda medial"],
  },
  {
    id: "subpectoral",
    label: "Loja subpeitoral",
    description: "Espaço entre o peitoral maior e a parede costal/peitoral menor: plano dual-plane/subpeitoral.",
    centre: "pectoralis-major",
    walls: [
      { label: "Anterior", structures: ["pectoralis-major"] },
      { label: "Posterior", structures: ["pectoralis-minor", "chest-wall", "intercostal-muscles", "serratus-anterior"] },
    ],
    contents: ["thoracoacromial-vessels", "pectoral-nerves", "internal-thoracic-vessels"],
    view: "anterior",
    hide: ["skin", "breast", "breast-fat", "nipple-areola", "breast-ligaments", "pectoral-fascia"],
    pearls: ["Liberação das origens inferiores do peitoral maior define o dual-plane", "Perfurantes da torácica interna na borda medial: hemostasia cuidadosa"],
  },
  {
    id: "ld-serratus-plane",
    label: "Plano entre grande dorsal e serrátil",
    description: "Plano de descolamento da face profunda do GD sobre o serrátil anterior e a parede costal, onde corre o pedículo.",
    centre: "latissimusCenter",
    walls: [
      { label: "Superficial: grande dorsal", structures: ["latissimus-dorsi"] },
      { label: "Profundo: serrátil e costelas", structures: ["serratus-anterior", "chest-wall", "intercostal-muscles"] },
      { label: "Superior: redondo maior", structures: ["teres-major"] },
    ],
    contents: ["thoracodorsal-vessels", "thoracodorsal-nerve", "long-thoracic-nerve", "intercostal-vessels"],
    view: "posterolateral",
    hide: ["skin", "breast", "breast-fat", "nipple-areola", "contralateral-breast", "trapezius"],
    pearls: ["Descolar de lateral para medial: o plano é mais fácil a partir da borda anterior", "Não incluir o serrátil (plano profundo) nem o serrátil posterior inferior"],
  },
  {
    id: "auscultation-triangle",
    label: "Triângulo de ausculta",
    description: "Área de parede fina entre a borda superior do GD, a borda inferolateral do trapézio e a borda medial da escápula.",
    centre: "scapulaInferiorAngle",
    walls: [
      { label: "Medial: trapézio", structures: ["trapezius"] },
      { label: "Inferior: grande dorsal", structures: ["latissimus-dorsi"] },
      { label: "Lateral: escápula / romboide maior", structures: ["axilla", "rhomboids"] },
    ],
    contents: ["intercostal-muscles"],
    view: "posterior",
    hide: ["skin"],
    pearls: ["Assoalho: romboide maior, 6ª–7ª costelas e 6º espaço intercostal", "Referência para diferenciar o GD do trapézio na elevação do retalho superior"],
  },
  {
    id: "lumbar-triangle",
    label: "Triângulo lombar inferior (Petit)",
    description: "Entre a borda anterior do GD, a borda posterior do oblíquo externo e a crista ilíaca.",
    centre: "iliacCrestTop",
    walls: [
      { label: "Posterior: grande dorsal", structures: ["latissimus-dorsi"] },
      { label: "Anterior: oblíquo externo", structures: ["external-oblique"] },
      { label: "Inferior: crista ilíaca", structures: ["iliac-crest"] },
    ],
    contents: ["thoracolumbar-fascia"],
    view: "posterolateral",
    hide: ["skin"],
    pearls: ["Limite inferior da colheita estendida do GD", "Local raro de hérnia lombar"],
  },
  {
    id: "quadrangular-space",
    label: "Espaços quadrangular e triangular",
    description: "Passagens posteriores da axila entre redondo menor, redondo maior, cabeça longa do tríceps e úmero.",
    centre: "circumflex-humeral-vessels",
    walls: [
      { label: "Superior: redondo menor", structures: ["teres-minor"] },
      { label: "Inferior: redondo maior", structures: ["teres-major"] },
      { label: "Medial: cabeça longa do tríceps", structures: ["triceps"] },
      { label: "Lateral: úmero", structures: ["axilla"] },
    ],
    contents: ["circumflex-humeral-vessels", "arm-nerves", "subscapular-vessels"],
    view: "posterior",
    hide: ["skin", "deltoid", "deltoid-fascia", "latissimus-dorsi", "trapezius"],
    pearls: ["Quadrangular: nervo axilar e artéria circunflexa posterior do úmero", "Triangular (medial à cabeça longa): artéria circunflexa da escápula"],
  },
];

/**
 * Rigid manipulations (no deformation): "reflect" rotates a structure group around a hinge axis,
 * "retract" translates it away from the body. Hinges are resolved at runtime from real vertices.
 */
export type Manipulation = {
  id: string;
  label: string;
  kind: "reflect" | "retract" | "transpose";
  structures: string[];
  /** hinge pivot: nearest vertex of `pivotStructure` to landmark/structure `pivotNear` */
  pivotStructure: string;
  pivotNear: string;
  axis: [number, number, number];
  maxAngle?: number;
  distanceMm?: number;
  /** transpose: landmark the structure centroid is carried to (arc around the operative side) */
  target?: string;
  targetOffsetMm?: [number, number, number];
  hint: string;
};

export const manipulations: Manipulation[] = [
  {
    id: "ld-flap",
    label: "Elevar e transpor o grande dorsal",
    kind: "transpose",
    structures: ["latissimus-dorsi"],
    pivotStructure: "",
    pivotNear: "",
    axis: [0, 1, 0],
    target: "breastCenter",
    targetOffsetMm: [0, 25, 30],
    hint: "Arco didático: o músculo é levado rigidamente do dorso, pelo lado lateral do tórax, até a parede anterior. Os vasos e o nervo toracodorsais reais permanecem na posição anatômica (axila).",
  },
  {
    id: "pec-major",
    label: "Rebater o peitoral maior",
    kind: "reflect",
    structures: ["pectoralis-major", "pectoral-fascia"],
    pivotStructure: "pectoralis-major",
    pivotNear: "axilla",
    axis: [0, 1, 0],
    maxAngle: -110,
    hint: "Rebatido lateralmente em torno da inserção umeral: expõe o peitoral menor, o espaço de Rotter e o nível II.",
  },
  {
    id: "pec-minor",
    label: "Rebater o peitoral menor",
    kind: "reflect",
    structures: ["pectoralis-minor"],
    pivotStructure: "pectoralis-minor",
    pivotNear: "axillaryArteryCenter",
    axis: [0, 0, 1],
    maxAngle: 70,
    hint: "Rebatido em direção ao coracoide: expõe a 2ª parte da artéria axilar e o nível III.",
  },
  {
    id: "breast",
    label: "Afastar a mama medialmente",
    kind: "reflect",
    structures: ["breast", "breast-fat", "breast-ligaments", "nipple-areola"],
    pivotStructure: "breast-fat",
    pivotNear: "chest-wall",
    axis: [0, 1, 0],
    maxAngle: 75,
    hint: "A mama gira como uma porta em torno da borda medial: expõe o plano pré-peitoral e a fáscia peitoral.",
  },
  {
    id: "trapezius",
    label: "Rebater o trapézio",
    kind: "reflect",
    structures: ["trapezius"],
    pivotStructure: "trapezius",
    pivotNear: "chest-wall",
    axis: [0, 1, 0],
    maxAngle: -60,
    hint: "Rebatido medialmente: expõe romboides, borda superior do GD e o triângulo de ausculta.",
  },
  {
    id: "explode",
    label: "Afastar a estrutura selecionada",
    kind: "retract",
    structures: [],
    pivotStructure: "",
    pivotNear: "",
    axis: [0, 0, 0],
    distanceMm: 80,
    hint: "Afasta a estrutura selecionada para longe do centro do corpo (vista explodida), sem deformá-la.",
  },
];
