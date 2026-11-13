# Plano: mamoplastia em mamas com ptose e hipertrofia G3 e G4

## Objetivo

Levar tudo o que o app faz hoje com a mama de ptose grau II (forma da mama, marcação, pedículos, ressecções, passo a passo animado, resultado esperado, vasos e nervos que acompanham o tecido) para duas mamas novas, muito maiores e mais pendentes: **G3** e **G4**. Este documento traz as definições, os volumes calculados no próprio modelo, as especificações de cada peça a replicar, os defeitos encontrados no caminho, as fases e as decisões que dependem de você. **Nada foi implementado no app**: os números vêm de um piloto que rodou o pipeline do repositório com as saídas desviadas para fora dele.

> **Leitura do pedido.** "Modelos de reconstrução" foi lido como a **remodelação da mama na mamoplastia redutora** (marcação → pedículo → ressecção → transposição → fechamento → resultado), replicada para as duas mamas novas. "G3 e G4" foi lido como os **graus III e IV de hipertrofia da classificação de Berrocal Revueltas**, com ptose grau III de Regnault. Se a intenção era reconstrução após mastectomia (por exemplo, adenectomia redutora com padrão de Wise e retalho dérmico inferior) ou mamoplastia oncológica, veja "Outra leitura" no fim: a base (fases A e B) é a mesma.

## Definições

### Por que G3 e G4 são mamas novas

O app tem hoje três estados: ptose I, II e III, com hipertrofia "leve", "moderada" e "acentuada" (+24%, +52% e +110% sobre a mama do modelo, de 426 mL). Esses nomes descrevem o ganho de volume, não a classificação clínica. Pela classificação de Berrocal Revueltas, que gradua a hipertrofia pelo **peso ressecado por mama**:

| Grau | Peso ressecado | Volume equivalente (0,95 g/mL) |
|---|---|---|
| I (leve) | até 500 g | até 526 mL |
| II (moderada) | 500 a 800 g | 526 a 842 mL |
| III (grave) | 800 a 1.000 g | 842 a 1.053 mL |
| IV (gigantomastia) | 1.000 g ou mais | 1.053 mL ou mais |

As ressecções que o app mostra hoje (101 a 173 g) são de grau I. Mesmo o estado "Ptose III com hipertrofia acentuada" (893 mL) daria, numa redução para cerca de 500 mL, uma peça de ~370 g: ainda grau I. Para ensinar G3 e G4, o monte precisa ser muito maior.

A literatura internacional usa outro corte para gigantomastia, de **mais de 1.500 g por mama** (não há definição única; Dancey et al., 2008, propõem classificar pela causa; Dafydd et al., 2011, por ≥3% do peso corporal). O G4 proposto abaixo atende as duas definições.

### Os dois estados propostos

Mesma família de mapas da ptose (`build_breast.py`), com ptose grau III medida pelo critério de Regnault e um crescimento maior. Medidas tiradas no modelo deformado, lado operado:

| Estado | Mamilo × sulco | Contorno inferior × sulco | Fúrcula–mamilo | Mamilo–sulco (pele) | Projeção | Mamilo–linha média | Volume do monte | Regnault |
|---|---|---|---|---|---|---|---|---|
| Sem ptose (o modelo) | 51 mm acima | 0 | 22,6 cm | 7,2 cm | 55 mm | 11,2 cm | 426 mL | — |
| Ptose II (caso atual) | 26 mm abaixo | 62 mm abaixo | 32,1 cm | 13,6 cm | 84 mm | 13,8 cm | 641 mL | grau II |
| Ptose III (atual) | 89 mm abaixo | 101 mm abaixo | 37,3 cm | 14,9 cm | 66 mm | 14,1 cm | 866 mL | grau III |
| **G3** | **93 mm abaixo** | **104 mm abaixo** | **40,5 cm** | **17,1 cm** | **94 mm** | **15,8 cm** | **1.415 mL (+232%)** | **grau III** |
| **G4** | **111 mm abaixo** | **121 mm abaixo** | **44,2 cm** | **18,7 cm** | **102 mm** | **16,4 cm** | **2.105 mL (+394%)** | **grau III** |

Ptose II e III aparecem aqui já com a correção do crescimento descrita adiante (hoje o app mostra 647 e 893 mL).

Parâmetros (mm de descida do fluxo; inclinação; fatores de espessura, largura, comprimento abaixo do sulco e afinamento da bolsa pendente):

| | Descida | Inclinação | Espessura | Largura | Comprimento | Bolsa |
|---|---|---|---|---|---|---|
| Ptose III (atual) | 77 | 1,3 | 1,45 | 1,40 | 1,30 | 0,50 |
| G3 | 80 | 1,3 | 2,10 | 1,75 | 1,30 | 0,50 |
| G4 | 84 | 1,4 | 2,90 | 2,00 | 1,40 | 0,60 |

![Perfis no meridiano da mama: repouso, ptose II, ptose III, G3 e G4](img/mamoplastia-g3-g4-perfis.jpg)

*Perfil no meridiano da mama (piloto, lado operado; mm na carta, sulco em azul). G3 e G4 continuam a mesma família: o sulco não se move, o polo superior esvazia e a bolsa cresce e pende.*

