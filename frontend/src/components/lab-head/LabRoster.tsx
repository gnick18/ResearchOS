"use client";

import { useState } from "react";
import LivingPopup from "@/components/ui/LivingPopup";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { discoverUsers } from "@/lib/file-system/user-discovery";
import { readUserSettings, type AccountType } from "@/lib/settings/user-settings";
import { readOnboarding } from "@/lib/onboarding/sidecar";
import { archiveUser, restoreUser } from "@/lib/lab/user-archive";
import { readSharingIdentity } from "@/lib/sharing/identity/sidecar";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import UserAvatar from "@/components/UserAvatar";
import Tooltip from "@/components/Tooltip";
import { ARCHIVED_USERS_QUERY_KEY } from "@/hooks/useArchivedUsers";
import { LAB_USER_PROFILES_QUERY_KEY } from "@/hooks/useLabUserProfiles";

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

interface RosterRow {
  username: string;
  displayName: string | null;
  account_type: AccountType;
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  // D5/D6 (cross-boundary sharing): whether this member has published a
  // global sharing identity (a `_sharing_identity.json` sidecar exists).
  // READ-ONLY signal. A lab head may SEE who has an identity but has no
  // power over it. The sidecar survives archiving, so this can be true for
  // archived members too.
  hasSharingIdentity: boolean;
}

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

const LAB_ROSTER_QUERY_KEY = ["lab-roster"] as const;

export default function LabRoster() {
  const { isConnected } = useFileSystem();
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const queryClient = useQueryClient();

  const isLabHead = accountType === "lab_head";

  // The Lab Roster is the only surface that needs per-user archive
  // state alongside display name + account_type. `useLabUserProfileMap`
  // pulls displayName + account_type but not archive state; we re-fan
  // here so the roster has a single coherent read. The cost is small
  // (N user dirs, N sidecar reads); the simplicity wins.
  const { data: rows = [], isLoading } = useQuery({
    queryKey: LAB_ROSTER_QUERY_KEY,
    queryFn: async (): Promise<RosterRow[]> => {
      // Use `discoverUsers()` (rather than `Object.keys(readAllUserMetadata())`)
      // so the roster auto-inherits tombstone filtering, sentinel filtering
      // (`lab`, `public`, `_no_user_`, etc.), and any future filters added
      // to that helper. The previous direct-read path leaked every historical
      // username (including soft-deleted users whose `users/<u>/` directory
      // had been hard-deleted years ago and a literal `"undefined"` key
      // polluted by an upstream bad caller). See lab-roster ghost cleanup
      // 2026-05-26.
      const usernames = await discoverUsers();
      const out = await Promise.all(
        usernames.map(async (username): Promise<RosterRow> => {
          let displayName: string | null = null;
          let account_type: AccountType = "member";
          try {
            const settings = await readUserSettings(username);
            displayName = settings.displayName;
            account_type = settings.account_type;
          } catch {
            // Stay on safe defaults.
          }
          let archived = false;
          let archived_at: string | null = null;
          let archived_by: string | null = null;
          try {
            const sidecar = await readOnboarding(username);
            archived = sidecar.archived === true;
            archived_at = sidecar.archived_at ?? null;
            archived_by = sidecar.archived_by ?? null;
          } catch {
            // Stay on non-archived default.
          }
          // D5/D6: best-effort read of the member's published sharing
          // identity sidecar. Wrapped in try/catch like the reads above, so
          // a missing or unreadable sidecar simply yields `false` (no
          // badge). This is read-only and informational; the lab head never
          // gains any control over the member's global identity.
          let hasSharingIdentity = false;
          try {
            const side = await readSharingIdentity(username);
            hasSharingIdentity = side !== null;
          } catch {
            // Stay on "no identity" default.
          }
          return {
            username,
            displayName,
            account_type,
            archived,
            archived_at,
            archived_by,
            hasSharingIdentity,
          };
        }),
      );
      // Sort: active first, then archived; within each, lab_head first,
      // then alphabetical. Mirrors the login-screen sort so the visual
      // ordering carries across surfaces.
      return out.sort((a, b) => {
        if (a.archived !== b.archived) return a.archived ? 1 : -1;
        if (a.account_type !== b.account_type) {
          return a.account_type === "lab_head" ? -1 : 1;
        }
        return a.username.localeCompare(b.username);
      });
    },
    enabled: isConnected,
    staleTime: 30_000,
  });

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
