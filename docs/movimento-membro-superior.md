# Movimento do membro superior: posições cirúrgicas com músculos deformados

## Objetivo

Levar o braço a posições predefinidas que facilitam o estudo da axila e da musculatura do ombro. Os músculos, vasos e nervos devem ser **deformados** de acordo com o movimento, e não apenas girados ou afastados como nas manipulações rígidas da aba Dissecar.

Posições implementadas (`src/data/armPoses.json`):

| Posição | Uso cirúrgico | Cinemática (alvo) |
|---|---|---|
| Anatômica | braço pendente, como no modelo original | — |
| Abdução 90° (braçadeira) | dissecção axilar, linfonodo sentinela, mastectomia | elevação umerotorácica 90° no plano coronal, rotação externa 30° |
| Flexão 90° (decúbito lateral) | retalho do grande dorsal, retalhos toracolaterais | elevação 90° no plano sagital |
| Mão na nuca | acesso axilar amplo, parede torácica lateral | elevação 130° (plano 10°), rotação externa 60° |

## Plano em etapas e situação

| # | Etapa | Como | Situação |
|---|---|---|---|
| 1 | Articulações a partir dos ossos do próprio modelo | Centro glenoumeral por ajuste de esfera à cabeça do úmero (raio 21,8 mm); SC e AC pelos marcos da clavícula; plano da escápula por PCA; eixo do úmero da cabeça aos epicôndilos | feito |
| 2 | Cinemática da cintura escapular | Cadeia tórax → clavícula (elevação/retração na SC) → escápula (rotação superior na AC) → úmero. O ângulo glenoumeral é resolvido por bisseção para atingir exatamente a elevação umerotorácica pedida (ritmo escapuloumeral ≈ 2:1) | feito |
| 3 | Contato escapulotorácico | A rotação rígida faria o ângulo inferior "descolar" do tórax (escápula alada: 25–50 mm). A inclinação posterior é **resolvida** para manter a folga de repouso do ângulo inferior (≈ 6 mm) até o gradil costal, com teto de 30° | feito |
| 4 | Pesos anatômicos de deformação | Por músculo: campo harmônico na própria superfície entre o(s) osso(s) de origem e o de inserção (Dirichlet nos vértices em contato com cada osso). Vasos, nervos, linfonodos e fáscias herdam os pesos dos músculos e ossos vizinhos, suavizados sobre todas essas estruturas juntas (raio de 16 mm): cada secção transversal de um vaso e os dois lados de uma bifurcação se movem juntos, sem o vaso abrir em fita nem o ramo descolar do tronco. Pele do tronco, mama e parede torácica ficam com o tórax. Um campo volumétrico euclidiano foi descartado: "vaza" pelo ar entre o braço e o tronco | feito |
| 5 | Deformação | Skinning por quatérnios duais (sem o colapso do ombro do skinning linear) | feito |
| 6 | Músculos esticados em linha reta | O skinning gira o meio de um músculo em torno da articulação e cria alças (parte abdominal do peitoral maior em "L" a 90°, arco sobre a axila a 130°). Correção por "corda": cada vértice é recolocado entre as extremidades da sua fibra (origem e inserção, extensões harmônicas das áreas de fixação), mantendo o afastamento de repouso girado; aplicada onde a fibra se alonga. Peitoral maior (3 partes), grande dorsal e redondo maior | feito |
| 7 | Volume muscular | Ventre que encurta engrossa e o que alonga afina (secção ∝ 1/√estiramento, perfil sen(πu) entre origem e inserção) | feito |
| 8 | Colisões e deslizamento | Tecido que ficava fora do gradil costal mantém ≥ 85% da folga de repouso (desliza sobre o tórax em vez de afundar); vértices dentro de um osso voltam para a superfície | feito |
| 8b | Vasos e nervos acompanham as correções | As correções aplicadas a cada músculo (corda, volume, deslizamento, colisão) são transferidas aos vasos, nervos, linfonodos e fáscias vizinhos (integral até 10 mm, nula além de 25 mm): o nervo peitoral continua na face profunda do peitoral maior | feito |
| 9 | Pacote para o app | Deltas por vértice (int16, passo de 0,025 mm) em 3 quadros-chave por posição, só para os vértices que se movem; versões desktop e celular. Carregados sob demanda | feito |
| 10 | Execução no app | Morph targets do three.js com normais deformadas; animação de ~1 s; marcos ósseos e áreas de fixação acompanham os ossos; fibras e hilos acompanham os músculos já deformados (deslocamentos calculados no pipeline); rótulos, zonas e a câmera acompanham o tecido deformado; corte e seleção funcionam na posição | feito |
| 11 | Interface | Botão **Braço** no trilho (celular) e seletor acima do modelo (desktop); vistas com posição nos packs: Axila → Dissecção axilar → *Braço a 90°*; Axila → Marcos → *Mão atrás da cabeça*; Retalhos → Grande dorsal → *Decúbito lateral* | feito |
| 12 | Validação anatômica | Revisão por especialista das relações na posição (plexo, pedículo toracodorsal, pregas axilares), com o modo de revisão da aba Estudo | pendente |