Fúrcula–mamilo de 40,5 e 44,2 cm ficam na faixa em que muitos autores passam a considerar o enxerto livre do complexo areolopapilar (40 cm; alguns, 45 cm). Neste corpo a distância já começa alta: 22,6 cm sem ptose, uns 2 cm acima do usual.

### Outras medidas dos estados

| | Repouso | Ptose II | Ptose III | G3 | G4 |
|---|---|---|---|---|---|
| Aréola do modelo: diâmetro em relação à ptose II (pela área da malha deformada) | ×0,83 | ×1 | ×1,17 | ×1,41 | ×1,63 |
| Pele sobre o monte | 212 cm² | 443 cm² | 591 cm² | 766 cm² | 963 cm² |

A sequência atual usa, na ptose II, uma aréola de ensino alargada para 5,6 cm. Na mesma proporção do alargamento da aréola do modelo, seriam 79 mm em G3 e 91 mm em G4. **Proposta: 7,5 cm em G3 e 9,0 cm em G4**, com o mesmo areolótomo de 4,2 cm. O anel a desepitelizar passa de 10,8 cm² (ptose II) a 30,3 cm² (G3) e 49,8 cm² (G4).

## Defeitos encontrados no piloto (corrigir antes de G3/G4)

1. **O crescimento dobra o tecido na ptose III atual.** O jacobiano do mapa fica negativo em 1,7% das amostras do monte: 7 mL de tecido em repouso, quase todo na borda lateral (7 a 8 cm lateral ao meridiano do mamilo, onde a atenuação vale de 0,2 a 0,7), da altura do mamilo até 6,6 cm acima dela, de 10 a 21 mm de profundidade. A causa é o **alargamento**: na borda, a atenuação cai mais depressa do que o afastamento do meridiano cresce, e o tecido de dentro passa o de fora. Espessura, comprimento e bolsa não dobram, e sem o alargamento nada se inverte. Com os fatores de G3 e G4, a dobra cresceria.
   **Correção proposta e testada:** o crescimento passa a ser um **fluxo**, ou seja, o mesmo campo de velocidade integrado em 24 passos (método do ponto médio) em vez de um deslocamento direto. Um fluxo de campo suave não pode dobrar: o tecido se afasta da parede sem atravessá-la, e o volume ganho vem da divergência do campo. No piloto, nenhum estado inverte nada (jacobiano mínimo de 0,65 na ptose II, 0,38 na III, 0,22 em G3 e 0,17 em G4). Os estados atuais mudam pouco: ptose II passa de 647 para 641 mL e ptose III de 893 para 866 mL; as medidas variam até 4 mm, e a projeção da ptose III, 6 mm. As peças da ptose II mudam até 2 mL (quilha do Pitanguy 182 → 180, ferradura 111 → 109, inferior e lateral 107 → 105; pedículos iguais).
2. **A quilha do Pitanguy depende da janela da grade frontal.** `Front` corta a mama em pé em `v ≥ −160 mm`; G3 e G4 descem além disso (o contorno inferior do G4 fica em −172 mm), e a grade precisa ser maior. Ao ampliar a grade para −260 mm, as peças do Wise e da vertical na ptose II não mudam, mas a quilha do Pitanguy cai de 182 para 162 mL. O desenho da quilha precisa ficar independente da janela antes de servir a três mamas.
3. **Vasos e nervos superficiais furam a pele quando a mama cresce.** Os tubos acompanham a linha de centro deformada com o calibre mantido, mas a camada superficial afina no polo superior e na face lateral. Folga mínima entre o tubo e a pele (mm, descontado o raio exibido; negativo = fura):

   | Ramo | Repouso | Ptose II | Ptose III | G3 | G4 |
   |---|---|---|---|---|---|
   | Torácica lateral, ramo superior | 3,0 | 0,2 | −0,3 | −0,5 | −0,9 |
   | Torácica lateral, ramo inferior | 2,6 | 0,1 | −0,5 | −0,8 | −0,5 |
   | Ramo cutâneo lateral do 5º | 2,8 | 0,4 | −0,2 | −0,5 | −0,4 |
   | 4º intercostal, ramo superficial | 3,8 | 2,0 | 0,8 | 0,0 | 0,1 |
   | Ramo cutâneo anterior do 3º | 2,1 | 0,2 | 0,6 | 0,5 | 0,0 |
   | Perfurante da torácica interna, 2º espaço | 1,8 | 0,1 | 0,6 | 1,2 | 2,0 |

   A medida é aproximada (até 0,6 mm de erro, distância a amostras da pele a cada 1,2 mm). Os ramos profundos (perfurantes intercostais, toracoacromial, ramo profundo do 4º) ficam a 4–14 mm da pele em todos os estados. A correção está na fase B.

## Volumes

### Balanço proposto

O resultado esperado da ptose II tem de 465 a 541 mL. A proposta é que G3 e G4 terminem com uma mama do mesmo porte, para que a comparação ensine o que muda na técnica e não no resultado:

