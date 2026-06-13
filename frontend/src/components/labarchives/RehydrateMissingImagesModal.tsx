"use client";

/**
 * Modal wrapper around `RehydrateMissingImagesPanel`. Opened from the
 * persistent banner in `TaskDetailPopup`'s Lab Notes tab when the user has
 * leftover Form-B online-only images from a LabArchives import.
 *
 * The wizard's "5 · Fetch images" step is the canonical place to bring
 * inline images in; this modal is the rescue path for users who clicked
 * away from the wizard, skipped the step, or only had partial luck the
 * first time.
 *
 * The modal calls `rehydrateMissingImages` from `lib/import/eln/rehydrate.ts`
 * once the user confirms — which is the same disk-write + markdown-rewrite
 * + sidecar-shrink behavior the wizard runs at apply time, extracted into a
 * function callable post-import.
 *
 * Demo / wiki-capture mode: both panel paths (DevTools + Drop) work in
 * demo because their staged blobs come from the user's own browser, not
 * from any LabArchives backend. Apply-side rehydration writes to the demo's
 * fixture file-service, which is fine — the demo banner re-renders with the
 * new count next session.
 */

import { useCallback, useState } from "react";
import LivingPopup from "@/components/ui/LivingPopup";
import RehydrateMissingImagesPanel from "./RehydrateMissingImagesPanel";
import type { FetchedImage, MissingInlineImage } from "@/lib/import/eln/types";
import {
  rehydrateMissingImages,
  type RehydrateResult,
} from "@/lib/import/eln/rehydrate";

interface Props {
  /** Controlled open state. The parent always renders the modal and toggles
   *  this so LivingPopup can play its exit animation on close. */
  open: boolean;
  /** Task notes base (`taskNotesBase({ id, owner })`). Used as the disk
   *  root for the Images/ folder + the `_import_source.json` sidecar. */
  notesBase: string;
  /** Markdown path for `notes.md` — the same path the Lab Notes editor
   *  reads/writes. The modal rewrites image refs in this file in-place. */
  notesMarkdownPath: string;
  /** Outstanding Form-B images we'll be trying to bring in. Sourced from
   *  the sidecar at banner-load time. */
  missingImages: MissingInlineImage[];
  /** Optional notebook label for the DevTools-script's ZIP filename. */
  notebookLabel?: string;
  /** Fires after the apply pass completes (success or partial). The banner
   *  uses this to refresh its count. The result's `sidecar` field is the
   *  post-shrink sidecar shape, NOT the pre-shrink one. */
  onApplied: (result: RehydrateResult) => void;
  /** Fires when the user closes the modal without applying. Also fires after
   *  a successful apply, AFTER `onApplied`, so the parent can clean up its
   *  open-state. */
  onClose: () => void;
}

type ApplyState =
  | { kind: "idle" }
  | { kind: "applying" }
  | { kind: "done"; result: RehydrateResult }
  | { kind: "error"; message: string };

