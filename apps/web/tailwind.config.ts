import type { Config } from 'tailwindcss'

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
        muted: '#6a7a8e',
        dim: '#374556',
        text: '#c9d1d9',
        accent: '#58a6ff',
        success: '#3fb950',
        warning: '#f0883e',
        danger: '#f78166',
        purple: '#d2a8ff',
      },
      fontFamily: {
        sans:  ['IBM Plex Mono', 'Courier New', 'monospace'],
        mono:  ['IBM Plex Mono', 'Courier New', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
