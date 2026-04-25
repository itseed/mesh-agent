import type { Config } from 'tailwindcss'

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#0d1117',
        surface: '#161b22',
        border: '#30363d',
        muted: '#8b949e',
        accent: '#58a6ff',
        success: '#3fb950',
        warning: '#f0883e',
        danger: '#f78166',
        purple: '#d2a8ff',
      },
    },
  },
  plugins: [],
} satisfies Config
