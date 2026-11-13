"use client";

import { Children, forwardRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { fold } from "@/lib/text";
import { Icon, type IconName } from "./Icon";

export { fold };

/** Joins class names, skipping empty ones. */
export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

/** True when `className` already sets a utility of this family (so a component default can step aside). */
const sets = (className: string | undefined, family: RegExp) => Boolean(className && className.split(/\s+/).some((name) => family.test(name)));

/** Public asset path, prefixed with the GitHub Pages sub-path when deployed there. */
export const asset = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;

/** Fixed colours per structure group (semantic, as in the design). */
export const groupTone: Record<string, string> = {
  Superfície: "#B68690",
  Pele: "#B68690",
  Mama: "#8E5C68",
  Músculos: "#A4453E",
  Fáscias: "#9C6E2E",
  Vasos: "#7E332E",
  Nervos: "#9C6E2E",
  Linfáticos: "#5C8473",
  Esqueleto: "#B9AC9C",
  Ossos: "#B9AC9C",
};
export const toneOfGroup = (group: string | undefined) => (group && groupTone[group]) || "#8C8389";

export function Lbl({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx("text-[11.5px] font-semibold uppercase tracking-[1.5px] text-muted", className)} style={style}>
      {children}
    </div>
  );
}

export function H1({ children, sub, className }: { children: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-1.2px] text-ink">{children}</h1>
      {sub && <p className="mt-2 text-[15.5px] leading-[1.45] text-ink-2">{sub}</p>}
    </div>
  );
}

export function Card({ children, className, style, padded = true, as: Tag = "div", onClick }: { children: ReactNode; className?: string; style?: CSSProperties; padded?: boolean; as?: "div" | "button" | "article" | "section"; onClick?: () => void }) {
  return (
    <Tag onClick={onClick} {...(Tag === "button" ? { type: "button" as const } : {})} className={cx("rounded-card border border-line bg-surface text-left shadow-card", padded && !sets(className, /^p[xy]?-/) && "p-[18px]", className)} style={style}>
      {children}
    </Tag>
  );
}

type ChipTone = "neutral" | "sage" | "amber" | "danger" | "rose" | "warm" | "ink";
const chipTones: Record<ChipTone, string> = {
  neutral: "bg-surface-alt text-ink-2",
  sage: "bg-sage-tint text-sage-deep",
  amber: "bg-amber-tint text-amber-deep",
  danger: "bg-danger-tint text-danger-deep",
  rose: "bg-rose-tint text-rose-deep",
  warm: "bg-warm text-ink",
  ink: "bg-ink text-on-ink",
};
export function Chip({ children, tone = "neutral", size = "m", className }: { children: ReactNode; tone?: ChipTone; size?: "s" | "m"; className?: string }) {
  return (
    <span className={cx("inline-block whitespace-nowrap rounded-lg font-semibold uppercase", size === "s" ? "px-2 py-1 text-[10.5px] tracking-[0.8px]" : "px-2.5 py-[5px] text-[11.5px] tracking-[0.6px]", chipTones[tone], className)}>
      {children}
    </span>
  );
}

type BtnVariant = "primary" | "ghost" | "warm" | "soft" | "danger";
const btnVariants: Record<BtnVariant, string> = {
  primary: "bg-ink text-on-ink border-transparent active:bg-ink/90",
  ghost: "bg-transparent text-ink border-line active:bg-surface-alt",
  warm: "bg-warm text-ink border-transparent active:bg-warm/80",
  soft: "bg-rose-bg text-rose-deep border-transparent",
  danger: "bg-danger-tint text-danger-deep border-transparent",
};
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; icon?: IconName; leading?: IconName; full?: boolean };
export const Btn = forwardRef<HTMLButtonElement, BtnProps>(function Btn({ variant = "primary", icon, leading, full = true, className, children, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "flex items-center justify-center rounded-[14px] border font-semibold transition-colors disabled:opacity-40",
        !sets(className, /^h-/) && "h-14",
        !sets(className, /^gap-/) && "gap-2.5",
        !sets(className, /^text-(xs|sm|base|lg|xl|\[)/) && "text-base",
        full && !sets(className, /^w-/) && "w-full",
        btnVariants[variant],
        className,
      )}
      {...rest}
    >
      {leading && <Icon name={leading} size={19} />}
      {children}
      {icon && <Icon name={icon} size={19} stroke={1.8} />}
    </button>
  );
});

