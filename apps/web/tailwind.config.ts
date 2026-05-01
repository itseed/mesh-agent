import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#06090f',
        surface: '#0d1117',
        'surface-2': '#121920',
        border: '#1a2333',
        'border-hi': '#2a3850',
        muted: '#8b9db8',
        dim: '#4f6275',
        text: '#dde4ec',
        accent: '#58a6ff',
        success: '#3fb950',
        warning: '#f0883e',
        danger: '#f78166',
        purple: '#d2a8ff',
      },
      fontFamily: {
        sans: [
          'var(--font-thai)',
          'var(--font-sans)',
          'Noto Sans Thai',
          'Noto Sans',
          'system-ui',
          'sans-serif',
        ],
        thai: ['var(--font-thai)', 'Noto Sans Thai', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'IBM Plex Mono', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
