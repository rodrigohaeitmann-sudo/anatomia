# Modelo híbrido feminino do tronco

Pipeline que gera `public/models/hybrid/torso-female-hybrid.glb` e `src/data/hybridTorsoManifest.json`.

Nenhuma estrutura anatômica é modelada à mão: vasos, nervos, músculos, ossos, pele e mama são malhas segmentadas das fontes abaixo.

| Camada | Fonte | Malhas | Triângulos |
|---|---|---:|---:|
| Pele do tronco, mamas (gordura, lobos, ductos, seios lactíferos, ligamentos de Cooper, mamilo, aréola, tubérculos) | HRA / NIH – Visible Human Female v1.3 | 17 | 660 mil |
| Parede torácica, músculos, **todos os vasos e nervos nomeados** da axila, parede torácica, dorso e braço proximal | BodyParts3D 4.3 (DBCLS) | 191 | 1,10 milhão |
| Grande dorsal (ausente no 4.x) | BodyParts3D 3.0 (DBCLS), FMA13359 | 1 | 227 mil |
| Linfonodos axilares e paraesternais, fáscias peitoral/clavipeitoral/toracolombar/deltoidea, nervo peitoral lateral | Z-Anatomy | 14 | 21 mil |

## Como as referências anatômicas são preservadas

1. **BodyParts3D fica intacto.** As malhas 4.3 e 3.0 estão no mesmo referencial nativo (mm, mesmo indivíduo). Elas não são escaladas, deformadas nem remodeladas. As relações entre vasos, nervos, músculos e ossos são as da fonte.
2. **Z-Anatomy entra com uma única transformação de similaridade.** Ela é estimada por ICP sobre o serrátil anterior e o grande dorsal, presentes nas duas fontes. Erro: RMS de 2,0 mm, p95 de 4,4 mm.
3. **A pele e as mamas do HRA entram com uma única transformação rígida, em escala real.** Ela vem do ICP pele-a-pele no tronco. Resultado: 99,94% dos pontos da anatomia profunda ficam dentro da pele feminina.
4. **Única alteração de forma: a base posterior da mama.** Ela é comprimida em profundidade, coluna a coluna, para repousar anteriormente à parede torácica (espaço retromamário de 2 mm). A superfície anterior, o mamilo e a aréola ficam fixos. Lobos e ductos seguem o mesmo mapeamento monotônico, sem dobras. A magnitude fica registrada em `registration.breastConformation` no manifesto: avanço máximo de 25 mm e razão mínima de profundidade de 0,36.
5. **Lado operatório.** O BodyParts3D 4.3 só tem os ramos do plexo braquial (toracodorsal, torácico longo, peitorais, intercostobraquial) no lado **esquerdo**. Por isso o modelo é montado com o lado esquerdo da fonte, e o conjunto inteiro é refletido como um corpo único para ser apresentado como **direito**, como no roteiro cirúrgico. A reflexão global preserva todas as distâncias e relações espaciais.
6. **Referencial do viewer.** O modelo é colocado no mesmo referencial do modelo Z-Anatomy anterior. Assim, câmeras e anotações das 30 etapas continuam válidas. Os marcos anatômicos usados pelos guias cirúrgicos (mamilo, sulco inframamário, borda anterior do grande dorsal, ângulo inferior da escápula, crista ilíaca, origem do pedículo toracodorsal etc.) são calculados a partir das malhas e gravados em `landmarks`.

Cada malha do GLB tem nó próprio. Os `extras` do nó registram a fonte, o nome original, o ID FMA e a licença. O manifesto repete isso em `meshes`.

## Reproduzir

```bash
pip install -r scripts/hybrid/requirements.txt
npm run fetch:hybrid   # baixa as fontes (~140 MB) em assets/source/hybrid/ e extrai o Z-Anatomy
npm run build:hybrid   # registra, monta, gera o manifesto e comprime com meshopt (gltfpack)
```

`select_bp3d43.py` regenera `bp3d43-selection.json`, a lista curada de malhas do 4.3 com regras explícitas por nome. Rode-o só para mudar a seleção. O arquivo versionado garante builds idênticos.

## Camadas de estudo (marcos, fixações, fibras, marcação, zonas)

```bash
npm run layers:hybrid  # extract_zanatomy_skeleton.mjs → decode_model.mjs → build_anatomy_layers.py (~3 min)
```

Gera `src/data/anatomyLayers.json` (metadados, pontos, linhas, medidas) e `public/models/hybrid/anatomy-layers.bin` (áreas de fixação, fibras e amostras de partição, quantizadas em 16 bits). Tudo é calculado sobre a geometria publicada no GLB desktop, que `decode_model.mjs` decodifica.

