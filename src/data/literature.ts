/**
 * Literatura citada nas fichas ("Modelo × literatura" e "Variações") e nas zonas de perfurantes.
 *
 * Os números vêm dos resumos ou de fontes secundárias indicadas em `evidence`; não foram conferidos
 * no texto completo. As medidas "do modelo" são calculadas em scripts/hybrid/build_anatomy_layers.py
 * e gravadas em src/data/anatomyLayers.json (measurements).
 */
import layers from "@/data/anatomyLayers.json";

export type Reference = {
  id: string;
  /** short citation shown in cards */
  label: string;
  detail: string;
  url: string;
  evidence: "resumo" | "fonte secundária" | "método" | "fonte de dados";
};

export const references: Record<string, Reference> = {
  "licap-2008": {
    id: "licap-2008",
    label: "Plast Reconstr Surg, 2008 (24 cadáveres)",
    detail: "Estudo cadavérico das perfurantes intercostais laterais do 3º ao 8º espaço, entre o grande dorsal e o peitoral maior.",
    url: "https://pubmed.ncbi.nlm.nih.gov/18300954/",
    evidence: "resumo",
  },
  "tdap-2010": {
    id: "tdap-2010",
    label: "Schaverien et al., 2010 (injeção, 15 retalhos)",
    detail: "Localização constante das perfurantes da pá cutânea dos retalhos TDAP e grande dorsal miocutâneo.",
    url: "https://mdanderson.elsevierpure.com/en/publications/thoracodorsal-artery-perforator-flap-and-latissimus-dorsi-myocuta",
    evidence: "resumo",
  },
  "imap-2017": {
    id: "imap-2017",
    label: "Indian J Plast Surg, 2017 (angiotomografia, 10 mulheres)",
    detail: "Perfurantes da artéria torácica interna em angiotomografia e série retrospectiva.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5469236/",
    evidence: "resumo",
  },
  "pm-footprint-2013": {
    id: "pm-footprint-2013",
    label: "Rev Bras Ortop, 2013 (20 ombros)",
    detail: "Footprint do peitoral maior no úmero.",
    url: "https://www.scielo.br/j/rbort/a/CZTcZtwrTRxtxtctszM9YWv/?lang=en",
    evidence: "resumo",
  },
  "pm-footprint-2018": {
    id: "pm-footprint-2018",
    label: "JSOA, 2018 (12 ombros)",
    detail: "Anatomia da inserção do tendão do peitoral maior e nova referência anatômica.",
    url: "https://www.jsoaonline.com/archive/2018/pectoralis-major-tendon-insertion-anatomy-description-novel-anatomic-reference/",
    evidence: "resumo",
  },
  "ld-hilum-1981": {
    id: "ld-hilum-1981",
    label: "Tobin et al. 1981 (60 cadáveres); Bartlett et al. 1981 (50 cadáveres)",
    detail: "Anatomia neurovascular intramuscular do grande dorsal. Valores citados em revisão de tese (Chulalongkorn).",
    url: "https://cuir.car.chula.ac.th/bitstream/123456789/67535/3/Samang_wa_ch2_p.pdf",
    evidence: "fonte secundária",
  },
  "td-nerve-2018": {
    id: "td-nerve-2018",
    label: "Egypt J Anat, 2018 (16 músculos)",
    detail: "Padrão de ramificação do nervo toracodorsal.",
    url: "https://doi.org/10.21608/ejana.2018.43502",
    evidence: "resumo",
  },
  "td-nerve-2022": {
    id: "td-nerve-2022",
    label: "Kazan Med J, 2022 (121 preparações)",
    detail: "Variantes de ramificação extra e intramuscular do nervo toracodorsal.",
    url: "https://kazanmedjournal.ru/kazanmedj/article/view/100474",
    evidence: "resumo",
  },
  "axillary-arch-2018": {
    id: "axillary-arch-2018",
    label: "The Surgeon, 2018 (meta-análise, 29 estudos)",
    detail: "Prevalência e anatomia do arco axilar (de Langer).",
    url: "https://pubmed.ncbi.nlm.nih.gov/29801707/",
    evidence: "resumo",
  },
  "icbn-2017": {
    id: "icbn-2017",
    label: "Cureus, 2017 (meta-análise, 16 estudos)",
    detail: "Origem, ramificação e comunicações do nervo intercostobraquial.",
    url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5393909/",
    evidence: "resumo",
  },
  "icbn-2024": {
    id: "icbn-2024",
    label: "World J Surg Oncol, 2024 (meta-análise, 23 estudos)",
    detail: "Prevalência do nervo intercostobraquial em estudos cadavéricos e intraoperatórios.",
    url: "https://link.springer.com/article/10.1186/s12957-024-03374-w",
    evidence: "resumo",
  },
  "sternalis-2021": {
    id: "sternalis-2021",
    label: "Anat Sci Int, 2021 (meta-análise, 98 estudos)",
    detail: "Prevalência do músculo esternal por método de detecção.",
    url: "https://link.springer.com/10.1007/s12565-021-00632-9",
    evidence: "resumo",
  },
  "choi-blemker-2013": {
    id: "choi-blemker-2013",
    label: "Choi & Blemker, PLoS ONE 2013",
    detail: "Arranjo dos fascículos reconstruído por campo vetorial laplaciano entre as áreas de fixação. Método usado para as fibras.",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3808403/",
    evidence: "método",
  },
  "wuringer-1998": {
    id: "wuringer-1998",
    label: "Würinger et al., Plast Reconstr Surg 1998",
    detail: "Septo fibroso horizontal da fáscia peitoral (5ª costela) ao mamilo, entre uma camada vascular cranial (toracoacromial e ramo da torácica lateral) e uma caudal (perfurantes intercostais); guia o principal nervo do mamilo e continua nos ligamentos verticais medial e lateral.",
    url: "https://pubmed.ncbi.nlm.nih.gov/?term=Nerve+and+vessel+supplying+ligamentous+suspension+of+the+mammary+gland",
    evidence: "resumo",
  },
  "schlenz-2000": {
    id: "schlenz-2000",
    label: "Schlenz et al., Plast Reconstr Surg 2000 (28 cadáveres)",
    detail: "Inervação do complexo areolopapilar pelos ramos cutâneos laterais e anteriores do 3º, 4º e 5º nervos intercostais; trajeto do ramo lateral.",
    url: "https://pubmed.ncbi.nlm.nih.gov/10724249/",
    evidence: "resumo",
  },
  "van-deventer-2004": {
    id: "van-deventer-2004",
    label: "van Deventer, Aesthetic Plast Surg 2004 (27 mamas)",
    detail: "Fontes arteriais do complexo areolopapilar após injeção de látex em 15 cadáveres.",
    url: "https://pubmed.ncbi.nlm.nih.gov/15633023/",
    evidence: "resumo",
  },
  "odey-2007": {
    id: "odey-2007",
    label: "O'Dey et al., Plast Reconstr Surg 2007 (14 mamas)",
    detail: "Microdissecção das fontes arteriais do complexo areolopapilar e confiabilidade vascular dos pedículos.",
    url: "https://pubmed.ncbi.nlm.nih.gov/17496587/",
    evidence: "resumo",
  },
  "bayati-1995": {
    id: "bayati-1995",
    label: "Bayati & Seckel, Plast Reconstr Surg 1995 (13 dissecções)",
    detail: "Ligamento do sulco inframamário: do periósteo da 5ª costela e da fáscia entre a 5ª e a 6ª costelas à derme profunda do sulco.",
    url: "https://pubmed.ncbi.nlm.nih.gov/?term=Bayati+Seckel+Inframammary+crease+ligament",
    evidence: "resumo",
  },
  "z-anatomy": {
    id: "z-anatomy",
    label: "Z-Anatomy (CC BY-SA 4.0)",
    detail: "Marcos ósseos e áreas de fixação muscular transferidos para os ossos do modelo.",
    url: "https://github.com/LluisV/Z-Anatomy",
    evidence: "fonte de dados",
  },
};

