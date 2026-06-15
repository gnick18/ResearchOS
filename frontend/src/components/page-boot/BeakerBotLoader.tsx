"use client";

// The visual for the page-boot wait. The mascot is the OFFICIAL animated
// BeakerBot from the splash/welcome flow (SplashBeaker: draws on, fills with the
// pastel-rainbow liquid, overfills to the brim then spills + settles) — reused,
// not reinvented, so there is one branded beaker and no new inline SVG / icon
// baseline. Below it sits the HONEST determinate progress bar synced to real
// load progress, the current step label, an ETA (on repeat visits), a per-page
// blurb + "Why the wait?" link, and a retry on error (no soft-lock). The mascot
// pour is ambient delight; the bar is the real signal.

import { useEffect, useState } from "react";
import { SplashBeaker } from "@/components/animations/SplashBeaker";
import type { BootState } from "@/lib/page-boot/page-boot";

function etaText(etaMs: number | null, phase: BootState["phase"]): string {
  if (phase === "done") return "";
  if (etaMs === null) return "First load — caching for next time";
  if (etaMs < 400) return "Almost there";
  return `About ${(etaMs / 1000).toFixed(1)}s left`;
}

export interface BeakerBotLoaderProps {
  state: BootState;
  /** One-line, page-specific explanation of what's loading + why it's worth it. */
  blurb?: string;
  /** Where "Why the wait?" links (the local-first wiki page). */
  whyHref?: string;
  onRetry?: () => void;
}

export function BeakerBotLoader({ state, blurb, whyHref, onRetry }: BeakerBotLoaderProps) {
  const pct = Math.round(state.pct);
  const isError = state.phase === "error";

  // Keep the official pour lively during a longer load by replaying it; let it
  // settle (no replay) once we're done or have errored.
  const [playKey, setPlayKey] = useState(0);
  useEffect(() => {
    if (state.phase !== "running") return;
    const id = setInterval(() => setPlayKey((k) => k + 1), 3400);
    return () => clearInterval(id);
  }, [state.phase]);

  return (
    <div
      className="flex min-h-[60vh] w-full flex-col items-center justify-center px-6 text-center"
      role="status"
      aria-live="polite"
      aria-label={isError ? "Loading failed" : `Loading, ${pct} percent`}
    >
      <SplashBeaker playKey={playKey} size="min(32vmin, 150px)" shadow={false} />

      {isError ? (
        <>
          <p className="mt-2 text-base font-medium text-foreground">
            Something went wrong loading this page.
          </p>
          {state.label && (
            <p className="mt-1 text-meta text-foreground-muted">Step: {state.label}</p>
          )}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 rounded-lg border border-border-strong px-4 py-2 text-meta font-medium text-foreground hover:border-brand-action"
            >
              Try again
            </button>
          )}
        </>
      ) : (
        <>
          <div className="mt-2 text-2xl font-medium tabular-nums text-foreground">{pct}%</div>
          <div className="min-h-[20px] text-sm text-foreground">{state.label}</div>
          <div className="mt-3.5 h-2 w-full max-w-[340px] overflow-hidden rounded-full border border-border bg-surface-sunken">
            <div
              className="h-full rounded-full bg-brand-action"
              style={{ width: `${state.pct}%`, transition: "width 0.3s ease" }}
            />
          </div>
          <div className="mt-1.5 min-h-[16px] text-[12px] text-foreground-faint">
            {etaText(state.etaMs, state.phase)}
          </div>
          {blurb && (
            <p className="mt-4 max-w-[380px] text-[12.5px] leading-relaxed text-foreground-muted">
              {blurb}{" "}
              {whyHref && (
                <a href={whyHref} className="whitespace-nowrap text-brand-action hover:underline">
                  Why the wait?
                </a>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
