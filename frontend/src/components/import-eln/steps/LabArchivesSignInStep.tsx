"use client";

/**
 * Thin wizard-step wrapper around the reusable 3-tab fetch panel.
 *
 * The tab-switching core (API / DevTools / Drop) moved to
 * `components/labarchives/RehydrateMissingImagesPanel.tsx` on 2026-05-14
 * Phase 1 so the same UI is available from the post-import banner in
 * `TaskDetailPopup`'s Lab Notes tab (via `RehydrateMissingImagesModal`).
 *
 * This file's only remaining job is the wizard-specific glue: the
 * Back / Skip / Continue buttons at the bottom of the dialog. The panel
 * owns its own state; we read the most recent staged map via
 * `onMatchesChange` and hand it off when the user clicks Continue.
 */

import { useCallback, useState } from "react";
import RehydrateMissingImagesPanel from "@/components/labarchives/RehydrateMissingImagesPanel";
import type { FetchedImage } from "@/lib/labarchives/api-client";
import type { MissingInlineImage } from "@/lib/import/eln/types";

interface Props {
  /** Receiver-side username; the panel reads/writes `_labarchives.json`
   *  for this user when the API path is taken. */
  receiver: string;
  /** Form-B inline images we know about from the Preview step. */
  missingImages: MissingInlineImage[];
  /** Optional notebook label used in the DevTools-script's ZIP filename. */
  notebookLabel?: string;
  /** Fire when the user chooses to continue. The map is keyed by
   *  `MissingInlineImage.originalUrl` and may be empty (the user opted to
   *  skip the rehydration step entirely). */
  onContinue: (fetched: Map<string, FetchedImage>) => void;
  /** Fire when the user backs out of this step. */
  onBack: () => void;
}

export default function LabArchivesSignInStep({
  receiver,
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
        username={receiver}
        missingImages={missingImages}
        notebookLabel={notebookLabel}
        onMatchesChange={handleMatches}
      />

      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={onBack}
          className="px-3 py-2 text-sm text-gray-700 hover:text-gray-900"
        >
          Back
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onContinue(new Map())}
            className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg"
          >
            Skip — leave as placeholders
          </button>
          <button
            type="button"
            onClick={() => onContinue(staged)}
            disabled={stagedCount === 0}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
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
