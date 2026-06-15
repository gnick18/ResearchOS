"use client";

// Onboarding tutor — beat 1, the welcome hero.
//
// Full-screen, account-gated, shown right after the setup wizard. Beaker owns
// the screen on our signature marketing backdrop, with a shiny rainbow CTA that
// begs to be touched and a quiet grey escape beside it (highly encouraged, never
// a trap). The capped onboarding token meter is visible from the first second so
// the gift spend is honest.
//
// Presentational only. The parent owns the step machine and passes onStart /
// onSkip. No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import BeakerBot, { type BeakerBotPose } from "@/components/BeakerBot";
import MarketingBackdrop from "@/components/marketing/MarketingBackdrop";
import styles from "./WelcomeTakeover.module.css";

export interface WelcomeTakeoverProps {
  onStart: () => void;
  onSkip: () => void;
  /** Tokens used so far this run and the cap, for the visible meter. */
  tokensUsed?: number;
  tokenCap?: number;
}

// Beaker greets, then shows off the signature poses on a gentle loop, so the
// hero mascot is genuinely alive. Starts on the wave (a hello) and cycles
// through the continuous-loop poses.
const HERO_POSES: BeakerBotPose[] = ["waving", "twirl", "double-wave", "cheering", "idle"];
const POSE_HOLD_MS = 3200;

export default function WelcomeTakeover({
  onStart,
  onSkip,
  tokensUsed = 0,
  tokenCap = 150_000,
}: WelcomeTakeoverProps) {
  const pct = tokenCap > 0 ? Math.min(100, (tokensUsed / tokenCap) * 100) : 0;
  const [poseIdx, setPoseIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setPoseIdx((i) => (i + 1) % HERO_POSES.length),
      POSE_HOLD_MS,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[var(--bg,#f6f7f5)]">
      <MarketingBackdrop tone="vivid" />

      <button
        onClick={onSkip}
        className="absolute right-4 top-4 z-20 text-xs text-[var(--muted,#6b716a)] hover:text-[var(--fg,#1f2421)] hover:underline"
      >
        Skip for now
      </button>

      <div className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-full bg-[var(--brand-soft,#e3f4ec)]/90 px-3 py-1 text-[10px] font-semibold text-[var(--brand-ink,#0f6e56)] shadow-sm backdrop-blur">
        onboarding
        <span className="h-1 w-9 overflow-hidden rounded bg-black/10">
          <span className="block h-full rounded bg-[var(--brand,#1d9e75)]" style={{ width: `${pct}%` }} />
        </span>
        {Math.round(tokensUsed / 1000)}k / {Math.round(tokenCap / 1000)}k
      </div>

      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="relative flex items-center justify-center">
          <span className={styles.heroGlow} aria-hidden />
          <BeakerBot
            pose={HERO_POSES[poseIdx]}
            animated
            alive
            ariaLabel="Beaker"
            className="relative h-[clamp(240px,50vh,520px)] w-auto drop-shadow-[0_22px_48px_rgba(80,120,180,0.3)]"
          />
        </div>

        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-[var(--fg,#1f2421)] sm:text-4xl">
          Hi, I'm Beaker.
        </h1>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-[var(--muted,#6b716a)]">
          Give me five minutes and I'll show you what this place can do for your
          research. No setup, just watch.
        </p>

        <button onClick={onStart} className={`${styles.cta} mt-7`}>
          Show me around
        </button>
        <button
          onClick={onSkip}
          className="mt-3 px-3 py-1 text-[13px] font-medium text-[var(--muted,#6b716a)] hover:text-[var(--fg,#1f2421)]"
        >
          I'll explore on my own
        </button>
      </div>
    </div>
  );
}
