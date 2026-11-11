# Anatomia Cirúrgica em Mastologia

Atlas anatômico 3D interativo para mastologia, organizado em packs de visualização.

## Stack

- Next.js App Router
- React + TypeScript
- Tailwind CSS
- Three.js, React Three Fiber e Drei
- Export estático preparado para GitHub Pages

## Funcionalidades

- Instalável como app (PWA): no Android, "Instalar app"; no iPhone, Safari → Compartilhar → "Adicionar à Tela de Início". Funciona offline após o primeiro acesso.
- Celular (padrão de apps de anatomia): modelo em tela cheia com barra superior compacta, trilho de ferramentas (rótulos, marcos, régua, corte, pele, vasos, foco, centro), painel inferior arrastável em três alturas com as vistas e as abas (Vista, Ficha, Estudo, Corte, Dissecar, Estruturas), biblioteca de packs com busca e modo paisagem compacto. Rótulos viram pinos numerados com linhas-guia e desobstrução automática; o texto abre ao toque e a legenda completa fica na aba Vista. A estrutura tocada aparece numa barra inferior e a ficha abre sob demanda. A câmera se recentra na área livre entre a barra e o painel. Modelo leve (704 mil triângulos, 2,9 MB).
- Cortes transversal, sagital e coronal com tampas coloridas no 3D e vista 2D do corte (estilo TC) com identificação por toque.
- Seleção por toque com ficha anatômica: origem, inserção, inervação, vascularização, ação, marcos e relevância cirúrgica. Porções musculares selecionáveis (partes do peitoral maior, deltoide e trapézio; cabeças do tríceps e do bíceps; digitações do serrátil anterior e fascículos do peitoral menor por costela).
- Aba **Estudo** (`docs/plano-marcos-anatomicos.md`): 71 marcos ósseos e hilos com ficha; áreas de origem e inserção sobre os ossos; direção das fibras; marcação pré-operatória na pele; zonas probabilísticas de perfurantes (LICAP, TDAP, IMAP); régua em mm; mapa de distância até nervos e vasos; quadro "Modelo × literatura" e variações com referências; autoavaliação "encontre o marco"; revisão do especialista exportável.
- Packs de visualização por grupo (`src/data/packs.ts`), cada um com várias vistas:
  - Mama: anatomia da mama (camadas, parênquima, cortes sagital e transversal), ptose mamária (perfis sem ptose e graus I–III de Regnault, frente, por dentro, corte sagital), irrigação e inervação, drenagem linfática, planos de reconstrução.
  - Axila: dissecção axilar (fáscia e músculos → limites sem fáscia → zona de dissecção projetada → níveis de Berg) e marcos anatômicos (nervos a preservar, eixo vascular, Rotter, corte transversal).
  - Retalhos: grande dorsal (músculo, pedículo, plano GD–serrátil, triângulos, arco de rotação) e toracolateral (pedículos, zona doadora, corte).
  - Parede torácica e ombro.
  Cada vista define as estruturas, o enquadramento, rótulos e zonas ancorados em pontos reais das estruturas, e opcionalmente corte, espaço ou manipulação. Link direto: `#pack/vista`.
- Dissecção livre: profundidade por camadas, janelas de pele, estruturas rebatidas e transpostas (transformações rígidas), vista explodida e espaços cirúrgicos com paredes destacadas.
- Posição do membro superior (botão **Braço** e vistas com posição nos packs): anatômica, abdução 90° na braçadeira, flexão 90° em decúbito lateral e mão na nuca. Músculos, vasos e nervos são deformados pela posição (pesos anatômicos, quatérnios duais, fibras esticadas entre origem e inserção, volume muscular, deslizamento sobre o tórax), com animação; marcos, fixações, fibras, rótulos e corte acompanham. Plano, método e limitações: `docs/movimento-membro-superior.md`.

