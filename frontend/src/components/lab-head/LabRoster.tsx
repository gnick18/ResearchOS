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
import { MULTI_FOLDER_ENABLED } from "@/lib/file-system/multi-folder-config";
import { useLabSession } from "@/hooks/useLabSession";
import {
  getLabRemote,
  readmitMemberRemote,
} from "@/lib/lab/lab-do-client";
import {
  verifyMembershipLog,
  type LabRecord,
} from "@/lib/lab/lab-membership";
import { fingerprint } from "@/lib/sharing/identity/keys";
import { hexToBytes } from "@noble/hashes/utils.js";
import {
  searchResearchers,
  type ProfileSearchResult,
} from "@/lib/sharing/profile";

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

  // Phase C2 (PI re-admit after a member's identity reset). DARK behind
  // MULTI_FOLDER_ENABLED. Holds the username being re-admitted; the modal owns
  // the rest of the multi-step flow (load record, resolve new identity, confirm).
  const [readmitUsername, setReadmitUsername] = useState<string | null>(null);

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
            // Phase C2: re-admit a member who reset their identity key. Same
            // gate as Archive plus the multi-folder flag, so flag-OFF is
            // byte-identical (the button never renders).
            const canReadmit =
              MULTI_FOLDER_ENABLED && isLabHead && !isSelf && !row.archived;
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
                {canReadmit && (
                  <button
                    type="button"
                    onClick={() => setReadmitUsername(row.username)}
                    className="flex-shrink-0 px-2.5 py-1 rounded-md text-meta font-medium border border-border text-foreground hover:bg-surface-sunken"
                    data-testid={`lab-roster-readmit-${row.username}`}
                  >
                    Re-admit (reset key)
                  </button>
                )}
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

      {readmitUsername && (
        <ReadmitDialog
          username={readmitUsername}
          displayName={
            rows.find((r) => r.username === readmitUsername)?.displayName?.trim() ||
            readmitUsername
          }
          onClose={() => setReadmitUsername(null)}
          onDone={() =>
            void queryClient.invalidateQueries({ queryKey: LAB_ROSTER_QUERY_KEY })
          }
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

// ---------------------------------------------------------------------------
// Phase C2: PI re-admit after a member's identity reset. DARK behind
// MULTI_FOLDER_ENABLED (the caller only renders this when the flag is on).
//
// A member who reset their identity key (Phase C1) now holds a brand-new
// keypair under the SAME username; their roster entry's keys are stale, so the
// lab key sealed to the old key can no longer be opened by them. The PI re-admits
// them with the new keys via readmitMemberRemote (a rotate-then-add against the
// relay). All state is local to this modal. The flow is staged:
//
//   - "loading"  : reading + verifying the current lab record off the relay.
//   - "session"  : the head is not signed in to the lab (no live keys to sign).
//   - "error"    : record load or verify failed; only Close.
//   - "select"   : resolve the member's NEW identity from the directory.
//   - "confirm"  : old fingerprint vs the selected new fingerprint + warning.
//   - "working"  : the two-append re-admit is in flight.
//   - "done"     : success.
//
// No emojis, no em-dashes, no mid-sentence colons.
type ReadmitPhase =
  | { kind: "loading" }
  | { kind: "session" }
  | { kind: "error"; message: string }
  | {
      kind: "select";
      labId: string;
      // The verified current record + the member row's current key facts.
      record: LabRecord;
      oldFingerprint: string;
    }
  | {
      kind: "confirm";
      labId: string;
      record: LabRecord;
      oldFingerprint: string;
      selected: ProfileSearchResult;
    }
  | { kind: "working" }
  | { kind: "done" };

function ReadmitDialog({
  username,
  displayName,
  onClose,
  onDone,
}: {
  username: string;
  displayName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const session = useLabSession();
  const [phase, setPhase] = useState<ReadmitPhase>({ kind: "loading" });
  // Directory search state for the "select" phase.
  const [query, setQuery] = useState(displayName);
  const [results, setResults] = useState<ProfileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  // Resolve the live lab session up front. The head's signing key + current lab
  // key live in the controller's "live" state.
  const sessionLoading = session !== null && session.loading === true;
  const live =
    session !== null && session.loading === false
      ? (() => {
          const s = session.controller.getState();
          return s.kind === "live" ? s : null;
        })()
      : null;

  // One-shot record load on open. We avoid useEffect ceremony by loading lazily
  // from the loading render, gated by phase so it runs exactly once.
  if (phase.kind === "loading") {
    if (sessionLoading) {
      // Session hook still resolving; keep showing the loader.
    } else if (!live) {
      // Not signed in to the lab, no keys to sign with. Show the session notice.
      // Defer the state change out of render.
      queueMicrotask(() => setPhase({ kind: "session" }));
    } else {
      const labId = live.labId;
      queueMicrotask(async () => {
        try {
          const got = await getLabRemote(labId);
          if (!got) {
            setPhase({ kind: "error", message: "This lab could not be found on the relay." });
            return;
          }
          if (!verifyMembershipLog(got.record).ok) {
            setPhase({
              kind: "error",
              message: "The lab membership log failed verification. Re-admit is blocked.",
            });
            return;
          }
          const member = got.record.members.find((m) => m.username === username);
          if (!member) {
            setPhase({
              kind: "error",
              message: `${displayName} is no longer a member of this lab.`,
            });
            return;
          }
          const oldFingerprint = fingerprint(hexToBytes(member.ed25519PublicKey));
          setPhase({ kind: "select", labId, record: got.record, oldFingerprint });
        } catch {
          setPhase({
            kind: "error",
            message: "Could not read the lab record from the relay. Try again.",
          });
        }
      });
    }
  }

  const runSearch = async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    setSearched(false);
    try {
      const found = await searchResearchers(q);
      setResults(found);
    } finally {
      setSearching(false);
      setSearched(true);
    }
  };

  const doReadmit = async () => {
    if (phase.kind !== "confirm" || !live) return;
    const { labId, record, selected } = phase;
    setPhase({ kind: "working" });
    try {
      const out = await readmitMemberRemote({
        labId,
        record,
        currentLabKey: live.labKey,
        username,
        newKeys: {
          x25519PublicKey: selected.x25519PublicKey,
          ed25519PublicKey: selected.ed25519PublicKey,
        },
        headEd25519PrivateKey: live.signingKeyPair.ed25519Priv,
      });
      if (out.ok) {
        onDone();
        setPhase({ kind: "done" });
        return;
      }
      if (out.stage === "rotate") {
        setPhase({
          kind: "error",
          message: `Could not start the re-admit (relay ${out.status}). Nothing changed; try again.`,
        });
      } else {
        // The member was removed but the re-add failed. Refresh the roster so it
        // reflects the removal, then point the PI at the normal invite flow.
        onDone();
        setPhase({
          kind: "error",
          message: `The member was removed but re-adding their new key failed (relay ${out.status}). Re-invite them through the normal invite flow to finish.`,
        });
      }
    } catch {
      setPhase({
        kind: "error",
        message: "The re-admit failed unexpectedly. Nothing was changed; try again.",
      });
    }
  };

  return (
    <LivingPopup
      open
      onClose={phase.kind === "working" ? () => {} : onClose}
      label="Re-admit member"
      card={false}
      widthClassName="max-w-lg"
      closeOnScrimClick={phase.kind !== "working"}
    >
      <div
        className="pointer-events-auto bg-surface-raised rounded-xl shadow-xl w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
        data-testid="lab-roster-readmit-dialog"
      >
        <h2 className="text-title font-semibold text-foreground">
          Re-admit {displayName}
        </h2>

        {phase.kind === "loading" && (
          <p className="text-body text-foreground-muted">Loading the lab record…</p>
        )}

        {phase.kind === "session" && (
          <p className="text-body text-foreground-muted">
            Sign in to your lab to re-admit a member.
          </p>
        )}

        {phase.kind === "error" && (
          <p className="text-body text-rose-700 dark:text-rose-300">{phase.message}</p>
        )}

        {phase.kind === "select" && (
          <div className="space-y-3">
            <p className="text-body text-foreground-muted">
              Find {displayName}&apos;s new identity. After a key reset they
              re-publish a fresh fingerprint; pick the result that matches the
              fingerprint they sent you.
            </p>
            <div className="text-meta text-foreground-muted">
              Current key:{" "}
              <span className="font-mono text-foreground">{phase.oldFingerprint}</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runSearch();
                }}
                placeholder="Search by name or institution"
                className="flex-1 px-3 py-1.5 rounded-md border border-border bg-surface text-body text-foreground"
                data-testid="lab-roster-readmit-search-input"
              />
              <button
                type="button"
                onClick={() => void runSearch()}
                disabled={searching || query.trim().length < 2}
                className="px-3 py-1.5 rounded-md text-meta font-medium border border-border text-foreground hover:bg-surface-sunken disabled:opacity-50"
              >
                {searching ? "Searching…" : "Search"}
              </button>
            </div>
            {searched && results.length === 0 && !searching && (
              <p className="text-meta text-foreground-muted">No researchers found.</p>
            )}
            {results.length > 0 && (
              <ul className="divide-y divide-border border border-border rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                {results.map((r) => {
                  // Grey out the OLD identity (its fingerprint equals the current
                  // roster fingerprint): that is not a reset, so it is not a valid
                  // re-admit target.
                  const isOld = r.fingerprint === phase.oldFingerprint;
                  return (
                    <li key={r.fingerprint}>
                      <button
                        type="button"
                        disabled={isOld}
                        onClick={() =>
                          setPhase({
                            kind: "confirm",
                            labId: phase.labId,
                            record: phase.record,
                            oldFingerprint: phase.oldFingerprint,
                            selected: r,
                          })
                        }
                        className={`w-full text-left px-3 py-2.5 ${
                          isOld
                            ? "opacity-50 cursor-not-allowed bg-surface-sunken"
                            : "bg-surface-raised hover:bg-surface-sunken"
                        }`}
                        data-testid={`lab-roster-readmit-result-${r.fingerprint.replace(/\s/g, "")}`}
                      >
                        <div className="text-body font-medium text-foreground">
                          {r.displayName}
                          {isOld && (
                            <span className="ml-2 text-meta font-normal text-foreground-muted">
                              (current key, not a reset)
                            </span>
                          )}
                        </div>
                        {r.affiliation && (
                          <div className="text-meta text-foreground-muted">
                            {r.affiliation}
                          </div>
                        )}
                        <div className="text-meta font-mono text-foreground-muted">
                          {r.fingerprint}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {phase.kind === "confirm" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border p-3">
                <div className="text-meta font-semibold text-foreground-muted">
                  Old key
                </div>
                <div className="text-meta font-mono text-foreground break-all">
                  {phase.oldFingerprint}
                </div>
              </div>
              <div className="rounded-lg border border-emerald-300 dark:border-emerald-500/30 p-3">
                <div className="text-meta font-semibold text-emerald-700 dark:text-emerald-300">
                  New key
                </div>
                <div className="text-meta font-mono text-foreground break-all">
                  {phase.selected.fingerprint}
                </div>
              </div>
            </div>
            <p className="text-body text-foreground-muted">
              This re-admits {displayName} with their new identity. Their old key
              loses access to lab data shared under it; they regain current and
              historical lab data with the new key. This rotates the lab key for
              everyone.
            </p>
          </div>
        )}

        {phase.kind === "working" && (
          <p className="text-body text-foreground-muted">Re-admitting {displayName}…</p>
        )}

        {phase.kind === "done" && (
          <p className="text-body text-foreground">
            {displayName} re-admitted. They can now reach lab data again with their
            new identity.
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          {phase.kind === "confirm" && (
            <button
              type="button"
              onClick={() =>
                setPhase({
                  kind: "select",
                  labId: phase.labId,
                  record: phase.record,
                  oldFingerprint: phase.oldFingerprint,
                })
              }
              className="px-3 py-1.5 rounded-md text-meta text-foreground-muted hover:bg-surface-sunken"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={phase.kind === "working"}
            className="px-3 py-1.5 rounded-md text-meta text-foreground-muted hover:bg-surface-sunken disabled:opacity-50"
          >
            {phase.kind === "done" ? "Close" : "Cancel"}
          </button>
          {phase.kind === "confirm" && (
            <button
              type="button"
              onClick={() => void doReadmit()}
              className="px-3 py-1.5 rounded-md text-meta font-medium text-white bg-emerald-600 hover:bg-emerald-700"
              data-testid="lab-roster-readmit-confirm"
            >
              Re-admit
            </button>
          )}
        </div>
      </div>
    </LivingPopup>
  );
}
