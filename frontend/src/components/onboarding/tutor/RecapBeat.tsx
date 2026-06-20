"use client";

// Onboarding tutor — the recap + invite-in beat (the end).
//
// The sample data is gone, the space is clean. Beaker shows the recap of what he
// learned (the first visibly-useful act of the memory feature) and ends on an
// invitation, not a forced task. "Replay any section" covers the everything-else
// gap. Finishing fires onFinish so the host unmounts + records the run. No
// emojis, no em-dashes, no mid-sentence colons.

import BeakerSays from "./BeakerSays";
import type { RecapItem } from "@/lib/onboarding/tutor-summary";
import TutorScreen from "./TutorScreen";

export interface RecapBeatProps {
  recap: RecapItem[];
  /** Whether the user chose to remember (changes the recap framing slightly). */
  remembered: boolean;
  /** End the run. The host unmounts and records onboarding as done. */
  onFinish: () => void;
}

export default function RecapBeat({ recap, remembered, onFinish }: RecapBeatProps) {
  return (
    <TutorScreen>
      <div className="w-full max-w-xl">
        <BeakerSays>
          That&apos;s the tour. The sample data is gone, your space is clean.
          {remembered ? " Here is what I'll remember." : ""}
        </BeakerSays>

        {remembered && recap.length > 0 ? (
          <div className="rounded-xl border border-[var(--line,#e3e5e0)] bg-[var(--surface,#fff)] px-3 py-3">
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--violet-ink,#5b34a0)]">
              Saved to your memory
            </div>
            {recap.map((r) => (
              <div
                key={r.label}
                className="flex gap-2 border-b border-dashed border-[var(--line,#e3e5e0)] py-1 text-xs last:border-b-0"
              >
                <span className="w-24 flex-none text-[var(--faint,#9aa097)]">{r.label}</span>
                <span>{r.value}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex gap-2">
          <button
            onClick={onFinish}
            className="flex-1 rounded-lg bg-[var(--brand,#1d9e75)] px-4 py-2.5 text-sm font-bold text-white hover:brightness-105"
          >
            Make your first table
          </button>
          <button
            onClick={onFinish}
            className="rounded-lg border border-[var(--line2,#d2d5cd)] px-4 py-2.5 text-sm font-bold text-[var(--muted,#6b716a)] hover:bg-[var(--sunken,#f1f2ef)]"
          >
            Just explore
          </button>
        </div>
        <div className="mt-3 text-[11px] text-[var(--info-ink,#1b4fa8)]">
          You can replay any section later from the Help menu.
        </div>
      </div>
    </TutorScreen>
  );
}