| | Ptose II (hoje) | G3 | G4 |
|---|---|---|---|
| Monte antes (V₀) | 647 mL | 1.415 mL | 2.105 mL |
| Volume final alvo (V_f) | 465–541 mL (medido) | 500 ± 50 mL | 525 ± 50 mL |
| Ressecção alvo (V₀ − V_f) | 106–182 mL | 915 mL | 1.580 mL |
| Peso estimado (× 0,95 g/mL) | 101–173 g | **869 g** | **1.501 g** |
| Ressecção / monte | 16–28% | 65% | 75% |
| Grau de Berrocal Revueltas | I | **III** (800–1.000 g) | **IV** (≥ 1.000 g; também > 1.500 g) |

Para continuar no grau III, o volume final de G3 pode variar de 362 a 573 mL; para passar de 1.500 g, o de G4 tem de ficar abaixo de 526 mL.

### O que as dimensões atuais dão em G3 e G4

As três técnicas rodaram sem nenhuma mudança de dimensão (aréola nova de 42 mm, ramos de 5 cm, 120° entre os ramos do T, colar de 10 mm, bases de 8 cm, pedículo superior de 25 mm, retalhos de 15 mm, 5 mm sobre a fáscia):

| Caso | Técnica | Pedículo | Ressecção | Peso | % do monte | Volume que sobraria | Falta ressecar |
|---|---|---|---|---|---|---|---|
| G3 | Pitanguy (superior) | 137 mL | 525 mL | 498 g | 37% | 890 mL | 390 mL |
| G3 | Wise (inferior) | 435 mL | 434 mL | 412 g | 31% | 981 mL | 481 mL |
| G3 | Vertical (superomedial) | 386 mL | 446 mL | 424 g | 32% | 969 mL | 469 mL |
| G4 | Pitanguy (superior) | 162 mL | 831 mL | 789 g | 39% | 1.274 mL | 749 mL |
| G4 | Wise (inferior) | 602 mL | 708 mL | 673 g | 34% | 1.397 mL | 872 mL |
| G4 | Vertical (superomedial) | 534 mL | 727 mL | 691 g | 35% | 1.378 mL | 853 mL |

Todas as peças fecharam e a ida e volta do mapa inverso ficou abaixo de 0,001 mm. Mas os padrões feitos para a ptose II, aplicados a mamas de 1,4 e 2,1 L, retiram só um terço do monte e deixam mamas de 0,9 a 1,4 L. É o esperado: na cirurgia, o que ajusta a redução é o afinamento do pedículo e a ressecção sob os retalhos, não o desenho da pele.

### Ressecção dirigida por volume-alvo (especificação)

Cada técnica ganha dois parâmetros, resolvidos por bisseção até o volume final ficar no alvo (± 3%):

1. **Ressecção sob os retalhos** (largura `W`): além das cunhas abaixo da espessura do retalho, o tecido sob os retalhos medial e lateral é retirado até `W` mm além do padrão, deixando sempre o retalho de 15 mm e 5 mm sobre a fáscia. É o descolamento com ressecção que se faz nas mamas grandes.
2. **Afinamento do pedículo** (espessura `e`): o pedículo perde tecido nas faces laterais e profunda até a espessura `e`. Limites: no mínimo 20 mm sob a aréola, base de pelo menos 8 cm e raiz na parede intacta (no inferior, a raiz que leva o septo).

Ponto de partida: manter a fração do pedículo no volume final que ele tem na ptose II (15% no Pitanguy, 47% no Wise, 32% na vertical):

| | Pitanguy | Wise | Vertical |
|---|---|---|---|
| Pedículo alvo em G3 (V_f 500 mL) | 75 mL (hoje 137) | 234 mL (hoje 435) | 162 mL (hoje 386) |
| Pedículo alvo em G4 (V_f 525 mL) | 79 mL (hoje 162) | 245 mL (hoje 602) | 170 mL (hoje 534) |

Quando os limites de segurança impedem chegar ao alvo, **o alvo cede**: o volume final sobe e o app mostra o valor que resultou. Pilares e retalhos (medial/lateral) são medidos depois, como hoje (34/48, 22/32 e 23/39 mL na ptose II).

## Marcação

| Medida (pele em pé) | Ptose II | G3 | G4 |
|---|---|---|---|
| Fúrcula–ponto A | 27,2 cm | 27,3 cm | 28,9 cm |
| Ascensão do complexo areolopapilar (mamilo → A) | 3,6 cm | 10,9 cm | 13,0 cm |
| B–C em linha reta (T invertido) | 9,6 cm | 12,0 cm | 12,1 cm |
| Ramos horizontais (medial + lateral) | 23,0 cm | 30,8 cm | 37,0 cm |
| Incisão no sulco | 15,0 cm | 17,3 cm | 19,0 cm |
| Sobra a compensar no fechamento | 8,0 cm (razão 1,53) | 13,5 cm (1,78) | 18,0 cm (1,95) |
| Vertical: cúpula / ramos medial e lateral | 12,1 / 10,7 e 12,0 cm | 15,5 / 17,8 e 21,7 cm | 17,0 / 21,3 e 26,1 cm |

