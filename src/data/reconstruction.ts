/**
 * Mastectomia e reconstrução imediata com retalhos miocutâneos pediculados: os passos de
 * src/data/reconstructionSteps.json (escritos por scripts/hybrid/build_flaps.py; docs/plano-retalhos-miocutaneos.md).
 * Cada vista é um quadro da sequência; entre duas vistas o tecido é animado de um quadro ao outro. Os números vêm do
 * pipeline (medidos nas malhas).
 */
import type { AnatomyDetail } from "@/data/anatomyDetails";
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

// ---- grande dorsal ---------------------------------------------------------------------------------------
const L = "grande-dorsal";
const lid = (part: string) => `recon-${part}-${L}`;
const lm = reconstructionMeasures(L);
const backCommon = { orientation: "posterolateral" as const, anchor: `step:${L}:centre`, distance: 0.82, follow: false };
const frontCommon = { orientation: "anterolateral" as const, anchor: `step:${L}:front-centre`, distance: 0.72, follow: false };
const ldVessels = [lid("artery"), lid("vein")];
const ldBack = ["skin", "contralateral-breast", lid("skin"), lid("back-skin"), lid("island"), lid("island-fat"), lid("perforators")];
const ldContext = ["serratus-anterior", "teres-major", "trapezius", "subscapular-vessels", "axillary-vessels", ...chestWall];
const island = `${cm(lm.islandLengthMm ?? 0)} × ${cm(lm.islandWidthMm ?? 0)} cm`;

