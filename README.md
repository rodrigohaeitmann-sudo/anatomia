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

1. Revisar licença da fonte, por exemplo Z-Anatomy, antes de baixar ou converter arquivos.
2. Organizar as estruturas no Blender.
3. Reduzir polígonos quando necessário.
4. Padronizar nomes de malhas.
5. Exportar como `.glb` ou `.gltf`.
6. Copiar para `public/models/`.
7. Mapear as estruturas em `src/lib/modelConfig.ts`.
8. Registrar fonte, autores, licença, modificações e data de acesso em `ATTRIBUTIONS.md`.

## Deploy no GitHub Pages

O deploy está configurado para GitHub Pages via GitHub Actions. O arquivo `next.config.ts` usa `output: "export"` e configura `basePath`/`assetPrefix` durante GitHub Actions para publicar o app no subcaminho do repositório.

Para acessar o app pelo link do GitHub Pages:

1. Envie a branch `main` para o GitHub.
2. No GitHub, acesse **Settings → Pages**.
3. Em **Build and deployment**, selecione **Source: GitHub Actions**.
4. Execute ou aguarde o workflow **Deploy GitHub Pages**.
5. Acesse `https://rodrigohaeitmann-sudo.github.io/anatomia/`.

O workflow `.github/workflows/deploy.yml` instala dependências, gera o export estático em `out`, adiciona `.nojekyll`, envia o artefato e publica com `actions/deploy-pages`.

## Aviso

Este MVP usa conteúdo e geometria demonstrativos. O material deve ser revisado por especialistas antes de uso educacional formal ou clínico.