Especificação:

- **Ponto A** segue a convenção decidida (projeção do sulco no meridiano). Em G4 ele cai a 28,9 cm da fúrcula, porque a pele do polo superior está esticada. Ver decisão 5.
- **Sulco no T invertido**: com os mesmos ramos, a sobra quase dobra. Proposta: alongar a incisão no sulco, primeiro para o lado lateral, até a razão voltar a 1,53, a mesma da ptose II. A incisão passa a 20,1 cm em G3 (+2,8 cm) e 24,2 cm em G4 (+5,2 cm), o que corresponde à extensão lateral que se faz para tirar a orelha lateral. A alternativa (encurtar os ramos horizontais aproximando B e C) muda o cone e fica como opção.
- **Padrão vertical**: os ramos chegam a 21–26 cm em G4. É longe do uso habitual da técnica vertical em reduções desse porte. Ver decisão 4.
- **Aréola de ensino** de 7,5 cm (G3) e 9,0 cm (G4), com areolótomo de 4,2 cm (seção "Outras medidas").

## Pedículos: comprimento e o que cada um conserva

| Pedículo | Ptose II | G3 | G4 |
|---|---|---|---|
| Superior (Pitanguy): distância de transposição | 3,6 cm | 10,9 cm | 13,0 cm |
| Inferior (Wise): comprimento (mamilo–sulco) / base 8 cm | 13,6 cm (1,7 : 1) | 17,1 cm (2,1 : 1) | 18,7 cm (2,3 : 1) |
| Superomedial (vertical): arco de rotação | a medir na fase C | a medir | a medir |

Artérias e nervos conservados até o mamilo pela regra da fase 3 (ramo seccionado quando passa por dentro da peça ou cruza uma incisão ainda superficial). G3 e G4 com as dimensões atuais; os quadros mudam quando o volume-alvo entrar e serão recalculados:

| Caso | Técnica | Artérias conservadas | Nervos conservados |
|---|---|---|---|
| Ptose II | Pitanguy | torácica interna 2º e 3º | anterior do 3º; lateral do 3º |
| G3 | Pitanguy | intercostal 6º | anterior do 3º e do 5º; lateral do 3º |
| G4 | Pitanguy | **nenhuma** | anterior do 3º e do 5º; lateral do 3º |
| Ptose II | Wise | intercostais 4º–6º; toracoacromial | anterior do 3º; 4º profundo; lateral do 3º |
| G3 | Wise | intercostais 4º–6º; toracoacromial | anterior do 3º e do 5º; lateral do 3º (4º profundo seccionado) |
| G4 | Wise | intercostais 4º–6º; toracoacromial | anterior do 3º e do 5º; 4º profundo; lateral do 3º |
| Ptose II | Vertical | torácica interna 2º–4º; intercostais 4º–6º; toracoacromial | anteriores do 3º ao 5º; 4º profundo; lateral do 3º |
| G3 | Vertical | torácica interna 2º e 3º; intercostais 4º–6º | anterior do 3º e do 5º; 4º profundo; lateral do 3º |
| G4 | Vertical | torácica interna 2º; intercostais 4º–6º | anterior do 3º e do 5º; lateral do 3º |

O que o quadro ensina bate com a literatura: o **pedículo superior longo perde as perfurantes da torácica interna**, que chegam ao complexo areolopapilar pela face medial e cruzam o padrão (autores relatam que o pedículo superior longo não é confiável em mamas muito grandes). O inferior mantém as perfurantes intercostais e o ramo da toracoacromial pelo septo, e há séries sem relação entre necrose e distância mamilo–sulco acima de 15 cm no pedículo inferior. Nos dois casos, o modelo mostra trajetos típicos, não previsão.

## Vasos e nervos: trajeto e tamanho

### Trajeto

- **Mesmas regras de traçado** da fase 5 (`build_breast_anatomy.py`): origem nos troncos e espaços intercostais reais, destino nos marcos da mama, profundidade no subcutâneo. A mama G3/G4 é o mesmo tecido deformado, e o trajeto vem do mesmo mapa, que agora não dobra (defeito 1). A forma da mama não altera o trajeto da inervação do complexo areolopapilar (Sarhadi et al., 1996, em mamas obesas e com macromastia). O que muda é o comprimento e a posição.
- **Folga sob a pele por estado.** O pipeline calcula, para cada estado, quanto empurrar cada amostra da linha de centro em direção ao tórax (ao longo do raio da carta da mama, que o app já tem) para que o tubo fique a pelo menos **0,5 mm + raio** da pele e a 1,6 mm dos ossos, com o deslocamento suavizado ao longo do ramo. Vai para o app como um número por amostra e por estado: 16 ramos × ~50 amostras × 5 estados, cerca de 4 mil valores (menos de 20 kB). O app aplica o deslocamento depois do mapa. Isso corrige também os casos da ptose III atual.
- **Nos passos**, nada muda na regra: os ramos são reamostrados a cada 1,5 mm e cada trecho segue o tecido em que está (peça, pedículo, pilares, resto da mama); o trecho na peça sai com ela, o do pedículo se dobra e é sepultado, a origem na parede não se move.

