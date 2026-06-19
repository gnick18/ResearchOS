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

// The pure greeting-name logic (honorific stripping + preferred-name precedence)
// lives in the shared lib module so every greeting surface uses the same rule.
// Re-exported here so the variants keep importing { firstName } from "./shared".
export { firstName, resolveGreetingName } from "@/lib/greeting/greeting-name";

export interface SplashVariantProps {
  /** Fires when the curtain finishes and the caller should reveal the app. */
  onComplete: () => void;
  /** Optional personalized greeting. Degrades gracefully when absent. */
  userName?: string;
  /**
   * The user's preferred / greeting name ("call me Grant"), account-scoped so it
   * follows them across folders. When set it wins over the display name's first
   * word, so the greeting reads "Grant" rather than the honorific "Dr". Degrades
   * gracefully when absent (falls back to the honorific-stripped first name).
   */
  preferredName?: string;
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

/** True when the user asked the OS to reduce motion. SSR-safe (false on server). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The rainbow "OS" wordmark, reused across variants. Plain text, themeable size. */
export const WORDMARK_GRADIENT =
  `linear-gradient(95deg,${RAINBOW_CSS})`;