const latissimusViews: PackView[] = [
  {
    ...backCommon,
    id: "grande-dorsal-marcacao",
    title: "1. Marcação no dorso",
    description: `A ilha é um fuso transverso na linha do sutiã, ${cm(lm.paddleBelowScapulaMm ?? 0)} cm abaixo da ponta da escápula, sobre o grande dorsal, da borda anterior para dentro, com o tamanho do defeito da mastectomia (${island}). É um retalho miocutâneo: pele, derme e gordura presas ao músculo pelas perfurantes, e a ilha conta tanto quanto o músculo. A cicatriz do dorso fica horizontal, escondida pelo sutiã.`,
    structures: [...ldBack, lid("marking"), lid("limits"), lid("tunnel"), lid("muscle"), lid("remnant")],
    solid: ["skin", lid("skin"), lid("back-skin"), lid("island")],
    labels: withPoints([
      label(L, lid("marking"), "island-back", `Fuso na linha do sutiã: ${island}`),
      label(L, lid("limits"), "border", "Borda anterior do grande dorsal"),
      label(L, lid("tunnel"), "tunnel", "Túnel axilar (subcutâneo)"),
    ]),
    surgery: surgery(L, "marcacao", { replayFrom: null }),
    relations: [
      "Decúbito lateral com o braço fletido a 90° sobre o apoio (no modelo, posição anatômica)",
      `Largura de ${cm(lm.islandWidthMm ?? 0)} cm: o dorso fecha sem tensão (teste do pinçamento; até 8–10 cm)`,
      "A ilha fica toda sobre o músculo: é nutrida pelas perfurantes musculocutâneas, que entram pela sua parte central",
      "Fuso com cerca de 3 vezes o comprimento pela largura, pontas afiladas para fechar sem orelhas",
      "Variantes: ilha oblíqua, paralela às costelas, ou vertical, ao longo da borda anterior; a escolha depende do defeito e de onde a paciente prefere a cicatriz",
      "Na frente, a loja da mastectomia espera aberta (passos da mastectomia)",
    ],
  },
  {
    ...backCommon,
    id: "grande-dorsal-incisao",
    title: "2. Incisão e descolamento",
    description: "Incisão em volta do fuso até a fáscia do músculo, sem descolar a ilha dele: a pele, a derme e a gordura da ilha ficam presas ao músculo pelas perfurantes. A pele do dorso é descolada acima da fáscia, até as bordas do músculo: a ponta da escápula e o trapézio em cima, a borda anterior, a linha das espinhosas e, embaixo, até onde o músculo será seccionado.",
    structures: [...ldBack, lid("incision"), lid("limits"), lid("muscle"), lid("remnant"), "trapezius", "teres-major"],
    translucent: ["skin", lid("back-skin")],
    solid: [lid("island")],
    labels: withPoints([label(L, lid("incision"), "island-back", "Incisão em volta do fuso"), label(L, lid("muscle"), "border", "Grande dorsal exposto"), label(L, lid("perforators"), "perforators", "Perfurantes: prendem a ilha ao músculo")]),
    surgery: surgery(L, "incisao", { replayFrom: null }),
    relations: [
      "O plano é acima da fáscia do grande dorsal; no grande dorsal estendido, a gordura profunda do dorso vai com o músculo",
      "O trapézio cobre a borda superior e medial do músculo: é afastado, não incisado",
    ],
  },
  {
    ...backCommon,
    id: "grande-dorsal-liberacao",
    title: "3. Liberação do músculo",
    description: `O músculo é separado do serrátil anterior e do redondo maior e seccionado distalmente, na medida da loja: o retalho leva ${lm.takenPct ?? 0}% do músculo (${lm.muscleAreaCm2 ?? 0} cm², ${cm(lm.muscleMm ?? 0)} mm de espessura). A parte lombar fica presa à fáscia toracolombar e à crista ilíaca. O retalho fica preso só pelo tendão e pelo pedículo.`,
    structures: [...ldBack, lid("muscle"), lid("remnant"), lid("limits"), ...ldContext, ...ldVessels],
    translucent: ["skin", lid("back-skin")],
    solid: [lid("island")],
    focus: [lid("muscle")],
    labels: withPoints([label(L, lid("remnant"), "remnant", "Parte lombar: fica"), label(L, lid("muscle"), "border", "Retalho do grande dorsal")]),
    surgery: surgery(L, "liberacao"),
    relations: [
      "Origens do grande dorsal: espinhosas de T7 a L5 e sacro (pela fáscia toracolombar), crista ilíaca, 3–4 últimas costelas e, em geral, a ponta da escápula",
      "O serrátil anterior e o nervo torácico longo ficam na parede (não podem vir com o retalho)",
      "Irrigação tipo V de Mathes–Nahai: o pedículo dominante toracodorsal basta; as perfurantes segmentares das intercostais posteriores e lombares são ligadas",
    ],
  },
  {
    ...backCommon,
    distance: 0.62,
    anchor: `step:${L}:hilum-pediculo`,
    id: "grande-dorsal-pediculo",
    title: "4. Pedículo toracodorsal",
    description: `O músculo é rebatido em direção à axila e mostra o pedículo na face profunda: artéria e veias toracodorsais com ${cm(lm.pedicleMm ?? 0)} cm livres da subescapular ao hilo. O ramo do serrátil é ligado e o nervo toracodorsal seccionado; o tendão é liberado em parte.`,
    structures: [...ldBack, lid("muscle"), lid("remnant"), lid("nerve-cut"), lid("serratus-cut"), ...ldVessels, ...ldContext],
    translucent: ["skin", lid("back-skin")],
    focus: [lid("artery"), lid("nerve-cut"), lid("serratus-cut")],
    labels: withPoints([
      label(L, lid("artery"), "hilum-pediculo", `Artéria e veias toracodorsais: ${cm(lm.pedicleMm ?? 0)} cm`),
      label(L, lid("serratus-cut"), "serratus-cut", "Ramo do serrátil ligado"),
      label(L, lid("nerve-cut"), "nerve-cut", "Nervo toracodorsal seccionado"),
      label(L, lid("artery"), "origin", "Subescapular (origem)"),
    ]),
    surgery: surgery(L, "pediculo"),
    relations: [
      "A toracodorsal é o ramo terminal da subescapular, depois da circunflexa da escápula; entra no hilo 8–10 cm abaixo da axilar e 2–3 cm dentro da borda anterior",
      "No músculo ela se divide em ramo descendente (lateral, a ~2 cm da borda anterior) e transverso (ao longo da borda superior); traçado esquemático (Tobin, 1981)",
      "O ramo do serrátil permite fluxo retrógrado se a toracodorsal for ligada acima dele: por isso, em geral, só é ligado quando o arco pede",
      "Seccionar o nervo reduz a contração do retalho sobre o implante (animação) e favorece a atrofia; preservá-lo mantém volume. Não há consenso",
    ],
  },
  {
    ...frontCommon,
    orientation: "lateral",
    distance: 0.85,
    anchor: `step:${L}:tunnel`,
    id: "grande-dorsal-tunel",
    title: "5. Túnel axilar",
    description: `O retalho passa por um túnel subcutâneo alto na axila, do dorso para a loja da mastectomia, girando ${lm.rotationDeg ?? 0}° em volta do pivô do pedículo. Por isso o fuso, transverso no dorso, chega à mama inclinado ${lm.islandTiltDeg ?? 0}°. O pedículo acompanha sem tração: a maior razão entre a distância origem–hilo e o comprimento livre foi ${(lm.maxStretch ?? 1).toLocaleString("pt-BR")}.`,
    structures: ["skin", "contralateral-breast", lid("skin"), lid("back-skin"), lid("island"), lid("island-fat"), lid("perforators"), lid("muscle"), lid("remnant"), lid("tunnel"), ...ldVessels, lid("nerve-cut"), "pectoralis-major", "serratus-anterior", ...chestWall],
    translucent: ["skin", lid("skin"), lid("back-skin")],
    focus: [lid("muscle"), lid("island")],
    labels: withPoints([label(L, lid("tunnel"), "tunnel", "Túnel axilar"), label(L, lid("muscle"), "flap-front", "Retalho na loja da mastectomia")]),
    surgery: surgery(L, "tunel"),
    relations: [
      "O túnel fica abaixo da pele da axila e acima do pedículo: largo o bastante para não comprimir os vasos",
      "A borda lateral do sulco e a prega axilar anterior são respeitadas",
      "O retalho entra pela ponta lateral da loja e fica, por enquanto, solto sobre o peitoral maior",
      modelNote,
    ],
  },
  {
    ...backCommon,
    id: "grande-dorsal-doadora",
    title: "6. Fechamento do dorso",
    description: `Ainda em decúbito lateral, o dorso é fechado sobre drenos aspirativos, com pontos de adesão (quilting) do retalho de pele à parede. A cicatriz fica horizontal, na linha do sutiã, com ${cm(lm.backScarMm ?? 0)} cm.`,
    structures: ["skin", "contralateral-breast", lid("back-skin"), lid("remnant"), lid("scar"), "trapezius"],
    solid: ["skin", lid("back-skin")],
    labels: withPoints([label(L, lid("scar"), "back-scar", `Cicatriz do dorso: ${cm(lm.backScarMm ?? 0)} cm`)]),
    surgery: surgery(L, "doadora"),
    relations: [
      "O seroma do dorso é a complicação mais comum. Num ensaio randomizado com 108 mulheres, os pontos de adesão reduziram o seroma de 96% para 83% (Daltrey et al., 2006)",
      "Onde o músculo foi retirado, a pele fica sobre o serrátil e as costelas: o contorno do dorso fica um pouco mais plano",
      "A paciente é virada para decúbito dorsal para a inserção",
    ],
  },
  {
    ...frontCommon,
    id: "grande-dorsal-implante",
    title: "7. Implante",
    description: `Com a paciente em decúbito dorsal, o implante (${ml(lm.implantMl ?? 0)} no modelo) entra na loja, sobre o peitoral maior e sob o grande dorsal. O volume é o que falta para encher o envelope de pele da mama, descontados o músculo e a ilha com a gordura do dorso.`,
    structures: ["skin", "contralateral-breast", lid("skin"), lid("back-skin"), lid("island"), lid("island-fat"), lid("perforators"), lid("muscle"), lid("implant"), ...ldVessels, "pectoralis-major", "serratus-anterior", ...chestWall],
    translucent: ["skin", lid("skin"), lid("back-skin")],
    focus: [lid("implant")],
    labels: withPoints([label(L, lid("implant"), "implant", `Implante: ${ml(lm.implantMl ?? 0)}`), label(L, lid("muscle"), "flap-front", "Grande dorsal")]),
    surgery: surgery(L, "implante"),
    relations: [
      `A ilha traz ${cm(lm.islandFatMm ?? 0)} cm de gordura do dorso nesta paciente: junto com o músculo (≈ ${ml(lm.muscleMl ?? 0)}) ela dá boa parte do volume, por isso o implante é pequeno`,
      "Variante comum: implante na loja subpeitoral, com o grande dorsal completando o polo inferior",
      "Alternativas: expansor (troca depois) ou grande dorsal estendido, sem implante, quando o dorso tem gordura suficiente",
    ],
  },
  {
    ...frontCommon,
    id: "grande-dorsal-insercao",
    title: "8. Inserção e modelagem",
    description: `O músculo é suturado ao sulco inframamário, à borda esternal e ao peitoral maior, cobrindo o implante. O fuso chega inclinado; para deitá-lo no defeito transverso, um terço de cada ponta é descolado do músculo e a ilha gira ${lm.islandTurnDeg ?? 0}° sobre ele, presa pelo centro, onde entram as perfurantes. A ilha é suturada no defeito e a pele que ficou da mastectomia volta ao envelope da mama.`,
    structures: ["skin", "contralateral-breast", lid("skin"), lid("back-skin"), lid("island"), lid("island-fat"), lid("perforators"), lid("muscle"), lid("implant"), lid("island-scar"), ...ldVessels, "pectoralis-major", ...chestWall],
    translucent: ["skin", lid("skin"), lid("back-skin")],
    focus: [lid("island"), lid("perforators"), lid("muscle")],
    labels: withPoints([label(L, lid("island"), "island-front", "Ilha girada no defeito"), label(L, lid("muscle"), "flap-inset", "Grande dorsal sobre o implante"), label(L, lid("artery"), "pedicle-front", "Pedículo, da axila ao músculo")]),
    surgery: surgery(L, "insercao"),
    relations: [
      "A ilha tem um segundo arco de rotação, sobre o músculo, além do arco do retalho em volta da axila: descolar até um terço de cada ponta deixa deitar na horizontal um fuso que chegaria vertical",
      "A forma final é o envelope da mama em repouso: o objetivo da reconstrução imediata, que reaproveita a pele",
      "A parte do músculo que sobra é acomodada no contorno (na prática, pregueada ou aparada)",
      "Drenos na loja; o pedículo passa pela axila sem dobra",
      modelNote,
    ],
  },
  {
    ...frontCommon,
    id: "grande-dorsal-resultado",
    title: "9. Resultado",
    description: `Mama reconstruída com a ilha de pele do dorso (${island}), de cor e textura um pouco diferentes da pele da mama. O complexo areolopapilar pode ser reconstruído meses depois (retalho local e tatuagem).`,
    structures: ["skin", "contralateral-breast", lid("skin"), lid("back-skin"), lid("island"), lid("island-scar")],
    solid: ["skin", lid("skin"), lid("back-skin"), lid("island")],
    labels: withPoints([label(L, lid("island"), "island-front", "Ilha do dorso"), label(L, lid("island-scar"), "front-scar", "Cicatriz em volta da ilha")]),
    surgery: surgery(L, "resultado", { replayFrom: null, instant: true, caption: "Resultado esperado" }),
    relations: [
      "Complicações: seroma do dorso, necrose parcial da ilha, contratura capsular do implante, assimetria, contração visível do músculo (animação) e pequena perda de força de adução e extensão do ombro",
      "Indicações típicas: reconstrução depois de radioterapia, falha de implante, pacientes sem abdome doador",
    ],
  },
  {
    ...backCommon,
    id: "grande-dorsal-resultado-dorso",
    title: "10. Resultado: dorso",
    description: `No dorso fica a cicatriz horizontal de ${cm(lm.backScarMm ?? 0)} cm, na linha do sutiã, e, embaixo, a parte lombar do músculo, que não foi usada.`,
    structures: ["skin", "contralateral-breast", lid("back-skin"), lid("scar")],
    solid: ["skin", lid("back-skin")],
    labels: withPoints([label(L, lid("scar"), "back-scar", "Cicatriz do dorso")]),
    surgery: surgery(L, "resultado", { replayFrom: null, instant: true, caption: "Resultado esperado: dorso" }),
    relations: ["A função do ombro costuma voltar ao normal nas atividades diárias; esportes de tração (natação, escalada) podem notar a perda"],
  },
];

