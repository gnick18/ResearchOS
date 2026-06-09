"use client";

// OverviewSection: the project's "About" overview, prose-autosaved to disk.
//
// EXTRACTED from ProjectRoute.tsx (the retiring full-page project surface) so
// the new ProjectDetailPopup can mount the centerpiece overview directly. The
// behavior is unchanged from the route version: a local-first edit buffer,
// 1500ms debounced autosave (matching NoteDetailPopup), an unsaved-changes
// guard, and owner-routed writes for shared-with-edit receivers.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { projectsApi as rawProjectsApi } from "@/lib/local-api";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import type { Project } from "@/lib/types";

// Autosave debounce for overview prose. Matches NoteDetailPopup's
// running-log entry autosave (1500ms after the last keystroke) so the
// UX stays consistent across long-form markdown surfaces.
const OVERVIEW_AUTOSAVE_DELAY_MS = 1500;

export interface OverviewSectionProps {
  project: Project;
  // The URL `?owner=` hint used for READS. When present, the overview is
  // loaded from that user's directory. View-only receivers and edit-permission
  // receivers both pass the same hint here.
  ownerHint: string | null;
  // The owner-routing target for WRITES. Set only for edit-permission
  // receivers (the shared project's actual owner); undefined for own
  // projects (writes go to the current user). View-only receivers never
  // reach the write path because `readOnly` short-circuits autosave.
  editOwner: string | undefined;
  readOnly: boolean;
  // Hide the section heading + save status when the popup already renders an
  // "About" label above the section (the popup home view). Default false keeps
  // the standalone heading for any other host.
  hideHeading?: boolean;
}

export default function OverviewSection({
  project,
  ownerHint,
  editOwner,
  readOnly,
  hideHeading = false,
}: OverviewSectionProps) {
  const queryClient = useQueryClient();
  const projectId = project.id;

  const queryKey = useMemo(
    () => ["projects", ownerHint ?? "self", projectId, "overview"] as const,
    [projectId, ownerHint]
  );

  const {
    data: serverValue,
    isLoading,
    isError,
  } = useQuery<string>({
    queryKey,
    queryFn: () => rawProjectsApi.getOverview(projectId, ownerHint ?? undefined),
  });

  // Local-first edit buffer: typing updates this immediately, the debounced
  // save flushes to disk. Without a local mirror, every keystroke would
  // round-trip through React Query refetch and the cursor would jump.
  //
  // The "store information from previous renders" pattern (React docs) is
  // used here in place of a useEffect that calls setState — that latter
  // shape triggers a cascading-render lint error and is discouraged.
  // React bails out of the current render and re-renders cleanly when
  // setState is called during render with a different value.
  const [draft, setDraft] = useState<string>("");
  const [lastSyncedServer, setLastSyncedServer] = useState<string | null>(null);
  if (serverValue !== undefined && lastSyncedServer !== serverValue) {
    setLastSyncedServer(serverValue);
    setDraft(serverValue);
  }

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (savedFlashTimeoutRef.current) clearTimeout(savedFlashTimeoutRef.current);
    };
  }, []);

  // Flush the pending autosave timer immediately (used by beforeunload). Closes
  // over the current draft, so the callback re-binds when the draft changes.
  const flushOverviewSave = useCallback(() => {
    if (!saveTimeoutRef.current) return;
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
    // Fire-and-forget: we can't await in beforeunload. The write is
    // best-effort; for tab-close scenarios the browser sometimes allows a
    // brief async operation to complete before the process exits.
    rawProjectsApi.setOverview(projectId, draft, editOwner).catch(() => {});
  }, [projectId, draft, editOwner]);

  // Guard against navigating away with a pending autosave debounce window.
  const hasOverviewUnsavedChanges = saveStatus === "saving" && !readOnly;
  useUnsavedChangesGuard(hasOverviewUnsavedChanges, { onFlush: flushOverviewSave });

  const handleChange = useCallback(
    (next: string) => {
      if (readOnly) return;
      setDraft(next);
      setSaveStatus("saving");
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await rawProjectsApi.setOverview(projectId, next, editOwner);
          // Mirror the write back into React Query AND advance the
          // "last synced from server" cursor in lockstep — otherwise the
          // render-time prop-sync check above would see the new server
          // value and overwrite the user's freshly-typed draft.
          queryClient.setQueryData(queryKey, next);
          setLastSyncedServer(next);
          setSaveStatus("saved");
          if (savedFlashTimeoutRef.current) clearTimeout(savedFlashTimeoutRef.current);
          savedFlashTimeoutRef.current = setTimeout(() => setSaveStatus("idle"), 1500);
        } catch (err) {
          console.error("[OverviewSection] Failed to save overview:", err);
          setSaveStatus("error");
        }
      }, OVERVIEW_AUTOSAVE_DELAY_MS);
    },
    [readOnly, projectId, editOwner, queryClient, queryKey]
  );

  return (
    <section id="overview" className="scroll-mt-32">
      {!hideHeading && (
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-title font-semibold text-foreground">Overview</h2>
          {!readOnly && saveStatus !== "idle" && (
            <span
              className={`text-meta ${
                saveStatus === "error" ? "text-red-500" : "text-foreground-muted"
              }`}
              aria-live="polite"
            >
              {saveStatus === "saving" && "Saving…"}
              {saveStatus === "saved" && "Saved"}
              {saveStatus === "error" && "Couldn't save"}
            </span>
          )}
        </div>
      )}
      {hideHeading && !readOnly && saveStatus !== "idle" && (
        <div className="flex justify-end mb-1">
          <span
            className={`text-meta ${
              saveStatus === "error" ? "text-red-500" : "text-foreground-muted"
            }`}
            aria-live="polite"
          >
            {saveStatus === "saving" && "Saving…"}
            {saveStatus === "saved" && "Saved"}
            {saveStatus === "error" && "Couldn't save"}
          </span>
        </div>
      )}
      {isError ? (
        <p className="text-body text-red-500">Couldn&apos;t load this project&apos;s overview.</p>
      ) : (
        // Always render the textarea so the §6.2 onboarding spotlight selector +
        // cursor type action can resolve immediately on mount. During the brief
        // loading window the value is empty and the placeholder reads as a
        // loading hint; the render-time setDraft(serverValue) sync backfills the
        // value when the read resolves.
        <textarea
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={
            isLoading
              ? "Loading overview…"
              : readOnly
                ? "No overview yet."
                : "Capture the hypothesis, motivation, and big-picture context for this project…"
          }
          disabled={readOnly}
          // Onboarding v4 §6.2 spotlight + typewriter anchor. The
          // walkthrough's project-overview-typing-demo beat types a
          // placeholder hypothesis here via the cursor script (see
          // steps/walkthrough/lib/targets.ts -> projectOverviewTextarea).
          data-tour-target="project-overview-textarea"
          className="w-full min-h-[180px] p-3 text-body text-foreground border border-border rounded-md resize-y focus:outline-none focus:ring-1 focus:ring-blue-300"
        />
      )}
    </section>
  );
}
