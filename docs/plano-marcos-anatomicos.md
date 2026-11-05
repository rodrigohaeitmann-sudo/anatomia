# Plano: marcos anatômicos e anatomia profunda para o cirurgião

Objetivo: dar ao modelo a precisão de referência que um cirurgião usa para refinar técnica, ou seja, tuberosidades e cristas, porções musculares, áreas de fixação, direção das fibras, hilos e projeções na pele. Cada item deve mostrar de onde vem e quão confiável é.

## O que os apps consagrados fazem (e onde este app vai além)

| App | Recurso de referência |
|---|---|
| Complete Anatomy | Mapa de origem e inserção, superfícies e marcos ósseos, músculo em movimento |
| Visible Body | Modo "marcos" ao selecionar osso; modo "fixações" que isola músculo, ossos, irrigação e inervação, com pinos vermelho/azul |
| BioDigital | Categoria de marcos ósseos por região; origens e inserções |
| Primal Pictures | Camadas, animações cirúrgicas e vídeo clínico |
| IMAIOS e-Anatomy | Correlação com TC e RM rotuladas |

Esses apps são feitos para ensino geral. Aqui o foco é a cirurgia da mama e da axila: medidas em mm, projeção na pele para marcação, distância até estruturas de risco, zonas de perfurantes e variações com prevalência. O modelo é comparado abertamente com a literatura.

## Fases e status

### Fase 1: dados que já existiam (implementada)

| Item | Status | Onde |
|---|---|---|
| Marcos ósseos nomeados (71, com ficha) | ✅ | aba Estudo → Marcos ósseos; botão "Marcos" no trilho |
| Áreas de origem/inserção sobre os ossos (55) | ✅ | ficha do músculo → "Ver fixações"; aba Estudo → todas as áreas |
| Porções musculares selecionáveis | ✅ | toque no músculo; ficha → Porções |
| Ficha "Modelo × literatura" e variações | ✅ | ficha do peitoral maior, grande dorsal, pedículo/nervo toracodorsal, intercostobraquial, vasos intercostais e torácicos internos |
| Revisão do especialista (confirmar/ajustar/incorreto, exportar JSON) | ✅ | ficha do marco; aba Estudo → Revisão |

### Fase 2: calculado sobre as malhas (implementada)

| Item | Status | Observação |
|---|---|---|
| Direção das fibras | ✅ | 11 conjuntos: partes do peitoral maior, peitoral menor, serrátil, grande dorsal, redondo maior, subescapular e partes do deltoide |
| Digitações do serrátil e fascículos do peitoral menor | ✅ | partição harmônica por costela de origem. O Z-Anatomy não tem área separada na 2ª costela, então a 1ª digitação cobre a 1ª–2ª |
| Inserções umerais ausentes no Z-Anatomy | ✅ | grande dorsal, redondo maior, coracobraquial e cabeça curta do bíceps por contato músculo-osso; marcadas como "calculado" |
| Hilos neurovasculares | ✅ | grande dorsal (artéria e nervo toracodorsais) e nervo peitoral medial no peitoral menor |
| Régua em mm | ✅ | trilho → Régua; também mede entre marcos |
| Mapa de distância até nervo/vaso | ✅ | ficha de nervos e vasos, ou aba Estudo |
| Marcação pré-operatória na pele | ✅ | borda do grande dorsal, prega axilar anterior, clavícula, margem medial da escápula, linha esternal, linha hemiclavicular, sulco inframamário, EIC e pontos ósseos palpáveis |

### Fase 3: curadoria e ensino (parcial)

| Item | Status | Observação |
|---|---|---|
| Zonas probabilísticas de perfurantes | ✅ | LICAP, TDAP, IMAP; faixas a partir das distâncias publicadas, sem desenhar vasos |
| Variações com prevalência | ✅ | arco axilar, intercostobraquial, ramificação do toracodorsal, músculo esternal, lâminas do tendão do peitoral maior |
| Autoavaliação "encontre o marco" (erro em mm) | ✅ | aba Estudo; repete primeiro os marcos com maior erro |
| Correlação com o corte anatômico real (Visible Human) | ⏳ | depende de confirmar a licença na NLM e registrar as fotos de criossecção ao modelo |
| Ossos de maior resolução (úmero, clavícula) | ⏳ | exige tomografia de osso real com licença aberta, ajustada à forma do BodyParts3D; a subdivisão só melhoraria a aparência |
| Variações em 3D (arco axilar, ramificações) | ⏳ | hoje em texto; modelar exigiria malhas de variantes reais com fonte |

## Precisão e procedência

- **Marcos e áreas (Z-Anatomy):** os ossos do Z-Anatomy derivam do mesmo BodyParts3D do modelo. Erro mediano do ajuste por osso: úmero 0,5 mm, escápula 0,7 mm, clavícula 0,5 mm, costelas 0,3–0,9 mm, quadril 1,4 mm (`fit` em `src/data/anatomyLayers.json`).
- **Correções sobre a fonte:** em cerca de um terço das áreas, o rótulo origem/inserção do Z-Anatomy contraria a convenção clássica (serrátil, peitoral menor, subclávio, trapézio). A classificação vem de tabela própria. As partes ascendente e descendente do trapézio estão trocadas na fonte e foram atribuídas pela posição.
- **Comparação com a literatura:**
  - A inserção do peitoral maior começa a 57,5 mm do topo da cabeça do úmero; a literatura dá 59,3 mm (55–64).
  - A inserção tem 45 mm de comprimento no modelo, contra cerca de 73 mm na literatura: o modelo encurta.
  - O hilo do grande dorsal fica a 20 mm da borda livre; a literatura dá 21–26 mm (10–40).
- **Literatura:** os números vêm dos resumos ou de fonte secundária (indicado em cada referência). Este ambiente não conseguiu abrir os artigos completos, então confira-os antes de uso formal.

## Limites

- Esqueleto e músculos são de um homem (BodyParts3D); pele e mama, de uma mulher (Visible Human Female). As projeções na pele e as zonas de perfurantes herdam essa diferença.
- Úmero (3,8 mil triângulos) e clavícula (1,2 mil) são malhas de baixa resolução nas duas fontes: os marcos estão no lugar certo, mas o relevo de cristas e tubérculos fica suavizado.
- As fibras seguem a superfície do músculo (campo harmônico 2D), não a arquitetura interna em lâminas.

## Como revisar

1. Abra a ficha de um marco (toque no ponto) → Confirmar, Ajustar posição (toque no osso) ou Incorreto, com comentário.
2. Na aba Estudo → Revisão → Exportar revisão (JSON).
3. Envie o arquivo: as correções entram no build (`scripts/hybrid/build_anatomy_layers.py`) e passam a valer para todos.

## Reprodução

`npm run layers:hybrid`. Detalhes em `scripts/hybrid/README.md`.