### Tamanho: comprimento

Comprimento de cada ramo da origem ao fim (mm), medido sobre a linha de centro deformada:

| Ramo | Calibre (Ø real, origem → fim) | Repouso | Ptose II | Ptose III | G3 | G4 | G4 / ptose II |
|---|---|---|---|---|---|---|---|
| Perfurante da torácica interna, 2º espaço | 2,5 → 1,2 mm | 151 | 240 | 284 | 311 | 343 | 1,43 |
| Perfurante da torácica interna, 3º | 2,2 → 1,2 | 130 | 218 | 262 | 286 | 315 | 1,44 |
| Perfurante da torácica interna, 4º | 2,0 → 1,2 | 119 | 207 | 251 | 276 | 306 | 1,48 |
| Ramo mamário lateral superior | 2,4 → 1,2 | 125 | 210 | 249 | 278 | 302 | 1,44 |
| Ramo mamário lateral inferior | 2,0 → 1,2 | 116 | 200 | 235 | 261 | 283 | 1,42 |
| Perfurante intercostal, 4º | 2,0 → 1,2 | 85 | 175 | 211 | 232 | 255 | 1,46 |
| Perfurante intercostal, 5º | 2,2 → 1,2 | 67 | 150 | 182 | 202 | 223 | 1,49 |
| Perfurante intercostal, 6º | 2,0 → 1,2 | 84 | 153 | 186 | 206 | 228 | 1,49 |
| Ramo mamário da toracoacromial | 2,2 → 1,2 | 121 | 208 | 244 | 265 | 288 | 1,38 |
| 4º intercostal, ramo profundo | 1,8 → 1,1 | 180 | 262 | 296 | 315 | 334 | 1,27 |
| 4º intercostal, ramo superficial | 1,6 → 1,0 | 152 | 238 | 282 | 310 | 336 | 1,41 |
| Ramo cutâneo lateral do 3º | 1,6 → 1,0 | 137 | 214 | 241 | 259 | 282 | 1,32 |
| Ramo cutâneo lateral do 5º | 1,6 → 1,0 | 141 | 224 | 253 | 266 | 279 | 1,25 |
| Ramo cutâneo anterior do 3º | 1,6 → 1,0 | 81 | 162 | 182 | 192 | 204 | 1,26 |
| Ramo cutâneo anterior do 4º | 1,6 → 1,0 | 104 | 193 | 237 | 263 | 293 | 1,52 |
| Ramo cutâneo anterior do 5º | 1,6 → 1,0 | 77 | 154 | 177 | 184 | 196 | 1,27 |

Os comprimentos entram na ficha de cada ramo, por estado. Em cada técnica, a ficha do pedículo passa a trazer também o comprimento dos ramos conservados **da base do pedículo ao mamilo**, na mama marcada e no resultado.

### Tamanho: calibre

- **Proposta: manter o calibre traçado**, com o afilamento da origem ao fim, sem afinar com o alongamento (como hoje). No app, o raio é exibido 1,35× maior para que o ramo possa ser visto e tocado. Não há estudo que compare o calibre das perfurantes da torácica interna em mamas hipertróficas e normais. A perfurante dominante mede 1,8 ± 0,8 mm em séries de reconstrução, e a do 2º espaço é a mais calibrosa; o traçado (2,5 mm no 2º espaço, 2,0 a 2,2 mm nos demais) está nessa faixa.
- **Alternativa (hipótese, não evidência):** pela lei de Murray (fluxo ∝ raio³), se o fluxo acompanhasse o volume irrigado, o raio cresceria 1,49× em G3 e 1,70× em G4 em relação ao traçado em repouso. Só entra se você quiser e, nesse caso, marcada na ficha como hipótese.
- **Nervos**: calibre mantido. A sensibilidade do complexo areolopapilar cai com o tamanho e a ptose da mama (Tairych et al., 1998); isso vai para as fichas de G3 e G4.

## Réplica de cada funcionalidade

