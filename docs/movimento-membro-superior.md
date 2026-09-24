# Viabilidade: movimento do membro superior

## Resumo

É viável. Recomendo fazer em duas fases:

1. **Fase 1:** posições predefinidas do braço (poses), com esqueleto rígido e deformação simples dos tecidos moles.
2. **Fase 2:** movimento contínuo, com ritmo escapuloumeral.

Simulação muscular realista, com preservação de volume e deslizamento de planos, está fora do alcance de um app web/celular.

## Por que interessa

No retalho do grande dorsal, a posição do braço muda a anatomia cirúrgica:

- a abdução a 90° e a elevação anterior expõem a axila e tensionam a borda anterior do GD;
- o arco de rotação do pedículo depende da posição do úmero.

Hoje o modelo é estático, com o braço pendente, como no BodyParts3D.

## O que o modelo atual permite

- O esqueleto do BodyParts3D (úmero, escápula, clavícula) tem malhas separadas. Dá para definir articulações anatômicas:
  - glenoumeral: centro da cabeça umeral, obtido por ajuste de esfera à superfície articular;
  - escapulotorácica;
  - acromioclavicular e esternoclavicular.
- Músculos, vasos e nervos são malhas estáticas, sem "rig" (esqueleto de animação) e sem pesos de deformação.

## Abordagem proposta

**Fase 1 — poses predefinidas.** Poses: braço pendente, abdução de 90°, elevação anterior e decúbito lateral com braço em suporte.

1. **Rig.** Criar ossos para clavícula, escápula, úmero e antebraço com eixos anatômicos. O pipeline Python já calcula marcos; a cabeça umeral e a glenoide são ajustáveis por esfera.
2. **Pesos de skinning.** Gerar pesos por difusão de calor (heat diffusion), por exemplo no Blender em modo batch, que pode entrar no pipeline:
   - ossos com peso 1 no próprio osso;
   - músculos que cruzam a articulação (deltoide, GD, peitoral maior, redondos) com pesos graduais entre origem e inserção;
   - vasos e nervos axilares acompanhando o úmero distalmente e o tórax proximalmente.
3. **Deformação.** Usar dual-quaternion skinning para evitar o "colapso" do ombro. O three.js suporta `SkinnedMesh`, e o formato glTF aceita skins e animações.
4. **Ritmo escapuloumeral.** Na abdução, cerca de 2:1 (glenoumeral:escapulotorácico), acoplado com rotação da clavícula.

**Fase 2 — controle contínuo.** Controle deslizante de abdução, flexão e rotação, com o mesmo rig e interpolação das poses corretivas (blend shapes) ajustadas na fase 1.

## Limitações a esperar

- **Músculos:** o skinning não preserva volume nem simula contração. Músculos largos que cruzam o ombro (GD, peitoral maior, deltoide) vão esticar ou comprimir de forma aproximada. Para ensino da topografia é aceitável; para biomecânica, não.
- **Pele:** a pele HRA tem o braço abduzido e a do BodyParts3D tem o braço pendente. Um rig único exige refazer o recorte da pele do braço ou reposicionar a pele HRA para a pose de referência. Isso é trabalho de modelagem assistida.
- **Vasos e nervos:** o trajeto axilar muda de forma com a abdução. Com pesos lineares, o resultado é plausível, mas não validado. Uma solução intermediária é mover rigidamente só os segmentos distais ao colo do úmero.
- **Desempenho:** o skinning de cerca de 700 mil triângulos (versão mobile) em GPU é viável. A malha de desktop, com 2 M, exige testes em celulares mais antigos.
- **Validação:** as poses precisam de revisão anatômica, sobretudo a posição do plexo braquial e do pedículo toracodorsal na abdução.

## Estimativa de esforço

| Etapa | Complexidade |
|---|---|
| Rig ósseo + marcos articulares no pipeline | média |
| Pesos automáticos (Blender headless) + exportação glTF com skin | média |
| Poses predefinidas + seletor de pose no app | baixa |
| Ajuste de pele e pesos de vasos/nervos na axila | alta (manual) |
| Ritmo escapuloumeral contínuo | média |

## Alternativa de menor custo

Mover rigidamente só o esqueleto do braço e os músculos que nele se inserem, com o pedículo fixo. Isso mostraria a mudança de relação entre o úmero, a borda anterior do GD e a axila, sem deformar malhas. É semelhante às manipulações rígidas já disponíveis na aba Dissecar. Tem a limitação óbvia de gerar interpenetração no ombro.
