"use client";

// Dev review page for the app-launch Splash redesign (splash lane, 2026-06-13).
//
// Renders a mock workbench, then overlays a chosen Splash redesign variant on
// top exactly the way lib/providers.tsx mounts the real one in production, so
// the rainbow exit can be seen receding to reveal the workbench underneath.
//
// The real Splash plays once per day and takes a few seconds, so this page adds
// the controls needed to iterate fast:
//   - a Play / Replay button (re-runs the full animation without a reload)
//   - a variant toggle (Aurora Curtain / Split Stage / Pour and Bloom)
//   - a userName input so the personalized greeting hero can be checked with
//     different names, and cleared to confirm the no-name fallback
//
// This page does NOT touch the real once-a-day mount or its localStorage gate
// (lib/providers.tsx). The winning variant gets wired into the real Splash
// later, after Grant picks. This route is dev-only and bypasses the folder gate
// via the /dev/splash branch in providers.tsx.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useState } from "react";

import {
  SPLASH_VARIANTS,
  type SplashVariantId,
} from "@/components/onboarding/splash-variants";

// A lightweight fake workbench so it is obvious what the splash reveals. It is
// not the real app (that needs a connected folder); it just stands in as a
// recognizable workspace behind the overlay.
function MockWorkbench() {
  return (
    <div className="min-h-screen w-full bg-surface text-foreground">
      {/* Top nav */}
      <header className="flex items-center justify-between border-b border-border bg-surface-raised px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-base font-extrabold tracking-tight text-brand-ink">
            ResearchOS
          </span>
          <span className="text-meta text-foreground-muted">/ Workbench</span>
        </div>
        <div className="flex items-center gap-4 text-meta text-foreground-muted">
          <span>Gantt</span>
          <span>Methods</span>
          <span>Notes</span>
          <span>Calendar</span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-sky/20 text-[11px] font-bold text-brand-action">
            GN
          </span>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="hidden w-56 shrink-0 border-r border-border bg-surface-raised/60 p-4 sm:block">
          <p className="mb-2 text-meta font-semibold uppercase tracking-wide text-foreground-muted">
            Projects
          </p>
          <ul className="space-y-1.5 text-body">
            {["Yeast CRISPR screen", "Promoter library", "LC-MS metabolites"].map(
              (p) => (
                <li
                  key={p}
                  className="rounded-lg px-2 py-1.5 text-foreground hover:bg-surface-sunken"
                >
                  {p}
                </li>
              ),
            )}
          </ul>
        </aside>

        {/* Content */}
        <main className="flex-1 p-6">
          <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-brand-ink">
            Today at a glance
          </h1>
          <p className="mb-6 text-body text-foreground-muted">
            This is the mock workbench the splash should reveal.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Due today", "3 tasks"],
              ["This week", "11 tasks"],
              ["Experiments running", "4"],
              ["Inventory low", "2 reagents"],
              ["Recent notes", "7"],
              ["Shared with me", "5"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-border bg-surface-raised p-4"
              >
                <p className="text-meta text-foreground-muted">{label}</p>
                <p className="mt-1 text-xl font-bold text-brand-ink">{value}</p>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function SplashReviewPage() {
  const [variantId, setVariantId] = useState<SplashVariantId>("aurora");
  const [userName, setUserName] = useState("Grant");
  const [running, setRunning] = useState(false);
  // A monotonic id used as the variant key + replayKey so Play / Replay remounts
  // it and the animation restarts from the top.
  const [runId, setRunId] = useState(0);

  const entry = SPLASH_VARIANTS.find((v) => v.id === variantId)!;
  const Variant = entry.Component;

  const play = useCallback(() => {
    // Drop any running splash, then remount on the next tick so a mid-play
    // replay restarts cleanly from the top.
    setRunning(false);
    window.setTimeout(() => {
      setRunId((n) => n + 1);
      setRunning(true);
    }, 30);
  }, []);

  return (
    <main className="relative">
      {/* The workbench is always mounted underneath, the way the real app is. */}
      <MockWorkbench />

      {/* The chosen variant, overlaid on top exactly like production. On
          complete it unmounts so the exit reveals the workbench above. */}
      {running && (
        <Variant
          key={runId}
          replayKey={runId}
          userName={userName.trim() || undefined}
          onComplete={() => setRunning(false)}
        />
      )}

      {/* Dev control dock */}
      <div className="fixed bottom-4 left-4 z-[20000] w-[min(92vw,420px)] rounded-2xl border border-border bg-surface-overlay p-4 text-foreground ros-popover-shadow">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
            Splash review
          </span>
          <button
            type="button"
            onClick={play}
            className="rounded-lg bg-brand-action px-4 py-1.5 text-body font-semibold text-white hover:opacity-90"
          >
            {running ? "Replay" : "Play"}
          </button>
        </div>

        {/* variant toggle */}
        <div className="mb-3 grid grid-cols-3 gap-1.5">
          {SPLASH_VARIANTS.map((v) => {
            const active = v.id === variantId;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setVariantId(v.id)}
                title={v.blurb}
                className={
                  "rounded-lg border px-2 py-1.5 text-meta font-semibold transition-colors " +
                  (active
                    ? "border-brand-action bg-brand-action/10 text-brand-action"
                    : "border-border bg-surface text-foreground-muted hover:bg-surface-raised")
                }
              >
                {v.label}
              </button>
            );
          })}
        </div>

        {/* active variant blurb */}
        <p className="mb-3 text-meta leading-snug text-foreground-muted">
          {entry.blurb}
        </p>

        {/* userName control */}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label
              htmlFor="splash-username"
              className="mb-1 block text-meta font-semibold text-foreground-muted"
            >
              userName
            </label>
            <input
              id="splash-username"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="e.g. Grant"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-body text-foreground outline-none focus:border-brand-action focus:ring-1 focus:ring-brand-action"
            />
          </div>
          <button
            type="button"
            onClick={() => setUserName("")}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-meta font-medium text-foreground-muted hover:bg-surface-raised"
          >
            Clear
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-foreground-muted">
          Clear the name to test the no-greeting fallback. Esc or Skip dismisses
          a running splash. Reduced-motion shows a static logo for every variant.
        </p>
      </div>
    </main>
  );
}