| Funcionalidade (hoje, ptose II) | Em G3 e G4 | O que muda |
|---|---|---|
| Seletor **Forma da mama** com medidas | Dois chips novos (G3, G4) | Medidas do estado; linha nova "Berrocal (redução esperada)"; aviso de enxerto livre quando fúrcula–mamilo ≥ 40 cm |
| Pack **Ptose mamária** (7 vistas) | +4 vistas | Perfil de G3 e G4 (câmera fixa), frente e corte sagital de G4 |
| Rótulos, pinos, zonas, marcação de pele, corte 3D e 2D, seleção | Automático | Seguem o mapa; conferir a desobstrução dos pinos na mama grande |
| Pack **Irrigação e inervação** (vista "Septo e vasos na ptose") | +2 vistas | "Septo e vasos em G3" e "em G4", com os comprimentos na ficha |
| Pack **Mamoplastia redutora**: marcação, pedículo e ressecção das 3 técnicas (9 vistas) | 9 vistas por caso | Ressecção dirigida por volume-alvo; sulco alongado; grade frontal ampliada; o que conserva e secciona por caso |
| Packs **passo a passo** (11, 10 e 9 vistas) | 3 packs por caso | Aréola de 7,5/9,0 cm; mesmas etapas; resultado com o volume final alvo |
| Areolótomo, incisão e desepitelização | Igual | Anel maior (30 e 50 cm²) |
| Ressecção (peça sai em bloco, para baixo e medial) | Igual | Afastamento proporcional ao tamanho da peça (hoje 30/65/95 mm; G4 ≈ 1,6 L precisa de mais) e câmera um pouco mais distante |
| Transposição com os vasos do pedículo | Igual | Subida de 10,9 e 13,0 cm no Pitanguy: interpolação mais longa, com a dobra do pedículo visível |
| Fechamento em etapas, suturas coloridas, pontos | Igual | Sulco mais longo; mais pontos (um a cada 8 mm) |
| Resultado esperado: cicatrizes, medidas antes e depois | Igual | Mamilo 1,5 cm acima do sulco e pilar vertical de 5 cm: o polo inferior precisa encurtar mais (hoje o limite é 40% do comprimento; em G3/G4, até 25%) |
| Setas, transições, "Rever", pele opaca/transparente, preferências por técnica | Igual | Nada |
| Vasos e nervos acompanham o tecido; vivos × cortados | Igual | Folga sob a pele por estado; comprimentos na ficha |
| Fichas de técnica e de pedículo; "Modelo × literatura" | Por caso | Referências de G3/G4 (abaixo) |
| Revisão do especialista exportável | Por caso | Peças e marcações novas entram na revisão |

### Técnica adicional recomendada para G4: enxerto livre do complexo areolopapilar

G4 tem fúrcula–mamilo de 44,2 cm, mamilo–sulco de 18,7 cm, ressecção de ~1.500 g, e o pedículo superior longo perde todas as artérias no modelo: é o caso típico do enxerto livre (Thorek). Proposta de sequência, no mesmo formato dos outros passo a passo:

1. Marcação (padrão de Wise, ponto A, medidas)
2. Coleta do enxerto: disco de pele total de 4,2 cm centrado no mamilo, desengordurado
3. Amputação: ressecção inferior e central em bloco, com a pele do padrão
4. (Opcional) retalho dermoglandular inferior ou central para projeção, já que a técnica costuma deixar a mama larga e plana
5. Fechamento: ponto em T, sutura vertical, sutura no sulco
6. Leito receptor: desepitelização de 4,2 cm no vértice do cone
7. Enxerto fixado, com curativo de Brown
8. Resultado esperado: menor projeção e todos os ramos para o complexo areolopapilar seccionados por definição (irrigação por embebição, sensibilidade perdida), o que fica explícito na ficha

## Arquitetura e dados

| Item | Hoje | Com G3 e G4 |
|---|---|---|
| `breastModel.json` | 3 estados | 5 estados (+0,6 kB) e o crescimento como fluxo; `breast-chart.bin` não muda (a janela da carta já cobre a largura de G4: u de 39 a 193 mm, janela de 16 a 214) |
| `breastMap.ts` + `check_breast_map.mjs` | crescimento direto | fluxo de crescimento espelhado em TypeScript; vetores de teste regravados; erro máximo ≤ 0,001 mm |
| Custo do mapa | ≈ 1 s no desktop e 0,4 s no celular (3 estados) | no piloto em Python, de 1,1 s para 3,0 s (5 estados, 24 passos): **calcular só até o estado escolhido**, num Web Worker, ou com menos passos se a diferença for < 0,05 mm |
| *Morph targets* | 3 por malha | +2 (cerca de 18 MB no desktop e 6,5 MB no celular): criar sob demanda |
| Pele do celular | refinada (o polo superior estica até 3×) | G4 estica a pele do monte 4,5×: refino adaptativo pelo estiramento (aresta ≤ 7 mm depois da deformação) |
| `mammaplasty.json` / `.bin` | 55 kB / 177 kB (ptose II) | um par por caso: G3 ≈ 280 kB, G4 ≈ 320 kB de peças (vértices 1,6× e 1,8×) |
| `mammaplastySteps.json` | 100 kB, **importado no bundle** | um arquivo por caso, **carregado sob demanda** (senão o bundle cresce 200 kB) |
| `mammaplasty-<técnica>.bin` | 660–900 kB | `mammaplasty-<técnica>-<caso>.bin`, ≈ 1,0–1,6 MB cada, baixado só quando a técnica abre |
| Camada esquemática | deforma pelo mapa | + deslocamentos de folga por estado (< 20 kB) |
| Service worker | cache primeiro, hash no endereço | nova versão de cache |

Mudanças no pipeline:

- `build_breast.py`: estados G3 e G4, crescimento como fluxo, verificação do jacobiano (falha se algum elemento ficar abaixo de 0,1).
- `build_breast_anatomy.py`: folga por estado e relatório de comprimentos.
- `build_mammaplasty.py`: `STATE` vira a lista de casos (ptose II, G3, G4) com dimensões por caso (aréola, volume final alvo, extensão do sulco), solver de volume-alvo e grade frontal calculada pelo estado e sem afetar a quilha (defeito 2).
- `build_mammaplasty_steps.py`: chaves `<técnica>-<caso>`, aréola por caso, afastamento da peça e câmera pelo tamanho da peça, limite do encurtamento do polo inferior por caso.
- App: `mammaplasty.ts` e `mammaplastySteps.ts` passam a receber o caso; `HybridModel.prepareSurgery(técnica, caso)`; packs gerados por caso.