- Forma da mama (botão **Mama** e pack Ptose mamária): sem ptose ou ptose graus I, II e III, cada grau com a hipertrofia que costuma acompanhá-lo (leve, moderada, acentuada). Pele, corpo adiposo, lobos, ductos, ligamentos, mamilo e aréola das duas mamas são deformados por um mesmo mapa (fluxo incompressível preso à parede torácica, mais o crescimento do monte), calculado no aparelho a partir de 87 kB de parâmetros medidos nas malhas; rótulos, marcação na pele, zonas e corte acompanham. Cada estado mostra as medidas tiradas no próprio modelo (mamilo × sulco, fúrcula–mamilo, mamilo–sulco, volume) e o grau de Regnault que resulta delas. Plano, especificação das técnicas e limitações: `docs/plano-mamoplastia.md`.
- Anatomia da mama enriquecida pela literatura (pack Irrigação e inervação da mama): perfurantes da torácica interna (2º–4º espaços), ramos mamários da torácica lateral, perfurantes intercostais anteriores (4º–6º), ramo mamário da toracoacromial, septo horizontal de Würinger com os ligamentos medial e lateral, ligamento do sulco inframamário, ramo cutâneo lateral do 4º nervo intercostal (profundo e superficial) e ramos cutâneos laterais e anteriores do 3º ao 5º. São 10 estruturas **esquemáticas**: linhas de centro e lâminas traçadas por regras da literatura sobre marcos medidos nas malhas reais (costelas e espaços intercostais, troncos de origem, parede, pele, mamilo, sulco), 67 kB. As malhas são construídas no aparelho e acompanham a forma da mama mantendo o calibre. Cada ficha traz o aviso, o trajeto, a relevância para os pedículos e as referências.

## Desenvolvimento

```bash
npm install
npm run dev
```

Validações locais:

```bash
npm run lint
npm run typecheck
npm run build
```

## Modelo anatômico

O visualizador usa um **modelo híbrido feminino** (`public/models/hybrid/torso-female-hybrid.glb`, 8,9 MB com meshopt, 2,0 milhões de triângulos, 223 malhas). Ele combina:

- **pele e mamas do Visible Human Female (NIH/HRA)**: gordura, lobos, ductos, seios lactíferos, ligamentos de Cooper, mamilo e aréola;
- **esqueleto, músculos, vasos e nervos reais do BodyParts3D 4.3**: pedículo toracodorsal, vasos axilares, subescapulares, torácicos laterais, toracoacromiais e intercostais; plexo braquial, nervos toracodorsal, torácico longo, peitorais e intercostobraquial;
- **grande dorsal do BodyParts3D 3.0**;
- **linfonodos axilares e fáscias do Z-Anatomy**.

As malhas do modelo vêm de exames e atlas publicados e não são redesenhadas. A exceção é a camada esquemática da mama (ver "Forma da mama" acima e `ATTRIBUTIONS.md`), identificada como tal na lista de estruturas e nas fichas. Os guias cirúrgicos (ilha de pele, incisões, loja, dreno) são marcações didáticas ancoradas em marcos anatômicos calculados das malhas.

Os estados da mama (ptose) não alteram o arquivo do modelo: são deformações das malhas reais aplicadas no app (`npm run breast:hybrid` regenera a carta e os parâmetros).

O processo (registro entre fontes, preservação das referências anatômicas, limitações) está em `scripts/hybrid/README.md`. As atribuições estão em `ATTRIBUTIONS.md`.

Para regenerar:

```bash
pip install -r scripts/hybrid/requirements.txt
npm run fetch:hybrid
npm run build:hybrid
```

## Deploy no GitHub Pages

O deploy está configurado para GitHub Pages via GitHub Actions. O arquivo `next.config.mjs` usa `output: "export"` e configura `basePath`/`assetPrefix` durante GitHub Actions para publicar o app no subcaminho do repositório.

Para acessar o app pelo link do GitHub Pages:

1. Envie a branch `main` para o GitHub.
2. No GitHub, acesse **Settings → Pages**.
3. Em **Build and deployment**, selecione **Source: GitHub Actions**.
4. Execute ou aguarde o workflow **Deploy GitHub Pages**.
5. Acesse `https://rodrigohaeitmann-sudo.github.io/anatomia/`.

O workflow `.github/workflows/deploy.yml` instala dependências, gera o export estático em `out`, adiciona `.nojekyll`, envia o artefato e publica com `actions/deploy-pages`.

## Aviso

Este MVP usa conteúdo e geometria demonstrativos. O material deve ser revisado por especialistas antes de uso educacional formal ou clínico.
