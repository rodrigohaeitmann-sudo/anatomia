import type { CSSProperties, ReactElement } from "react";

/**
 * Icon set of MamaFlow (1.6 stroke, 24 px grid) plus the anatomy-specific icons of MamaFlow Anatomia.
 * Paths copied from the design kit so screens match it exactly.
 */
const paths = {
  home: <path d="M3.5 11.5L12 4l8.5 7.5M5.5 10v9a1 1 0 001 1h3.5v-5h4v5H17a1 1 0 001-1v-9" />,
  book: <path d="M5 4h12a2 2 0 012 2v14H7a2 2 0 01-2-2V4zM5 4v14M19 20H7M9 8h6M9 12h5" strokeLinecap="round" />,
  flow: (
    <g>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <path d="M7.6 7.7L11 16M16.4 7.7L13 16M8 6h8" />
    </g>
  ),
  search: (
    <g>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" strokeLinecap="round" />
    </g>
  ),
  chevR: <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />,
  chevL: <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />,
  chevD: <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />,
  chevU: <path d="M6 15l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />,
  arrowR: <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />,
  arrowL: <path d="M19 12H5M11 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />,
  x: <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />,
  plus: <path d="M12 5v14M5 12h14" strokeLinecap="round" />,
  check: <path d="M5 12.5l4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />,
  user: (
    <g>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </g>
  ),
  hist: (
    <g>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" strokeLinecap="round" />
      <path d="M3 4v4h4M12 8v4.5l3 1.8" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
  trash: <path d="M4.5 6.5h15M9 6.5V4.5h6v2M6.5 6.5l1 13.5h9l1-13.5M10 10v7M14 10v7" strokeLinecap="round" strokeLinejoin="round" />,
  info: (
    <g>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.6h0M11 11h1.2v6h1.3" strokeLinecap="round" />
    </g>
  ),
  eye: (
    <g>
      <path d="M2.8 12S6.5 6 12 6s9.2 6 9.2 6-3.7 6-9.2 6-9.2-6-9.2-6z" />
      <circle cx="12" cy="12" r="2.6" />
    </g>
  ),
  eyeOff: (
    <g>
      <path d="M4 4l16 16" strokeLinecap="round" />
      <path d="M9.6 5.3A9.6 9.6 0 0112 5c5.5 0 9.2 6 9.2 6a17 17 0 01-3 3.6M6.7 7.4A17 17 0 002.8 11s3.7 6 9.2 6a9.4 9.4 0 003.6-.7" strokeLinecap="round" />
    </g>
  ),
  shield: <path d="M12 3.5l7 2.5v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z" strokeLinejoin="round" />,
  doc: (
    <g>
      <path d="M6 3.5h7l5 5V20a1 1 0 01-1 1H6a1 1 0 01-1-1V4.5a1 1 0 011-1z" strokeLinejoin="round" />
      <path d="M13 3.5V9h5M8.5 13h7M8.5 16.5h5" strokeLinecap="round" />
    </g>
  ),
  heart: <path d="M12 20s-7.5-4.4-7.5-9.4A4.1 4.1 0 0112 8a4.1 4.1 0 017.5 2.6c0 5-7.5 9.4-7.5 9.4z" strokeLinejoin="round" />,
  grid: (
    <g>
      <rect x="4" y="4" width="7" height="7" rx="2" />
      <rect x="13" y="4" width="7" height="7" rx="2" />
      <rect x="4" y="13" width="7" height="7" rx="2" />
      <rect x="13" y="13" width="7" height="7" rx="2" />
    </g>
  ),
  layers: (
    <g strokeLinejoin="round">
      <path d="M12 3.5l8.5 4.5L12 12.5 3.5 8z" />
      <path d="M3.5 12l8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5" strokeLinecap="round" />
    </g>
  ),
  cut: (
    <g strokeLinecap="round">
      <circle cx="6" cy="7" r="2.6" />
      <circle cx="6" cy="17" r="2.6" />
      <path d="M8.2 8.4L20 17M8.2 15.6L20 7" />
    </g>
  ),
  arm: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="4.8" r="2" />
      <path d="M9 7.5v7l-3 6M9 14.5l3 6M9 9.5l4.5-3 4.5-2.5" />
    </g>
  ),
  shape: <path d="M7 3c0 5 1.2 7.5 5 10.2 3 2.1 3.8 4.3 2.2 5.8-1.3 1.2-3.7 1-7.2 1" strokeLinecap="round" strokeLinejoin="round" />,
  pen: (
    <g strokeLinejoin="round" strokeLinecap="round">
      <path d="M4 20l1-4L16 5l3 3L8 19z" />
      <path d="M14 7l3 3" />
    </g>
  ),
  present: (
    <g strokeLinecap="round">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M12 16v4M8 20h8" />
    </g>
  ),
  rotate: <path d="M20 12a8 8 0 11-2.3-5.7M20 4v4h-4" strokeLinecap="round" strokeLinejoin="round" />,
  play: <path d="M8 5.5v13l10-6.5z" strokeLinejoin="round" />,
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
    </g>
  ),
  target: (
    <g>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </g>
  ),
  isolate: (
    <g strokeLinecap="round">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M3.5 8.5v-5h5M15.5 3.5h5v5M20.5 15.5v5h-5M8.5 20.5h-5v-5" />
    </g>
  ),
  pin: (
    <g>
      <path d="M12 21s-6-5.5-6-11a6 6 0 0112 0c0 5.5-6 11-6 11z" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.2" />
    </g>
  ),
  bookmark: <path d="M6.5 4h11v16.5L12 16.5l-5.5 4z" strokeLinejoin="round" />,
  sidebar: (
    <g>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </g>
  ),
  expand: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" strokeLinecap="round" strokeLinejoin="round" />,
  collapse: <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" strokeLinecap="round" strokeLinejoin="round" />,
  cube: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12L4 7.5M12 12v9" strokeLinejoin="round" />,
  laser: (
    <g strokeLinecap="round">
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </g>
  ),
  label: (
    <g strokeLinejoin="round">
      <rect x="3.5" y="7" width="17" height="10" rx="5" />
      <path d="M8 12h8" strokeLinecap="round" />
    </g>
  ),
  key: (
    <g>
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <path d="M7 10h0M10.5 10h0M14 10h0M17 10h0M8 14h8" strokeLinecap="round" />
    </g>
  ),
  study: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 9L12 4.5 21.5 9 12 13.5z" />
      <path d="M6.5 11v4.5c0 1.4 2.5 3 5.5 3s5.5-1.6 5.5-3V11M21.5 9v5" />
    </g>
  ),
  scalpel: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 20.5l9-9 3 3c-3 4-7 6-12 6z" />
      <path d="M12.5 11.5l6-6a2 2 0 013 3l-6 6" />
    </g>
  ),
  ruler: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 16.5L16.5 3.5l4 4-13 13z" />
      <path d="M7.5 12.5l2 2M10.5 9.5l1.5 1.5M13.5 6.5l2 2" />
    </g>
  ),
  vessel: <path d="M12 3c0 4-4 5-4 9a4 4 0 008 0c0-4-4-5-4-9zM12 13v8" strokeLinecap="round" strokeLinejoin="round" />,
  skin: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3.5L4 6v4l2.5 1V20h11v-9L20 10V6l-4-2.5c-.7 1.5-2.2 2.5-4 2.5s-3.3-1-4-2.5z" />
    </g>
  ),
  focus: (
    <g strokeLinecap="round">
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </g>
  ),
  download: <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" strokeLinecap="round" strokeLinejoin="round" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11" strokeLinecap="round" strokeLinejoin="round" />,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof paths;

type IconProps = { name: IconName; size?: number; stroke?: number; color?: string; className?: string; style?: CSSProperties };

export function Icon({ name, size = 22, stroke = 1.6, color, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? "currentColor"} strokeWidth={stroke} className={className} style={{ flexShrink: 0, ...style }} aria-hidden>
      {paths[name]}
    </svg>
  );
}
