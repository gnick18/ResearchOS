"use client";

// Lab-tier Phase 7a: the preview + confirm + progress + result UI for converting
// a multiuser folder into a single-user (separate accounts) folder.
//
// Flow: open -> compute the plan (preview) -> user confirms -> run (progress) ->
// result with recovery info. The dangerous work is gated behind an explicit
// confirm, and the result screen says where the hand-off copies and the
// recoverable originals live.
//
// House style: no emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import type { IconName } from "@/components/icons";
import { planMigrationToSoloLive, executeMigrationToSoloLive } from "@/lib/lab/migrate-to-solo-live";
import type { MigrationPlan } from "@/lib/lab/migrate-to-solo";
import type { MigrationExecResult } from "@/lib/lab/migrate-to-solo-executor";
import { useFileSystem } from "@/lib/file-system/file-system-context";

type Phase = "loading" | "preview" | "running" | "done" | "error";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** One "what happens" point with an icon and a sentence. */
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

// Mounted only while open (the parent gates with `soloOpen && ...`), so state
// starts fresh each time and the load effect only writes state AFTER its await.
export default function MigrateToSoloModal({
  onClose,
  onComplete,
  primaryUser,
  chromeless = false,
}: {
  onClose: () => void;
  /** Called once the conversion succeeds (the result screen is shown). */
  onComplete?: () => void;
  primaryUser: string;
  /** Render just the inner content WITHOUT the LivingPopup wrapper, so a parent
   *  (the on-connect MigrationGate) can host this body inside its own single,
   *  continuous popup instead of opening a second one. Standalone callers
   *  (Settings, RunALabModal) leave this off and keep their own popup chrome. */
  chromeless?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [result, setResult] = useState<MigrationExecResult | null>(null);
  const [error, setError] = useState<string>("");
  const { directoryName } = useFileSystem();

  // Compute the plan once on mount.
  useEffect(() => {
    let cancelled = false;
    planMigrationToSoloLive(primaryUser)
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
  }, [primaryUser]);

  const run = async () => {
    if (!plan) return;
    setPhase("running");
    try {
      const r = await executeMigrationToSoloLive(plan);
      setResult(r);
      setPhase("done");
      onComplete?.();
    } catch (e) {
      setError(errorMessage(e));
      setPhase("error");
    }
  };

  const others = plan?.usersToMove ?? [];
  const count = others.length;
  const peopleWord = count === 1 ? "person" : "people";

  const body = (
    <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <span className="text-brand-sky">
            <Icon name="users" className="h-6 w-6" />
          </span>
          <h2 className="text-title font-semibold text-foreground">Convert this folder to single-user</h2>
        </div>

        {phase === "loading" && (
          <p className="text-body text-foreground-muted">Looking at who is in this folder...</p>
        )}

        {phase === "preview" && plan && plan.alreadySolo && (
          <>
            <p className="text-body text-foreground">
              This folder already has just you in it. There is no one to move
              out, but it is still set up as a shared lab, which is why
              ResearchOS keeps asking. Finish converting it into your personal
              folder and it will stop.
            </p>
            <p className="text-meta text-foreground-muted">
              This only updates this folder&apos;s setup. None of your notes,
              tasks, or files are touched, and nothing is deleted.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="ros-btn-neutral px-4 py-2 text-body text-foreground">
                Cancel
              </button>
              <button type="button" onClick={run} className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 px-4 py-2 text-body rounded-lg">
                Make it my personal folder
              </button>
            </div>
          </>
        )}

        {phase === "preview" && plan && !plan.alreadySolo && (
          <>
            <p className="text-body text-foreground">
              You are <span className="font-semibold">{primaryUser}</span>. This folder is shared with {count}{" "}
              other {peopleWord}. Converting makes it your own single-user folder, which drops the multi-user
              overhead and loads faster. Your own notes, tasks, and files are left exactly as they are.
            </p>

            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
              <Point icon="download" title="Everyone else gets a portable copy">
                Each person is packaged under{" "}
                <code className="text-meta">{directoryName ?? "this folder"}/_migration_bundles</code> so you can hand
                them their bundle. They open it as their own single-user folder, so no one loses their work.
              </Point>
              <Point icon="history" title="Their data moves to a recoverable Trash">
                Originals go to{" "}
                <code className="text-meta">{directoryName ?? "this folder"}/_trash/migrated_users</code>, not a hard
                delete, so you can put anything back if something looks off.
              </Point>
              <Point icon="share" title="Shared links are cleared">
                Sharing between you and them is removed, because a single-user folder shares with no one. Only the
                sharing links change, your records keep their history.
              </Point>
            </div>

            <div>
              <p className="text-meta font-medium text-foreground-muted mb-2">
                Moving out ({count} {peopleWord})
              </p>
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {others.map((u) => (
                  <li key={u.username} className="flex items-center justify-between px-3 py-2">
                    <span className="text-body text-foreground">{u.username}</span>
                    <span className="text-meta text-foreground-muted">
                      {u.total} {u.total === 1 ? "record" : "records"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="ros-btn-neutral px-4 py-2 text-body text-foreground">
                Cancel
              </button>
              <button type="button" onClick={run} className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 px-4 py-2 text-body rounded-lg">
                Convert to single-user
              </button>
            </div>
          </>
        )}

        {phase === "running" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="text-brand-action animate-spin">
              <Icon name="refresh" className="h-7 w-7" />
            </span>
            <p className="text-body text-foreground">
              {count > 0
                ? `Converting. Moving ${count} ${peopleWord} out and tidying up.`
                : "Converting. Finishing up."}
            </p>
            <p className="text-meta text-foreground-muted">
              This can take a moment on a synced folder. Please keep this tab open.
            </p>
          </div>
        )}

        {phase === "done" && result && (
          <>
            <div className="flex items-center gap-2 text-green-600">
              <Icon name="check" className="h-5 w-5" />
              <p className="text-body font-medium">
                This folder is now your personal folder.
              </p>
            </div>
            {result.movedUsers.length > 0 ? (
              <>
                <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
                  <Point icon="download" title="Hand-off copies are ready">
                    Find each person under{" "}
                    <code className="text-meta">{directoryName ?? "this folder"}/_migration_bundles</code> and send them
                    their bundle. They open it as their own folder.
                  </Point>
                  <Point icon="history" title="Nothing was deleted">
                    The originals are in{" "}
                    <code className="text-meta">{directoryName ?? "this folder"}/_trash/migrated_users</code> if you ever
                    need to recover them.
                  </Point>
                </div>
                <p className="text-meta text-foreground-muted">
                  Moved out: {result.movedUsers.join(", ")}.
                </p>
              </>
            ) : (
              <p className="text-body text-foreground-muted">
                Nothing needed to move. This just cleared the leftover shared-lab
                setup, so it works as a single-user folder now and will not keep
                asking.
              </p>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 px-4 py-2 text-body rounded-lg">
                Done
              </button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <div className="flex items-start gap-2 text-amber-600">
              <Icon name="alert" className="h-5 w-5 mt-0.5 shrink-0" />
              <div>
                <p className="text-body font-medium">The conversion did not finish.</p>
                <p className="text-meta text-foreground-muted mt-1 break-words">{error}</p>
              </div>
            </div>
            <p className="text-body text-foreground">
              No data was lost. Nothing is removed until a full backup copy exists, so you can safely run this again
              to finish where it left off.
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
  );

  // Hosted inside the gate's single, continuous popup: hand back just the body so
  // there is no second LivingPopup and no close-then-reopen animation. The gate
  // owns the surrounding chrome and its blocking close behavior.
  if (chromeless) return body;

  return (
    <LivingPopup
      open
      // Block close while the move is running so a tab close cannot interrupt it.
      onClose={phase === "running" ? () => {} : onClose}
      label="Convert this folder to single-user"
      widthClassName="max-w-2xl"
      padded
      showClose={phase !== "running"}
      closeOnEscape={phase !== "running"}
      closeOnScrimClick={phase !== "running"}
    >
      {body}
    </LivingPopup>
  );
}
