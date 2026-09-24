"use client";

import { useEffect, useMemo, useRef } from "react";
import type { SectionReport } from "@/components/AnatomyViewer";
import { modelLandmarks as L, modelStructures, tissueColors, type Tissue } from "@/lib/modelConfig";
import { filledTissues, pointInLoop } from "@/lib/sectioning";

const labelOf = new Map(modelStructures.map((structure) => [structure.id, structure.label]));
const orientation = {
  transverse: { left: "D", right: "E", top: "Anterior", bottom: "Posterior" },
  sagittal: { left: "Ant.", right: "Post.", top: "Cranial", bottom: "Caudal" },
  coronal: { left: "D", right: "E", top: "Cranial", bottom: "Caudal" },
};

/** 2D view of the cross-section: filled volumes, outlined surfaces, tap to identify. */
export function SectionView2D({ report, selected, onSelect }: { report: SectionReport; selected: string | null; onSelect: (structure: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useMemo(() => {
    if (!report || !report.result.loops.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const loop of report.result.loops) {
      for (let i = 0; i < loop.points.length; i += 2) {
        minX = Math.min(minX, loop.points[i]);
        maxX = Math.max(maxX, loop.points[i]);
        minY = Math.min(minY, loop.points[i + 1]);
        maxY = Math.max(maxY, loop.points[i + 1]);
      }
    }
    const byMesh = new Map<string, typeof report.result.loops>();
    report.result.loops.forEach((loop) => byMesh.set(loop.meshName, [...(byMesh.get(loop.meshName) ?? []), loop]));
    // largest meshes first so small structures (vessels, nerves) are drawn on top
    const meshes = [...byMesh.values()].sort((a, b) => Math.max(...b.map((l) => l.area)) - Math.max(...a.map((l) => l.area)));
    return { meshes, minX, minY, maxX, maxY };
  }, [report]);

  const size = 640;
  const transform = useMemo(() => {
    if (!view) return null;
    const pad = 24;
    const scale = (size - pad * 2) / Math.max(view.maxX - view.minX, view.maxY - view.minY, 1e-6);
    const ox = pad + ((size - pad * 2) - (view.maxX - view.minX) * scale) / 2;
    const oy = pad + ((size - pad * 2) - (view.maxY - view.minY) * scale) / 2;
    return { scale, x: (u: number) => ox + (u - view.minX) * scale, y: (v: number) => size - (oy + (v - view.minY) * scale), inv: (px: number, py: number) => [(px - ox) / scale + view.minX, (size - py - oy) / scale + view.minY] as const };
  }, [view]);

  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, size, size);
    context.fillStyle = "#020617";
    context.fillRect(0, 0, size, size);
    if (!view || !transform) return;
    for (const loops of view.meshes) {
      const { tissue, structure } = loops[0];
      const fill = filledTissues.has(tissue);
      const colour = structure === selected ? "#fde68a" : tissueColors[tissue as Tissue] ?? "#cbd5e1";
      const path = new Path2D();
      for (const loop of loops) {
        for (let i = 0; i < loop.points.length; i += 2) {
          const px = transform.x(loop.points[i]), py = transform.y(loop.points[i + 1]);
          if (i === 0) path.moveTo(px, py);
          else path.lineTo(px, py);
        }
        if (loop.closed) path.closePath();
      }
      if (fill) {
        context.fillStyle = colour;
        context.globalAlpha = tissue === "fat" ? 0.55 : 0.92;
        context.fill(path, "evenodd");
      }
      context.globalAlpha = 1;
      context.lineWidth = structure === selected ? 2.5 : tissue === "skin" ? 1.6 : 0.9;
      context.strokeStyle = fill ? "rgba(2,6,23,0.65)" : colour;
      context.stroke(path);
    }
  }, [view, transform, selected]);

  function pick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!view || !transform || !canvas.current) return;
    const rect = canvas.current.getBoundingClientRect();
    const [u, v] = transform.inv(((event.clientX - rect.left) / rect.width) * size, ((event.clientY - rect.top) / rect.height) * size);
    const hit = [...view.meshes].reverse().find((loops) => filledTissues.has(loops[0].tissue) && loops.filter((loop) => loop.closed && pointInLoop(u, v, loop.points)).length % 2 === 1);
    onSelect(hit?.[0].structure ?? null);
  }

  if (!report) return <p className="text-xs text-slate-400">Calculando o corte…</p>;
  const labels = orientation[report.axis];
  const reference = report.axis === "transverse" ? ((report.positionModel - L.nipple[1]) / L.unitsPerMm) : report.axis === "sagittal" ? ((report.positionModel - L.nipple[0]) / L.unitsPerMm) : ((report.positionModel - L.nipple[2]) / L.unitsPerMm);
  const referenceText =
    report.axis === "transverse" ? `${Math.abs(reference).toFixed(0)} mm ${reference >= 0 ? "acima" : "abaixo"} do mamilo` : report.axis === "sagittal" ? `${Math.abs(reference).toFixed(0)} mm ${reference >= 0 ? "medial" : "lateral"} ao mamilo` : `${Math.abs(reference).toFixed(0)} mm ${reference >= 0 ? "anterior" : "posterior"} ao mamilo`;
  const present = [...new Set(report.result.loops.map((loop) => loop.structure))];

  return (
    <div className="space-y-2">
      <div className="relative mx-auto aspect-square w-full max-w-[420px] overflow-hidden rounded-2xl border border-white/10">
        <canvas ref={canvas} width={size} height={size} onClick={pick} className="h-full w-full cursor-crosshair" />
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">{labels.left}</span>
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">{labels.right}</span>
        <span className="absolute left-1/2 top-1 -translate-x-1/2 text-[10px] font-bold text-slate-400">{labels.top}</span>
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-bold text-slate-400">{labels.bottom}</span>
      </div>
      <p className="text-center text-xs text-slate-300">{referenceText} · {present.length} estruturas no plano</p>
      <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
        {present.map((id) => (
          <button key={id} onClick={() => onSelect(id)} className={`rounded-full px-2 py-1 text-[10px] ${id === selected ? "bg-amber-300/30 text-amber-100" : "bg-slate-800 text-slate-300"}`}>
            {labelOf.get(id) ?? id}
          </button>
        ))}
      </div>
    </div>
  );
}