export function Pick({ children, on = false, onClick, className, size = "m", disabled, title }: { children: ReactNode; on?: boolean; onClick?: () => void; className?: string; size?: "s" | "m"; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      disabled={disabled}
      title={title}
      className={cx(
        "shrink-0 whitespace-nowrap rounded-full border transition-colors disabled:opacity-40",
        size === "s" ? "px-[13px] py-2 text-[13.5px]" : "px-[18px] py-[11px] text-[15px]",
        on ? "border-transparent bg-ink font-semibold text-on-ink" : "border-line bg-surface font-medium text-ink-2 active:bg-surface-alt",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Seg<T extends string>({ options, value, onChange, className, size = "m", label }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; className?: string; size?: "s" | "m"; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("flex gap-1 rounded-full border border-line bg-surface p-1", className)}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={cx("flex-1 rounded-full transition-colors", size === "s" ? "h-9 text-[13.5px]" : "h-11 text-[15px]", on ? "bg-ink font-semibold text-on-ink" : "font-medium text-ink-2")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Compact Guiado/Livre style toggle used on top of the viewer. */
export function ModeToggle<T extends string>({ options, value, onChange, className, glass = false }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; className?: string; glass?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Modo de estudo" className={cx("flex shrink-0 rounded-full border border-line p-[3px]", glass ? "glass" : "bg-surface-alt", className)}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button key={option.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(option.value)} className={cx("rounded-full px-3 py-2 text-[13px] font-semibold transition-colors", on ? "bg-ink text-on-ink" : "text-ink-2")}>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx("flex h-7 w-[46px] shrink-0 rounded-full p-[3px] transition-colors disabled:opacity-40", on ? "justify-end bg-ink" : "justify-start bg-line")}
    >
      <span className="h-[22px] w-[22px] rounded-full bg-surface shadow-[0_1px_2px_rgba(34,28,32,.15)]" />
    </button>
  );
}

export function Group({ children, className }: { children: ReactNode; className?: string }) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <div className={cx("overflow-hidden rounded-card border border-line bg-surface shadow-card", className)}>
      {items.map((child, index) => (
        <div key={index} className={index ? "border-t border-line-soft" : undefined}>
          {child}
        </div>
      ))}
    </div>
  );
}

type CircTone = "surface" | "ink" | "warm" | "glass";
const circTones: Record<CircTone, string> = {
  surface: "bg-surface border-line text-ink",
  ink: "bg-ink border-transparent text-on-ink",
  warm: "bg-warm border-line text-ink",
  glass: "glass border-line text-ink shadow-glass",
};
export function Circ({ icon, size = 44, iconSize = 20, tone = "surface", onClick, label, active, className, disabled }: { icon: IconName; size?: number; iconSize?: number; tone?: CircTone; onClick?: () => void; label: string; active?: boolean; className?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      className={cx("grid shrink-0 place-items-center rounded-full border transition active:scale-95 disabled:opacity-35", active ? "border-transparent bg-ink text-on-ink" : circTones[tone], className)}
      style={{ width: size, height: size }}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}

/** Tool of the dock / toolbar: icon over label (vertical) or icon beside label (row). */
export function ToolButton({ icon, label, on, row = false, onClick, className, badge }: { icon: IconName; label: string; on?: boolean; row?: boolean; onClick?: () => void; className?: string; badge?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cx(
        "relative flex items-center transition-colors",
        row ? "h-10 flex-row justify-start gap-2 rounded-xl px-3.5" : "flex-col justify-center gap-1 rounded-2xl px-1 py-2",
        on ? "bg-warm text-ink" : "text-ink-2 active:bg-surface-alt",
        className,
      )}
    >
      <Icon name={icon} size={21} stroke={on ? 2 : 1.6} />
      <span className={cx(row ? "text-[13.5px]" : "text-[11px]", on ? "font-semibold" : "font-medium")}>{label}</span>
      {badge && <span className="absolute right-[22%] top-1.5 h-2 w-2 rounded-full bg-rose-deep" />}
    </button>
  );
}

/** View progress: done views in rose, current one wide in ink. */
export function Dots({ count, active, className }: { count: number; active: number; className?: string }) {
  return (
    <div className={cx("flex items-center gap-[5px]", className)} aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={cx("h-1.5 rounded-md transition-all", index === active ? "w-[18px] bg-ink" : index < active ? "w-1.5 bg-rose" : "w-1.5 bg-line")} />
      ))}
    </div>
  );
}

