"use client";

/**
 * Thin wizard-step wrapper around the reusable 2-tab fetch panel.
 *
 * The tab-switching core (DevTools / Drop) lives in
 * `components/labarchives/RehydrateMissingImagesPanel.tsx` so the same UI
 * is also reachable from the post-import banner in `TaskDetailPopup`'s
 * Lab Notes tab (via `RehydrateMissingImagesModal`).
 *
 * History: until 2026-05-14 this step also offered a third path —
 * "Connect via API" — that required institutional LabArchives access
 * credentials. That tab was removed alongside the rest of the
 * institutional-API surface (see AGENTS.md §8 "LabArchives institutional
 * API removal") because the cred-less DevTools-script and folder-drop
 * paths already cover the use case.
 */

import { useCallback, useState } from "react";
import RehydrateMissingImagesPanel from "@/components/labarchives/RehydrateMissingImagesPanel";
import type { FetchedImage, MissingInlineImage } from "@/lib/import/eln/types";

interface Props {
  missingImages: MissingInlineImage[];
  notebookLabel?: string;
  onContinue: (fetched: Map<string, FetchedImage>) => void;
  onBack: () => void;
}

export default function LabArchivesSignInStep({
  missingImages,
  notebookLabel,
  onContinue,
  onBack,
}: Props) {
  const [staged, setStaged] = useState<Map<string, FetchedImage>>(new Map());

  const handleMatches = useCallback((m: Map<string, FetchedImage>) => {
    setStaged(m);
  }, []);

  const stagedCount = staged.size;

  return (
    <div className="space-y-4">
      <RehydrateMissingImagesPanel
        missingImages={missingImages}
        notebookLabel={notebookLabel}
        onMatchesChange={handleMatches}
      />

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <button
          type="button"
          onClick={onBack}
          className="px-3 py-2 text-body text-foreground-muted hover:text-foreground"
        >
          Back
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onContinue(new Map())}
            className="ros-btn-neutral px-3 py-2 text-body"
          >
            Skip — leave as placeholders
          </button>
          <button
            type="button"
            onClick={() => onContinue(staged)}
            disabled={stagedCount === 0}
            className="ros-btn-raise px-4 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {stagedCount === 0
              ? "Continue to import"
              : `Continue with ${stagedCount} image${stagedCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
