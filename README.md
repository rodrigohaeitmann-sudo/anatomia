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
- Visualizador 3D central com placeholder anatômico.
- Sidebar de procedimentos.
- Timeline de etapas cirúrgicas.
- Painel didático da etapa selecionada.
- Toggles para estruturas anatômicas.
- Botões de reset de câmera, plano de corte e alternância entre modo anatômico/cirúrgico.
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

## Modelos anatômicos futuros

O MVP agora inclui um primeiro modelo regional derivado do Z-Anatomy em `public/models/z-anatomy/torso-mastology.glb`. Ele substitui o placeholder principal do visualizador e expõe malhas reais para grande dorsal, serrátil anterior, peitorais, parede torácica, axila, mama/regiões cutâneas e vasos toracodorsais.

Para regenerar o modelo:

1. Baixe os FBX oficiais do Z-Anatomy para `assets/source/z-anatomy/`.
2. Use os arquivos `MuscularSystem100.fbx`, `SkeletalSystem100.fbx`, `CardioVascular41.fbx` e `Regions_of_human_body100.fbx`.
3. Execute `npm run build:z-anatomy`.
4. Revise `src/data/zAnatomyTorsoManifest.json`.
5. Confira `ATTRIBUTIONS.md` e `public/models/z-anatomy/NOTICE.txt`.

Os FBX brutos ficam fora do Git por tamanho e rastreabilidade; o repositório versiona apenas o GLB processado e o manifesto.

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
