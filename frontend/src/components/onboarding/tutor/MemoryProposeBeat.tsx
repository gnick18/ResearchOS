"use client";

// Onboarding tutor — the memory-propose beat.
//
// Introduces the per-user memory by USING it in context. Beaker offers to
// remember what he learned, the user confirms (propose-then-confirm, never a
// silent write). The privacy promise (per-user, never shared) is stated right
// where the first write happens. Either choice advances. No emojis, no
// em-dashes, no mid-sentence colons.

import BeakerBot from "@/components/BeakerBot";
import TutorScreen from "./TutorScreen";

export interface MemoryProposeBeatProps {
  fact: string;
  /** User said yes (the host persists the fact to the per-user memory). */
  onRemember: () => void;
  /** User declined, nothing persists. */
  onDecline: () => void;
}

export default function MemoryProposeBeat({
  fact,
  onRemember,
  onDecline,
}: MemoryProposeBeatProps) {
  return (
    <TutorScreen>
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-start gap-2">
          <span className="h-8 w-8 flex-none">
            <BeakerBot pose="idle" animated alive ariaLabel="Beaker" className="h-full w-full" />
          </span>
          <div className="rounded-xl rounded-tl-sm border border-[var(--line,#e3e5e0)] bg-[var(--sunken,#f1f2ef)] px-3 py-2 text-sm">
            I keep a little memory just for you, private and never shared with
            your lab. Anytime you tell me to remember something, it sticks across
            all our chats.
          </div>
        </div>

        <div className="rounded-xl border border-[var(--violet,#7c4dca)] bg-[var(--violet-soft,#efe7fb)] px-3 py-3">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-[var(--violet-ink,#5b34a0)]">
            Save to your memory?
          </div>
          <div className="mb-3 text-sm italic">{fact}</div>
          <div className="flex gap-2">
            <button
              onClick={onRemember}
              className="rounded-lg bg-[var(--violet,#7c4dca)] px-3 py-1.5 text-xs font-bold text-white hover:brightness-105"
            >
              Yes, remember
            </button>
            <button
              onClick={onDecline}
              className="rounded-lg border border-[var(--violet,#7c4dca)] bg-[var(--surface,#fff)] px-3 py-1.5 text-xs font-bold text-[var(--violet-ink,#5b34a0)] hover:bg-[var(--sunken,#f1f2ef)]"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </TutorScreen>
  );
}
