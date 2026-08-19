import defaultTheme from "tailwindcss/defaultTheme";
import tailwindDotGridBackgrounds from "@nauverse/tailwind-dot-grid-backgrounds";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "selector",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', ...defaultTheme.fontFamily.sans],
      },
      keyframes: {
        "pulse-green": {
          "0%, 100%": { backgroundColor: "#2563eb" },
          "35%": { backgroundColor: "#16a34a" },
        },
      },
      animation: {
        "pulse-green": "pulse-green 1s ease-in-out",
      },
    },
  },
  plugins: [tailwindDotGridBackgrounds],
};
