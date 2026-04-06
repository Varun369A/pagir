/**
 * PAGIR 2 — Design tokens
 *
 * All colors, typography, spacing are defined here.
 * Components import from theme — never hardcode hex values.
 */

export const Colors = {
  // Backgrounds
  bg:           '#0f0f12',
  surface:      '#1a1a24',
  surfaceElevated: '#22222e',
  border:       '#2d2d3d',
  borderFocus:  '#a78bfa',

  // Brand
  primary:      '#a78bfa',
  primaryDim:   '#7c5cbf',
  primaryDeep:  '#3d3565',

  // Text
  textPrimary:  '#f9fafb',
  textSecondary: '#9ca3af',
  textDim:      '#6b7280',
  textMuted:    '#4b5563',
  textInverse:  '#0f0f12',

  // Semantic
  success:      '#22c55e',
  successBg:    '#052e16',
  danger:       '#ef4444',
  dangerBg:     '#2d1515',
  warning:      '#f59e0b',
  warningBg:    '#1a1a0a',
  info:         '#60a5fa',
  infoBg:       '#0c1628',

  // Transparent overlays
  overlay:      'rgba(0,0,0,0.6)',
  overlayLight: 'rgba(167,139,250,0.08)',
}

export const Typography = {
  // Font sizes
  xs:   { fontSize: 11, lineHeight: 14 },
  sm:   { fontSize: 12, lineHeight: 16 },
  base: { fontSize: 14, lineHeight: 20 },
  md:   { fontSize: 15, lineHeight: 22 },
  lg:   { fontSize: 16, lineHeight: 24 },
  xl:   { fontSize: 18, lineHeight: 26 },
  '2xl': { fontSize: 22, lineHeight: 30 },
  '3xl': { fontSize: 26, lineHeight: 34 },
  '4xl': { fontSize: 32, lineHeight: 40 },

  // Named styles
  caption:    { fontSize: 11, lineHeight: 14, color: Colors.textMuted },
  label:      { fontSize: 12, lineHeight: 16, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  body:       { fontSize: 14, lineHeight: 20, color: Colors.textSecondary },
  subheadline: { fontSize: 14, lineHeight: 20 },
  headline:   { fontSize: 16, lineHeight: 24, fontWeight: '600' as const },
  title:      { fontSize: 22, lineHeight: 30, fontWeight: '700' as const },
  largeTitle: { fontSize: 28, lineHeight: 36, fontWeight: '700' as const },
}

export const Spacing = {
  xs:  4,
  sm:  8,
  md:  12,
  base: 16,
  lg:  20,
  xl:  24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 56,
}

export const Radius = {
  sm:   8,
  md:   12,
  lg:   14,
  xl:   16,
  '2xl': 20,
  full: 9999,
}

export const Shadow = {
  primary: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
}