const latissimusPack: Pack = {
  id: "grande-dorsal-passo-a-passo",
  title: "Retalho do grande dorsal",
  summary: "Fuso transverso na linha do sutiã, liberação do músculo, pedículo toracodorsal, túnel axilar, implante e inserção da ilha girada no defeito da mastectomia.",
  views: latissimusViews,
};

// ---- TRAM pediculado ----------------------------------------------------------------------------------------
const T = "tram";
const tid = (part: string) => `recon-${part}-${T}`;
const tm = reconstructionMeasures(T);
const abdomenCommon = { orientation: "frontal" as const, anchor: `step:${T}:centre`, distance: 0.95, follow: false };
const breastCommon = { orientation: "anterolateral" as const, anchor: `step:${T}:front-centre`, distance: 0.72, follow: false };
const zones = [tid("zone-1"), tid("zone-2"), tid("zone-3"), tid("zone-3-tip"), tid("zone-4")];
const tramSkin = ["skin", "contralateral-breast", tid("skin"), tid("abdomen-skin"), tid("abdomen-window")];
const flapSkin = [tid("island"), tid("flap-skin"), tid("discard-skin"), tid("tip-skin")];
const abdominalWall = [tid("contra-rectus"), tid("linea-alba"), tid("pyramidalis"), tid("external-oblique"), tid("pelvis"), "iliac-crest", tid("inguinal"), tid("iliac")];
/** the wall round the pedicle (each step shows only what it is about: the landmarks of the lower abdomen only below) */
const wallFrame = [tid("contra-rectus"), tid("linea-alba"), tid("external-oblique")];
const pelvisFrame = [tid("pelvis"), "iliac-crest", tid("inguinal"), tid("pyramidalis")];
const tramVessels = [tid("superior-epigastric"), tid("inferior-epigastric"), tid("inferior-epigastric-stays"), tid("perforators"), tid("contra-epigastric")];
const tramIsland = `${cm(tm.islandLengthMm ?? 0)} × ${cm(tm.islandWidthMm ?? 0)} cm`;
const zoneMl = (zone: string) => ml(tm[`${zone}Ml`] ?? 0);

