"use client";

import { useState } from "react";
import LivingPopup from "@/components/ui/LivingPopup";
import { useQueryClient } from "@tanstack/react-query";
import { archiveUser, restoreUser } from "@/lib/lab/user-archive";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsLabHead } from "@/hooks/useIsLabHead";
import {
  useLabRosterRows,
  LAB_ROSTER_QUERY_KEY,
  type RosterRow,
} from "@/hooks/useLabRoster";
import UserAvatar from "@/components/UserAvatar";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";
import { ARCHIVED_USERS_QUERY_KEY } from "@/hooks/useArchivedUsers";
import { LAB_USER_PROFILES_QUERY_KEY } from "@/hooks/useLabUserProfiles";
import { useContextMenu } from "@/components/context-menu/ContextMenuProvider";
import type { EditMenuItem } from "@/components/sequences/SequenceEditMenu";

/**
 * Lab Head Phase 6 (lab head Phase 6 manager, 2026-05-23): Lab Roster
 * surface.
 *
 * Mounted under Settings → Lab Mode tab. Lists every user in the lab with:
 *   - display name + @username + account_type pill + status (Active /
 *     Archived)
 *   - Archive / Restore button (lab_head only)
 *
 * Members see this surface read-only — they can view the roster but
 * no archive/restore buttons render (the `canArchive` flag below stays
 * false for non-lab-heads).
 *
 * Decisions locked (LAB_HEAD_PROPOSAL §6, Grant 2026-05-23):
 *   1. Lab head only can archive (no self-archive, no member-on-member).
 *   2. Confirmation dialog before archiving (data is non-destructive
 *      but the user-visible consequence is significant).
 *
 * The old PI edit-session unlock gate on archive/restore was removed with
 * the PI edit-mode feature; being a lab head is now sufficient.
 */

// RosterRow + the loader query now live in @/hooks/useLabRoster (shared with the
// PI-Mode People page). This file renders + owns the archive/restore actions.

// D5/D6 read-only badge icon. A small "person plus link" mark for the
// "has sharing identity" pill. Inline SVG (the project ships no icon-font
// dependency and every user-facing icon is an inline SVG).
function SharingIdentityIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="4.5" r="2.5" />
      <path d="M1.5 13.5c0-2.5 2-4 4.5-4 1 0 1.9.24 2.6.66" />
      <path d="M10.5 11h4M12.5 9v4" />
    </svg>
  );
}

/**
 * PI capability revamp Phase 2 pass 2 (sharing + collaboration manager,
 * 2026-06-07): build the right-click context menu for ONE roster row. These are
 * MEMBER-scoped actions (archive / restore), not record actions, so this is a
 * small local builder rather than buildPiRecordMenuItems (which is record
 * scoped). Returns [] for a non-lab-head, or a lab head right-clicking their OWN
 * row, so openMenu(e, []) falls through to the normal right-click glyph and the
 * behavior is byte-identical for everyone else.
 *
 * The items route through the SAME pending-action confirm the inline Archive /
 * Restore buttons use (setPendingAction), so the confirmation dialog is never
 * bypassed. "Open member overview" is intentionally omitted: the roster has no
 * member-overview surface to navigate to today, and the brief says omit rather
 * than invent a route.
 */
export function buildRosterRowMenuItems(args: {
  row: RosterRow;
  isLabHead: boolean;
  currentUser: string | null | undefined;
  onArchive: () => void;
  onRestore: () => void;
}): EditMenuItem[] {
  const { row, isLabHead, currentUser, onArchive, onRestore } = args;
  // Non-lab-head, or a lab head on their OWN row: no menu. Self-archive is
  // blocked by the locked design, so the own-row case shows nothing either.
  if (!isLabHead) return [];
  if (!currentUser) return [];
  if (row.username === currentUser) return [];

  if (row.archived) {
    return [
      {
        id: "roster-restore-member",
        label: "Restore member",
        enabled: true,
        onRun: onRestore,
      },
    ];
  }
  return [
    {
      id: "roster-archive-member",
      label: "Archive member",
      enabled: true,
      onRun: onArchive,
    },
  ];
}

