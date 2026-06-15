"use client";

// Dev review page for the LLM onboarding tutor (BeakerAI lane, 2026-06-14).
//
// Mounts the real OnboardingTutor force-enabled (bypassing
// NEXT_PUBLIC_ONBOARDING_TUTOR) over a mock workbench, so the whole flow can be
// walked in any browser without a connected folder. This is the first place the
// flow is visible, the deep demos still run on the stand-in stage (the live
// real-page driving lands with the after-account mount). A Replay button
// remounts the tutor so the run restarts from the welcome beat.
//
// Folderless dev harness, bypasses the folder gate via the /dev/onboarding-tutor
// branch in providers.tsx. No em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useState } from "react";
import OnboardingTutor from "@/components/onboarding/tutor/OnboardingTutor";

function MockWorkbench() {
  return (
    <div className="min-h-screen w-full bg-[var(--surface,#fff)] text-[var(--fg,#1f2421)]">
      <header className="flex items-center justify-between border-b border-[var(--line,#e3e5e0)] px-5 py-3">
        <span className="text-base font-extrabold tracking-tight">ResearchOS</span>
        <span className="text-xs text-[var(--muted,#6b716a)]">/ Workbench (mock)</span>
      </header>
      <main className="p-6">
        <h1 className="mb-1 text-2xl font-extrabold tracking-tight">Today at a glance</h1>
        <p className="text-sm text-[var(--muted,#6b716a)]">
          The mock app the onboarding tutor mounts over.
        </p>
      </main>
    </div>
  );
}

export default function OnboardingTutorReviewPage() {
  const [runId, setRunId] = useState(0);
  const [lastFact, setLastFact] = useState<string | null>(null);

  const replay = useCallback(() => {
    setLastFact(null);
    setRunId((n) => n + 1);
  }, []);

  return (
    <main className="relative">
      <MockWorkbench />

      <OnboardingTutor
        key={runId}
        forceEnabled
        onComplete={() => {
          /* run reached done or skipped; in the real mount the host unmounts + records it */
        }}
        onRememberFact={(fact) => setLastFact(fact)}
      />

      <div className="fixed bottom-4 left-4 z-[20000] w-[min(92vw,420px)] rounded-2xl border border-[var(--line2,#d2d5cd)] bg-[var(--surface,#fff)] p-4 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--faint,#9aa097)]">
            Onboarding tutor review
          </span>
          <button
            type="button"
            onClick={replay}
            className="rounded-lg bg-[var(--brand,#1d9e75)] px-4 py-1.5 text-sm font-semibold text-white hover:brightness-105"
          >
            Replay
          </button>
        </div>
        <p className="text-[11px] leading-snug text-[var(--muted,#6b716a)]">
          Walk welcome to recap. Deep demos run on the stand-in stage for now.
          The memory write is captured below instead of persisted.
        </p>
        {lastFact ? (
          <p className="mt-2 rounded-md bg-[var(--violet-soft,#efe7fb)] px-2 py-1 text-[11px] text-[var(--violet-ink,#5b34a0)]">
            remembered: {lastFact}
          </p>
        ) : null}
      </div>
    </main>
  );
}
