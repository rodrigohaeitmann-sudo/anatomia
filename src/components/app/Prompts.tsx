"use client";

import { FloatingPrompt } from "@/components/tools/StudyPanel";
import { landmarkById } from "@/lib/anatomyLayers";
import type { ViewerController } from "./useViewerController";

/** Banners over the model while a mode waits for taps on it: quiz, ruler, adjusting a landmark. */
export function ViewerPrompts({ ctl, top, className }: { ctl: ViewerController; top: number; className?: string }) {
  if (ctl.quiz) {
    const quiz = ctl.quiz;
    const mean = quiz.session.length ? quiz.session.reduce((a, b) => a + b, 0) / quiz.session.length : null;
    return (
      <FloatingPrompt
        top={top}
        className={className}
        title={
          ctl.quizTarget ? (
            <>
              Toque: <span className="text-rose-deep">{ctl.quizTarget.name}</span>
            </>
          ) : (
            "Sem marcos visíveis"
          )
        }
        detail={quiz.errorMm !== null ? `Erro ${quiz.errorMm.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mm · média ${mean?.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mm (${quiz.session.length})` : ctl.quizTarget?.bone}
        actions={[
          { label: quiz.errorMm === null ? "Pular" : "Próximo", primary: true, onPress: ctl.nextQuiz },
          { label: "Sair", onPress: ctl.stopQuiz },
        ]}
      />
    );
  }
  if (ctl.adjusting) {
    return (
      <FloatingPrompt
        top={top}
        className={className}
        title={
          <>
            Toque no osso: nova posição de <span className="text-rose-deep">{landmarkById.get(ctl.adjusting)?.name}</span>
          </>
        }
        actions={[{ label: "Cancelar", onPress: () => ctl.setAdjusting(null) }]}
      />
    );
  }
  if (ctl.study.ruler && ctl.tool !== "study") {
    const text = ctl.rulerPoints.length === 0 ? "Régua: toque o primeiro ponto" : ctl.rulerPoints.length === 1 ? "Régua: toque o segundo ponto" : `Distância: ${ctl.rulerMm?.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mm`;
    return (
      <FloatingPrompt
        top={top}
        className={className}
        title={text}
        actions={[
          ...(ctl.rulerPoints.length ? [{ label: "Limpar", onPress: ctl.clearRuler }] : []),
          { label: "Sair", primary: true, onPress: () => ctl.setStudy({ ...ctl.study, ruler: false }) },
        ]}
      />
    );
  }
  return null;
}
