import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        // Status colors are fixed by PRD §9.4 — do not reuse for decoration.
        status: {
          ok: "#16a34a",
          late: "#ea580c",
          medium: "#ea580c",
          notok: "#dc2626",
          critical: "#dc2626",
          pending: "#9ca3af",
        },
      },
      minHeight: {
        tap: "44px",
      },
      minWidth: {
        tap: "44px",
      },
    },
  },
  plugins: [],
};

export default config;
