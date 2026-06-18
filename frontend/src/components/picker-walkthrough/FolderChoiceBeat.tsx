"use client";

import { useState } from "react";

/**
 * Walkthrough Beat 3: Folder choice (local vs cloud-synced).
 *
 * Two radio cards side-by-side. The user picks one, then clicks
 * Continue. Per the state machine: local advances straight to `done`
 * (skipping Beat 4); cloud advances to Beat 4 (the per-provider setup
 * cards).
 *
 * Recommendation copy nudges solo users toward local without making
 * cloud feel second-class: both options are visually equal, and the
 * supporting text is informational rather than directive. The cards
 * use a sky-blue ring + filled radio circle to signal selection
 * (consistent with the v4 wizard radio pattern).
 *
 * Selection state is local to this beat. The parent orchestrator
 * receives the choice via `onContinue(choice)`. If the user navigates
 * back to this beat (not currently in the linear state machine, but
 * the API is shaped for it), they would start fresh: we do not persist
 * across remounts.
 *
 * Salvaged from the retired pre-onboarding flow (75c6107b) and rehomed
 * under picker-walkthrough/.
 */
export type FolderChoice = "local" | "cloud";

export interface FolderChoiceBeatProps {
  onContinue: (choice: FolderChoice) => void;
}

export default function FolderChoiceBeat({ onContinue }: FolderChoiceBeatProps) {
  const [choice, setChoice] = useState<FolderChoice | null>(null);

  const handleContinue = () => {
    if (!choice) return;
    onContinue(choice);
  };

  return (
    <div data-testid="picker-walkthrough-beat-folder-choice">
      <h2 className="mb-3 text-2xl font-bold text-slate-900">
        Where should this folder live?
      </h2>
      <p className="mb-4 text-title leading-relaxed text-slate-700">
        Pick the spot that fits how you work. You can always migrate later.
      </p>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <ChoiceCard
          choiceKey="local"
          title="Local folder"
          recommendation="Recommended for solo"
          body="A folder on your machine. Fast, simple, no sync."
          selected={choice === "local"}
          onSelect={() => setChoice("local")}
        />
        <ChoiceCard
          choiceKey="cloud"
          title="Cloud-synced folder"
          recommendation="For multi-device or sharing"
          body="A folder inside Dropbox, OneDrive, Google Drive, Box, or iCloud Drive. Requires the provider's desktop app already syncing."
          selected={choice === "cloud"}
          onSelect={() => setChoice("cloud")}
        />
      </div>
      <p className="mb-6 text-meta leading-relaxed text-slate-500">
        Not sure? Pick local. It is the fastest path and you can move the
        folder into a cloud sync app any time.
      </p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleContinue}
          disabled={!choice}
          className="inline-flex items-center rounded-lg bg-sky-500 px-5 py-2.5 text-body font-semibold text-white shadow-sm transition-colors hover:bg-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="picker-walkthrough-folder-choice-continue"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

interface ChoiceCardProps {
  choiceKey: FolderChoice;
  title: string;
  recommendation: string;
  body: string;
  selected: boolean;
  onSelect: () => void;
}

function ChoiceCard({
  choiceKey,
  title,
  recommendation,
  body,
  selected,
  onSelect,
}: ChoiceCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={[
        "flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500",
        selected
          ? "border-sky-500 bg-sky-50 shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
      ].join(" ")}
      data-testid={`picker-walkthrough-folder-choice-${choiceKey}`}
    >
      <div className="flex w-full items-center gap-2">
        {/* Radio circle, inline SVG so we don't pull in an icon lib. */}
        <span
          aria-hidden="true"
          className={[
            "inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2",
            selected ? "border-sky-500" : "border-slate-300",
          ].join(" ")}
        >
          {selected && (
            <span className="inline-block h-2 w-2 rounded-full bg-sky-500" />
          )}
        </span>
        <span className="text-title font-semibold text-slate-900">{title}</span>
      </div>
      <span className="text-meta font-medium uppercase tracking-wide text-sky-700">
        {recommendation}
      </span>
      <span className="text-body leading-relaxed text-slate-700">{body}</span>
    </button>
  );
}