const tramViews: PackView[] = [
  {
    ...abdomenCommon,
    id: "tram-marcacao",
    title: "1. Marcação",
    description: `Elipse do abdome inferior: da prega suprapúbica até 1,5 cm acima do umbigo e de uma espinha ilíaca ântero-superior à outra (${cm(tm.lensWidthMm ?? 0)} × ${cm(tm.lensHeightMm ?? 0)} cm sobre a pele). O pedículo é o reto do mesmo lado da mama. As cores são as zonas de Hartrampf; o tracejado em volta da zona I é a ilha que vai repor a pele do defeito (${tramIsland}).`,
    structures: [...tramSkin, ...flapSkin, ...zones, tid("marking"), tid("zones"), tid("tunnel")],
    translucent: ["skin", tid("abdomen-skin"), tid("abdomen-window"), ...flapSkin],
    labels: withPoints([
      label(T, tid("zone-1"), "zone-1", `Zona I: sobre o reto do pedículo (${zoneMl("zone-1")})`),
      label(T, tid("zone-2"), "zone-2", `Zona II: além da linha média (${zoneMl("zone-2")})`),
      label(T, tid("zone-3"), "zone-3", "Zona III: lateral ao pedículo"),
      label(T, tid("zone-4"), "zone-4", `Zona IV: será descartada (${zoneMl("zone-4")})`),
      label(T, tid("marking"), "navel", "Umbigo"),
      label(T, tid("tunnel"), "tunnel", "Túnel epigástrico até a loja"),
    ]),
    surgery: surgery(T, "marcacao", { replayFrom: null }),
    relations: [
      `Retalho inteiro: ${ml(tm.flapMl ?? 0)}, com ${cm(tm.fatMm ?? 0)} cm de gordura abaixo do umbigo nesta paciente`,
      "O fechamento do abdome é avaliado pelo pinçamento, com a paciente fletida",
      "Zonas de Hartrampf (1982): I sobre o reto do pedículo, II sobre o reto oposto, III lateral ao pedículo, IV lateral oposta. Scheflan e Dinner (1983), e Holm (2006) para a AEIP, trocam II e III",
      "A irrigação vem da epigástrica superior, a menos dominante para esta pele: quanto mais longe do pedículo, pior a perfusão",
      "Contraindicações relativas: tabagismo, obesidade grave e cicatrizes que cortam os vasos (subcostal, por exemplo)",
    ],
  },
  {
    ...abdomenCommon,
    id: "tram-incisao",
    title: "2. Incisões e descolamento",
    description: "Incisão em volta da elipse e do umbigo, que fica preso ao seu pedículo. O retalho abdominal superior é descolado acima da aponeurose, até o rebordo costal e o apêndice xifoide, como numa abdominoplastia. Pelo descolamento, um túnel subcutâneo leva à loja da mastectomia pelo sulco inframamário medial.",
    structures: [...tramSkin, ...flapSkin, ...zones, tid("incision"), tid("tunnel"), tid("sheath"), ...wallFrame, ...pelvisFrame],
    translucent: ["skin", tid("abdomen-skin"), tid("abdomen-window"), ...flapSkin],
    labels: withPoints([label(T, tid("abdomen-skin"), "upper-flap", "Retalho abdominal superior descolado"), label(T, tid("incision"), "navel", "Umbigo circunscrito"), label(T, tid("tunnel"), "tunnel", "Túnel epigástrico")]),
    surgery: surgery(T, "incisao", { replayFrom: null }),
    relations: [
      "As aderências laterais do sulco inframamário são preservadas: o túnel entra pela parte medial",
      "O túnel deve ser largo (cerca de 4 dedos) para o retalho passar sem comprimir o pedículo",
    ],
  },
  {
    ...abdomenCommon,
    id: "tram-ilha",
    title: "3. Elevação da ilha",
    description: `A ilha é levantada de lateral para medial, acima da aponeurose do oblíquo externo: do lado do pedículo, até a fileira lateral de perfurantes; do lado oposto, até a linha média. A zona IV, a pior perfundida, é descartada (${zoneMl("zone-4")}).`,
    structures: [...tramSkin, ...flapSkin.filter((id) => id !== tid("discard-skin")), tid("zone-1"), tid("zone-2"), tid("zone-3"), tid("zone-3-tip"), tid("zone-4"), tid("perforators"), tid("sheath"), ...wallFrame, ...pelvisFrame],
    translucent: ["skin", tid("abdomen-skin"), tid("abdomen-window"), ...flapSkin],
    focus: [tid("zone-4"), tid("perforators")],
    labels: withPoints([label(T, tid("zone-4"), "discard", `Zona IV descartada: ${zoneMl("zone-4")}`), label(T, tid("perforators"), "perforators", "Perfurantes periumbilicais (esquema)")]),
    surgery: surgery(T, "ilha"),
    relations: [
      "As perfurantes da epigástrica inferior profunda saem em duas fileiras, medial e lateral, mais densas em volta do umbigo",
      "No TRAM pediculado elas são a via de entrada do sangue que vem de cima, pelos vasos de choke acima do umbigo",
      "Se a zona III ou a II sangrarem mal, também são aparadas",
    ],
  },
  {
    ...abdomenCommon,
    distance: 0.8,
    id: "tram-bainha",
    title: "4. Bainha e vasos inferiores",
    description: "A bainha anterior do reto é incisada em volta das perfurantes: uma faixa dela fica com o músculo. Abaixo da ilha, o reto é seccionado e os vasos epigástricos inferiores profundos são ligados. A ilha agora só recebe sangue de cima.",
    structures: ["skin", tid("abdomen-skin"), tid("abdomen-window"), tid("island"), tid("zone-1"), tid("rectus"), tid("rectus-stays"), tid("sheath"), tid("sheath-strip"), tid("perforators"), tid("superior-epigastric"), tid("inferior-epigastric"), tid("inferior-epigastric-stays"), tid("iliac"), ...wallFrame],
    translucent: ["skin", tid("abdomen-skin"), tid("abdomen-window"), tid("island"), tid("zone-1")],
    focus: [tid("inferior-epigastric-stays"), tid("sheath-strip"), tid("rectus")],
    labels: withPoints([label(T, tid("inferior-epigastric-stays"), "diea-cut", "Epigástricos inferiores profundos ligados"), label(T, tid("sheath"), "sheath", "Bainha anterior aberta"), label(T, tid("perforators"), "perforators", "Perfurantes")]),
    surgery: surgery(T, "bainha"),
    relations: [
      "Acima da linha arqueada há bainha posterior; abaixo dela, só a fáscia transversal fica atrás do músculo",
      "\"Delay\": ligar os epigástricos inferiores 1–2 semanas antes abre os vasos de choke e melhora a perfusão do retalho pediculado",
    ],
  },
  {
    ...abdomenCommon,
    distance: 0.85,
    anchor: `step:${T}:rectus`,
    id: "tram-musculo",
    title: "5. Elevação do reto",
    description: "O reto é levantado da bainha posterior, de baixo para cima, até o rebordo costal, levando na face profunda os vasos epigástricos superiores, que entram no músculo atrás da 7ª cartilagem. Os nervos segmentares (T7 a T12), que entram pela borda lateral, são seccionados.",
    structures: ["skin", tid("abdomen-skin"), tid("abdomen-window"), tid("island"), tid("zone-1"), tid("rectus"), tid("rectus-stays"), tid("sheath"), tid("sheath-strip"), tid("posterior-sheath"), tid("transversalis"), tid("superior-epigastric"), tid("inferior-epigastric"), tid("inferior-epigastric-stays"), tid("perforators"), ...wallFrame, "costal-cartilages", "chest-wall"],
    translucent: ["skin", tid("abdomen-skin"), tid("abdomen-window"), tid("island"), tid("zone-1")],
    focus: [tid("rectus"), tid("superior-epigastric"), tid("posterior-sheath")],
    labels: withPoints([
      label(T, tid("rectus"), "rectus", "Reto do abdome: o pedículo"),
      label(T, tid("superior-epigastric"), "pivot", "Epigástricos superiores entram no rebordo costal"),
      label(T, tid("posterior-sheath"), "posterior-sheath", "Bainha posterior: o leito do músculo"),
    ]),
    surgery: surgery(T, "musculo"),
    relations: [
      "Irrigação tipo III de Mathes–Nahai: dois pedículos dominantes, a epigástrica superior (da torácica interna) e a inferior profunda (da ilíaca externa)",
      "Abaixo da linha arqueada não há bainha posterior: o leito é só a fáscia transversal, e é ali que o abdome fica mais fraco. A posição da linha varia muito; no modelo ela fica a um terço do caminho do umbigo ao púbis, perto da média medida em cadáveres",
      "A torácica interna do mesmo lado precisa estar íntegra (atenção a cateter ou a ponte de mamária)",
      `O músculo leva o retalho por ${cm(tm.carrierMm ?? 0)} cm, do rebordo costal à borda da ilha`,
    ],
  },
  {
    ...breastCommon,
    orientation: "frontal",
    distance: 0.95,
    anchor: `step:${T}:carrier`,
    id: "tram-tunel",
    title: "6. Túnel e rotação de 180°",
    description: "O retalho sobe pelo túnel epigástrico, do lado da mama, e gira 180° no caminho; estreitado, passa pelo túnel e se abre na loja da mastectomia. O reto gira junto: a parte presa ao retalho vira para cima e o resto, mais longo que a distância do rebordo à loja, dobra-se sobre si mesmo junto ao rebordo, com meia torção. A borda que era a do umbigo fica embaixo, junto ao sulco; a zona III fica medial.",
    structures: ["skin", "contralateral-breast", tid("skin"), tid("abdomen-skin"), tid("abdomen-window"), tid("island"), tid("flap-skin"), tid("tip-skin"), tid("zone-1"), tid("zone-2"), tid("zone-3"), tid("zone-3-tip"), tid("rectus"), tid("rectus-stays"), tid("sheath"), tid("posterior-sheath"), tid("transversalis"), tid("superior-epigastric"), tid("inferior-epigastric"), tid("tunnel"), tid("contra-rectus"), tid("linea-alba"), "pectoralis-major", "costal-cartilages", "chest-wall"],
    translucent: ["skin", tid("skin"), tid("abdomen-skin"), tid("abdomen-window"), tid("island"), tid("flap-skin"), tid("tip-skin"), tid("zone-1"), tid("zone-2"), tid("zone-3"), tid("zone-3-tip")],
    focus: [tid("rectus"), tid("superior-epigastric")],
    labels: withPoints([label(T, tid("rectus"), "carrier", "Reto dobrado no rebordo costal"), label(T, tid("zone-1"), "flap-front", "Retalho na loja")]),
    surgery: surgery(T, "tunel"),
    relations: [
      "Com o pedículo do mesmo lado a transposição é direta, de 180° sobre o rebordo costal; com o do lado oposto, o músculo cruza a linha média num arco mais suave",
      "A dobra do músculo no rebordo é a causa do volume que às vezes se vê no epigástrio",
      modelNote,
    ],
  },
  {
    ...breastCommon,
    id: "tram-insercao",
    title: "7. Inserção e modelagem",
    description: `Tudo é desepitelizado, exceto a ilha que repõe a pele do defeito (${tramIsland}). Das zonas I a III, sem a ponta da zona III, restam ${ml(tm.keptMl ?? 0)}: cerca de ${Math.round((tm.keptMl ?? 0) / (mm.breastMl || 1))} vezes os ${ml(mm.breastMl ?? 0)} da mama retirada. O excesso é aparado, das bordas mais distantes do pedículo para dentro, até o volume que a simetria pede. O retalho é fixado ao sulco e à parede, e a pele da mastectomia volta ao envelope.`,
    structures: ["skin", "contralateral-breast", tid("skin"), tid("abdomen-skin"), tid("abdomen-window"), tid("island"), tid("flap-skin"), tid("zone-1"), tid("zone-2"), tid("zone-3"), tid("rectus"), tid("superior-epigastric"), tid("island-scar"), "pectoralis-major", "costal-cartilages", "chest-wall"],
    translucent: ["skin", tid("skin"), tid("abdomen-skin"), tid("abdomen-window"), tid("flap-skin")],
    tint: { [tid("flap-skin")]: "#d97a82" },
    focus: [tid("island"), tid("zone-1")],
    labels: withPoints([label(T, tid("island"), "island-front", "Ilha do abdome no defeito"), label(T, tid("zone-1"), "flap-front", "Gordura do retalho modelando a mama")]),
    surgery: surgery(T, "insercao"),
    relations: [
      "A pele desepitelizada (rosada) fica sob os retalhos da mastectomia",
      "O volume do retalho passa do necessário: o excesso é aparado, a começar pelas zonas mais distantes do pedículo",
      "No modelo, as zonas I a III inteiras são comprimidas no envelope da mama em repouso, por frações da espessura, em vez de aparadas; na prática o retalho é aparado, dobrado e suturado para formar o cone e o sulco",
    ],
  },
  {
    ...abdomenCommon,
    id: "tram-doadora",
    title: "8. Fechamento do abdome",
    description: "A bainha anterior é fechada sobre o defeito do músculo (ou reforçada com tela; abaixo da linha arqueada o reparo é obrigatório). O retalho abdominal superior desce até a incisão suprapúbica e o umbigo é exteriorizado por uma abertura nova, no mesmo lugar.",
    structures: [...tramSkin.filter((id) => id !== tid("abdomen-window")), tid("scar"), tid("sheath"), tid("sheath-suture"), tid("rectus-stays"), ...abdominalWall],
    translucent: ["skin", tid("abdomen-skin")],
    labels: withPoints([label(T, tid("scar"), "abdominal-scar", "Cicatriz suprapúbica"), label(T, tid("scar"), "navel-scar", "Umbigo exteriorizado"), label(T, tid("sheath-suture"), "sheath", "Bainha anterior suturada")]),
    surgery: surgery(T, "doadora"),
    relations: [
      `O retalho superior avança ${cm(tm.advancementMm ?? 0)} cm: drenos e flexão do quadril nos primeiros dias reduzem a tensão`,
      "Complicações do abdome: abaulamento ou hérnia, seroma, necrose da borda e perda de força para levantar o tronco",
    ],
  },
  {
    ...breastCommon,
    id: "tram-resultado",
    title: "9. Resultado",
    description: `Mama reconstruída só com tecido da própria paciente: a ilha de pele do abdome (${tramIsland}) no lugar da elipse da mastectomia. A mama de gordura acompanha o peso e o envelhecimento como a outra.`,
    structures: ["skin", "contralateral-breast", tid("skin"), tid("abdomen-skin"), tid("island"), tid("island-scar")],
    solid: ["skin", tid("skin"), tid("abdomen-skin"), tid("island")],
    labels: withPoints([label(T, tid("island"), "island-front", "Ilha do abdome"), label(T, tid("island-scar"), "front-scar", "Cicatriz em volta da ilha")]),
    surgery: surgery(T, "resultado", { replayFrom: null, instant: true, caption: "Resultado esperado" }),
    relations: [
      "Necrose gordurosa em 5 a 20% e necrose parcial, sobretudo nas zonas mais distantes do pedículo",
      "Evoluções: TRAM bipediculado, TRAM livre e DIEP, que leva só a pele, a gordura e os vasos, sem músculo",
    ],
  },
  {
    ...abdomenCommon,
    id: "tram-resultado-abdome",
    title: "10. Resultado: abdome",
    description: "No abdome ficam a cicatriz suprapúbica, de uma espinha ilíaca à outra, e a cicatriz em volta do umbigo, como numa abdominoplastia.",
    structures: ["skin", "contralateral-breast", tid("skin"), tid("abdomen-skin"), tid("scar")],
    solid: ["skin", tid("skin"), tid("abdomen-skin")],
    labels: withPoints([label(T, tid("scar"), "abdominal-scar", "Cicatriz suprapúbica"), label(T, tid("scar"), "navel-scar", "Cicatriz periumbilical")]),
    surgery: surgery(T, "resultado", { replayFrom: null, instant: true, caption: "Resultado esperado: abdome" }),
    relations: ["A parede perde um reto: a tela e a reabilitação reduzem o abaulamento e a perda de força"],
  },
];