## Fases

| # | Fase | Entrega | Critério de pronto |
|---|---|---|---|
| A | **Estados G3 e G4** | Crescimento como fluxo em Python e TypeScript; G3 e G4 no seletor e no pack Ptose mamária; medidas e grau de Berrocal esperado; refino da pele no celular; estados calculados sob demanda | Jacobiano > 0,1 em todo estado; `check:breast` ≤ 0,001 mm; volumes e medidas da tabela ± 2%; pele sem facetas visíveis no celular |
| B | **Vasos e nervos** | Folga por estado; comprimentos nas fichas; vistas de G3 e G4 no pack Irrigação | Nenhum tubo a menos de 0,5 mm da pele em nenhum estado; ossos ≥ 1,6 mm |
| C | **Marcação e peças** | Grade frontal independente da janela; ressecção dirigida por volume-alvo; sulco alongado; pack Mamoplastia redutora para G3 e G4; conserva × secciona por caso | Peças fechadas; ida e volta < 0,001 mm; volume final no alvo ± 3% (ou o alvo que cedeu, informado); ptose II com as mesmas peças de hoje, a menos do defeito 2 |
| D | **Passo a passo** | 3 técnicas × 2 casos, com aréola, fechamento, resultado e medidas antes e depois; dados por caso, carregados sob demanda | Sem triângulo invertido fora das lascas do sulco; pilar vertical entre 4,5 e 6 cm; mamilo 1,5 cm acima do sulco; vasos seguem o tecido |
| E | **Enxerto livre (recomendado)** | Sequência do enxerto livre em G4 (e, se quiser, em G3 para comparar) | Mesmos critérios de D |
| F | **Validação** | Revisão do especialista; README, `plano-mamoplastia.md` e `ATTRIBUTIONS.md` atualizados; lint, typecheck e build | Revisão aprovada |

A, B e C podem ser revisadas em separado; D e E dependem de C.

## Decisões que dependem de você

1. **Leitura do pedido**: mamoplastia redutora em G3 e G4 (este plano) ou reconstrução após mastectomia?
2. **G3 e G4** como graus III e IV de hipertrofia de Berrocal, sobre ptose grau III, com os volumes propostos (monte de 1.415 e 2.105 mL; ressecções de ~870 e ~1.500 g)?
3. **Volume final alvo**: 500 mL em G3 e 525 mL em G4 (mama do mesmo porte do resultado da ptose II), ou outro?
4. **Técnicas em G4**: manter as três como réplica? O Pitanguy fica como ensino do risco do pedículo superior longo (no modelo ele perde todas as artérias). A vertical tem ramos de 21–26 cm em G4: manter, trocar por Wise com pedículo superomedial (Orlando e Guthrie) ou tirar? Entra o **enxerto livre** (fase E)?
5. **Ponto A em G4**: manter a projeção do sulco (28,9 cm da fúrcula) ou limitar a distância fúrcula–A (por exemplo, a 26 cm)?
6. **Calibre**: manter o traçado (recomendado) ou escalar pela lei de Murray como hipótese?
7. **Crescimento como fluxo para todos os estados** (corrige a ptose III atual; a ptose II passa de 647 para 641 mL e o caso atual é regenerado, com as peças mudando até 2 mL), ou só para G3/G4?
8. **Nomes dos estados atuais**: "hipertrofia leve, moderada, acentuada" descreve ganho de volume, mas as reduções que eles dão são grau I de Berrocal. Renomear ou acrescentar o grau esperado?
9. **Na biblioteca**: um pack por técnica e por caso (12 packs de mamoplastia ao todo; simples e igual ao que existe) ou um pack por técnica com um seletor de caso nos passos (mais fácil de comparar; mais trabalho no visualizador)?
10. **Aréola de ensino**: 7,5 cm em G3 e 9,0 cm em G4, com areolótomo de 4,2 cm?

## Outra leitura: reconstrução após mastectomia

Se o pedido era reconstrução, G3 e G4 continuam sendo a base (fases A e B), e a fase C muda. Em mamas grandes e ptóticas, a reconstrução imediata costuma usar a **adenectomia redutora**: padrão de Wise, a pele inferior desepitelizada como retalho dérmico que cobre o polo inferior do implante, e o implante pré- ou retropeitoral (o pack Planos de reconstrução já tem os planos). Os volumes seriam outros: peça = toda a glândula; pele retirada = padrão de Wise; implante escolhido pelo volume final.

## Limitações

