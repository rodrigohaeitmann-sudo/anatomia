/**
 * Fichas anatômicas exibidas ao selecionar uma estrutura no modelo.
 * Conteúdo didático de referência (anatomia descritiva e cirúrgica clássica); deve ser revisado
 * por especialistas antes de uso formal. Lado descrito: o do modelo (direito).
 */
export type AnatomyDetail = {
  summary: string;
  origin?: string;
  insertion?: string;
  course?: string;
  innervation?: string;
  vascularization?: string;
  action?: string;
  branches?: string;
  drainage?: string;
  landmarks?: string[];
  surgical?: string[];
};

export const anatomyDetails: Record<string, AnatomyDetail> = {
  "latissimus-dorsi": {
    summary: "Músculo largo e plano do dorso, em leque, que converge da região toracolombar para o sulco intertubercular do úmero. Unidade doadora do retalho do grande dorsal.",
    origin: "Processos espinhosos de T7–T12 e vértebras lombares/sacrais via fáscia toracolombar, terço posterior da crista ilíaca, 3–4 últimas costelas e, frequentemente, o ângulo inferior da escápula.",
    insertion: "Assoalho do sulco intertubercular do úmero, por tendão achatado que se enrola em torno do redondo maior.",
    innervation: "Nervo toracodorsal (C6–C8), ramo do fascículo posterior do plexo braquial.",
    vascularization: "Dominante: artéria toracodorsal (ramo terminal da subescapular), que se divide no hilo em ramos lateral (descendente) e medial (transverso). Secundárias: perfurantes das intercostais posteriores e lombares (base de retalhos em turbina reversa). Classificação de Mathes-Nahai tipo V.",
    action: "Extensão, adução e rotação medial do úmero; auxilia a expiração forçada e a elevação do tronco (escalada).",
    landmarks: ["Borda anterior livre: forma a prega axilar posterior", "Borda superior cruza o ângulo inferior da escápula", "Triângulo de ausculta entre a borda superior do GD, o trapézio e a borda medial da escápula", "Triângulo lombar (Petit) entre o GD, o oblíquo externo e a crista ilíaca"],
    surgical: ["Hilo do pedículo na face profunda, ~8–10 cm do ápice axilar, 2–3 cm medial à borda anterior", "Ramo do serrátil anterior sai da toracodorsal: permite perfusão retrógrada se o tronco for ligado", "Preservar o nervo toracodorsal evita atrofia, mas pode causar contrações (animação) no retalho", "Seroma na área doadora é a complicação mais comum; pontos de adesão (quilting) reduzem incidência"],
  },
  "serratus-anterior": {
    summary: "Músculo da parede lateral do tórax, com digitações que se interdigitam com o oblíquo externo; parede medial da axila.",
    origin: "Faces externas das 8–9 primeiras costelas, por digitações.",
    insertion: "Face costal da borda medial da escápula, do ângulo superior ao inferior (maior concentração no ângulo inferior).",
    innervation: "Nervo torácico longo (C5–C7), que desce na sua face superficial, na linha axilar média.",
    vascularization: "Artéria torácica lateral e ramo do serrátil da artéria toracodorsal; superiormente, ramos da toracoacromial e supraescapular.",
    action: "Protração da escápula e rotação superior (abdução acima de 90°); mantém a escápula aplicada ao tórax.",
    landmarks: ["Digitações inferiores visíveis entre o GD e o oblíquo externo", "Forma a parede medial da axila"],
    surgical: ["Lesão do nervo torácico longo causa escápula alada", "Plano de descolamento do GD passa superficialmente a ele; cuidado com o ramo do serrátil ao isolar o pedículo"],
  },
  "pectoralis-major": {
    summary: "Músculo em leque da parede anterior do tórax, com partes clavicular, esternocostal e abdominal; forma a parede anterior da axila e a prega axilar anterior.",
    origin: "Parte clavicular: metade medial da clavícula. Parte esternocostal: esterno e cartilagens costais 1–6. Parte abdominal: aponeurose do oblíquo externo.",
    insertion: "Crista do tubérculo maior (lábio lateral do sulco intertubercular) do úmero, com tendão bilaminar em U.",
    innervation: "Nervos peitorais lateral (C5–C7; parte clavicular) e medial (C8–T1; parte esternocostal inferior).",
    vascularization: "Ramo peitoral da artéria toracoacromial (dominante), perfurantes da torácica interna (segmentares), torácica lateral e intercostais anteriores. Mathes-Nahai tipo V.",
    action: "Adução, rotação medial e flexão do úmero (parte clavicular).",
    landmarks: ["Sulco deltopeitoral com a veia cefálica", "Borda inferolateral forma a prega axilar anterior", "Origem inferior define o sulco inframamário medial"],
    surgical: ["Plano pré-peitoral: entre a fáscia peitoral e a glândula", "Plano subpeitoral: entre peitoral maior e menor/parede costal", "Preservar os nervos peitorais evita atrofia do músculo em cirurgias axilares"],
  },
  "pectoralis-minor": {
    summary: "Músculo triangular profundo ao peitoral maior; referência para os níveis axilares de Berg.",
    origin: "Faces anteriores das costelas 3–5, próximo às cartilagens.",
    insertion: "Processo coracoide da escápula (borda medial e face superior).",
    innervation: "Nervo peitoral medial (C8–T1), que o perfura; às vezes também o lateral.",
    vascularization: "Ramo peitoral da toracoacromial e artéria torácica lateral.",
    action: "Abaixa e protrai a escápula; eleva as costelas na inspiração forçada.",
    landmarks: ["Cruza anteriormente a artéria axilar, dividindo-a em três partes", "Nível I: lateral à sua borda lateral; nível II: posterior; nível III: medial à borda medial"],
    surgical: ["Afastado ou seccionado para acessar o nível III", "Espaço de Rotter (interpeitoral) entre ele e o peitoral maior"],
  },
  subclavius: {
    summary: "Pequeno músculo entre a clavícula e a primeira costela, envolto pela fáscia clavipeitoral.",
    origin: "Junção da 1ª costela com sua cartilagem.",
    insertion: "Sulco na face inferior do terço médio da clavícula.",
    innervation: "Nervo para o subclávio (C5–C6), do tronco superior.",
    action: "Estabiliza e abaixa a clavícula.",
    landmarks: ["Limite superior da fáscia clavipeitoral", "Referência do ápice da axila (nível III)"],
  },
  trapezius: {
    summary: "Músculo superficial do dorso e pescoço, em partes descendente, transversa e ascendente.",
    origin: "Linha nucal superior, protuberância occipital externa, ligamento nucal e processos espinhosos de C7–T12.",
    insertion: "Terço lateral da clavícula, acrômio e espinha da escápula.",
    innervation: "Nervo acessório (NC XI; motor) e ramos de C3–C4 (proprioceptivos).",
    vascularization: "Artéria cervical transversa (ramo superficial), supraescapular e perfurantes intercostais posteriores.",
    action: "Elevação, retração e rotação superior da escápula; a parte ascendente a abaixa.",
    landmarks: ["Borda inferolateral da parte ascendente recobre a porção superomedial do GD", "Limite medial do triângulo de ausculta"],
    surgical: ["Na colheita do GD, identificar a borda do trapézio e não descolá-lo junto (plano diferente)"],
  },
  rhomboids: {
    summary: "Romboides maior e menor, profundos ao trapézio, entre a coluna e a borda medial da escápula.",
    origin: "Menor: ligamento nucal e processos espinhosos de C7–T1. Maior: processos espinhosos de T2–T5.",
    insertion: "Borda medial da escápula (menor na raiz da espinha; maior abaixo, até o ângulo inferior).",
    innervation: "Nervo dorsal da escápula (C5).",
    vascularization: "Artéria dorsal da escápula.",
    action: "Retração e rotação inferior da escápula.",
    landmarks: ["Assoalho do triângulo de ausculta (romboide maior)"],
  },
  "levator-scapulae": {
    summary: "Músculo do pescoço que eleva a escápula.",
    origin: "Processos transversos de C1–C4.",
    insertion: "Borda medial da escápula, do ângulo superior à raiz da espinha.",
    innervation: "Nervo dorsal da escápula (C5) e ramos de C3–C4.",
    action: "Eleva e roda inferiormente a escápula.",
  },
  "teres-major": {
    summary: "Músculo espesso da borda lateral da escápula; parede posterior da axila e limite inferior dos espaços quadrangular e triangular.",
    origin: "Face posterior do ângulo inferior da escápula.",
    insertion: "Lábio medial do sulco intertubercular do úmero, medial e posterior ao tendão do GD.",
    innervation: "Nervo subescapular inferior (C5–C7).",
    vascularization: "Artéria circunflexa da escápula e ramos da toracodorsal.",
    action: "Adução, extensão e rotação medial do úmero.",
    landmarks: ["O GD envolve sua borda inferior em direção ao úmero", "Limite superior da dissecção do GD"],
    surgical: ["Separar GD do redondo maior na parte superior do retalho; o plano entre eles leva ao pedículo"],
  },
  "teres-minor": {
    summary: "Músculo do manguito rotador na borda lateral da escápula.",
    origin: "Dois terços superiores da borda lateral da escápula (face posterior).",
    insertion: "Faceta inferior do tubérculo maior do úmero.",
    innervation: "Nervo axilar (C5–C6).",
    action: "Rotação lateral do úmero; estabiliza a articulação do ombro.",
    landmarks: ["Limite superior dos espaços quadrangular e triangular"],
  },
  subscapularis: {
    summary: "Músculo do manguito rotador que ocupa a fossa subescapular; parede posterior da axila.",
    origin: "Fossa subescapular.",
    insertion: "Tubérculo menor do úmero.",
    innervation: "Nervos subescapulares superior e inferior (C5–C6).",
    action: "Rotação medial do úmero; estabiliza a cabeça umeral.",
    landmarks: ["Os vasos subescapulares e o nervo toracodorsal descem sobre sua face anterior"],
  },
  infraspinatus: {
    summary: "Músculo do manguito rotador na fossa infraespinal.",
    origin: "Fossa infraespinal da escápula.",
    insertion: "Faceta média do tubérculo maior do úmero.",
    innervation: "Nervo supraescapular (C5–C6).",
    vascularization: "Artérias supraescapular e circunflexa da escápula.",
    action: "Rotação lateral do úmero.",
  },
  supraspinatus: {
    summary: "Músculo do manguito rotador na fossa supraespinal.",
    origin: "Fossa supraespinal da escápula.",
    insertion: "Faceta superior do tubérculo maior do úmero.",
    innervation: "Nervo supraescapular (C5–C6).",
    action: "Inicia a abdução do braço (0–15°).",
  },
  deltoid: {
    summary: "Músculo que forma o contorno do ombro, com partes clavicular, acromial e espinal.",
    origin: "Terço lateral da clavícula, acrômio e espinha da escápula.",
    insertion: "Tuberosidade deltoidea do úmero.",
    innervation: "Nervo axilar (C5–C6), que o penetra pela face profunda após passar pelo espaço quadrangular.",
    vascularization: "Artéria circunflexa posterior do úmero e ramo deltoideo da toracoacromial.",
    action: "Abdução do braço (15–90°); flexão (anterior) e extensão (posterior).",
    landmarks: ["Sulco deltopeitoral com a veia cefálica"],
  },
  "coracobrachialis-biceps": {
    summary: "Coracobraquial e cabeças do bíceps braquial; parede lateral da axila.",
    origin: "Coracobraquial e cabeça curta do bíceps: processo coracoide. Cabeça longa: tubérculo supraglenoidal.",
    insertion: "Coracobraquial: face medial do úmero (terço médio). Bíceps: tuberosidade do rádio e aponeurose bicipital.",
    innervation: "Nervo musculocutâneo (C5–C7), que perfura o coracobraquial.",
    action: "Flexão e adução do braço; o bíceps flexiona o cotovelo e supina o antebraço.",
    landmarks: ["O feixe neurovascular axilar corre medial ao coracobraquial"],
  },
  triceps: {
    summary: "Tríceps braquial; a cabeça longa separa os espaços quadrangular e triangular.",
    origin: "Cabeça longa: tubérculo infraglenoidal. Lateral e medial: face posterior do úmero.",
    insertion: "Olécrano da ulna.",
    innervation: "Nervo radial (C6–C8).",
    action: "Extensão do cotovelo; a cabeça longa auxilia adução do braço.",
  },
  "external-oblique": {
    summary: "Músculo mais superficial da parede anterolateral do abdome.",
    origin: "Faces externas das 8 últimas costelas, interdigitando com o serrátil anterior e o GD.",
    insertion: "Lábio externo da crista ilíaca, linha alba e ligamento inguinal (aponeurose).",
    innervation: "Nervos toracoabdominais (T7–T11) e subcostal (T12).",
    action: "Flexão e rotação contralateral do tronco; compressão abdominal.",
    landmarks: ["Limite anterior do triângulo lombar (Petit)"],
  },
  "serratus-posterior": {
    summary: "Serráteis posteriores superior e inferior, músculos respiratórios finos profundos aos romboides e ao GD.",
    origin: "Superior: C7–T3. Inferior: T11–L2.",
    insertion: "Superior: costelas 2–5. Inferior: costelas 9–12.",
    innervation: "Nervos intercostais correspondentes.",
    landmarks: ["O inferior fica logo profundo ao GD na região lombar: não incluí-lo no retalho"],
  },
  "intercostal-muscles": {
    summary: "Músculos intercostais externos, internos e íntimos, que ocupam os espaços intercostais.",
    innervation: "Nervos intercostais.",
    vascularization: "Artérias intercostais anteriores (da torácica interna) e posteriores (da aorta).",
    landmarks: ["O feixe intercostal (veia, artéria, nervo) corre no sulco costal entre intercostais internos e íntimos"],
  },
  "contralateral-pectoral": { summary: "Peitorais maior e menor do lado contralateral, para referência de simetria." },
  "pectoral-fascia": {
    summary: "Fáscia peitoral (sobre o peitoral maior) e fáscia clavipeitoral (entre subclávio e peitoral menor, continuando como ligamento suspensor da axila).",
    landmarks: ["A clavipeitoral é perfurada pela veia cefálica, artéria toracoacromial e nervo peitoral lateral"],
    surgical: ["A glândula mamária repousa sobre a fáscia peitoral, separada pelo espaço retromamário", "Mastectomia retira a fáscia peitoral junto com a peça em muitos protocolos"],
  },
  "thoracolumbar-fascia": {
    summary: "Fáscia toracolombar com lâminas anterior, média e posterior; a lâmina posterior dá origem à aponeurose do GD.",
    surgical: ["Limite inferomedial da colheita do GD; incisar a aponeurose junto às origens para liberar o músculo"],
  },
  "deltoid-fascia": { summary: "Fáscia que recobre o deltoide, contínua com a fáscia peitoral e a braquial." },
  "axillary-vessels": {
    summary: "Artéria e veia axilares: eixo vascular da axila, da borda lateral da 1ª costela à borda inferior do redondo maior.",
    course: "A artéria é dividida pelo peitoral menor em três partes: 1ª (medial) — torácica superior; 2ª (posterior) — toracoacromial e torácica lateral; 3ª (lateral) — subescapular e circunflexas anterior e posterior do úmero. A veia situa-se anteromedialmente à artéria.",
    branches: "Torácica superior, toracoacromial, torácica lateral, subescapular, circunflexas do úmero.",
    landmarks: ["A veia axilar é o limite superior da linfadenectomia axilar (níveis I–II)"],
    surgical: ["Dissecar abaixo da veia axilar, de lateral para medial, preservando o pedículo toracodorsal e o nervo torácico longo"],
  },
  "subclavian-vessels": {
    summary: "Artéria e veia subclávias, que se continuam como axilares na borda lateral da 1ª costela.",
    branches: "Artéria: vertebral, torácica interna, tronco tireocervical, tronco costocervical, dorsal da escápula.",
  },
  "thoracoacromial-vessels": {
    summary: "Tronco curto da 2ª parte da artéria axilar que perfura a fáscia clavipeitoral.",
    branches: "Peitoral (entre os peitorais), deltoideo, acromial e clavicular.",
    surgical: ["Ramo peitoral é o pedículo dominante do peitoral maior", "Encontrado no espaço interpeitoral (Rotter) com o nervo peitoral lateral"],
  },
  "lateral-thoracic-vessels": {
    summary: "Artéria torácica lateral (2ª parte da axilar) e veia correspondente, descendo ao longo da borda lateral do peitoral menor sobre o serrátil.",
    course: "Supre serrátil anterior, peitorais e a porção lateral da mama (ramos mamários laterais).",
    surgical: ["Contribui para a irrigação do quadrante lateral da mama; ligada na linfadenectomia de nível I"],
  },
  "subscapular-vessels": {
    summary: "Artéria subescapular, maior ramo da axilar (3ª parte), e veia correspondente; bifurcam-se em circunflexa da escápula e toracodorsal.",
    course: "Desce pela borda lateral do subescapular. A circunflexa da escápula passa pelo espaço triangular para o dorso.",
    surgical: ["Eixo subescapular permite retalhos quiméricos (GD, serrátil, escapular, paraescapular) com pedículo único"],
  },
  "thoracodorsal-vessels": {
    summary: "Pedículo dominante do grande dorsal: continuação da subescapular após a origem da circunflexa da escápula.",
    course: "Desce sobre o subescapular e o redondo maior, acompanhado do nervo toracodorsal, e entra na face profunda do GD cerca de 8–10 cm abaixo da axila. Emite o ramo para o serrátil anterior antes do hilo.",
    branches: "Ramo para o serrátil anterior; no hilo, ramos lateral (descendente, paralelo à borda anterior) e medial (transverso).",
    landmarks: ["Comprimento do pedículo: ~8–12 cm", "Calibre arterial: ~1,5–3 mm; veia: ~3–4 mm"],
    surgical: ["Isolar o pedículo até a origem da circunflexa da escápula aumenta o arco de rotação", "Ligar o ramo do serrátil só após confirmar a patência do tronco toracodorsal", "Evitar tração e torção ao tunelizar pela axila"],
  },
  "circumflex-humeral-vessels": {
    summary: "Artérias circunflexas anterior e posterior do úmero (3ª parte da axilar) e veias correspondentes.",
    course: "A posterior acompanha o nervo axilar pelo espaço quadrangular; a anterior contorna o colo cirúrgico anteriormente.",
  },
  "brachial-vessels": {
    summary: "Artéria braquial (continuação da axilar abaixo do redondo maior), artéria braquial profunda e veias superficiais (cefálica, basílica) e braquiais.",
    landmarks: ["Veia cefálica no sulco deltopeitoral; basílica perfura a fáscia no meio do braço"],
  },
  "internal-thoracic-vessels": {
    summary: "Artéria e veia torácicas internas, ~1–2 cm lateral ao esterno, profundas às cartilagens costais.",
    branches: "Perfurantes mamárias mediais (2º–4º espaços), intercostais anteriores, musculofrênica e epigástrica superior.",
    surgical: ["Principal fonte arterial da mama (~60%) via perfurantes mediais", "Vasos receptores para retalhos livres (DIEP)", "Linfonodos paraesternais acompanham os vasos"],
  },
  "intercostal-vessels": {
    summary: "Vasos intercostais anteriores e posteriores e subcostais, no sulco costal.",
    surgical: ["Perfurantes laterais irrigam a porção lateral da mama e o GD (retalhos baseados em perfurantes intercostais)"],
  },
  "scapular-cervical-vessels": {
    summary: "Artérias supraescapular, dorsal da escápula e cervical transversa (e veias), que formam a anastomose periescapular.",
    surgical: ["A anastomose periescapular pode manter o fluxo distal se a axilar for obstruída"],
  },
  "thoracodorsal-nerve": {
    summary: "Nervo motor do grande dorsal.",
    course: "Origina-se do fascículo posterior (C6–C8), cruza a axila posterior e desce com os vasos toracodorsais, lateral a eles, até o hilo do GD.",
    innervation: "Grande dorsal.",
    surgical: ["Identificado na linfadenectomia axilar junto ao pedículo; preservá-lo", "Secção opcional no retalho de GD para reduzir animação"],
  },
  "long-thoracic-nerve": {
    summary: "Nervo motor do serrátil anterior (nervo de Bell).",
    course: "Raízes C5–C7; desce posterior ao plexo braquial e percorre a face superficial do serrátil anterior, na linha axilar média, aderido à fáscia.",
    innervation: "Serrátil anterior.",
    surgical: ["Lesão causa escápula alada", "Na axila, fica medial e profundo; identificá-lo junto à parede torácica antes de dissecar o tecido linfonodal"],
  },
  "pectoral-nerves": {
    summary: "Nervos peitorais medial (do fascículo medial, C8–T1) e lateral (do fascículo lateral, C5–C7).",
    course: "O lateral perfura a fáscia clavipeitoral com os vasos toracoacromiais; o medial perfura o peitoral menor ou passa pela sua borda lateral.",
    innervation: "Peitoral maior e menor.",
    surgical: ["Preservá-los na dissecção do espaço de Rotter e no nível II evita atrofia do peitoral maior"],
  },
  "intercostobrachial-nerve": {
    summary: "Ramo cutâneo lateral do 2º nervo intercostal (T2) que cruza a axila até a face medial do braço.",
    course: "Emerge no 2º espaço intercostal, na linha axilar média, e atravessa a gordura axilar transversalmente, abaixo da veia axilar.",
    innervation: "Sensibilidade da axila e face medial/posterior do braço.",
    surgical: ["Frequentemente sacrificado na linfadenectomia: causa hipoestesia na face medial do braço"],
  },
  "intercostal-nerves": {
    summary: "Nervos intercostais (ramos anteriores torácicos) com ramos cutâneos laterais e anteriores.",
    surgical: ["Ramo cutâneo lateral do 4º nervo intercostal é a principal inervação sensitiva do complexo areolopapilar"],
  },
  "brachial-plexus": {
    summary: "Plexo braquial (C5–T1): raízes, troncos (superior, médio, inferior), divisões e fascículos (lateral, medial, posterior) ao redor da artéria axilar.",
    branches: "Fascículo posterior: toracodorsal, subescapulares, axilar, radial. Lateral: peitoral lateral, musculocutâneo. Medial: peitoral medial, ulnar, cutâneos mediais. Mediano: dos fascículos lateral e medial.",
    landmarks: ["Fascículos nomeados pela posição em relação à 2ª parte da artéria axilar"],
    surgical: ["Nível III da axila está próximo ao plexo: dissecção cuidadosa com tração mínima"],
  },
  "arm-nerves": {
    summary: "Ramos terminais do plexo braquial para o membro superior: axilar, radial, mediano, ulnar e musculocutâneo.",
    landmarks: ["Axilar passa pelo espaço quadrangular com a circunflexa posterior do úmero"],
  },
  "axillary-lymph-nodes": {
    summary: "Linfonodos axilares (grupos anterior/peitoral, posterior/subescapular, lateral/umeral, central e apical), interpeitorais (Rotter) e paraesternais.",
    drainage: "Recebem ~75% da drenagem linfática da mama; os paraesternais drenam os quadrantes mediais.",
    landmarks: ["Níveis de Berg: I lateral, II posterior e III medial ao peitoral menor"],
    surgical: ["Linfonodo sentinela geralmente no nível I (grupo anterior)", "Linfadenectomia clássica: níveis I e II, abaixo da veia axilar, preservando toracodorsal e torácico longo"],
  },
  skin: {
    summary: "Pele do tronco feminino (Visible Human Female, NIH).",
    surgical: ["Ilha de pele do retalho de GD desenhada sobre o músculo, orientada nas linhas de tensão (transversal/oblíqua) para cicatriz no sutiã", "Sulco inframamário: referência para simetria e posicionamento do retalho"],
  },
  breast: {
    summary: "Glândula mamária: lobos, ductos lactíferos principais e seios lactíferos convergindo para o mamilo.",
    vascularization: "Artéria torácica interna (perfurantes mediais, ~60%), torácica lateral (~30%), ramos peitorais da toracoacromial e intercostais laterais.",
    drainage: "Veias acompanhantes e plexo subareolar; linfa para axila (~75%) e cadeia paraesternal.",
    innervation: "Ramos cutâneos anteriores e laterais dos nervos intercostais T2–T6 (complexo areolopapilar principalmente T4).",
    landmarks: ["Estende-se da 2ª à 6ª costela, da borda esternal à linha axilar média", "Cauda axilar (de Spence) em direção à axila"],
  },
  "breast-fat": {
    summary: "Corpo adiposo da mama, que envolve o parênquima e dá o volume e contorno.",
    surgical: ["Plano pré-peitoral: posterior ao corpo adiposo, sobre a fáscia peitoral", "A espessura do retalho de mastectomia depende da camada subcutânea preservada"],
  },
  "breast-ligaments": {
    summary: "Ligamentos suspensores de Cooper: septos fibrosos da fáscia superficial até a pele e a fáscia peitoral.",
    surgical: ["Seu estiramento contribui para a ptose", "Retração por tumor produz a depressão cutânea (sinal da covinha)"],
  },
  "nipple-areola": {
    summary: "Complexo areolopapilar: mamilo, aréola e tubérculos de Montgomery.",
    innervation: "Principalmente o ramo cutâneo lateral do 4º nervo intercostal.",
    landmarks: ["Geralmente no 4º espaço intercostal, na linha hemiclavicular (varia com a ptose)"],
  },
  "contralateral-breast": { summary: "Mama contralateral (tecido adiposo, glândula e complexo areolopapilar) para referência de simetria." },
  "chest-wall": {
    summary: "Costelas, esterno (manúbrio, corpo, processo xifoide) e vértebras torácicas.",
    landmarks: ["Ângulo de Louis (junção manúbrio-esternal) marca a 2ª cartilagem costal", "Ponta da escápula ao nível de T7–T8"],
  },
  "costal-cartilages": { summary: "Cartilagens costais que unem as costelas ao esterno; os vasos torácicos internos correm profundamente a elas." },
  axilla: {
    summary: "Escápula, clavícula e úmero: esqueleto da cintura escapular e limites ósseos da axila.",
    landmarks: ["Ângulo inferior da escápula: referência superior do GD", "Processo coracoide: inserção do peitoral menor e origem do coracobraquial/bíceps curto", "Sulco intertubercular: inserções do GD, redondo maior e peitoral maior"],
  },
  "iliac-crest": {
    summary: "Osso do quadril com a crista ilíaca.",
    landmarks: ["Terço posterior da crista: origem do GD e limite inferior da colheita"],
  },
};
