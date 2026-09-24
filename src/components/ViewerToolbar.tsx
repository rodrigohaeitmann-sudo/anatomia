import type { ViewMode } from "@/lib/viewerTypes";

type ViewerToolbarProps = {
  viewMode: ViewMode;
  onResetCamera: () => void;
  onTransverseCut: () => void;
  onToggleSkin: () => void;
  onShowVessels: () => void;
  onSetViewMode: (mode: ViewMode) => void;
};

export function ViewerToolbar({ viewMode, onResetCamera, onTransverseCut, onToggleSkin, onShowVessels, onSetViewMode }: ViewerToolbarProps) {
  const buttonClass = "shrink-0 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20";

  return (
    <div className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/70 p-2 shadow-xl backdrop-blur sm:flex-wrap sm:p-3">
      <button className={buttonClass} onClick={onResetCamera}>Resetar câmera</button>
      <button className={buttonClass} onClick={onTransverseCut}>Corte transversal</button>
      <button className={buttonClass} onClick={onToggleSkin}>Pele</button>
      <button className={buttonClass} onClick={onShowVessels}>Mapa neurovascular</button>
      <button className={`${buttonClass} ${viewMode === "anatomical" ? "bg-sky-500/40" : ""}`} onClick={() => onSetViewMode("anatomical")}>Modo anatômico</button>
      <button className={`${buttonClass} ${viewMode === "surgical" ? "bg-pink-500/40" : ""}`} onClick={() => onSetViewMode("surgical")}>Modo cirúrgico</button>
    </div>
  );
}
