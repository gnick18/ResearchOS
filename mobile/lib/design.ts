/**
 * ResearchOS companion design tokens (v3, UI contract).
 *
 * Ported 1:1 from the locked UI contract stylesheet
 * (docs/mockups/mobile-contract/contract.css). Brand sky #1AA0E6, Geist +
 * Geist Mono, FLAT canvas (Apple systemGroupedBackground style; depth comes
 * from cards/accents/elevation, never a gradient behind content), 8pt grid.
 *
 * All tokens are reached through useTheme(), which auto-picks light/dark.
 * Existing keys are preserved so older screens keep compiling while screens
 * are migrated; new keys (surface2, hairline, violet, shadows, fonts) match
 * the contract.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

import { useColorScheme } from '@/hooks/use-color-scheme';

// ---------------------------------------------------------------------------
// Fonts. Loaded in app/_layout.tsx via @expo-google-fonts/geist. Numbers and
// any tabular data use the mono family (timers, counts, calculator results).
// ---------------------------------------------------------------------------
export const fonts = {
  ui: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  extrabold: 'Geist_800ExtraBold',
  mono: 'GeistMono_500Medium',
  monoSemibold: 'GeistMono_600SemiBold',
} as const;

// ---------------------------------------------------------------------------
// Palette (static, not theme-aware) — matches contract.css :root brand tokens
// ---------------------------------------------------------------------------
export const palette = {
  // Brand. Sky carries ~90% of interactive weight. Coral/amber/violet are
  // accents (never two warm accents on one element; rainbow is decoration only).
  sky: '#1AA0E6',
  sky600: '#1487c7',
  sky700: '#0f6fa6',
  skyLight: '#E8F5FE',
  skyDim: 'rgba(26, 160, 230, 0.12)',
  skyBorder: 'rgba(26, 160, 230, 0.30)',

  coral: '#FF6F61',
  coralDim: 'rgba(255, 111, 97, 0.12)',
  coralBorder: 'rgba(255, 111, 97, 0.34)',
  amber: '#F59E0B',
  amberDim: 'rgba(245, 158, 11, 0.14)',
  amberBorder: 'rgba(245, 158, 11, 0.34)',
  violet: '#7C5CE0',
  violetDim: 'rgba(124, 92, 224, 0.14)',

  // Accent alias kept for older imports (was purple/#5B47D6 -> now violet).
  purple: '#7C5CE0',
  purpleLight: 'rgba(124, 92, 224, 0.10)',

  elevatedBorder: '#d4e2ee',

  // Semantic (contract values)
  success: '#16a34a',
  successLight: 'rgba(22, 163, 74, 0.12)',
  successDim: 'rgba(22, 163, 74, 0.12)',
  danger: '#e5484d',
  dangerLight: 'rgba(229, 72, 77, 0.12)',
  dangerDim: 'rgba(229, 72, 77, 0.12)',
  dangerBorder: 'rgba(229, 72, 77, 0.34)',
  warning: '#d97706',
  warningLight: 'rgba(217, 119, 6, 0.12)',

  // Rainbow signature (pastel for the decorative edge; vivid set for dark mode)
  rainbowLight: ['#FFB3A7', '#FFD79A', '#A9E6B8', '#A7D8F5', '#C9B8F0'],
  rainbowDark: ['#F2724F', '#F5A623', '#3FBF6B', '#2E9BE6', '#7C5CE0'],

  white: '#ffffff',
  black: '#000000',
  faint: '#939DAD',
} as const;

// ---------------------------------------------------------------------------
// Surface tokens (light and dark) — FLAT canvas per the contract
// ---------------------------------------------------------------------------
export interface SurfaceTokens {
  bg: string;
  surface: string;
  /** Second elevated surface (reader pages, inset cards) */
  surface2: string;
  sunken: string;
  pressed: string;

  text: string;
  muted: string;
  faint: string;
  placeholder: string;

  border: string;
  borderStrong: string;
  hairline: string;

  tabBarBg: string;
  tabBarBorder: string;
  tabBarActiveTint: string;
  tabBarInactiveTint: string;
}

