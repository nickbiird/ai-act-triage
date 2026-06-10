import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        tier: {
          prohibited: '#b91c1c',
          high: '#c2410c',
          limited: '#a16207',
          minimal: '#15803d',
        },
      },
    },
  },
  plugins: [],
};

export default config;
