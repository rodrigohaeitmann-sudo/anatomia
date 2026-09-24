# Anatomia Cirúrgica em Mastologia

Webapp MVP para visualização interativa de cortes anatômicos e etapas cirúrgicas em mastologia.

## Stack

- Next.js App Router
- React + TypeScript
- Tailwind CSS
- Three.js, React Three Fiber e Drei
- Export estático preparado para GitHub Pages

## Funcionalidades do MVP

- Página inicial com apresentação do projeto.
- Visualizador 3D com modelo anatômico feminino híbrido, iluminação PBR, corte sagital real e modo cirúrgico.
- Sidebar de procedimentos.
- Timeline de etapas cirúrgicas.
- Painel didático da etapa selecionada.
- Toggles para estruturas anatômicas.
- Botões de reset de câmera, corte sagital (pelo mamilo) e alternância entre modo anatômico/cirúrgico.
- Dados em `src/data/procedures.ts`.
- Pastas `public/models/` e `public/placeholders/` preparadas para recursos futuros.

## Procedimento inicial

O primeiro módulo mockado é **Reconstrução mamária com retalho do grande dorsal**, com 10 etapas iniciais do posicionamento até a modelagem e fixação do retalho.

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
