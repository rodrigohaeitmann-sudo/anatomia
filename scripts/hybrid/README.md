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

## Limitações conhecidas

- A musculatura e o esqueleto são de um indivíduo masculino (BodyParts3D). A pele e as mamas são de uma mulher de outra fonte (Visible Human Female). O encaixe foi medido, mas não validado por anatomista.
- O braço da pele do HRA está abduzido e o do BodyParts3D, pendente. Por isso a pele foi recortada no tronco, e úmero, deltoide e vasos/nervos do braço ficam sem cobertura cutânea.
- As fáscias toracolombares do Z-Anatomy são superfícies de baixa resolução (160–313 triângulos), mantidas como estão na fonte.
- Os linfonodos do Z-Anatomy representam grupos (anterior, posterior, lateral, central, apical, interpeitoral, paraesternal), não linfonodos individuais.
