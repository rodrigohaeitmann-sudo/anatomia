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
- Celular: viewer em primeiro plano, navegação entre etapas, ferramentas em abas e modelo leve (704 mil triângulos, 2,9 MB).
- Cortes transversal, sagital e coronal com tampas coloridas no 3D e vista 2D do corte (estilo TC) com identificação por toque.
- Seleção por toque com ficha anatômica: origem, inserção, inervação, vascularização, ação, marcos e relevância cirúrgica.
- Packs de visualização por grupo (`src/data/packs.ts`), cada um com várias vistas:
  - Mama: anatomia da mama (camadas, parênquima, cortes sagital e transversal), irrigação e inervação, drenagem linfática, planos de reconstrução.
  - Axila: dissecção axilar (fáscia e músculos → limites sem fáscia → zona de dissecção projetada → níveis de Berg) e marcos anatômicos (nervos a preservar, eixo vascular, Rotter, corte transversal).
  - Retalhos: grande dorsal (músculo, pedículo, plano GD–serrátil, triângulos, arco de rotação) e toracolateral (pedículos, zona doadora, corte).
  - Parede torácica e ombro.
  Cada vista define as estruturas, o enquadramento, rótulos e zonas ancorados em pontos reais das estruturas, e opcionalmente corte, espaço ou manipulação. Link direto: `#pack/vista`.
- Dissecção livre: profundidade por camadas, janelas de pele, estruturas rebatidas e transpostas (transformações rígidas), vista explodida e espaços cirúrgicos com paredes destacadas.
- Viabilidade de movimento do membro superior: `docs/movimento-membro-superior.md`.

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

Nenhuma estrutura anatômica é desenhada proceduralmente. Os guias cirúrgicos (ilha de pele, incisões, loja, dreno) são marcações didáticas ancoradas em marcos anatômicos calculados das malhas.

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