| Camada | Como é obtida |
|---|---|
| Marcos ósseos | Rótulos do esqueleto do Z-Anatomy. Cada osso do Z-Anatomy é ajustado ao osso do BodyParts3D (similaridade global + ajuste rígido por osso; erro mediano 0,1–1,4 mm). A ponta da linha-guia que toca o osso é projetada na superfície do osso do modelo. Incisura jugular, xifoide, processos espinhosos e rótulos das costelas são calculados nas malhas. |
| Áreas de fixação | Superfícies de origem/inserção do Z-Anatomy, transferidas pelo mesmo ajuste e projetadas no osso. A classificação origem/inserção vem de tabela própria (o rótulo o/e da fonte diverge em ~1/3 das áreas). Grande dorsal, redondo maior e coracobraquial no úmero e cabeça curta do bíceps no coracoide: contato < 1,6 mm entre as malhas do músculo e do osso. |
| Fibras | Campo harmônico na superfície de cada músculo (Laplaciano cotangente; u = 0 na origem, 1 na inserção; Choi & Blemker 2013) e linhas de corrente do gradiente, espaçadas pelo lado da origem. |
| Digitações / fascículos | Partição harmônica do serrátil anterior e do peitoral menor pela costela de origem. |
| Hilos | Primeiro contato (< 3 mm) da artéria/nervo com o músculo, a partir da origem da artéria subescapular. |
| Marcação na pele | Bordas e pontos calculados nas malhas (borda livre do grande dorsal, borda inferolateral do peitoral maior, clavícula, margem medial da escápula, linha esternal, linha hemiclavicular, sulco inframamário, EIC) projetados na pele do HRA. |
| Zonas de perfurantes | Faixas desenhadas com as distâncias da literatura (`src/data/literature.ts`) medidas ao longo do contorno da pele a partir das referências do modelo. São probabilísticas; nenhum vaso é modelado. |

## Anatomia esquemática da mama

```bash
npm run anatomy:breast   # decode_model.mjs → build_breast_anatomy.py (~1 min; `-- --figures DIR` grava renders de conferência)
```

Gera `src/data/breastAnatomy.json`: 10 estruturas que as fontes não trazem e que diferenciam os pedículos da mamoplastia. São as únicas estruturas do app que não vêm de segmentação; aparecem com a fonte "Esquemático (literatura)" e com aviso na ficha.

| Estrutura | Regra do traçado | Referência |
|---|---|---|
| Perfurantes da torácica interna (2º–4º espaços) | Do tronco real, pelo meio do espaço intercostal ao lado da borda esternal, através do peitoral maior; depois no subcutâneo (10 → 6 mm da pele) até as bordas superomedial e medial da aréola | van Deventer 2004; O'Dey et al. 2007 |
| Ramos mamários laterais | Do tronco real da torácica lateral, contornando a borda medida do peitoral maior; subcutâneo até a borda lateral da aréola | idem |
| Perfurantes intercostais anteriores (4º–6º espaços) | Do espaço intercostal, 1,5–2 cm medial ao meridiano, através da parede; seguem o septo até a região retroareolar | Würinger et al. 1998 |
| Ramo mamário da toracoacromial | Da ponta do ramo peitoral real, sob o peitoral maior até o 4º espaço; perfura e segue a face cranial do septo | Würinger et al. 1998 |
| Septo horizontal | Lâmina da parede, ao longo da linha medida da 5ª costela, até 9 mm atrás do mamilo | Würinger et al. 1998 |
| Ligamentos medial e lateral | Lâminas verticais nos limites medidos do corpo adiposo, da parede à derme, do septo até a 2ª/3ª costela | Würinger et al. 1998 |
| Ligamento do sulco inframamário | Faixa da parede (9 mm acima) à derme, ao longo do sulco medido na pele | Bayati & Seckel 1995 |
| Ramo cutâneo lateral do 4º intercostal | Emerge no 4º espaço perto da linha axilar média; ramo profundo sobre a parede (fáscia) até o meio da mama e daí ao mamilo junto ao septo; ramo superficial pelo subcutâneo | Schlenz et al. 2000 |
| Ramos cutâneos laterais (3º, 5º) e anteriores (3º–5º) | Dos espaços correspondentes, pelo subcutâneo, até a pele lateral/medial e a borda da aréola | Schlenz et al. 2000 |

Alturas das costelas e dos espaços, troncos de origem, borda do peitoral maior, parede (envoltória externa de músculos, costelas e cartilagens), pele, aréola, mamilo e sulco são **medidos nas malhas**; profundidades no subcutâneo, calibres (ampliados 1,35× para leitura) e espessuras são valores de desenho. O script confere que todo trajeto fica sob a pele e fora dos ossos. No app, `src/lib/breastAnatomy.ts` constrói tubos e lâminas e os reconstrói em cada estado da mama a partir da linha de centro deformada.

