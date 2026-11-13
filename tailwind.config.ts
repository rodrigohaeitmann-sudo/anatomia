import type { Config } from "tailwindcss";

/**
 * MamaFlow tokens (same palette as the MamaFlow app): sand paper, white surfaces, ink text, rose accent.
 * Semantic colours (sage, amber, danger) keep fixed meanings across the app.
 */
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      screens: {
        // phones held sideways: compact chrome so the model keeps most of the height
        short: { raw: "(max-height: 500px) and (orientation: landscape)" },
        // desktop widths where the side panels get narrower (min-/max- variants are unavailable with raw screens)
        narrow: { raw: "(max-width: 1279px)" },
        tight: { raw: "(max-width: 1180px)" },
      },
      colors: {
        paper: "#FCF9F6",
        surface: { DEFAULT: "#FFFFFF", alt: "#FBF6EE" },
        warm: "#F4E9DB",
        ink: { DEFAULT: "#221C20", 2: "#5A5057" },
        "on-ink": "#FCF9F6",
        muted: "#8C8389",
        faint: "#B6ADB1",
        line: { DEFAULT: "#E3D8CB", soft: "#EFE7DC" },
        rose: { DEFAULT: "#B68690", deep: "#8E5C68", tint: "#F4E1E5", bg: "#F8E7E9" },
        sage: { DEFAULT: "#5C8473", deep: "#3F5E51", tint: "#DDE7E0" },
        amber: { DEFAULT: "#9C6E2E", deep: "#6F4D1E", tint: "#EFDFC4" },
        danger: { DEFAULT: "#A4453E", deep: "#7E332E", tint: "#F0DAD7" },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "-apple-system", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 2px 10px rgba(34,28,32,.04)",
        up: "0 -2px 24px rgba(34,28,32,.10)",
        glass: "0 6px 18px -8px rgba(34,28,32,.25)",
        pin: "0 4px 14px -6px rgba(34,28,32,.25)",
        sheet: "0 -12px 32px -10px rgba(34,28,32,.2)",
        "sheet-lg": "0 -12px 40px rgba(34,28,32,.18)",
        pop: "0 24px 60px rgba(34,28,32,.16)",
        menu: "0 12px 32px -8px rgba(34,28,32,.22)",
      },
      borderRadius: {
        card: "22px",
        tile: "18px",
      },
    },
  },
  plugins: [],
};

export default config;
