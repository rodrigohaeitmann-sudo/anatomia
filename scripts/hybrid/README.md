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

## Limitações conhecidas

- A musculatura e o esqueleto são de um indivíduo masculino (BodyParts3D). A pele e as mamas são de uma mulher de outra fonte (Visible Human Female). O encaixe foi medido, mas não validado por anatomista.
- O braço da pele do HRA está abduzido e o do BodyParts3D, pendente. Por isso a pele foi recortada no tronco, e úmero, deltoide e vasos/nervos do braço ficam sem cobertura cutânea.
- As fáscias toracolombares do Z-Anatomy são superfícies de baixa resolução (160–313 triângulos), mantidas como estão na fonte.
- Os linfonodos do Z-Anatomy representam grupos (anterior, posterior, lateral, central, apical, interpeitoral, paraesternal), não linfonodos individuais.
