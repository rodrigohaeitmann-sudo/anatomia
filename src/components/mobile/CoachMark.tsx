"use client";

import { useEffect, useState } from "react";
import { Hand, X } from "lucide-react";

const KEY = "anatomia.coach.v1";

/** One-time hint on phones: how pins, selection and the sheet work. */
export function CoachMark({ bottom }: { bottom: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (!window.localStorage.getItem(KEY)) setShow(true);
    } catch {
      setShow(false);
    }
  }, []);
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* storage unavailable: the hint simply shows again next time */
    }
  };
  return (
    <div className="fixed inset-x-3 z-30 flex items-start gap-3 rounded-[22px] border border-sky-300/20 bg-slate-950/[0.92] p-3 text-[13px] leading-snug text-slate-200 shadow-2xl backdrop-blur-xl" style={{ bottom }} role="status">
      <Hand size={20} className="mt-0.5 shrink-0 text-sky-300" />
      <p className="flex-1">
        Toque nos <b className="text-white">números</b> para ler os rótulos e numa <b className="text-white">estrutura</b> para selecioná-la. Arraste o painel para cima para ver a legenda e as ferramentas.
      </p>
      <button type="button" onClick={dismiss} className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/10 text-slate-200" aria-label="Fechar dica">
        <X size={16} />
      </button>
    </div>
  );
}
