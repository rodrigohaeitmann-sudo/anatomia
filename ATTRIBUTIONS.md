# Atribuições de modelos anatômicos

O arquivo `public/models/hybrid/torso-female-hybrid.glb` é uma obra derivada que combina as fontes abaixo. Cada malha do GLB traz, nos `extras` do nó, a fonte, o nome original, o ID FMA (quando existe) e a licença. `src/data/hybridTorsoManifest.json` lista as mesmas informações. O processo está documentado em `scripts/hybrid/README.md`.

## HRA – Human Reference Atlas (NIH / HuBMAP), Visible Human Female v1.3

- Uso: pele do tronco e as duas glândulas mamárias (tecido adiposo, lobos, ductos e seios lactíferos, ligamentos suspensores, mamilo, aréola, tubérculos areolares).
- Fonte: https://github.com/hubmapconsortium/ccf-3d-reference-object-library (`VH_Female/v1.3`).
- Licença: Creative Commons Attribution 4.0 International (CC BY 4.0).
- Modificações: transformação rígida para o referencial do BodyParts3D, recorte da pele ao tronco, compressão em profundidade da base posterior da mama sobre a parede torácica, redução de malha da gordura mamária contralateral (20%), reflexão global e compressão meshopt.
- No aplicativo, a pele e as mamas também são exibidas deformadas (ptose graus I–III, `docs/plano-mamoplastia.md`). A deformação é calculada na exibição; o arquivo distribuído não muda.

## BodyParts3D 4.3 – The Database Center for Life Science (DBCLS)

- Uso: costelas, cartilagens costais, esterno, vértebras, escápula, clavícula, úmero, osso do quadril, músculos da parede torácica, do dorso e do ombro, e todos os vasos e nervos nomeados da axila, parede torácica e braço proximal.
- Fonte: malhas da Anatomography 4.3 espelhadas em https://github.com/olivercase/body_parts_3d_api (lista em `scripts/hybrid/bp3d43-selection.json`).
- Crédito: "BodyParts3D, © The Database Center for Life Science". A página oficial de licença (https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html) indica hoje CC BY 4.0. O espelho e os cabeçalhos antigos citam CC BY-SA 2.1 Japan. Por precaução, esta obra derivada segue os termos compartilha-igual.
- Citação: Mitsuhashi N, et al. BodyParts3D: 3D structure database for anatomical concepts. Nucleic Acids Res. 2009;37:D782–5. https://doi.org/10.1093/nar/gkn613
- Modificações: fusão de vértices, redução dos músculos intercostais (30%), reflexão global, mudança de referencial e compressão meshopt. As formas não foram alteradas.

## BodyParts3D 3.0 – DBCLS

- Uso: músculo grande dorsal esquerdo (FMA13359), ausente nas versões 4.x.
- Fonte: https://github.com/Kevin-Mattheus-Moerman/BodyParts3D (arquivo STL convertido do OBJ oficial 3.0).
- Licença/crédito: como acima.

## Z-Anatomy

- Uso: grupos de linfonodos axilares e paraesternais; fáscias peitoral, clavipeitoral, toracolombar e deltoidea; nervo peitoral lateral. Do esqueleto (`SkeletalSystem100.fbx`): marcos ósseos nomeados e áreas de fixação muscular do ombro, tórax e quadril, usados nas camadas de estudo (`src/data/anatomyLayers.json`, `public/models/hybrid/anatomy-layers.bin`).
- Fonte: https://github.com/LluisV/Z-Anatomy/tree/PC-Version/Resources/Models/FBX
- Licença: CC BY-SA 4.0. Atribuição solicitada: "Z-Anatomy - The open source atlas of anatomy - CC-BY-SA 4.0" e "BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan".
- Modificações: transformação de similaridade para o referencial do BodyParts3D (RMS de 2,0 mm), reflexão global e compressão meshopt. Marcos e áreas de fixação: cada osso do Z-Anatomy foi ajustado ao osso correspondente do BodyParts3D (similaridade global e ajuste rígido por osso; erro mediano de 0,1 a 1,4 mm) e os pontos/áreas foram projetados na superfície do osso do modelo, simplificados e quantizados. A classificação origem/inserção e alguns nomes de partes (trapézio ascendente/descendente) foram corrigidos pela posição. Não foram usados componentes do Z-Anatomy com licença não comercial.

## Camada esquemática da mama (este projeto)

- Uso: perfurantes da torácica interna, ramos mamários da torácica lateral, perfurantes intercostais anteriores, ramo mamário da toracoacromial, septo horizontal de Würinger, ligamentos medial e lateral, ligamento do sulco inframamário, ramos cutâneos dos nervos intercostais para o complexo areolopapilar (`src/data/breastAnatomy.json`).
- Origem: não vêm de exame nem de atlas 3D. São linhas de centro e lâminas traçadas por `scripts/hybrid/build_breast_anatomy.py` com regras tiradas da literatura (Würinger et al. 1998; Schlenz et al. 2000; van Deventer 2004; O'Dey et al. 2007; Bayati & Seckel 1995), ancoradas em marcos medidos nas malhas das fontes acima. No aplicativo aparecem com a fonte "Esquemático (literatura)" e com aviso na ficha.
- Licença: como dependem das malhas do modelo combinado, seguem a licença da obra derivada.

## Planos cirúrgicos (este projeto)

- Uso: marcações pré-operatórias, pedículos e ressecções da mamoplastia redutora (`src/data/mammaplasty.json`, `public/models/hybrid/mammaplasty.bin`) e os passos com o resultado esperado (`src/data/mammaplastySteps.json`, `public/models/hybrid/mammaplasty-<técnica>.bin`, gerados por `scripts/hybrid/build_mammaplasty_steps.py`: pele, peças, aréola, suturas, medidas e cicatrizes nos quadros-chave de cada técnica, e os vasos e nervos que o pedículo conserva, tirados da camada esquemática acima).
- Origem: gerados por `scripts/hybrid/build_mammaplasty.py` sobre a pele e a mama do HRA deformadas pelo mapa da mama. As peças são porções do volume da mama do modelo; as linhas seguem sua pele. Técnicas pelas descrições originais (Pitanguy 1967; Wise 1956; Robbins 1977; Courtiss & Goldwyn 1977; Hall-Findlay 1999), com dimensões propostas neste projeto. No aplicativo aparecem com a fonte "Plano cirúrgico (este projeto)" e com aviso na ficha.
- Licença: como dependem das malhas do modelo combinado, seguem a licença da obra derivada.

## Licença da obra derivada

Como incorpora material CC BY-SA, o modelo combinado é distribuído sob **CC BY-SA 4.0**, com as atribuições acima. O código do aplicativo continua sob a licença do repositório.

Ao adicionar modelos futuros, registre: fonte, licença original, autores, modificações, data de acesso e link.

Data de acesso das fontes: 2026-09-24 (esqueleto do Z-Anatomy: 2026-11-05).
