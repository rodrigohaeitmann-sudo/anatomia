import type { ViewMode } from "@/lib/viewerTypes";

type ViewerToolbarProps = {
  clippingEnabled: boolean;
  viewMode: ViewMode;
  onResetCamera: () => void;
  onToggleClipping: () => void;
  onToggleSkin: () => void;
  onShowVessels: () => void;
  onSetViewMode: (mode: ViewMode) => void;
};

export function ViewerToolbar({ clippingEnabled, viewMode, onResetCamera, onToggleClipping, onToggleSkin, onShowVessels, onSetViewMode }: ViewerToolbarProps) {
  const buttonClass = "rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20";

  return (
    <div className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-slate-950/70 p-3 shadow-xl backdrop-blur">
      <button className={buttonClass} onClick={onResetCamera}>Resetar câmera</button>
      <button className={buttonClass} onClick={onToggleClipping}>{clippingEnabled ? "Desativar corte" : "Ativar corte"}</button>
      <button className={buttonClass} onClick={onToggleSkin}>Ocultar/mostrar pele</button>
      <button className={buttonClass} onClick={onShowVessels}>Mostrar vasos</button>
      <button className={`${buttonClass} ${viewMode === "anatomical" ? "bg-sky-500/40" : ""}`} onClick={() => onSetViewMode("anatomical")}>Modo anatômico</button>
      <button className={`${buttonClass} ${viewMode === "surgical" ? "bg-pink-500/40" : ""}`} onClick={() => onSetViewMode("surgical")}>Modo cirúrgico</button>
    </div>
  );
}
