"use client";

// Onboarding tutor — the ONE AI demo beat.
//
// This is the only beat where the BeakerBot chat panel appears, because here the
// feature being shown IS the AI. The director picks the variant by top interest.
// The prompt is auto-typed and Beaker answers, doubling as the introduction to
// BeakerBot itself. Presentational, auto-advances to onDone after a dwell.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect } from "react";
import BeakerBot from "@/components/BeakerBot";
import type { AiVariant } from "@/lib/onboarding/reel-director";
import TutorScreen from "./TutorScreen";

export interface AiDemoBeatProps {
  variant: AiVariant;
  onDone: () => void;
}

const SCRIPT: Record<AiVariant, { route: string; prompt: string; reply: string; line: string }> = {
  overlay_tree: {
    route: "/phylo",
    prompt: "What can I overlay on this tree?",
    reply: "Your resistance table joins 7 of 8 tips. I painted MIC on for you.",
    line: "Just ask, and I'll put your data right onto the tree.",
  },
  plan_analysis: {
    route: "/datahub",
    prompt: "Plan an analysis of this data",
    reply: "Here is a plan: summarize by group, test the difference, then plot it.",
    line: "Tell me the question and I'll lay out the analysis.",
  },
  make_table: {
    route: "/datahub",
    prompt: "Make a table from this",
    reply: "I detected 3 columns and 8 rows. Want me to create the table?",
    line: "Paste anything and I'll turn it into a table you can use.",
  },
};

const DWELL_MS = 4200;

export default function AiDemoBeat({ variant, onDone }: AiDemoBeatProps) {
  const s = SCRIPT[variant];
  useEffect(() => {
    const id = setTimeout(onDone, DWELL_MS);
    return () => clearTimeout(id);
  }, [onDone]);

  return (
    <TutorScreen>
      <div className="w-full max-w-xl">
        <div className="mb-2 flex items-center justify-between text-[10.5px] uppercase tracking-wide text-[var(--faint,#9aa097)]">
          <span>on {s.route}</span>
          <span className="rounded border border-[var(--violet,#7c4dca)] bg-[var(--violet-soft,#efe7fb)] px-1.5 py-0.5 font-bold text-[var(--violet-ink,#5b34a0)]">
            AI FEATURE · chat shown
          </span>
        </div>

        <div className="overflow-hidden rounded-xl border border-[var(--line,#e3e5e0)]">
          <div className="flex items-center gap-2 border-b border-[var(--line,#e3e5e0)] bg-[var(--sunken,#f1f2ef)] px-3 py-1.5 text-[11px] font-bold">
            <span className="h-4 w-4">
              <BeakerBot pose="idle" animated alive ariaLabel="Beaker" className="h-full w-full" />
            </span>
            BeakerBot
          </div>
          <div className="flex flex-col gap-2 bg-[var(--surface,#fff)] p-3 text-xs">
            <div className="self-end rounded-lg rounded-br-sm bg-[var(--brand,#1d9e75)] px-2.5 py-1.5 text-white">
              {s.prompt}
            </div>
            <div className="self-start rounded-lg rounded-bl-sm border border-[var(--line,#e3e5e0)] bg-[var(--sunken,#f1f2ef)] px-2.5 py-1.5">
              {s.reply}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-start gap-2">
          <span className="h-7 w-7 flex-none">
            <BeakerBot pose="idle" animated alive ariaLabel="Beaker" className="h-full w-full" />
          </span>
          <div className="rounded-xl rounded-tl-sm bg-[var(--violet-soft,#efe7fb)] px-3 py-2 text-xs text-[var(--violet-ink,#5b34a0)]">
            {s.line}
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onDone}
            className="rounded-md bg-[var(--brand,#1d9e75)] px-4 py-1.5 text-xs font-bold text-white hover:brightness-105"
          >
            Continue
          </button>
        </div>
      </div>
    </TutorScreen>
  );
}
