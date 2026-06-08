/**
 * ResearchOS companion design tokens (v2 foundation).
 *
 * Philosophy: mirror the web app token spirit in React Native terms.
 * Brand sky is #1AA0E6 (BeakerBot signature color). Purple accent is used
 * sparingly for destructive/secondary highlights. All tokens are available
 * through useTheme(), which picks the right light/dark set automatically.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useColorScheme } from '@/hooks/use-color-scheme';

// ---------------------------------------------------------------------------
// Palette (static, not theme-aware)
// ---------------------------------------------------------------------------
export const palette = {
  // Brand
  sky: '#1AA0E6',
  skyLight: '#E6F4FE',
  skyDim: 'rgba(26, 160, 230, 0.12)',
  skyBorder: 'rgba(26, 160, 230, 0.35)',

  // Accent (links, destructive context on light bg)
  purple: '#5B47D6',
  purpleLight: 'rgba(91, 71, 214, 0.10)',

  // Semantic
  success: '#16a34a',
  successLight: 'rgba(22, 163, 74, 0.12)',
  danger: '#dc2626',
  dangerLight: 'rgba(220, 38, 38, 0.12)',
  dangerBorder: 'rgba(220, 38, 38, 0.45)',
  warning: '#d97706',
  warningLight: 'rgba(217, 119, 6, 0.12)',

  // Grays
  white: '#ffffff',
  black: '#000000',
} as const;

// ---------------------------------------------------------------------------
// Surface tokens (light and dark)
// ---------------------------------------------------------------------------
export interface SurfaceTokens {
  /** Screen background */
  bg: string;
  /** Card / elevated surface */
  surface: string;
  /** Inset / sunken well (e.g. input bg) */
  sunken: string;
  /** Pressed / hovered surface overlay */
  pressed: string;

  // Text
  text: string;
  muted: string;
  placeholder: string;

  // Borders
  border: string;
  borderStrong: string;

  // Tab bar
  tabBarBg: string;
  tabBarBorder: string;
  tabBarActiveTint: string;
  tabBarInactiveTint: string;
}

const lightSurface: SurfaceTokens = {
  bg: '#f9fafb',
  surface: '#ffffff',
  sunken: '#f3f4f6',
  pressed: 'rgba(0,0,0,0.04)',

  text: '#111827',
  muted: '#6b7280',
  placeholder: '#9ca3af',

  border: 'rgba(0,0,0,0.10)',
  borderStrong: 'rgba(0,0,0,0.20)',

  tabBarBg: '#ffffff',
  tabBarBorder: 'rgba(0,0,0,0.08)',
  tabBarActiveTint: palette.sky,
  tabBarInactiveTint: '#9ca3af',
};

const darkSurface: SurfaceTokens = {
  bg: '#0c0e11',
  surface: '#161b22',
  sunken: '#0d1117',
  pressed: 'rgba(255,255,255,0.06)',

  text: '#e6edf3',
  muted: '#8b949e',
  placeholder: '#6e7681',

  border: 'rgba(255,255,255,0.10)',
  borderStrong: 'rgba(255,255,255,0.20)',

  tabBarBg: '#161b22',
  tabBarBorder: 'rgba(255,255,255,0.07)',
  tabBarActiveTint: palette.sky,
  tabBarInactiveTint: '#6e7681',
};

// ---------------------------------------------------------------------------
// Shape radii
// ---------------------------------------------------------------------------
export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

// ---------------------------------------------------------------------------
// Spacing scale (4 px base)
// ---------------------------------------------------------------------------
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  '3xl': 32,
  '4xl': 40,
} as const;

// ---------------------------------------------------------------------------
// Typography scale
// ---------------------------------------------------------------------------
export const type = {
  meta: { fontSize: 12, lineHeight: 18 },
  caption: { fontSize: 13, lineHeight: 19 },
  body: { fontSize: 16, lineHeight: 24 },
  bodySemi: { fontSize: 16, lineHeight: 24, fontWeight: '600' as const },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const },
  display: { fontSize: 36, lineHeight: 44, fontWeight: '800' as const },
} as const;

// ---------------------------------------------------------------------------
// useTheme() helper
// ---------------------------------------------------------------------------
export interface Theme {
  palette: typeof palette;
  surface: SurfaceTokens;
  radii: typeof radii;
  spacing: typeof spacing;
  type: typeof type;
  dark: boolean;
}

export function useTheme(): Theme {
  const scheme = useColorScheme() ?? 'light';
  const dark = scheme === 'dark';
  return {
    palette,
    surface: dark ? darkSurface : lightSurface,
    radii,
    spacing,
    type,
    dark,
  };
}
