"use client";

// Lab-tier Phase 7a: the role-aware, blocking on-connect migration gate.
//
// When a real (non-demo) user connects a folder that is still multi-user, this
// greets them with a blocking choice so the migration is discoverable instead of
// buried in Settings:
//   - the OWNER (main user) is offered "Convert this folder to mine" (they keep
//     it, everyone else is packaged into portable copies),
//   - a LABMATE is offered "Take my data to my own folder" (they export just
//     themselves and leave, the shared folder stays intact for the rest).
// Both can choose "Keep it shared for now", which dismisses the gate for THIS
// folder durably (a per-folder localStorage flag), so a user who deliberately
// runs a shared folder is not re-nagged on every reload or relaunch. The
// migration is still reachable on demand from Settings; clearing the flag (or
// site data) re-surfaces the gate.
//
// Nothing is ever deleted, and nothing happens without an explicit confirm on
// the following preview screen. It is explicitly suppressed in demo mode: the
// demo fixture is a multi-user lab (so isLabMode is true), and the gate must not
// nag a visitor exploring /demo to migrate the fixture. The demo overrides the
// linked folder, so the gate waits and reappears once they leave demo.
//
// House style: no emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import LivingPopup from "@/components/ui/LivingPopup";
import { Icon } from "@/components/icons";
import { usePathname } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { LAB_MODE_QUERY_KEY } from "@/hooks/useIsLabMode";
import {
  useIsMultiUserFolder,
  MULTI_USER_FOLDER_QUERY_KEY,
} from "@/hooks/useIsMultiUserFolder";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { isOperatorSurface } from "@/lib/routes/operator-surface";
import { getDemoMode } from "@/lib/file-system/wiki-capture-mock";
import MigrateToSoloModal from "./MigrateToSoloModal";
import SelfExportModal from "./SelfExportModal";
import { SINGLE_USER_FOLDERS_ENABLED } from "@/lib/lab/single-user-folders-config";
import {
  type MigrationGraceState,
  isMigrationGateDismissible,
  recordMigrationDismissal,
  ensureMigrationFirstSeen,
  MIGRATION_GRACE_MAX_DISMISSALS,
  MIGRATION_GRACE_WINDOW_DAYS,
} from "@/lib/lab/single-user-folders";

// Per-folder so dismissing one shared folder does not silence the nudge for a
// different multi-user folder the same browser later connects.
const DISMISS_KEY_PREFIX = "ros_migration_gate_dismissed_v1";

// Phase-out-multi-user-folders grace bookkeeping (flag ON only). A SEPARATE
// per-folder key from the legacy boolean above, so flag-OFF keeps reading and
// writing the byte-identical unlimited-dismiss boolean and the two never collide.
// localStorage only, NO on-disk data, so NO data-shape change.
const GRACE_KEY_PREFIX = "ros_migration_gate_grace_v1";

function dismissKey(folder: string | null | undefined): string {
  return `${DISMISS_KEY_PREFIX}::${folder ?? "_unknown_"}`;
}

function graceKey(folder: string | null | undefined): string {
  return `${GRACE_KEY_PREFIX}::${folder ?? "_unknown_"}`;
}

function readDismissed(folder: string | null | undefined): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(dismissKey(folder)) === "1";
  } catch {
    return false;
  }
}

function readGraceState(
  folder: string | null | undefined,
): MigrationGraceState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(graceKey(folder));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MigrationGraceState>;
    if (
      typeof parsed?.firstSeen === "number" &&
      typeof parsed?.dismissals === "number"
    ) {
      return { firstSeen: parsed.firstSeen, dismissals: parsed.dismissals };
    }
    return null;
  } catch {
    return null;
  }
}

function writeGraceState(
  folder: string | null | undefined,
  state: MigrationGraceState,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(graceKey(folder), JSON.stringify(state));
  } catch {
    /* localStorage unavailable, in-memory state still drives this session */
  }
}

