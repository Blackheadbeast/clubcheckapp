import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: 'class',
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#f59e0b', // amber-500
          dark: '#d97706',    // amber-600
          light: '#fbbf24',   // amber-400
        },
        dark: {
          DEFAULT: '#0a0a0a',
          lighter: '#1a1a1a',
          card: '#171717',
        },
        // Light theme colors
        'light-bg': '#f5f5f5',
        'light-card': '#ffffff',
        'light-border': '#e5e5e5',
      },
    },
  },
  plugins: [],
};

export default config;