## Posições do membro superior

```bash
npm run poses:hybrid   # decode_model.mjs (desktop e celular) → build_poses.py (~15 min)
```

Gera `src/data/armPoses.json` (posições, cinemática, matrizes dos ossos por quadro-chave, pesos das camadas) e, em `public/models/hybrid/poses/`, os deltas por vértice de cada posição (int16, 3 quadros-chave) para as versões desktop e celular. O app os toca como morph targets. Plano em etapas, resultados e limitações: `docs/movimento-membro-superior.md`.

| Etapa | Como é feita |
|---|---|
| Articulações | Centro glenoumeral por ajuste de esfera à cabeça do úmero; SC e AC pelos marcos da clavícula; plano da escápula por PCA |
| Cinemática | Tórax → clavícula → escápula → úmero; ângulo glenoumeral resolvido para a elevação umerotorácica pedida; inclinação posterior resolvida pelo contato do ângulo inferior com o gradil costal |
| Pesos | Campo harmônico na superfície de cada músculo entre os ossos de origem e inserção; vasos, nervos, linfonodos e fáscias herdam dos músculos e ossos vizinhos |
| Deformação | Quatérnios duais; fibras alongadas recolocadas na corda entre as extremidades (peitoral maior, grande dorsal, redondo maior); volume muscular; deslizamento sobre o tórax; colisão com os ossos |

## Mama: carta e ptose

```bash
npm run breast:hybrid  # decode_model.mjs → build_breast.py (~10 s) → check_breast_map.mjs
```

Gera `src/data/breastModel.json` (carta dos dois lados, curvas do sulco, parâmetros dos estados e medidas clínicas), `public/models/hybrid/breast-chart.bin` (superfície-base das duas mamas, uint16, passo de 0,005 mm) e `scripts/hybrid/breast-test-vectors.json` (pontos de teste). A deformação não é gravada: o app avalia o mapa em cada vértice (`src/lib/breastMap.ts`) e `check_breast_map.mjs` confere que ele reproduz o pipeline (tolerância de 0,02 mm). Plano em fases, especificação das técnicas e limitações: `docs/plano-mamoplastia.md`.

| Etapa | Como é feita |
|---|---|
| Eixo e carta | Eixo vertical pela linha média do esterno (incisura jugular e xifoide) e pelo meio do tronco na altura do mamilo; coordenadas cilíndricas (arco, altura, raio), uma carta por lado |
| Superfície-base | Raio da pele fora da pegada do corpo adiposo e continuação harmônica (membrana) por dentro, suavizada: o tronco sem o monte mamário |
| Sulco inframamário | Maior concavidade vertical da pele junto ao limite inferior do corpo adiposo, coluna a coluna |
| Ptose | Mapa de fluxo de um campo incompressível preso à parede (camada de cisalhamento, afinamento do polo superior, acúmulo abaixo do sulco); grau III com giro polar em torno do sulco |
| Medidas | Tiradas no modelo deformado: mamilo × sulco, contorno inferior, fúrcula–mamilo e mamilo–sulco sobre a pele; a classificação de Regnault sai delas |

`--figures DIR` grava os perfis de cada estado no meridiano da mama, para revisão.

`pilot_mammaplasty.py` é o piloto das fases 2 e 3 do plano (marcação de Wise e volumes de pedículo e de ressecção sobre a mama ptótica). Não gera dados para o app: imprime medidas e volumes, grava `assets/build/mammaplasty-pilot.json` e, com `--figures DIR`, as figuras.

## Limitações conhecidas

- A musculatura e o esqueleto são de um indivíduo masculino (BodyParts3D). A pele e as mamas são de uma mulher de outra fonte (Visible Human Female). O encaixe foi medido, mas não validado por anatomista.
- O braço da pele do HRA está abduzido e o do BodyParts3D, pendente. Por isso a pele foi recortada no tronco, e úmero, deltoide e vasos/nervos do braço ficam sem cobertura cutânea.
- As fáscias toracolombares do Z-Anatomy são superfícies de baixa resolução (160–313 triângulos), mantidas como estão na fonte.
- A ptose é um modelo geométrico (fluxo com volume preservado), não uma simulação física, e parte de uma única mama, de cadáver em decúbito.
- Os linfonodos do Z-Anatomy representam grupos (anterior, posterior, lateral, central, apical, interpeitoral, paraesternal), não linfonodos individuais.