export default function MigrationGate() {
  const { currentUser, mainUser } = useCurrentUser();
  // Multi-user, NOT lab-mode: a solo lab head (one user, account_type lab_head)
  // is in lab mode but has no other users to migrate out, so the gate must not
  // fire for them. Only a folder that genuinely holds 2+ users needs splitting.
  const isMultiUser = useIsMultiUserFolder() ?? false;
  const pathname = usePathname();
  const { directoryName, disconnect } = useFileSystem();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [graceState, setGraceState] = useState<MigrationGraceState | null>(null);
  const [mode, setMode] = useState<"convert" | "selfexport" | null>(null);

  // Re-read the per-folder dismissal whenever the connected folder changes (the
  // name is null on the first render, before the handle resolves).
  useEffect(() => {
    setDismissed(readDismissed(directoryName));
    setGraceState(readGraceState(directoryName));
  }, [directoryName]);

  // Flag ON only: stamp first-seen the moment the gate is genuinely showing for a
  // multi-user folder, even if the user never clicks "Keep it shared for now", so
  // the days window starts ticking. Idempotent (ensureMigrationFirstSeen returns
  // prev unchanged once set), so this never resets the clock or counts a dismiss.
  useEffect(() => {
    if (!SINGLE_USER_FOLDERS_ENABLED) return;
    if (!isMultiUser || !currentUser) return;
    setGraceState((prev) => {
      const next = ensureMigrationFirstSeen(prev);
      if (next !== prev) writeGraceState(directoryName, next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiUser, currentUser, directoryName]);

  // Within grace -> the "Keep it shared for now" dismiss is offered. Once grace is
  // exhausted (count cap OR days window), the gate is BLOCKING and the dismiss is
  // removed (the user must Convert / Take-my-data-out, or use the always-present
  // disconnect escape). Flag OFF -> always dismissible (byte-identical to today).
  const dismissible = isMigrationGateDismissible(graceState);

  const dismiss = () => {
    // Flag OFF keeps the legacy unlimited-dismiss boolean (byte-identical). Flag
    // ON records the dismissal into the bounded grace state instead, so a later
    // reload re-surfaces the gate until grace runs out.
    if (!SINGLE_USER_FOLDERS_ENABLED) {
      try {
        window.localStorage.setItem(dismissKey(directoryName), "1");
      } catch {
        /* localStorage unavailable, in-memory dismiss still applies */
      }
      setDismissed(true);
      return;
    }
    // Guard against a dismiss firing once grace is already spent.
    if (!dismissible) return;
    setGraceState((prev) => {
      const next = recordMigrationDismissal(prev);
      writeGraceState(directoryName, next);
      return next;
    });
    setDismissed(true);
  };
  const onComplete = () => {
    // Close the popup directly (NOT via dismiss()): a completed migration is not
    // a "keep it shared" dismissal, so it must never spend grace, and once grace
    // is exhausted dismiss() is a no-op which would leave the popup up. The query
    // invalidation below recomputes isMultiUser to false, which is the real close.
    setDismissed(true);
    setMode(null);
    // The migration changed the folder's user count and/or cleared the
    // lab-head role, so the cached multi-user + lab-mode answers (staleTime
    // Infinity) are now wrong. Invalidate both so the gate's `isMultiUser`
    // recomputes to solo and the popup stays closed without a hard reload.
    void queryClient.invalidateQueries({ queryKey: MULTI_USER_FOLDER_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: LAB_MODE_QUERY_KEY });
  };

  // Operator surfaces (admin + LLC business) are carved out from every gate.
  if (isOperatorSurface(pathname)) return null;

  // Never in demo mode. The demo fixture is a multi-user lab, so it is
  // multi-user, but a visitor exploring /demo must not be nagged to migrate the
  // fixture. The demo overrides the real linked folder; the gate reappears once
  // they leave demo (this component re-renders on pathname change). Reading
  // getDemoMode() here, not usePathname, also catches the sticky in-tab flag.
  if (getDemoMode()) return null;

  // Only for a real, signed-in user in a genuinely multi-user folder. A solo
  // lab head (one user) is deliberately excluded, see useIsMultiUserFolder.
  if (!currentUser || !isMultiUser) return null;

  // Flag OFF: the legacy unlimited-dismiss boolean suppresses the gate forever
  // (byte-identical to before). Flag ON (phase-out): IGNORE the legacy boolean so
  // a user who dismissed the old always-dismissible gate BEFORE the flag flip is
  // re-engaged by the grace-then-force flow rather than silently grandfathered
  // out of the forced migration (the exact existing-folder population the
  // phase-out targets). Grace, started fresh by the effect above when no grace
  // key exists yet, then governs whether the "Keep it shared for now" dismiss is
  // offered. The blocking state and the disconnect escape are unchanged. A flow
  // already in progress (mode set) is never short-circuited to null here.
  if (dismissed && !SINGLE_USER_FOLDERS_ENABLED && mode === null) return null;

  // No designated main user => treat the connecting user as the owner so the
  // folder can always be converted by someone.
  const isOwner = mainUser == null || currentUser === mainUser;

  // ONE living popup hosts the whole flow. The nudge AND the chosen flow's
  // preview + confirm + progress render as a continuous swap inside the SAME
  // LivingPopup, so the user never sees a close-then-reopen or a double entrance
  // animation (Grant 2026-06-25: "the convert to single user popup twice"). The
  // chromeless modal hands back just its body; the gate keeps owning the blocking
  // chrome, and its inner Cancel returns here to the nudge rather than closing.
  const livingLabel =
    mode === "convert"
      ? "Convert this folder to single-user"
      : mode === "selfexport"
        ? "Take your data to your own folder"
        : isOwner
          ? "Make this your own folder"
          : "This is a shared lab folder";

  return (
    <LivingPopup
      open
      onClose={() => {}}
      label={livingLabel}
      widthClassName={mode === null ? "max-w-xl" : "max-w-2xl"}
      padded
      elevated
      showClose={false}
      closeOnEscape={false}
      closeOnScrimClick={false}
    >
      {mode === "convert" ? (
        <MigrateToSoloModal
          chromeless
          primaryUser={currentUser}
          onClose={() => setMode(null)}
          onComplete={onComplete}
        />
      ) : mode === "selfexport" ? (
        <SelfExportModal
          chromeless
          username={currentUser}
          onClose={() => setMode(null)}
          onComplete={onComplete}
        />
      ) : (
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <span className="text-brand-sky">
            <Icon name="users" className="h-6 w-6" />
          </span>
          <h2 className="text-title font-semibold text-foreground">
            {isOwner ? "Make this your own folder" : "This is a shared lab folder"}
          </h2>
        </div>

        {/* What you are about to act on, so the folder and account are never a
            guess. Grant 2026-06-11: the gate gave no way to confirm which folder
            or user it meant. */}
        <div className="rounded-lg border border-border bg-surface-sunken px-3.5 py-2.5 text-meta">
          <div className="flex items-center justify-between gap-3">
            <span className="text-foreground-muted">Folder</span>
            <span className="truncate font-medium text-foreground">
              {directoryName ?? "this folder"}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="text-foreground-muted">Signed in as</span>
            <span className="truncate font-medium text-foreground">
              {currentUser}
              {isOwner ? " (this folder's main account)" : ""}
            </span>
          </div>
        </div>

        {isOwner ? (
          <>
            {/* Just the choice here. The preview screen that opens on Convert
                spells out exactly what moves, so the gate no longer repeats it. */}
            <p className="text-body text-foreground">
              ResearchOS now works best as one folder per person, and this folder is still set up for several people.
              You can convert it into your own single-user folder, which is faster and simpler to work in. You will see
              exactly what moves before anything happens, and nothing is deleted.
            </p>
            {SINGLE_USER_FOLDERS_ENABLED && dismissible && (
              <p className="text-meta text-foreground-muted">
                You can keep this folder shared a little longer while you get
                ready, but moving to one folder per person will soon be required
                (up to {MIGRATION_GRACE_MAX_DISMISSALS} reminders or{" "}
                {MIGRATION_GRACE_WINDOW_DAYS} days, whichever comes first).
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              {dismissible && (
                <button
                  type="button"
                  onClick={dismiss}
                  className="ros-btn-neutral px-4 py-2 text-body text-foreground"
                >
                  Keep it shared for now
                </button>
              )}
              <button type="button" onClick={() => setMode("convert")} className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 px-4 py-2 text-body rounded-lg">
                Convert this folder to mine
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Just the choice here. The preview screen that opens on Take-my-data
                spells out exactly what moves, so the gate no longer repeats it. */}
            <p className="text-body text-foreground">
              ResearchOS now works best as one folder per person, and you are sharing this folder with others. You
              can take your own data into your own folder to work solo, and everyone else keeps this folder as it is.
              You will see exactly what moves before anything happens, and nothing is deleted.
            </p>
            {SINGLE_USER_FOLDERS_ENABLED && dismissible && (
              <p className="text-meta text-foreground-muted">
                You can keep working here a little longer while you get ready, but
                moving to your own folder will soon be required (up to{" "}
                {MIGRATION_GRACE_MAX_DISMISSALS} reminders or{" "}
                {MIGRATION_GRACE_WINDOW_DAYS} days, whichever comes first).
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              {dismissible && (
                <button
                  type="button"
                  onClick={dismiss}
                  className="ros-btn-neutral px-4 py-2 text-body text-foreground"
                >
                  Keep working here for now
                </button>
              )}
              <button type="button" onClick={() => setMode("selfexport")} className="ros-btn-raise bg-brand-action text-white transition-colors hover:bg-brand-action/90 px-4 py-2 text-body rounded-lg">
                Take my data to my own folder
              </button>
            </div>
          </>
        )}

        {/* Escape hatch: if this is the wrong folder or the wrong account, do
            not force a choice, let them reconnect a different one. */}
        <div className="border-t border-border pt-3 text-center">
          <button
            type="button"
            onClick={() => void disconnect()}
            className="text-meta text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
          >
            Wrong folder or account? Use a different folder
          </button>
        </div>
      </div>
      )}
    </LivingPopup>
  );
}
