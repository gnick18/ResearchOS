// Full-screen branded app-launch splash.
//
// Grant picked "Split Stage" as the winning treatment (2026-06-13) from the
// /dev/splash comparison, so the real Splash is now a thin wrapper over that
// variant. The public API (onComplete, userName) is unchanged, so providers.tsx
// and the dev account-setup page keep working without edits. The other variants
// (Aurora, Bloom) and the comparison page live on under splash-variants/.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

"use client";

import { VariantSplitStage } from "./splash-variants";

export interface SplashProps {
  /** Called when the splash finishes and the caller should advance to the app. */
  onComplete: () => void;
  /** The signed-in user's name. When set, a "Welcome back, <name>" greets them. */
  userName?: string;
}

export function Splash({ onComplete, userName }: SplashProps) {
  // Production mounts the splash once per day, so a stable (default) replayKey is
  // correct here; only the dev page bumps it to force a replay without remount.
  return <VariantSplitStage onComplete={onComplete} userName={userName} />;
}

export default Splash;
