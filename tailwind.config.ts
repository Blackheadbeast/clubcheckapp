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
        sans: ['var(--font-inter)', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.05)',
        raised: '0 4px 12px -2px rgb(16 24 40 / 0.08), 0 2px 4px -2px rgb(16 24 40 / 0.05)',
        pop: '0 20px 40px -12px rgb(16 24 40 / 0.28), 0 4px 10px -4px rgb(16 24 40 / 0.12)',
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
        nav: {
          DEFAULT: 'rgb(var(--color-nav) / <alpha-value>)',
          raised: 'rgb(var(--color-nav-raised) / <alpha-value>)',
          text: 'rgb(var(--color-nav-text) / <alpha-value>)',
          heading: 'rgb(var(--color-nav-heading) / <alpha-value>)',
          line: 'rgb(var(--color-nav-border) / <alpha-value>)',
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