export default function LabRoster() {
  const { currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const { openMenu } = useContextMenu();

  // `=== true` collapses the hook's loading `undefined` to `false`, exactly as
  // the prior `accountType === "lab_head"` did, keeping the value a plain
  // boolean for the menu-builder prop below.
  const isLabHead = useIsLabHead(currentUser) === true;

  // The shared roster loader (one read of every member with display + archive +
  // sharing + IDP status), now also used by the PI-Mode People page.
  const { data: rows = [], isLoading } = useLabRosterRows();

  // Pending action state. Drives the confirmation dialog.
  const [pendingAction, setPendingAction] = useState<
    | { kind: "archive"; row: RosterRow }
    | { kind: "restore"; row: RosterRow }
    | null
  >(null);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (!pendingAction || !currentUser) return;
    setBusy(true);
    try {
      if (pendingAction.kind === "archive") {
        await archiveUser(pendingAction.row.username, currentUser);
      } else {
        await restoreUser(pendingAction.row.username, currentUser);
      }
      // Invalidate all the caches that depend on archive state so
      // pickers + roster refresh on the next render.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: LAB_ROSTER_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ARCHIVED_USERS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: LAB_USER_PROFILES_QUERY_KEY }),
      ]);
      setPendingAction(null);
    } catch (err) {
      console.error("[LabRoster] action failed", err);
      window.alert(
        `Failed to ${pendingAction.kind} ${pendingAction.row.username}. See console.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-body font-medium text-foreground">Lab Roster</h3>
          <p className="text-meta text-foreground-muted mt-0.5">
            Manage which lab members appear in pickers and on the login
            screen. Archive a departed member to hide them from
            day-to-day surfaces while keeping all their data searchable.
            You manage local accounts only. Sharing identities belong to
            each member alone, you cannot control, reset, or access them,
            and resetting a member&apos;s password resets only their
            offline fallback.
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-meta text-foreground-muted">Loading roster…</p>
      ) : rows.length === 0 ? (
        <p className="text-meta text-foreground-muted">
          No lab members found. The roster populates as users log in to
          this lab folder.
        </p>
      ) : (
        <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden">
          {rows.map((row) => {
            const label = row.displayName?.trim() || row.username;
            const isSelf = row.username === currentUser;
            // Archive button: lab_head, NOT self, NOT already archived.
            // Self-archive is intentionally blocked per the locked design —
            // a PI who wants to leave hands off to a co-PI.
            const canArchive = isLabHead && !isSelf && !row.archived;
            const canRestore = isLabHead && row.archived;
            return (
              <li
                key={row.username}
                className={`flex items-center gap-3 px-3 py-2.5 ${
                  row.archived ? "bg-surface-sunken" : "bg-surface-raised"
                }`}
                data-testid={`lab-roster-row-${row.username}`}
                data-beaker-target={`lab-member:${row.username}`}
                onContextMenu={(e) =>
                  openMenu(
                    e,
                    buildRosterRowMenuItems({
                      row,
                      isLabHead,
                      currentUser,
                      // Route through the EXISTING pending-action confirm flow so
                      // the confirmation dialog is never bypassed.
                      onArchive: () => setPendingAction({ kind: "archive", row }),
                      onRestore: () => setPendingAction({ kind: "restore", row }),
                    }),
                  )
                }
              >
                <UserAvatar username={row.username} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-body font-medium truncate ${
                        row.archived ? "text-foreground-muted" : "text-foreground"
                      }`}
                    >
                      {label}
                    </span>
                    {row.account_type === "lab_head" && (
                      <span
                        className="px-1.5 py-0.5 text-meta font-semibold rounded bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300"
                        title="PI"
                      >
                        PI
                      </span>
                    )}
                    {row.archived ? (
                      <span
                        className="px-1.5 py-0.5 text-meta font-semibold rounded bg-surface-sunken text-foreground-muted"
                        title={
                          row.archived_by
                            ? `Archived by ${row.archived_by}`
                            : "Archived"
                        }
                      >
                        Archived
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 text-meta font-semibold rounded bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300">
                        Active
                      </span>
                    )}
                    {isSelf && (
                      <span className="px-1.5 py-0.5 text-meta font-semibold rounded bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300">
                        You
                      </span>
                    )}
                    {/* D5/D6: read-only "has sharing identity" badge. No
                        click, no action. A lab head may see who has a
                        global identity but has no power over it. Muted on
                        archived rows so it reads as inactive (the sidecar
                        survives archiving, so the badge can still show). Do
                        NOT grow this into a "reset/manage/view shares"
                        affordance — the global identity is the member's
                        alone (D5/D6). */}
                    {row.hasSharingIdentity && (
                      <Tooltip
                        label="Sharing identity"
                        body="This member has set up a sharing identity. Only they control it, you cannot manage, reset, or open it."
                      >
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-meta font-semibold rounded ${
                            row.archived
                              ? "bg-surface-sunken text-foreground-muted"
                              : "bg-sky-100 dark:bg-sky-500/15 text-sky-800 dark:text-sky-300"
                          }`}
                          data-testid={`lab-roster-sharing-${row.username}`}
                        >
                          <SharingIdentityIcon className="w-3 h-3" />
                          Sharing
                        </span>
                      </Tooltip>
                    )}
                  </div>
                  <div className="text-meta text-foreground-muted truncate">
                    @{row.username}
                    {row.archived && row.archived_at && (
                      <>
                        {" "}
                        (archived{" "}
                        {new Date(row.archived_at).toLocaleDateString()})
                      </>
                    )}
                  </div>
                  {/* Check-ins Phase 4: contents-free IDP compliance status.
                      The PI sees only that a plan exists and when it was last
                      updated, never the plan itself (NSF expects an IDP to
                      exist). Do NOT grow this into a "view IDP" affordance, the
                      contents belong to the trainee. */}
                  <div
                    className="text-meta text-foreground-muted truncate"
                    data-testid={`lab-roster-idp-${row.username}`}
                  >
                    {row.idpExists ? (
                      <span className="inline-flex items-center gap-1">
                        <Icon
                          name="check"
                          className="h-3 w-3 text-emerald-600 dark:text-emerald-400"
                        />
                        IDP on file
                        {row.idpUpdatedAt && (
                          <>
                            , updated{" "}
                            {new Date(row.idpUpdatedAt).toLocaleDateString()}
                          </>
                        )}
                      </span>
                    ) : (
                      <span>No IDP on file</span>
                    )}
                  </div>
                </div>
                {canArchive && (
                  <button
                    type="button"
                    onClick={() =>
                      setPendingAction({ kind: "archive", row })
                    }
                    className="flex-shrink-0 px-2.5 py-1 rounded-md text-meta font-medium border border-border text-foreground hover:bg-surface-sunken"
                    data-testid={`lab-roster-archive-${row.username}`}
                  >
                    Archive
                  </button>
                )}
                {canRestore && (
                  <button
                    type="button"
                    onClick={() =>
                      setPendingAction({ kind: "restore", row })
                    }
                    className="flex-shrink-0 px-2.5 py-1 rounded-md text-meta font-medium border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
                    data-testid={`lab-roster-restore-${row.username}`}
                  >
                    Restore
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pendingAction && (
        <ConfirmDialog
          action={pendingAction}
          busy={busy}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void handleConfirm()}
        />
      )}
    </div>
  );
}

function ConfirmDialog({
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  action:
    | { kind: "archive"; row: RosterRow }
    | { kind: "restore"; row: RosterRow };
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const label = action.row.displayName?.trim() || action.row.username;

  // Escape / scrim close route through LivingPopup, suspended while the
  // archive/restore write is in flight (busy).
  const closeIfIdle = () => {
    if (!busy) onCancel();
  };

  return (
    <LivingPopup
      open
      onClose={closeIfIdle}
      label={action.kind === "archive" ? "Archive member" : "Restore member"}
      card={false}
      widthClassName="max-w-md"
      closeOnScrimClick={!busy}
    >
      <div
        className="pointer-events-auto bg-surface-raised rounded-xl shadow-xl w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-title font-semibold text-foreground">
          {action.kind === "archive"
            ? `Archive ${label}?`
            : `Restore ${label}?`}
        </h2>
        {action.kind === "archive" ? (
          <>
            <p className="text-body text-foreground-muted">
              Their data stays searchable; they&apos;re just hidden from the
              login picker, the @mention picker, the share dialog, and the
              assignee dropdown. You can restore them any time.
            </p>
            {/* D5/D6: archiving is local-only. It never touches the
                member's global sharing identity or anything sent to them. */}
            {action.row.hasSharingIdentity && (
              <p className="text-meta text-foreground-muted">
                Archiving hides them locally. It does not affect their
                sharing identity or anything sent to them.
              </p>
            )}
          </>
        ) : (
          <p className="text-body text-foreground-muted">
            They&apos;ll reappear in the login picker and all member
            pickers immediately.
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded-md text-meta text-foreground-muted hover:bg-surface-sunken disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`px-3 py-1.5 rounded-md text-meta font-medium text-white ${
              action.kind === "archive"
                ? "bg-gray-700 hover:bg-gray-800"
                : "bg-emerald-600 hover:bg-emerald-700"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            data-testid={`lab-roster-confirm-${action.kind}`}
          >
            {busy
              ? "Working…"
              : action.kind === "archive"
                ? "Archive"
                : "Restore"}
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}
