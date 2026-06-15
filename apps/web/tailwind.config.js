/**
 * TailwindCSS config — flat, clinical, medical-teal, light + dark.
 *
 * Semantic color utilities map to the CSS variables defined in src/app.css
 * (stored as RGB triplets, so `/alpha` works). Use these in components instead
 * of raw slate-*: bg-surface / bg-surface-1/2/3, text-fg / text-muted / text-subtle,
 * border-line / border-line-strong, bg-brand / text-brand-fg / bg-brand-soft,
 * and the danger/warning/ok families. They flip automatically between themes.
 *
 * The literal brand teal scale (50–900) is kept for the rare fixed-tint need and
 * mirrors src/lib/branding.ts (single source for runtime/app code).
 *
 * @type {import('tailwindcss').Config}
 */
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
          DEFAULT: v('--brand'),
          strong: v('--brand-strong'),
          fg: v('--brand-fg'),
          soft: v('--brand-soft'),
          'soft-fg': v('--brand-soft-fg'),
        },
        surface: {
          DEFAULT: v('--surface'),
          1: v('--surface-1'),
          2: v('--surface-2'),
          3: v('--surface-3'),
        },
        fg: v('--text'),
        muted: v('--text-muted'),
        subtle: v('--text-subtle'),
        line: {
          DEFAULT: v('--line'),
          strong: v('--line-strong'),
        },
        danger: { DEFAULT: v('--danger'), soft: v('--danger-soft'), fg: v('--danger-fg') },
        warning: { DEFAULT: v('--warning'), soft: v('--warning-soft'), fg: v('--warning-fg') },
        ok: { DEFAULT: v('--ok'), soft: v('--ok-soft'), fg: v('--ok-fg') },
        ring: v('--ring'),
      },
      borderColor: {
        DEFAULT: v('--line'),
      },
      minHeight: { touch: '3rem' },
      minWidth: { touch: '3rem' },
      spacing: { touch: '3rem' },
      borderRadius: { '2xl': '1rem' },
    },
  },
  plugins: [],
};