Pipeline: `scripts/hybrid/build_poses.py` (`npm run poses:hybrid`). Execução no app: `src/lib/armPoses.ts`, `HybridModel.tsx` (morph targets) e `AnatomyViewer.tsx` (animação e camadas).

## Resultado medido no modelo

- Elevação umerotorácica atingida: 90,0°, 90,0° e 130,0°.
- Inclinação posterior da escápula resolvida pelo contato: ≈ 19° a 90° de abdução, ≈ 23° a 90° de flexão, 30° (teto) a 130°. Valores dentro das faixas de estudos cinemáticos 3D.
- Variação de comprimento dos músculos (distância entre as extremidades): mostrada no seletor de posição ("No modelo: …"). Direções coerentes com a função: na abdução alongam-se peitoral maior, grande dorsal e redondo maior e encurtam-se supraespinal, deltoide acromial e serrátil; na flexão encurtam-se a parte clavicular do peitoral maior, o deltoide clavicular, o coracobraquial e a cabeça curta do bíceps, e alongam-se o deltoide espinal e a cabeça longa do tríceps.
- A cabeça longa do bíceps fica fora dessa medida: o tendão desliza no sulco intertubercular e a inserção (tuberosidade do rádio) não está no modelo.

## Limitações

- **Não é simulação física.** Não há contração ativa, deslizamento entre músculos nem contato músculo-músculo. A deformação é geométrica (pesos anatômicos + correções) e serve para a topografia, não para biomecânica.
- **Pele.** A pele do tronco (HRA) não acompanha o braço e fica oculta nas posições; o braço não tem pele no modelo.
- **Mama.** Permanece na posição anatômica; o deslocamento da mama com a abdução não é modelado.
- **Vasos e nervos** acompanham os músculos e ossos vizinhos. O trajeto é plausível, mas não foi validado contra imagem em posição cirúrgica.
- **Mão na nuca** é a posição de maior amplitude: a deformação é mais aproximada.
- **Tamanho.** Cada posição baixa 1,6 MB no celular e 4,5 MB no desktop, uma única vez (fica em cache).

## Referências

- Inman VT, Saunders JB, Abbott LC. Observations on the function of the shoulder joint. *J Bone Joint Surg* 1944;26:1–30 (ritmo escapuloumeral).
- McClure PW et al. Direct 3-dimensional measurement of scapular kinematics during dynamic movements in vivo. *J Shoulder Elbow Surg* 2001;10:269–277.
- Ludewig PM et al. Motion of the shoulder complex during multiplanar humeral elevation. *J Bone Joint Surg Am* 2009;91:378–389.
- Kavan L et al. Geometric skinning with approximate dual quaternion blending. *ACM Trans Graph* 2008;27(4):105.
- Choi HF, Blemker SS. Skeletal muscle fascicle arrangements can be reconstructed using a Laplacian vector field simulation. *PLoS One* 2013;8:e77576 (campo harmônico de fibras).
