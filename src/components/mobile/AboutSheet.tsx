"use client";

import { X } from "lucide-react";
import { hybridTorsoModel } from "@/lib/modelConfig";

/** Model description, credits and usage tips (moved off the 3D view on phones). */
export function AboutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Sobre o modelo" className={`fixed inset-0 z-50 flex items-end bg-black/50 transition duration-300 ${open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`} onClick={onClose}>
      <div className={`max-h-[85dvh] w-full overflow-y-auto rounded-t-[28px] border-t border-white/10 bg-slate-950/95 p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-2xl transition duration-300 ${open ? "translate-y-0" : "translate-y-10"}`} onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-sky-300">Atlas anatômico interativo</p>
            <h2 className="text-xl font-black text-white">Anatomia Cirúrgica em Mastologia</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/10 text-white" aria-label="Fechar">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4 text-sm leading-relaxed text-slate-300">
          <section>
            <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-emerald-300">Como usar</h3>
            <ul className="list-disc space-y-1 pl-4">
              <li>Arraste para girar, pince para aproximar, dois dedos para deslocar.</li>
              <li>Toque numa estrutura para selecioná-la; a ficha abre pelo botão Ficha.</li>
              <li>Os números no modelo são rótulos: toque para ler. A legenda completa fica na aba Vista.</li>
              <li>Arraste o painel inferior para cima para ver mais; para baixo para liberar o modelo.</li>
            </ul>
          </section>
          <section>
            <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-emerald-300">Modelo</h3>
            <p>
              Modelo híbrido feminino com {(hybridTorsoModel.totalTriangles / 1e6).toFixed(1)} milhões de triângulos: pele e mamas do Visible Human Female (HRA/NIH); esqueleto, músculos, vasos e nervos do BodyParts3D 4.3 (DBCLS); grande dorsal do BodyParts3D 3.0; linfonodos e fáscias do Z-Anatomy. Nenhuma estrutura anatômica é desenhada à mão.
            </p>
          </section>
          <section>
            <h3 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-emerald-300">Créditos e licenças</h3>
            <ul className="list-disc space-y-1 pl-4">
              <li>HRA / NIH Visible Human Female — CC BY 4.0</li>
              <li>BodyParts3D, © The Database Center for Life Science</li>
              <li>Z-Anatomy — CC BY-SA 4.0</li>
              <li>Obra derivada distribuída sob CC BY-SA 4.0</li>
            </ul>
          </section>
          <p className="rounded-2xl border border-amber-300/20 bg-amber-400/5 p-3 text-xs text-amber-100/80">Conteúdo didático. Textos, zonas e relações devem ser revisados por especialistas antes de uso formal ou clínico.</p>
        </div>
      </div>
    </div>
  );
}