export default function RehydrateMissingImagesModal({
  open,
  notesBase,
  notesMarkdownPath,
  missingImages,
  notebookLabel,
  onApplied,
  onClose,
}: Props) {
  const [staged, setStaged] = useState<Map<string, FetchedImage>>(new Map());
  const [applyState, setApplyState] = useState<ApplyState>({ kind: "idle" });

  // Retain the last set of missing images so the body stays rendered through
  // LivingPopup's close animation after the parent clears them. Synced during
  // render (no ref read in render), the ExportFormatDialog idiom.
  const [shownImages, setShownImages] =
    useState<MissingInlineImage[]>(missingImages);
  if (open && missingImages !== shownImages) setShownImages(missingImages);

  const stagedOkCount = useStagedOkCount(staged);

  const handleApply = useCallback(async () => {
    if (stagedOkCount === 0) return;
    setApplyState({ kind: "applying" });
    try {
      const result = await rehydrateMissingImages({
        notesBase,
        notesMarkdownPath,
        fetched: staged,
      });
      setApplyState({ kind: "done", result });
      onApplied(result);
    } catch (err) {
      setApplyState({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to apply rehydration.",
      });
    }
  }, [notesBase, notesMarkdownPath, staged, stagedOkCount, onApplied]);

  const handleClose = useCallback(() => {
    if (applyState.kind === "applying") return;
    onClose();
  }, [applyState.kind, onClose]);

  return (
    <LivingPopup
      open={open}
      onClose={handleClose}
      label="Pull in your missing inline images"
      widthClassName="max-w-3xl"
      card={false}
      fillHeight
    >
      <div className="bg-surface-raised rounded-xl shadow-xl w-full max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-6 pt-5 pb-3 border-b border-border flex items-center justify-between gap-4">
          <div>
            <p className="text-meta uppercase tracking-wide text-foreground-muted font-medium">
              LabArchives import
            </p>
            <h2 className="text-title font-semibold text-foreground mt-0.5">
              Pull in your missing inline images
            </h2>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {applyState.kind === "done" ? (
            <ApplySummary result={applyState.result} />
          ) : (
            <RehydrateMissingImagesPanel
              missingImages={shownImages}
              notebookLabel={notebookLabel}
              onMatchesChange={setStaged}
            />
          )}
          {applyState.kind === "error" && (
            <p className="mt-3 text-meta text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 rounded-md px-3 py-2">
              {applyState.message}
            </p>
          )}
        </div>

        <div className="px-6 py-3 border-t border-border flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={applyState.kind === "applying"}
            className="px-3 py-2 text-body text-foreground hover:text-foreground disabled:opacity-50"
          >
            {applyState.kind === "done" ? "Done" : "Cancel"}
          </button>
          {applyState.kind !== "done" && (
            <button
              type="button"
              onClick={handleApply}
              disabled={stagedOkCount === 0 || applyState.kind === "applying"}
              className="px-4 py-2 text-body bg-brand-action hover:bg-brand-action/90 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {applyState.kind === "applying"
                ? "Applying…"
                : stagedOkCount === 0
                  ? "Apply images"
                  : `Apply ${stagedOkCount} image${stagedOkCount === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    </LivingPopup>
  );
}

/** Count entries in the staged map that are `{ kind: "ok" }`. Errors and
 *  missing entries don't get applied, so the button shouldn't pretend
 *  they're countable. */
function useStagedOkCount(staged: Map<string, FetchedImage>): number {
  let n = 0;
  for (const v of staged.values()) {
    if (v.kind === "ok") n++;
  }
  return n;
}

function ApplySummary({ result }: { result: RehydrateResult }) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/15 px-4 py-3">
        <p className="text-body font-medium text-emerald-900 dark:text-emerald-300">
          {result.applied === 0
            ? "Nothing was applied."
            : `Applied ${result.applied} image${result.applied === 1 ? "" : "s"}.`}
        </p>
        {result.sidecar && (
          <p className="text-meta text-emerald-800 dark:text-emerald-300 mt-1">
            {result.sidecar.missingInlineImages.length === 0
              ? "All your inline images are now in the note."
              : `${result.sidecar.missingInlineImages.length} image${
                  result.sidecar.missingInlineImages.length === 1 ? "" : "s"
                } still online — you can come back to this any time.`}
          </p>
        )}
      </div>
      {result.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 px-4 py-3">
          <p className="text-body font-medium text-amber-900 dark:text-amber-300">
            Some images couldn&apos;t be written:
          </p>
          <ul className="mt-1 list-disc list-inside text-meta text-amber-800 dark:text-amber-300 space-y-0.5">
            {result.warnings.slice(0, 8).map((w, i) => (
              <li key={i}>
                <code className="text-meta">{w.filename}</code> — {w.message}
              </li>
            ))}
            {result.warnings.length > 8 && (
              <li className="italic">
                …and {result.warnings.length - 8} more.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