export function Stat({ label, value, unit, size = 22 }: { label: string; value: ReactNode; unit?: string; size?: number }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase leading-tight tracking-[0.6px] text-muted">{label}</div>
      <div className="mt-[3px] flex items-baseline gap-1">
        <span className="tabular font-medium tracking-[-0.6px] text-ink" style={{ fontSize: size }}>
          {value}
        </span>
        {unit && <span className="text-[12.5px] text-muted">{unit}</span>}
      </div>
    </div>
  );
}

export function Brand({ size = 19, sub = true, className }: { size?: number; sub?: boolean; className?: string }) {
  return (
    <div className={cx("flex items-center gap-[9px]", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset("/brand/logo-ink.png")} width={size + 7} height={size + 7} alt="" className="block object-contain" />
      <span className="font-semibold tracking-[-0.4px] text-ink" style={{ fontSize: size }}>
        MamaFlow
      </span>
      {sub && <span className="rounded-lg bg-rose-tint px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.8px] text-rose-deep">Anatomia</span>}
    </div>
  );
}

export function SearchField({ value, onChange, placeholder = "Buscar…", autoFocus, onFocus, className, inputRef }: { value: string; onChange: (value: string) => void; placeholder?: string; autoFocus?: boolean; onFocus?: () => void; className?: string; inputRef?: React.Ref<HTMLInputElement> }) {
  return (
    <label className={cx("flex h-[54px] items-center gap-3 rounded-full border bg-surface px-[18px] transition-colors focus-within:border-ink", value ? "border-ink" : "border-line", className)}>
      <Icon name="search" size={20} color={value ? "#221C20" : "#8C8389"} />
      <input
        ref={inputRef}
        type="search"
        value={value}
        autoFocus={autoFocus}
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-base font-medium text-ink outline-none placeholder:font-normal placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Limpar busca" className="grid h-[26px] w-[26px] place-items-center rounded-full bg-surface-alt text-ink-2">
          <Icon name="x" size={14} />
        </button>
      )}
    </label>
  );
}

export function BackHeader({ eyebrow, title, onBack, action }: { eyebrow?: string; title: string; onBack: () => void; action?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-3 px-5 pb-4 pt-1.5">
      <Circ icon="chevL" onClick={onBack} label="Voltar" />
      <div className="min-w-0 flex-1 text-center">
        {eyebrow && <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-[1.4px] text-muted">{eyebrow}</div>}
        <div className="truncate text-[17px] font-semibold tracking-[-0.2px]">{title}</div>
      </div>
      <div className="grid h-11 w-11 place-items-center">{action}</div>
    </div>
  );
}

/** Slider in the MamaFlow style (thin track, ink fill, round thumb). */
export function Range({ value, min = 0, max = 1, step = 0.01, onChange, label, className }: { value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void; label: string; className?: string }) {
  const fill = ((value - min) / (max - min || 1)) * 100;
  return (
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className={cx("mf-slider w-full", className)}
      style={{ "--fill": `${fill}%` } as CSSProperties}
    />
  );
}

/** Empty state with an icon tile. */
export function Empty({ icon, title, sub, children }: { icon: IconName; title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3.5 px-8 py-10 text-center">
      <div className="grid h-[68px] w-[68px] place-items-center rounded-[22px] bg-warm text-rose-deep">
        <Icon name={icon} size={28} stroke={1.5} />
      </div>
      <div className="text-xl font-semibold tracking-[-0.4px]">{title}</div>
      {sub && <div className="max-w-sm text-[14.5px] leading-normal text-ink-2">{sub}</div>}
      {children}
    </div>
  );
}

/** Highlights the part of `text` that matches `query` (accent-insensitive). */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = fold(query.trim());
  if (!q) return <>{text}</>;
  const index = fold(text).indexOf(q);
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <span className="rounded-[4px] bg-rose-tint">{text.slice(index, index + q.length)}</span>
      {text.slice(index + q.length)}
    </>
  );
}
