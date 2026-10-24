import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pine: { 50: "#EEF5F3", 100: "#D5E7E2", 600: "#2B6A5F", 700: "#1F4E46", 800: "#173B35", 900: "#0F2925" },
        marigold: { 100: "#FBF0D3", 500: "#E0A526", 700: "#8A6210" },
        ink: "#1B2430",
        line: "#D9E0DD",
        mist: "#F4F7F6",
        brick: { 100: "#F8E1DC", 600: "#A8402D" },
      },
      fontFamily: {
        sans: ['"Public Sans"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