const lightSurface: SurfaceTokens = {
  bg: '#EEF1F6',
  surface: '#FFFFFF',
  surface2: '#F7F9FC',
  sunken: '#EFF2F7',
  pressed: 'rgba(15,23,34,0.04)',

  text: '#0F1722',
  muted: '#5B6675',
  faint: '#939DAD',
  placeholder: '#939DAD',

  border: 'rgba(15,23,34,0.08)',
  borderStrong: 'rgba(15,23,34,0.14)',
  hairline: 'rgba(15,23,34,0.06)',

  tabBarBg: 'rgba(255,255,255,0.72)',
  tabBarBorder: 'rgba(15,23,34,0.08)',
  tabBarActiveTint: palette.sky,
  tabBarInactiveTint: '#939DAD',
};

const darkSurface: SurfaceTokens = {
  bg: '#070A12',
  surface: '#121826',
  surface2: '#0E1420',
  sunken: '#0A0F1A',
  pressed: 'rgba(255,255,255,0.06)',

  text: '#EAF0F7',
  muted: '#9AA6B6',
  faint: '#5E6B7D',
  placeholder: '#5E6B7D',

  border: 'rgba(255,255,255,0.09)',
  borderStrong: 'rgba(255,255,255,0.16)',
  hairline: 'rgba(255,255,255,0.06)',

  tabBarBg: 'rgba(18,24,38,0.74)',
  tabBarBorder: 'rgba(255,255,255,0.09)',
  tabBarActiveTint: palette.sky,
  tabBarInactiveTint: '#5E6B7D',
};

// ---------------------------------------------------------------------------
// Elevation / shadow tokens (sm/md/lg; spread onto a View style)
// ---------------------------------------------------------------------------
export interface ElevationToken {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export interface ShadowSet {
  sm: ElevationToken;
  md: ElevationToken;
  lg: ElevationToken;
}

const shadowLight: ShadowSet = {
  sm: { shadowColor: '#0F1722', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  md: { shadowColor: '#0F1722', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.10, shadowRadius: 12, elevation: 5 },
  lg: { shadowColor: '#0F1722', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.16, shadowRadius: 24, elevation: 12 },
};

const shadowDark: ShadowSet = {
  sm: { shadowColor: '#000000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.4, shadowRadius: 3, elevation: 2 },
  md: { shadowColor: '#000000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 18, elevation: 8 },
  lg: { shadowColor: '#000000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.55, shadowRadius: 32, elevation: 16 },
};

// ---------------------------------------------------------------------------
// Shape radii (contract values)
// ---------------------------------------------------------------------------
export const radii = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  pill: 999,
} as const;

// ---------------------------------------------------------------------------
// Spacing scale (8pt grid, 4px substep)
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
// Typography scale (mobile, ~1.7:1 head/body, contract sizes + Geist weights)
// ---------------------------------------------------------------------------
export const type = {
  meta: { fontSize: 12, lineHeight: 18, fontFamily: fonts.semibold },
  caption: { fontSize: 13, lineHeight: 19, fontFamily: fonts.ui },
  body: { fontSize: 16, lineHeight: 24, fontFamily: fonts.ui },
  bodySemi: { fontSize: 16, lineHeight: 24, fontFamily: fonts.semibold, fontWeight: '600' as const },
  h: { fontSize: 20, lineHeight: 26, fontFamily: fonts.bold, fontWeight: '700' as const },
  title: { fontSize: 27, lineHeight: 32, fontFamily: fonts.extrabold, fontWeight: '800' as const, letterSpacing: -0.5 },
  display: { fontSize: 32, lineHeight: 38, fontFamily: fonts.extrabold, fontWeight: '800' as const, letterSpacing: -0.7 },
  mono: { fontSize: 16, fontFamily: fonts.mono },
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
  fonts: typeof fonts;
  /** Soft card shadow (sm). Spread onto a View style. */
  elevation: ElevationToken;
  /** Full shadow set: shadow.sm / .md / .lg */
  shadow: ShadowSet;
  /** Rainbow signature edge colors for this scheme. */
  rainbow: readonly string[];
  dark: boolean;
}

export function useTheme(): Theme {
  const scheme = useColorScheme() ?? 'light';
  const dark = scheme === 'dark';
  const shadow = dark ? shadowDark : shadowLight;
  return {
    palette,
    surface: dark ? darkSurface : lightSurface,
    radii,
    spacing,
    type,
    fonts,
    elevation: shadow.sm,
    shadow,
    rainbow: dark ? palette.rainbowDark : palette.rainbowLight,
    dark,
  };
}
