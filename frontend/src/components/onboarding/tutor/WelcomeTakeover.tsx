"use client";

// Onboarding tutor — beat 1, the welcome takeover.
//
// Full-screen, account-gated, shown right after the setup wizard. Beaker
// introduces himself and offers to drive a short tailored tour. Highly
// encouraged but never a trap: a primary "Show me around" plus an always-present
// quiet "Skip for now" (the no-soft-lock rule). The capped onboarding token
// meter is visible from the first second so the gift spend is honest.
//
// Presentational only. The parent owns the step machine and passes onStart /
// onSkip. No emojis, no em-dashes, no mid-sentence colons.

import { BeakerBotScene } from "@/components/onboarding/BeakerBotScene";

export interface WelcomeTakeoverProps {
  onStart: () => void;
  onSkip: () => void;
  /** Tokens used so far this run and the cap, for the visible meter. */
  tokensUsed?: number;
  tokenCap?: number;
}

export default function WelcomeTakeover({
  onStart,
  onSkip,
  tokensUsed = 0,
  tokenCap = 150_000,
}: WelcomeTakeoverProps) {
  const pct = tokenCap > 0 ? Math.min(100, (tokensUsed / tokenCap) * 100) : 0;
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--surface,#fff)] px-6 text-center">
      <button
        onClick={onSkip}
        className="absolute right-4 top-4 text-xs text-[var(--muted,#6b716a)] hover:text-[var(--fg,#1f2421)] hover:underline"
      >
        Skip for now
      </button>

      <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-[var(--brand-soft,#e3f4ec)] px-3 py-1 text-[10px] font-semibold text-[var(--brand-ink,#0f6e56)]">
        onboarding
        <span className="h-1 w-9 overflow-hidden rounded bg-black/10">
          <span className="block h-full rounded bg-[var(--brand,#1d9e75)]" style={{ width: `${pct}%` }} />
        </span>
        {Math.round(tokensUsed / 1000)}k / {Math.round(tokenCap / 1000)}k
      </div>

      <div className="h-20 w-20">
        <BeakerBotScene name="solo" className="h-full w-full" />
      </div>

      <div className="mt-4 text-base font-semibold">Hi, I'm Beaker.</div>
      <p className="mt-1 max-w-xs text-sm text-[var(--muted,#6b716a)]">
        Give me five minutes and I'll show you what this place can do for your
        research. No setup, just watch.
      </p>

      <button
        onClick={onStart}
        className="mt-4 rounded-lg bg-[var(--brand,#1d9e75)] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:brightness-105"
      >
        Show me around
      </button>
      <button
        onClick={onSkip}
        className="mt-2 px-3 py-1 text-xs text-[var(--muted,#6b716a)] hover:text-[var(--fg,#1f2421)]"
      >
        I'll explore on my own
      </button>
    </div>
  );
}
