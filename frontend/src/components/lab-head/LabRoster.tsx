"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { discoverUsers } from "@/lib/file-system/user-discovery";
import { readUserSettings, type AccountType } from "@/lib/settings/user-settings";
import { readOnboarding } from "@/lib/onboarding/sidecar";
import { archiveUser, restoreUser } from "@/lib/lab/user-archive";
import { useFileSystem } from "@/lib/file-system/file-system-context";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { useEditSession } from "@/hooks/useEditSession";
import RequestEditButton from "@/components/RequestEditButton";
import EditSessionBanner from "@/components/EditSessionBanner";
import UserAvatar from "@/components/UserAvatar";
import { ARCHIVED_USERS_QUERY_KEY } from "@/hooks/useArchivedUsers";
import { LAB_USER_PROFILES_QUERY_KEY } from "@/hooks/useLabUserProfiles";

/**
 * Lab Head Phase 6 (lab head Phase 6 manager, 2026-05-23): Lab Roster
 * surface.
 *
 * Mounted under Settings → Lab Head section (visible only when
 * `account_type === "lab_head"`; the parent component already gates
 * on that). Lists every user in the lab with:
 *   - display name + @username + account_type pill + status (Active /
 *     Archived)
 *   - Archive / Restore button (lab_head only, gated by Phase 5
 *     session unlock — see RequestEditButton)
 *
 * Members see this surface read-only — they can view the roster but
 * no archive/restore buttons render. The component is mounted from
 * `LabHeadSection`, which already gates on lab_head; members reach
 * this code path only via direct route navigation, where the
 * `canArchive` flag below stays false.
 *
 * Decisions locked (LAB_HEAD_PROPOSAL §6, Grant 2026-05-23):
 *   1. Lab head only can archive (no self-archive, no member-on-member).
 *   2. Archive/restore goes through Phase 5's session edit mode — the
 *      lab head must be unlocked. Mirrors the popup edit pattern.
 *   3. Confirmation dialog before archiving (data is non-destructive
 *      but the user-visible consequence is significant).
 */

interface RosterRow {
  username: string;
  displayName: string | null;
  account_type: AccountType;
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
}

const LAB_ROSTER_QUERY_KEY = ["lab-roster"] as const;

export default function LabRoster() {
  const { isConnected } = useFileSystem();
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const session = useEditSession();
  const queryClient = useQueryClient();

  const isLabHead = accountType === "lab_head";
  const sessionUnlocked =
    session.state === "unlocked" && session.active?.username === currentUser;

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
          return {
            username,
            displayName,
            account_type,
            archived,
            archived_at,
            archived_by,
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
          <h3 className="text-sm font-medium text-gray-800">Lab Roster</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Manage which lab members appear in pickers and on the login
            screen. Archive a departed member to hide them from
            day-to-day surfaces while keeping all their data searchable.
          </p>
        </div>
        {isLabHead && !sessionUnlocked && (
          <RequestEditButton
            username={currentUser ?? ""}
            targetLabel="Lab Roster"
          />
        )}
      </div>

      {isLabHead && sessionUnlocked && <EditSessionBanner />}

      {isLoading ? (
        <p className="text-xs text-gray-500">Loading roster…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-500">
          No lab members found. The roster populates as users log in to
          this lab folder.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 border border-gray-200 rounded-lg overflow-hidden">
          {rows.map((row) => {
            const label = row.displayName?.trim() || row.username;
            const isSelf = row.username === currentUser;
            // Archive button: lab_head, session unlocked, NOT self, NOT
            // already archived. Self-archive is intentionally blocked
            // per the locked design — a PI who wants to leave hands off
            // to a co-PI.
            const canArchive =
              isLabHead &&
              sessionUnlocked &&
              !isSelf &&
              !row.archived;
            const canRestore =
              isLabHead && sessionUnlocked && row.archived;
            return (
              <li
                key={row.username}
                className={`flex items-center gap-3 px-3 py-2.5 ${
                  row.archived ? "bg-gray-50" : "bg-white"
                }`}
                data-testid={`lab-roster-row-${row.username}`}
              >
                <UserAvatar username={row.username} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-medium truncate ${
                        row.archived ? "text-gray-500" : "text-gray-900"
                      }`}
                    >
                      {label}
                    </span>
                    {row.account_type === "lab_head" && (
                      <span
                        className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-800"
                        title="PI"
                      >
                        PI
                      </span>
                    )}
                    {row.archived ? (
                      <span
                        className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-slate-200 text-slate-600"
                        title={
                          row.archived_by
                            ? `Archived by ${row.archived_by}`
                            : "Archived"
                        }
                      >
                        Archived
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-emerald-100 text-emerald-800">
                        Active
                      </span>
                    )}
                    {isSelf && (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-blue-100 text-blue-800">
                        You
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    @{row.username}
                    {row.archived && row.archived_at && (
                      <>
                        {" "}
                        — archived{" "}
                        {new Date(row.archived_at).toLocaleDateString()}
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
                    className="flex-shrink-0 px-2.5 py-1 rounded-md text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-50"
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
                    className="flex-shrink-0 px-2.5 py-1 rounded-md text-xs font-medium border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
      // Marker for TourSpotlight (popup-occluding sweep manager,
      // 2026-05-27). Hides the v4 walkthrough ring while this popup
      // is mounted; see SnapshotTilePopup for the canonical example.
      data-tour-popup-occluding="lab-roster"
      onClick={() => !busy && onCancel()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-900">
          {action.kind === "archive"
            ? `Archive ${label}?`
            : `Restore ${label}?`}
        </h2>
        {action.kind === "archive" ? (
          <p className="text-sm text-gray-600">
            Their data stays searchable; they&apos;re just hidden from the
            login picker, the @mention picker, the share dialog, and the
            assignee dropdown. You can restore them any time.
          </p>
        ) : (
          <p className="text-sm text-gray-600">
            They&apos;ll reappear in the login picker and all member
            pickers immediately.
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded-md text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`px-3 py-1.5 rounded-md text-xs font-medium text-white ${
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
    </div>
  );
}
