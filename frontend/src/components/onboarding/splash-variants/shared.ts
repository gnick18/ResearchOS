// Shared types + brand constants for the app-launch Splash redesign variants.
//
// Every variant is a self-contained full-screen curtain that composes the
// animated SplashBeaker mascot with its own typographic + motion treatment.
// They all honor the same contract so the real Splash wrapper and the dev page
// can swap between them by id alone.
//
// Brand constraints (verbatim, do not drift):
//   - pastel rainbow ramp        FFD2B0 / FFF1A8 / B7EBB1 / A6D2F4 / D6B5F0
//   - brand-sky beaker           1AA0E6
//   - rainbow "OS" wordmark, light surface
//   - reduced motion degrades to a clean static logo
//
// No emojis, no em-dashes, no mid-sentence colons.

export interface SplashVariantProps {
  /** Fires when the curtain finishes and the caller should reveal the app. */
  onComplete: () => void;
  /** Optional personalized greeting. Degrades gracefully when absent. */
  userName?: string;
  /**
   * Bumped by the dev page to force a full replay without remounting timing
   * state. Production passes a stable key (mounted once per day).
   */
  replayKey?: number;
}

export const RAINBOW = ["#FFD2B0", "#FFF1A8", "#B7EBB1", "#A6D2F4", "#D6B5F0"] as const;
export const RAINBOW_CSS = RAINBOW.join(",");
export const SKY = "#1AA0E6";
export const SKY_DEEP = "#1283c9";
export const INK = "#0c1830";
export const MUTED = "#6b7280";

/** First name only, trimmed, for the greeting line. Empty string when absent. */
export function firstName(name?: string): string {
  if (!name) return "";
  return name.trim().split(/\s+/)[0] ?? "";
}

/** True when the user asked the OS to reduce motion. SSR-safe (false on server). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The rainbow "OS" wordmark, reused across variants. Plain text, themeable size. */
export const WORDMARK_GRADIENT =
  `linear-gradient(95deg,${RAINBOW_CSS})`;
