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
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(0 0 0 / 0.04)',
        pop: '0 10px 30px -10px rgb(0 0 0 / 0.25), 0 2px 6px -2px rgb(0 0 0 / 0.12)',
      },
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
        // Semantic, theme-aware tokens (see globals.css)
        canvas: 'rgb(var(--color-bg) / <alpha-value>)',
        surface: 'rgb(var(--color-bg-card) / <alpha-value>)',
        subtle: 'rgb(var(--color-bg-lighter) / <alpha-value>)',
        line: 'rgb(var(--color-border) / <alpha-value>)',
        fg: {
          DEFAULT: 'rgb(var(--color-text) / <alpha-value>)',
          muted: 'rgb(var(--color-text-secondary) / <alpha-value>)',
          subtle: 'rgb(var(--color-text-muted) / <alpha-value>)',
          heading: 'rgb(var(--color-text-heading) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          fg: 'rgb(var(--color-accent-fg) / <alpha-value>)',
          text: 'rgb(var(--color-accent-text) / <alpha-value>)',
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
