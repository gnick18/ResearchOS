"use client";

// Dev harness for the launch-into-app Splash. Renders a mock workbench, then
// overlays the real <Splash> on top exactly the way lib/providers.tsx does in
// production, so you can confirm the rainbow exit recedes to reveal the
// workbench underneath (and not a second BeakerBot). "Replay" remounts the
// splash so it plays from the top. This route is dev-only.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { useState } from "react";

import { Splash } from "@/components/onboarding/Splash";

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

export default function SplashPreviewPage() {
  // A monotonic id used as the Splash key so "Replay" remounts it and the
  // animation restarts from the top.
  const [runId, setRunId] = useState(1);
  const [running, setRunning] = useState(true);

  return (
    <main className="relative">
      {/* The workbench is always mounted underneath, the way the real app is. */}
      <MockWorkbench />

      {/* The real Splash, overlaid on top exactly like production. On complete it
          unmounts so the rainbow exit reveals the workbench above. */}
      {running && <Splash key={runId} onComplete={() => setRunning(false)} />}

      {/* Dev controls */}
      <div className="fixed bottom-4 left-4 z-[20000] flex items-center gap-3 rounded-xl border border-border bg-surface-overlay px-3 py-2 text-meta text-foreground shadow-lg">
        <span className="text-foreground-muted">splash:</span>
        <button
          type="button"
          className="font-semibold text-brand-action"
          onClick={() => {
            setRunning(false);
            // Remount on the next tick so a mid-play replay restarts cleanly.
            setTimeout(() => {
              setRunId((n) => n + 1);
              setRunning(true);
            }, 30);
          }}
        >
          Replay
        </button>
        <span className="text-foreground-muted">
          {running ? "playing…" : "revealed the workbench"}
        </span>
      </div>
    </main>
  );
}
