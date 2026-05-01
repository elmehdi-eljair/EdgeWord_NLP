import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#FBFAFE",
        "bg-2": "#F4F2FB",
        "bg-3": "#FFFFFF",
        ink: "#0A0817",
        "ink-2": "#2D2942",
        "ink-3": "#6E6989",
        "ink-4": "#A8A4BD",
        "ink-5": "#D5CFE8",
        line: "#E5E1F0",
        "line-2": "#D5CFE8",
        violet: {
          50: "#F5F0FF",
          100: "#EDE5FF",
          200: "#D4C4FE",
          400: "#9568F3",
          500: "#7B3FEE",
          600: "#6530CC",
        },
        green: { DEFAULT: "#16A34A", bg: "#DCFCE7" },
        amber: { DEFAULT: "#D97706", bg: "#FEF3C7" },
        red: { DEFAULT: "#DC2626", bg: "#FEE2E2" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      borderRadius: {
        xl: "12px",
        "2xl": "16px",
      },
      keyframes: {
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(200%)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
