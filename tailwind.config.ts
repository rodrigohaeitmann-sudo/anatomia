import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        surgical: {
          ink: "#0f172a",
          panel: "#101827",
          accent: "#38bdf8",
          blush: "#f9a8d4",
        },
      },
    },
  },
  plugins: [],
};

export default config;
