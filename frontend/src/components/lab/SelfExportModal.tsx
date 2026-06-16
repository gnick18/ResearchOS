"use client";

// Lab-tier Phase 7a: the labmate side of the role-aware migration. A non-owner
// user takes THEIR data out of a shared folder into their own portable folder,
// leaving everyone else in the shared folder untouched.
//
// Flow: open -> compute the plan (your record count + who stays) -> confirm ->
// run -> on success, IMMEDIATELY disconnect from the shared folder and hand off
// to SelfExportResultBanner, which tells the user where their new folder is.
//
// Why disconnect immediately: after the export removes users/<me>/, the app is
// still signed in as that user, and its per-user writers (streak, notebooks)
// will re-create a ghost users/<me>/ within a second. A button-gated disconnect
// on a result screen cannot win that race, so the result is shown AFTER the
// disconnect via a sessionStorage-backed banner instead.
//
// House style: no emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";
import { planSelfExportLive, executeSelfExportLive } from "@/lib/lab/migrate-to-solo-live";
import type { SelfExportPlan } from "@/lib/lab/migrate-to-solo-live";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { SELF_EXPORT_RESULT_KEY } from "./SelfExportResultBanner";

type Phase = "loading" | "preview" | "running" | "error";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function Point({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-brand-action">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-body font-medium text-foreground">{title}</p>
        <p className="text-meta text-foreground-muted mt-0.5">{children}</p>
      </div>
    </div>
  );
}

// Mounted only while open, so state starts fresh and the load effect only writes
// state after its await.
export default function SelfExportModal({
  onClose,
  onComplete,
  username,
}: {
  onClose: () => void;
  /** Called once the export succeeds (just before the disconnect). */
  onComplete?: () => void;
  username: string;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [plan, setPlan] = useState<SelfExportPlan | null>(null);
  const [error, setError] = useState<string>("");
  const { directoryName, disconnect } = useFileSystem();

  useEffect(() => {
    let cancelled = false;
    planSelfExportLive(username)
      .then((p) => {
        if (cancelled) return;
        setPlan(p);
        setPhase("preview");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(errorMessage(e));
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  const folderName = directoryName ?? "this folder";
  const remaining = plan?.remaining ?? [];
  const stayWord = remaining.length === 1 ? "person stays" : "people stay";
  const bundleDisplayPath = `${folderName}/_migration_bundles/${username}`;

  const run = async () => {
    setPhase("running");
    try {
      const r = await executeSelfExportLive(username);
      // Stash the result for the post-disconnect banner, then disconnect AT ONCE
      // so the app stops writing as the departed user (no ghost users/<me>/).
      try {
        window.sessionStorage.setItem(
          SELF_EXPORT_RESULT_KEY,
          JSON.stringify({
            username,
            folderName,
            bundlePath: `${folderName}/${r.bundlePath}`,
            trashPath: `${folderName}/${r.trashPath}`,
          }),
        );
      } catch {
        /* sessionStorage unavailable; the banner just will not show */
      }
      onComplete?.();
      await disconnect(); // unmounts this modal; the app returns to the connect screen
    } catch (e) {
      setError(errorMessage(e));
      setPhase("error");
    }
  };

  return (
    <LivingPopup
      open
      onClose={phase === "running" ? () => {} : onClose}
      label="Take your data to your own folder"
      widthClassName="max-w-2xl"
      padded
      showClose={phase !== "running"}
      closeOnEscape={phase !== "running"}
      closeOnScrimClick={phase !== "running"}
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <span className="text-brand-sky">
            <Icon name="download" className="h-6 w-6" />
          </span>
          <h2 className="text-title font-semibold text-foreground">Take your data to your own folder</h2>
        </div>

        {phase === "loading" && <p className="text-body text-foreground-muted">Adding up your data...</p>}

        {phase === "preview" && plan && (
          <>
            <p className="text-body text-foreground">
              You are <span className="font-semibold">{username}</span>. This copies your{" "}
              <span className="font-semibold">{plan.total}</span> {plan.total === 1 ? "record" : "records"} into a
              portable folder you can open as your own single-user workspace, then removes you from this shared
              folder. The other {remaining.length} {stayWord} put, and their data is not touched.
            </p>

            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
              <Point icon="download" title="Your data becomes its own folder">
                Everything you own is copied into <code className="text-meta">{bundleDisplayPath}</code>, a complete
                folder you open as your own workspace. Nothing of yours is left behind.
              </Point>
              <Point icon="users" title="The shared folder stays for everyone else">
                Only you leave. The other {remaining.length} {remaining.length === 1 ? "person keeps" : "people keep"}{" "}
                working in this folder exactly as before.
              </Point>
              <Point icon="history" title="Reversible">
                Your originals move to a recoverable <code className="text-meta">{folderName}/_trash</code>, not a hard
                delete, so this can be undone if needed.
              </Point>
            </div>

            {remaining.length > 0 && (
              <p className="text-meta text-foreground-muted">Staying in this folder: {remaining.join(", ")}.</p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="ros-btn-neutral px-4 py-2 text-body text-foreground">
                Cancel
              </button>
              <button type="button" onClick={run} className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 px-4 py-2 text-body rounded-lg">
                Take my data out
              </button>
            </div>
          </>
        )}

        {phase === "running" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="text-brand-action animate-spin">
              <Icon name="refresh" className="h-7 w-7" />
            </span>
            <p className="text-body text-foreground">Exporting your data and leaving the shared folder.</p>
            <p className="text-meta text-foreground-muted">This can take a moment on a synced folder. Please keep this tab open.</p>
          </div>
        )}

        {phase === "error" && (
          <>
            <div className="flex items-start gap-2 text-amber-600">
              <Icon name="alert" className="h-5 w-5 mt-0.5 shrink-0" />
              <div>
                <p className="text-body font-medium">The export did not finish.</p>
                <p className="text-meta text-foreground-muted mt-1 break-words">{error}</p>
              </div>
            </div>
            <p className="text-body text-foreground">
              No data was lost. Nothing is removed until a full copy of your data exists, so you can safely run this
              again to finish.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="ros-btn-neutral px-4 py-2 text-body text-foreground">
                Close
              </button>
              <button type="button" onClick={run} className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 px-4 py-2 text-body rounded-lg">
                Try again
              </button>
            </div>
          </>
        )}
      </div>
    </LivingPopup>
  );
}