export type Measurements = typeof layers.measurements;
const m = layers.measurements as Measurements & Record<string, unknown>;

export type Comparison = { label: string; model: string | null; literature: string; refs: string[]; note?: string };
export type Variation = { label: string; text: string; refs: string[] };

const mmText = (value: number | undefined | null) => (typeof value === "number" ? `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mm` : null);

/** Model × literature comparisons and anatomical variations, per structure id. */
export const literatureByStructure: Record<string, { comparisons?: Comparison[]; variations?: Variation[] }> = {
  "internal-thoracic-perforators": {
    variations: [
      { label: "Constância", text: "Em 27 de 27 mamas dissecadas, o complexo areolopapilar recebia ao menos um ramo da torácica interna: é a fonte considerada constante.", refs: ["van-deventer-2004"] },
      { label: "Ordem das fontes", text: "Em outra série, as fontes do complexo areolopapilar foram, em ordem decrescente de regularidade: torácica lateral, torácica interna, ramos intercostais anteriores e torácica superior.", refs: ["odey-2007"] },
    ],
  },
  "lateral-mammary-branches": {
    variations: [
      { label: "Constância", text: "Ramos da torácica lateral chegavam ao complexo areolopapilar em 19 de 27 mamas; em 2 de 27 havia ramos diretos da artéria axilar.", refs: ["van-deventer-2004"] },
      { label: "Pedículos", text: "Em microdissecção de 14 mamas, os acessos lateral e medial mostraram vantagem vascular sobre os pedículos inferior e superior.", refs: ["odey-2007"] },
    ],
  },
  "intercostal-perforators": {
    variations: [
      { label: "Camada caudal do septo", text: "As perfurantes das artérias intercostais formam a camada vascular caudal do septo horizontal; a camada cranial vem da toracoacromial e de um ramo da torácica lateral.", refs: ["wuringer-1998"] },
      { label: "Contribuição ao complexo areolopapilar", text: "Ramos intercostais anteriores foram a terceira fonte em regularidade em uma série; em outra, as intercostais posteriores chegavam ao complexo em apenas 1 de 27 mamas.", refs: ["odey-2007", "van-deventer-2004"] },
    ],
  },
  "thoracoacromial-mammary-branch": {
    variations: [{ label: "Camada cranial do septo", text: "A camada vascular cranial do septo horizontal recebe sangue da artéria toracoacromial e de um ramo da torácica lateral.", refs: ["wuringer-1998"] }],
  },
  "horizontal-septum": {
    variations: [
      { label: "Descrição original", text: "Septo fibroso horizontal que nasce da fáscia peitoral na altura da 5ª costela e vai até o mamilo, entre duas camadas vasculares. Suas bordas continuam em ligamentos verticais medial e lateral: o conjunto foi comparado a uma tipoia, como um sutiã.", refs: ["wuringer-1998"] },
    ],
  },
  "septum-ligaments": {
    variations: [{ label: "Descrição original", text: "As bordas do septo horizontal continuam em ligamentos verticais medial e lateral, que levam vasos e nervos próprios.", refs: ["wuringer-1998"] }],
  },
  "inframammary-ligament": {
    variations: [
      { label: "Descrição original", text: "Em 13 dissecções em cadáver e uma em paciente, um ligamento ia do periósteo da 5ª costela (medialmente) e da fáscia entre a 5ª e a 6ª costelas (lateralmente) à derme profunda do sulco.", refs: ["bayati-1995"] },
      { label: "Controvérsia", text: "Estudos posteriores não encontraram um ligamento verdadeiro e descrevem o sulco como uma condensação das fáscias ou uma zona de aderência da derme. Trate esta estrutura como uma das descrições possíveis.", refs: ["bayati-1995"] },
    ],
  },
  "fourth-intercostal-lateral-branch": {
    variations: [
      { label: "Trajeto", text: "Em 93% das mamas, os ramos cutâneos laterais seguiam profundamente, na fáscia peitoral, e chegavam ao mamilo por sua face posterior; em 7%, seguiam superficialmente no subcutâneo e chegavam pelo lado lateral.", refs: ["schlenz-2000"] },
      { label: "Fontes", text: "O mamilo e a aréola eram sempre inervados por ramos cutâneos laterais e anteriores do 3º, 4º e 5º nervos intercostais. O septo horizontal guia o principal nervo do mamilo.", refs: ["schlenz-2000", "wuringer-1998"] },
    ],
  },
  "lateral-cutaneous-branches": {
    variations: [{ label: "Fontes", text: "Os ramos cutâneos laterais do 3º, 4º e 5º nervos intercostais participam da inervação do complexo areolopapilar.", refs: ["schlenz-2000"] }],
  },
  "anterior-cutaneous-branches": {
    variations: [{ label: "Fontes", text: "Os ramos cutâneos anteriores do 3º, 4º e 5º nervos intercostais participam da inervação do complexo areolopapilar, pelo lado medial.", refs: ["schlenz-2000"] }],
  },
  "pectoralis-major": {
    comparisons: [
      {
        label: "Topo da cabeça do úmero → borda superior da inserção",
        model: mmText(m.pecMajorInsertion?.fromHeadTopMm),
        literature: "59,3 mm (55–64)",
        refs: ["pm-footprint-2013"],
      },
      {
        label: "Comprimento da inserção (footprint)",
        model: mmText(m.pecMajorInsertion?.lengthMm),
        literature: "73,3 ± 10,0 mm; largura 3,3 mm",
        refs: ["pm-footprint-2018"],
        note: "O modelo encurta a inserção: use-o para a posição relativa, não para o comprimento.",
      },
    ],
    variations: [
      { label: "Lâminas do tendão", text: "A descrição clássica é bilaminar, em U. Uma série brasileira (20 ombros) descreveu inserção laminar única, e um estudo com RM, ultrassom e histologia também encontrou entese unilaminar.", refs: ["pm-footprint-2013"] },
      { label: "Músculo esternal", text: "Prevalência de 5,96% em cadáveres e 4,33% em tomografia, mas só 0,47% descrito em cirurgia e 0,02% em mamografia. Pode simular nódulo e altera o plano pré-peitoral medial.", refs: ["sternalis-2021"] },
    ],
  },
  "latissimus-dorsi": {
    comparisons: [
      {
        label: "Hilo → borda lateral (livre) do músculo",
        model: mmText((m.ldHilum as { toBorderMm?: number } | undefined)?.toBorderMm),
        literature: "26 mm (10–40) · Bartlett: 21 mm",
        refs: ["ld-hilum-1981"],
        note: "No modelo, medido em linha reta até a borda livre calculada.",
      },
      {
        label: "Hilo → origem da artéria subescapular",
        model: mmText((m.ldHilum as { toSubscapularOriginMm?: number } | undefined)?.toSubscapularOriginMm),
        literature: "87 mm (60–115)",
        refs: ["ld-hilum-1981"],
        note: "No modelo, distância em linha reta; na literatura, ao longo do pedículo (por isso tende a ser maior).",
      },
    ],
    variations: [
      { label: "Arco axilar (de Langer)", text: "Feixe muscular ou tendíneo do grande dorsal que cruza a axila: 5,3% das axilas (61,6% unilaterais). Pode ser confundido com a borda do grande dorsal e encobrir a veia axilar.", refs: ["axillary-arch-2018"] },
    ],
  },
  "thoracodorsal-nerve": {
    variations: [
      { label: "Ramificação", text: "Divisão distal em 3 ramos em 75%, 2 ramos em ~23% e um único ramo em 1 caso (16 músculos). Outra série descreve 13 variantes extramusculares. A divisão antes de entrar no músculo é relevante para a denervação seletiva.", refs: ["td-nerve-2018", "td-nerve-2022"] },
    ],
  },
  "thoracodorsal-vessels": {
    comparisons: [
      {
        label: "Hilo → borda lateral do grande dorsal",
        model: mmText((m.ldHilum as { toBorderMm?: number } | undefined)?.toBorderMm),
        literature: "26 mm (10–40)",
        refs: ["ld-hilum-1981"],
      },
    ],
  },
  "intercostobrachial-nerve": {
    variations: [
      { label: "Presença e origem", text: "Presente em 98,4% das axilas (16 estudos, 1.567 axilas); origem em T2 em 90,6%. Tronco único em 47,0% e bifurcado em 42,2%. Meta-análise de 2024: presente em 98,94% (23 estudos).", refs: ["icbn-2017", "icbn-2024"] },
    ],
  },
  "intercostal-vessels": {
    variations: [
      { label: "Perfurantes laterais (LICAP)", text: "Média de 3,91 perfurantes por lado, do 3º ao 8º espaço intercostal, a 2,67–3,49 cm da borda anterior do grande dorsal. A maior perfurante fica no 6º espaço em 38,6%, a 2,5–3,5 cm da borda. Veja a zona na aba Estudo.", refs: ["licap-2008"] },
    ],
  },
  "internal-thoracic-vessels": {
    variations: [
      { label: "Perfurantes (IMAP)", text: "A perfurante dominante sai dos 4 primeiros espaços, do 2º em 55%; fica a ~1,8 cm (0,9–2,5) da borda do esterno na superfície do peitoral. Veja a zona na aba Estudo.", refs: ["imap-2017"] },
    ],
  },
};
