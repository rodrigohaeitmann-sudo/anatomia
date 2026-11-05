/**
 * Fichas das porções musculares selecionáveis (partes já separadas nas malhas do BodyParts3D e
 * regiões calculadas por costela de origem). Lado descrito: o do modelo (direito).
 * Conteúdo didático de anatomia descritiva clássica; revisar antes de uso formal.
 */
import type { AnatomyDetail } from "@/data/anatomyDetails";

export const partDetails: Record<string, AnatomyDetail> = {
  "pectoralis-major#clavicular": {
    summary: "Porção superior do peitoral maior. Separa-se da parte esternocostal por um interstício e margeia o sulco deltopeitoral.",
    origin: "Metade medial da face anterior da clavícula.",
    insertion: "Lábio lateral do sulco intertubercular. Suas fibras inserem-se na parte mais distal e superficial do tendão.",
    innervation: "Nervo peitoral lateral (C5–C7).",
    action: "Flexão do braço; adução e rotação medial.",
    landmarks: ["Borda superolateral no sulco deltopeitoral, com a veia cefálica", "Interstício com a parte esternocostal, útil para dissecção romba"],
  },
  "pectoralis-major#sternocostal": {
    summary: "Maior porção do peitoral maior, da face anterior do esterno e das cartilagens costais superiores.",
    origin: "Face anterior do esterno e cartilagens costais 1–6 (número variável).",
    insertion: "Lábio lateral do sulco intertubercular. As fibras inferiores torcem-se e inserem-se mais proximal e profundamente.",
    innervation: "Nervos peitorais lateral e medial.",
    action: "Adução e rotação medial; extensão do braço fletido.",
    surgical: ["Na loja subpeitoral, a liberação da origem costal inferior amplia o espaço; a origem esternal costuma ser preservada para evitar deformidade medial"],
  },
  "pectoralis-major#abdominal": {
    summary: "Porção inferior e mais delgada do peitoral maior, a partir da aponeurose do oblíquo externo.",
    origin: "Aponeurose do oblíquo externo (bainha anterior do reto).",
    insertion: "Parte proximal e profunda do tendão, no lábio lateral do sulco intertubercular.",
    innervation: "Nervo peitoral medial (C8–T1).",
    action: "Adução e rotação medial; abaixa o ombro.",
    landmarks: ["Sua borda livre inferolateral forma a prega axilar anterior"],
  },
  "deltoid#clavicular": { summary: "Parte anterior do deltoide.", origin: "Terço lateral da clavícula.", insertion: "Tuberosidade deltóidea do úmero.", innervation: "Nervo axilar (C5–C6).", action: "Flexão e rotação medial do braço." },
  "deltoid#acromial": { summary: "Parte média, multipenada, do deltoide.", origin: "Margem lateral do acrômio.", insertion: "Tuberosidade deltóidea do úmero.", innervation: "Nervo axilar (C5–C6).", action: "Abdução do braço (após os primeiros graus, iniciados pelo supraespinal)." },
  "deltoid#spinal": { summary: "Parte posterior do deltoide.", origin: "Lábio inferior da espinha da escápula.", insertion: "Tuberosidade deltóidea do úmero.", innervation: "Nervo axilar (C5–C6).", action: "Extensão e rotação lateral do braço." },
  "trapezius#descending": { summary: "Fibras superiores do trapézio.", origin: "Protuberância occipital externa, linha nucal superior e ligamento nucal.", insertion: "Terço lateral da clavícula.", innervation: "Nervo acessório (XI); fibras proprioceptivas de C3–C4.", action: "Eleva a escápula." },
  "trapezius#transverse": { summary: "Fibras médias do trapézio.", origin: "Processos espinhosos de C7–T3.", insertion: "Acrômio e espinha da escápula.", innervation: "Nervo acessório (XI).", action: "Retrai a escápula." },
  "trapezius#ascending": { summary: "Fibras inferiores do trapézio.", origin: "Processos espinhosos de T4–T12.", insertion: "Tubérculo na raiz da espinha da escápula.", innervation: "Nervo acessório (XI).", action: "Abaixa a escápula e participa da sua rotação superior.", landmarks: ["Sua borda inferolateral limita o triângulo de ausculta com o grande dorsal"] },
  "triceps#long": { summary: "Cabeça longa do tríceps, a única que cruza o ombro.", origin: "Tubérculo infraglenoidal da escápula.", insertion: "Olécrano da ulna.", innervation: "Nervo radial (C6–C8).", action: "Extensão do cotovelo; auxilia extensão e adução do braço.", landmarks: ["Passa entre os redondos maior e menor, separando os espaços triangular (medial) e quadrangular (lateral)"] },
  "triceps#lateral": { summary: "Cabeça lateral do tríceps.", origin: "Face posterior do úmero, acima do sulco do nervo radial.", insertion: "Olécrano da ulna.", innervation: "Nervo radial (C6–C8).", action: "Extensão do cotovelo." },
  "triceps#medial": { summary: "Cabeça medial (profunda) do tríceps.", origin: "Face posterior do úmero, abaixo do sulco do nervo radial.", insertion: "Olécrano da ulna.", innervation: "Nervo radial (C6–C8).", action: "Extensão do cotovelo." },
  "coracobrachialis-biceps#coracobrachialis": { summary: "Músculo do compartimento anterior do braço, do coracoide ao terço médio do úmero.", origin: "Ápice do processo coracoide (com a cabeça curta do bíceps).", insertion: "Face medial do terço médio do úmero.", innervation: "Nervo musculocutâneo (C5–C7), que o perfura.", action: "Flexão e adução do braço.", landmarks: ["O nervo musculocutâneo perfura o músculo: referência na dissecção do plexo braquial"] },
  "coracobrachialis-biceps#biceps-short": { summary: "Cabeça curta do bíceps braquial.", origin: "Ápice do processo coracoide.", insertion: "Tuberosidade do rádio e aponeurose bicipital.", innervation: "Nervo musculocutâneo (C5–C6).", action: "Flexão do cotovelo e supinação; auxilia a flexão do braço." },
  "coracobrachialis-biceps#biceps-long": { summary: "Cabeça longa do bíceps braquial; o tendão percorre o sulco intertubercular.", origin: "Tubérculo supraglenoidal da escápula.", insertion: "Tuberosidade do rádio e aponeurose bicipital.", innervation: "Nervo musculocutâneo (C5–C6).", action: "Flexão do cotovelo e supinação; estabiliza a cabeça do úmero." },
  "rhomboids#major": { summary: "Romboide maior.", origin: "Processos espinhosos de T2–T5.", insertion: "Margem medial da escápula, da raiz da espinha ao ângulo inferior.", innervation: "Nervo dorsal da escápula (C4–C5).", action: "Retrai e roda inferiormente a escápula." },
  "rhomboids#minor": { summary: "Romboide menor.", origin: "Ligamento nucal e processos espinhosos de C7–T1.", insertion: "Margem medial da escápula, na raiz da espinha.", innervation: "Nervo dorsal da escápula (C4–C5).", action: "Retrai a escápula." },
  "serratus-posterior#superior": { summary: "Serrátil posterior superior.", origin: "Processos espinhosos de C7–T3.", insertion: "Costelas 2–5, lateralmente aos ângulos.", innervation: "Nervos intercostais.", action: "Músculo respiratório acessório." },
  "serratus-posterior#inferior": { summary: "Serrátil posterior inferior.", origin: "Processos espinhosos de T11–L2.", insertion: "Costelas 9–12.", innervation: "Nervos intercostais e subcostal.", action: "Músculo respiratório acessório." },
};

/** Details for computed regions (serratus digitation, pectoralis minor slip) built from the parent's. */
export function regionDetail(partId: string, label: string): AnatomyDetail | undefined {
  const rib = Number(partId.split("#rib-")[1]);
  if (partId.startsWith("serratus-anterior#")) {
    return {
      summary: `${label}. As digitações superiores inserem-se ao longo da margem medial da escápula; as inferiores convergem para o ângulo inferior.`,
      origin: rib === 1 ? "Faces externas da 1ª e 2ª costelas (na fonte Z-Anatomy não há área separada na 2ª)." : `Face externa da ${rib}ª costela.`,
      insertion: "Face costal da margem medial da escápula.",
      innervation: "Nervo torácico longo (C5–C7), que desce sobre a sua face superficial.",
      landmarks: ["As digitações inferiores interdigitam-se com as do oblíquo externo"],
    };
  }
  if (partId.startsWith("pectoralis-minor#")) {
    return {
      summary: `${label}. Os três fascículos convergem para o processo coracoide.`,
      origin: `Face anterior da ${rib}ª costela, próximo à cartilagem.`,
      insertion: "Borda medial e face superior do processo coracoide.",
      innervation: "Nervo peitoral medial (C8–T1).",
    };
  }
  return undefined;
}