const tramPack: Pack = {
  id: "tram-passo-a-passo",
  title: "TRAM pediculado",
  summary: "Ilha do abdome inferior e zonas de Hartrampf, reto do abdome com os vasos epigástricos superiores, rotação de 180° pelo túnel epigástrico e fechamento do abdome.",
  views: tramViews,
};

export const reconstructionGroup: PackGroup = {
  id: "reconstrucao-mamaria",
  title: "Reconstrução mamária",
  description: "Mastectomia total e reconstrução imediata com retalhos miocutâneos pediculados: grande dorsal (com implante) e TRAM, passo a passo.",
  packs: [mastectomyPack, latissimusPack, tramPack],
};

// ---- cards of the pieces (tap on the model) ------------------------------------------------------------------
export const reconstructionDetails: Record<string, AnatomyDetail> = {
  [mid("skin")]: {
    summary: `Pele da mama que fica na mastectomia: os retalhos superior e inferior, com ${mm.flapMm ?? 6} mm de subcutâneo no modelo. Na reconstrução imediata é reaproveitada: o retalho enche o envelope que ela forma.`,
    surgical: ["Espessura uniforme: degraus comprometem o plexo subdérmico", "Retalhos finos demais necrosam sem ganho oncológico"],
  },
  [mid("flap-fat")]: { summary: "Subcutâneo que fica nos retalhos da mastectomia, acima do plano de dissecção (fáscia superficial, quando existe)." },
  [mid("specimen")]: {
    summary: `Peça da mastectomia total: ${specimenText}.`,
    surgical: ["Exérese de medial para lateral junto ao músculo, com a cauda axilar", "Ligadura das perfurantes da torácica interna (2º a 4º espaços) e dos ramos da torácica lateral"],
  },
  [mid("specimen-skin")]: { summary: `Pele da elipse (${cm(mm.ellipseLengthMm ?? 0)} × ${cm(mm.ellipseHeightMm ?? 0)} cm) com o complexo areolopapilar: sai em bloco com a mama.` },
  [mid("scar")]: { summary: `Cicatriz transversa da mastectomia sem reconstrução: ${cm(mm.scarMm ?? 0)} cm, um pouco além das pontas da elipse para não deixar orelhas.` },
  [lid("muscle")]: {
    summary: `Retalho do grande dorsal: ${lm.takenPct ?? 0}% do músculo (${lm.muscleAreaCm2 ?? 0} cm², ≈ ${ml(lm.muscleMl ?? 0)}), preso só pelo tendão e pelo pedículo toracodorsal. Na frente, cobre o implante e é suturado ao sulco, à borda esternal e ao peitoral maior.`,
    vascularization: "Artéria e veias toracodorsais (tipo V de Mathes–Nahai)",
    surgical: [`Gira ${lm.rotationDeg ?? 0}° em volta da axila ao passar pelo túnel`, "A parte lombar, aponeurótica, fica no dorso"],
  },
  [lid("remnant")]: { summary: "Parte do grande dorsal que fica no dorso: a lombar, presa à fáscia toracolombar e à crista ilíaca." },
  [lid("island")]: {
    summary: `Ilha do dorso: fuso transverso de ${island} na linha do sutiã, o tamanho do defeito da mastectomia sobre a pele. Pele, derme e gordura presas ao músculo: no retalho miocutâneo a ilha vale tanto quanto o músculo, porque repõe a pele que a mastectomia tirou.`,
    surgical: [
      "Nutrida pelas perfurantes musculocutâneas que entram pela sua parte central: não se descola a ilha do músculo, só as pontas, para girá-la",
      `Leva ${cm(lm.islandFatMm ?? 0)} cm de gordura do dorso nesta paciente`,
      `Chega à mama inclinada ${lm.islandTiltDeg ?? 0}° e gira ${lm.islandTurnDeg ?? 0}° sobre o músculo para deitar no defeito`,
    ],
  },
  [lid("island-fat")]: { summary: "Gordura sob a ilha cutânea, entre a derme e o músculo: na mama, faz parte do volume." },
  [lid("perforators")]: {
    summary: "Perfurantes musculocutâneas (esquema): ramos da toracodorsal que atravessam o músculo até o plexo da derme da ilha. São o que faz do retalho um retalho miocutâneo.",
    surgical: ["Ficam na parte central da ilha: por isso o centro não é descolado do músculo", "Tração, torção ou compressão no túnel comprometem a ilha mesmo com o músculo vivo"],
  },
  [lid("implant")]: { summary: `Implante: ${ml(lm.implantMl ?? 0)} no modelo, o volume que o retalho não enche no envelope da mama. Fica sobre o peitoral maior, sob o grande dorsal.` },
  [lid("artery")]: {
    summary: `Artéria toracodorsal: ramo terminal da subescapular, depois da circunflexa da escápula. Do hilo para baixo, ramos descendente e transverso (traçado esquemático). Pedículo livre de ${cm(lm.pedicleMm ?? 0)} cm.`,
    surgical: ["Hilo ~8–10 cm abaixo da axilar, 2–3 cm dentro da borda anterior", `No modelo, a distância da origem ao hilo nunca passa do comprimento livre (razão máxima ${(lm.maxStretch ?? 1).toLocaleString("pt-BR")})`],
  },
  [lid("vein")]: { summary: "Veias toracodorsais (em geral duas comitantes), que drenam para a subescapular e a axilar." },
  [lid("nerve")]: { summary: "Nervo toracodorsal (C6–C8, fascículo posterior), com os vasos." },
  [lid("nerve-cut")]: { summary: "Nervo toracodorsal seccionado: reduz a contração do retalho sobre o implante. Preservá-lo mantém o volume do músculo; não há consenso." },
  [lid("serratus-cut")]: { summary: "Ramo do serrátil ligado. Ele permite fluxo retrógrado se a toracodorsal for ligada acima dele." },
  [lid("back-skin")]: { summary: "Pele do dorso: descolada acima da fáscia do grande dorsal e fechada sobre drenos, com pontos de adesão contra o seroma." },
  [lid("scar")]: { summary: `Cicatriz do dorso: ${cm(lm.backScarMm ?? 0)} cm, oblíqua, ao longo do eixo da ilha.` },
  [tid("zone-1")]: { summary: `Zona I de Hartrampf: sobre o reto do pedículo, a mais bem irrigada (${zoneMl("zone-1")} no modelo).` },
  [tid("zone-2")]: { summary: `Zona II: sobre o reto oposto, além da linha média (${zoneMl("zone-2")}). Scheflan e Dinner a trocam com a III.` },
  [tid("zone-3")]: { summary: "Zona III: lateral ao reto do pedículo. Aqui fica a parte que se aproveita; a ponta é aparada." },
  [tid("zone-3-tip")]: { summary: "Ponta da zona III: aparada na inserção." },
  [tid("zone-4")]: { summary: `Zona IV: lateral ao reto oposto, a pior irrigada; descartada (${zoneMl("zone-4")}).` },
  [tid("island")]: { summary: `Ilha cutânea do abdome: ${tramIsland}, a pele que repõe a do defeito. O resto do retalho é desepitelizado e fica sob a pele da mastectomia.` },
  [tid("flap-skin")]: { summary: "Pele do retalho fora da ilha: desepitelizada na inserção, fica como derme sob os retalhos da mastectomia." },
  [tid("rectus")]: {
    summary: `Reto do abdome do pedículo: leva o retalho por ${cm(tm.carrierMm ?? 0)} cm, do rebordo costal à borda da ilha. Ao girar o retalho 180°, dobra-se sobre si mesmo no rebordo, com meia torção.`,
    origin: "Crista e sínfise púbicas",
    insertion: "5ª a 7ª cartilagens costais e processo xifoide",
    vascularization: "Epigástricas superior e inferior profunda (tipo III de Mathes–Nahai)",
    innervation: "Nervos segmentares T7 a T12, seccionados na elevação",
  },
  [tid("superior-epigastric")]: { summary: "Vasos epigástricos superiores: continuação da torácica interna, entram no reto atrás da 7ª cartilagem. São o pedículo do TRAM pediculado." },
  [tid("inferior-epigastric")]: { summary: "Vasos epigástricos inferiores profundos no retalho: ligados abaixo da ilha. Dominantes para a pele do abdome inferior (base do TRAM livre e do DIEP)." },
  [tid("inferior-epigastric-stays")]: { summary: "Vasos epigástricos inferiores profundos ligados: o trecho que fica, da ilíaca externa à ligadura." },
  [tid("perforators")]: { summary: "Perfurantes periumbilicais (esquemáticas): fileiras medial e lateral que atravessam o reto e a bainha até a pele." },
  [tid("sheath")]: { summary: "Bainha anterior do reto: aberta para tirar o músculo e fechada no fim (ou reforçada com tela). Abaixo da linha arqueada o reparo é obrigatório." },
  [tid("sheath-strip")]: { summary: "Faixa da bainha anterior em volta das perfurantes: vai com o músculo e o retalho." },
  [tid("posterior-sheath")]: {
    summary: "Bainha posterior do reto, formada pela lâmina posterior da aponeurose do oblíquo interno e pela do transverso: é o leito que fica quando o músculo é levantado, acima da linha arqueada.",
  },
  [tid("transversalis")]: {
    summary: "Abaixo da linha arqueada as aponeuroses passam todas para a frente do reto: atrás dele fica só a fáscia transversal. Sem o músculo, é o ponto fraco da parede, onde aparecem o abaulamento e a hérnia.",
    surgical: ["Fechamento da bainha anterior sem tensão; tela quando a bainha não fecha ou o tecido é fraco"],
  },
  [tid("abdomen-skin")]: { summary: `Pele do abdome: o retalho superior é descolado até o rebordo costal e avança ${cm(tm.advancementMm ?? 0)} cm até a incisão suprapúbica, como numa abdominoplastia.` },
  [tid("scar")]: { summary: "Cicatrizes do abdome: suprapúbica, de uma espinha ilíaca à outra, e em volta do umbigo." },
};