- **Arquétipos geométricos.** G3 e G4 são a mesma mama do modelo (adiposa, 426 mL, de uma mulher de 59 anos) crescida por um mapa. A proporção entre glândula e gordura não muda, e o corpo não engorda junto (na gigantomastia real, o tórax, o abdome e a posição do sulco costumam mudar).
- **A bolsa não encosta no abdome**: como na ptose III atual, fica uma fenda entre a face inferior e a parede.
- **Volumes** são medidos pelo jacobiano do mapa sobre o monte à frente da superfície-base, e o peso usa 0,95 g/mL. A classificação de Berrocal usa o peso real ressecado; o enquadramento aqui é por estimativa.
- **Peças, quadros "conserva × secciona" e comprimentos** são do piloto, com as dimensões atuais; mudam quando o volume-alvo entrar.
- **Literatura**: conferida por título, resumo e citações secundárias, não no texto completo. A fonte primária de Berrocal Revueltas não foi localizada; as faixas vêm de artigos brasileiros que a citam (com pequenas diferenças nos limites).

## Como os números foram obtidos

Piloto em 13/11/2026, sobre o modelo decodificado (`node scripts/hybrid/decode_model.mjs`), usando os módulos do repositório sem gravar nada nele:

1. `build_breast.Breast` e `measure` com os estados G3 e G4 acrescentados e o crescimento trocado por um fluxo (24 passos, ponto médio); jacobiano por diferenças finitas sobre as amostras de `mound_volumes`.
2. `build_mammaplasty.main` com `STATE` = G3 ou G4, a grade frontal ampliada para −260 mm e as saídas desviadas. Antes, o mesmo caminho reproduziu exatamente as peças da ptose II do repositório (70/182, 251/111 e 175/107 mL).
3. Comprimentos e folgas dos ramos de `breastAnatomy.json` levados pelo mapa, com distância a amostras da pele deformada.

Na fase A, esses passos viram verificações do próprio pipeline (`npm run breast:hybrid` passa a imprimir jacobiano, volumes e folgas por estado).

## Referências

- Regnault P. Breast ptosis: definition and treatment. *Clin Plast Surg* 1976;3(2):193–203.
- Classificação de Berrocal Revueltas (hipertrofia mamária pelo peso ressecado: I até 500 g; II 500–800 g; III 800–1.000 g; IV ≥ 1.000 g), citada em artigos da *Revista Brasileira de Cirurgia Plástica* e de periódicos brasileiros; fonte primária a conferir.
- Dancey A, Khan M, Dawson J, Peart F. Gigantomastia – a classification and review of the literature. *J Plast Reconstr Aesthet Surg* 2008;61(5):493–502.
- Dafydd H, Roehl KR, Phillips LG, Dancey A, Peart F, Shokrollahi K. Redefining gigantomastia. *J Plast Reconstr Aesthet Surg* 2011;64(2):160–163.
- Inferior pedicle breast reduction and long nipple-to-inframammary fold distance: how long is safe? *J Plast Reconstr Aesthet Surg* 2021 (PMID 33127349).
- Surgical outcomes of gigantomastia breast reduction superomedial pedicle technique: a 12-year retrospective study (PMID 23542843).
- Double-unit superomedio-central (DUS) pedicle inverted-T reduction mammaplasty for gigantomastia. *Aesthetic Plast Surg* 2021 (doi:10.1007/s00266-021-02351-y): enxerto livre considerado a partir de 40 cm de fúrcula–mamilo; os autores, a partir de 45 cm.
- Orlando JC, Guthrie RH. The superomedial dermal pedicle for nipple transposition. *Br J Plast Surg* 1975;28(1):42–45.
- Thorek M. Possibilities in the reconstruction of the human form. *N Y Med J* 1922;116:572–575.
- Casas LA, Byun MY, Depoli PA. Maximizing breast projection after free-nipple-graft reduction mammaplasty. *Plast Reconstr Surg* 2001;107(4):955–960.
- Free nipple graft: current indications and applications of a centenary breast surgery technique – an integrative review. *Mastology* 2022.
- Sarhadi NS, Shaw Dunn J, Lee FD, Soutar DS. An anatomical study of the nerve supply of the breast, including the nipple and areola. *Br J Plast Surg* 1996;49(3):156–164.
- Schlenz I, Kuzbari R, Gruber H, Holle J. The sensitivity of the nipple-areola complex: an anatomic study. *Plast Reconstr Surg* 2000;105(3):905–909.
- Tairych GV, Kuzbari R, Rigel S, Todoroff BP, Schneider B, Deutinger M. Normal cutaneous sensibility of the breast. *Plast Reconstr Surg* 1998;102(3):701–704.
- Angiotomografia das artérias mamárias no planejamento da mamoplastia redutora, 60 pacientes. *Egypt J Radiol Nucl Med* 2023 (doi:10.1186/s43055-023-01170-2).
- Estudo radioanatômico das perfurantes da torácica interna (2014; perfurante dominante de 1,8 ± 0,8 mm em 197 pacientes); referência completa a conferir.
- Murray CD. The physiological principle of minimum work: I. The vascular system and the cost of blood volume. *Proc Natl Acad Sci U S A* 1926;12(3):207–214.
- von Funck W, Theisel H, Seidel H-P. Vector field based shape deformations. *ACM Trans Graph* 2006;25(3):1118–1125.
- Demais referências das técnicas em `docs/plano-mamoplastia.md`.
