"use client";

import { StructureToggleList } from "@/components/StructureToggleList";
import { CutPanel } from "@/components/tools/CutPanel";
import { DissectionPanel } from "@/components/tools/DissectionPanel";
import { StudyPanel } from "@/components/tools/StudyPanel";
import { ArmPanel, LayersPanel, NotePanel, ShapePanel } from "./ToolPanels";
import type { ViewerController } from "./useViewerController";

/** Content of the open tool, the same on phones (sheet over the dock) and on desktop (panel or popover). */
export function ToolBody({ ctl, wide = false }: { ctl: ViewerController; wide?: boolean }) {
  switch (ctl.tool) {
    case "layers":
      return <LayersPanel ctl={ctl} onStructures={() => ctl.setTool("structures")} />;
    case "cut":
      return <CutPanel cut={ctl.cut} onChange={ctl.setCut} report={ctl.section} selected={ctl.selected} onSelect={(structure) => (structure ? ctl.openDetails(structure) : ctl.deselect())} />;
    case "shape":
      return <ShapePanel ctl={ctl} columns={wide ? 2 : 3} />;
    case "arm":
      return <ArmPanel ctl={ctl} factCount={wide ? 3 : 2} />;
    case "note":
      return <NotePanel ctl={ctl} />;
    case "study":
      return (
        <StudyPanel
          study={ctl.study}
          onStudy={ctl.setStudy}
          onSkeleton={ctl.showSkeleton}
          rulerPoints={ctl.rulerPoints}
          rulerMm={ctl.rulerMm}
          onClearRuler={ctl.clearRuler}
          quiz={ctl.quiz}
          quizPool={ctl.quizPool}
          onQuizStart={ctl.startQuiz}
          onQuizNext={ctl.nextQuiz}
          onQuizStop={ctl.stopQuiz}
          review={ctl.review.store}
          onExportReview={ctl.exportReview}
        />
      );
    case "dissection":
      return <DissectionPanel dissection={ctl.dissection} onChange={ctl.setDissection} />;
    case "structures":
      return <StructureToggleList visibility={ctl.visibility} onToggle={ctl.toggleStructure} embedded steps={ctl.stepStructures} allow={ctl.view.surgery ? ctl.allowed : undefined} />;
    default:
      return null;
  }
}
