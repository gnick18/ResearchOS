"use client";

// PI-Mode People page (PE-1..PE-4, Grant approved 2026-06-13).
//
// People is a first-class PI surface: one roster of every lab member showing
// per-member workload, a contents-free IDP-on-file badge, and (when billing is
// on) a billing chip from the unified roster. Clicking a member opens a panel
// that jumps to their Check-ins and their work (experiments / notes).
//
// Reuses the existing capability layer: the shared roster loader
// (useLabRosterRows), useLabData for workload counts, getLabRemote + fetchLabRoster
// for the billing chip, and the existing /workbench (Check-ins), /lab-experiments,
// /lab-notes surfaces for member work.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatUsernameHandle } from "@/lib/account/workspace-username";
import { useIsLabHead } from "@/hooks/useIsLabHead";
import { useHasPiPowers } from "@/hooks/useIsLabManager";
import { useLabSession } from "@/hooks/useLabSession";
import { useActiveLabName } from "@/hooks/useActiveLabName";
import { useQueryClient } from "@tanstack/react-query";
import { useLabData } from "@/hooks/useLabData";
import {
  useLabRosterRows,
  type RosterRow,
  LAB_ROSTER_QUERY_KEY,
} from "@/hooks/useLabRoster";
import { getLabRemote } from "@/lib/lab/lab-do-client";
import {
  setLabManagerForHead,
  submitMemberProposal,
  loadMemberProposals,
  resolveMemberProposal,
  type LabMemberProposal,
} from "@/lib/lab/lab-head-membership";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import {
  fetchLabRoster,
  type LabBillingStatus,
} from "@/lib/billing/client";
import UserAvatar from "@/components/UserAvatar";
import { PageContainer } from "@/components/layout/PageContainer";
import LivingPopup from "@/components/ui/LivingPopup";
import Tooltip from "@/components/Tooltip";
import { Icon } from "@/components/icons";

/** The billing chip copy + tone for each status. */
const BILLING_CHIP: Record<LabBillingStatus, { label: string; tone: string }> = {
  active: {
    label: "Paid seat",
    tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  pending: {
    label: "Seat pending",
    tone: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
  unbilled: {
    label: "Not billed yet",
    tone: "bg-surface-sunken text-foreground-muted",
  },
  no_identity: {
    label: "No billing identity",
    tone: "bg-surface-sunken text-foreground-muted",
  },
};

interface Workload {
  open: number;
  overdue: number;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Short "Jun 12" style date for the IDP-updated hint; null when unparseable. */
function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function PeoplePage() {
  const { currentUser } = useCurrentUser();
  // Lab Manager Phase 1: the People page opens to a Lab Manager too (in propose
  // mode), so gate access on PI POWERS but keep isHead separate so the head-only
  // controls (promote/demote, ratify) never show for a manager.
  const isHead = useIsLabHead(currentUser) === true;
  const hasPiPowers = useHasPiPowers(currentUser);
  const session = useLabSession();
  const labId = (session && !session.loading ? session.labId : null) ?? null;
  // The lab's cosmetic name, shown as a small eyebrow above the title so the PI
  // sees WHICH lab this roster belongs to. Best-effort and display-only.
  const labName = useActiveLabName();

  const { data: rows = [], isLoading } = useLabRosterRows();
  const { tasks } = useLabData();

  // Per-member workload from lab tasks (open + overdue), keyed by username. Goals
  // are already excluded upstream (getTasks({ exclude_goals: true })).
  const workloadByUser = useMemo(() => {
    const today = todayIso();
    const map = new Map<string, Workload>();
    for (const t of tasks) {
      if (!t.username) continue;
      const w = map.get(t.username) ?? { open: 0, overdue: 0 };
      if (!t.is_complete) {
        w.open += 1;
        if (t.end_date && t.end_date < today) w.overdue += 1;
      }
      map.set(t.username, w);
    }
    return map;
  }, [tasks]);

  // Busiest member's open count, so every workload bar is on a shared scale and
  // a PI can compare load down the column at a glance.
  const maxOpen = useMemo(() => {
    let m = 0;
    for (const w of workloadByUser.values()) if (w.open > m) m = w.open;
    return m;
  }, [workloadByUser]);

  // Billing chip per member (best-effort; null when billing is off). Resolve the
  // DO roster to billing statuses, then key by username so it lines up with the
  // folder roster above.
  const [billingByUser, setBillingByUser] = useState<
    Map<string, LabBillingStatus>
  >(new Map());
  useEffect(() => {
    if (!labId) return;
    let cancelled = false;
    (async () => {
      try {
        const remote = await getLabRemote(labId);
        if (cancelled || !remote) return;
        const members = (remote.record.members ?? [])
          .filter(
            (m) => m.role !== "head" && typeof m.ed25519PublicKey === "string",
          )
          .map((m) => ({ pubkey: m.ed25519PublicKey, username: m.username }));
        const billing = await fetchLabRoster(members);
        if (cancelled || !billing) return;
        const map = new Map<string, LabBillingStatus>();
        for (const m of billing.members) {
          if (m.username) map.set(m.username, m.billingStatus);
        }
        setBillingByUser(map);
      } catch {
        // Best-effort; chips simply stay hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [labId]);

  const [selected, setSelected] = useState<RosterRow | null>(null);
  const queryClient = useQueryClient();

  if (hasPiPowers === false) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-meta text-foreground-muted">
          The People page is the lab head&apos;s and lab managers&apos; view of
          the lab. Sign in as the PI or a lab manager to see your roster.
        </p>
      </div>
    );
  }

  const activeCount = rows.filter((r) => !r.archived).length;
  const hasBilling = billingByUser.size > 0;

  return (
    <PageContainer width="full" className="py-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="space-y-1">
          {labName && (
            <p className="text-meta font-semibold uppercase tracking-wide text-foreground-muted">
              {labName}
            </p>
          )}
          <h1 className="flex items-center gap-2 text-title font-semibold text-foreground">
            <Icon name="users" className="h-5 w-5" />
            People
          </h1>
          <p className="text-meta text-foreground-muted leading-relaxed">
            Your lab at a glance. Each member shows their current workload, whether
            an IDP is on file, and their cloud seat. Open a member to jump to your
            Check-ins and their work.
          </p>
        </div>
        {!isLoading && (
          <div className="flex shrink-0 items-center gap-3">
            <span className="rounded-full bg-surface-sunken px-3 py-1 text-meta font-medium text-foreground-muted">
              {activeCount} active
            </span>
            {isHead && (
              <Tooltip
                label="Invite a member"
                body="Opens Settings, where you can search the directory, invite by email, or create an invite link."
              >
                <Link
                  href="/settings?section=members"
                  className="ros-btn-raise flex items-center gap-1.5 rounded-lg bg-brand-action px-3 py-2 text-body font-medium text-white transition-colors hover:bg-brand-action/90"
                >
                  <Icon name="userPlus" className="h-4 w-4" />
                  Invite member
                </Link>
              </Tooltip>
            )}
          </div>
        )}
      </div>

      {isHead && labId && currentUser && (
        <ManagerRequestsSection labId={labId} headUsername={currentUser} />
      )}

      {isLoading ? (
        <p className="text-meta text-foreground-muted">Loading your lab…</p>
      ) : rows.length === 0 ? (
        <p className="text-meta text-foreground-muted">
          No lab members yet. They appear here as they join your lab folder.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-surface-sunken/60 text-meta uppercase tracking-wide text-foreground-muted">
                <th className="px-4 py-2.5 font-semibold">Member</th>
                <th className="w-[32%] px-4 py-2.5 font-semibold">Workload</th>
                <th className="w-[170px] px-4 py-2.5 font-semibold">IDP</th>
                {hasBilling && (
                  <th className="w-[150px] px-4 py-2.5 font-semibold">
                    Cloud seat
                  </th>
                )}
                <th className="w-[150px] px-4 py-2.5 text-right font-semibold">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const label = row.displayName?.trim() || row.username;
                const isSelf = row.username === currentUser;
                const w = workloadByUser.get(row.username);
                const open = w?.open ?? 0;
                const overdue = w?.overdue ?? 0;
                const bluePct =
                  maxOpen > 0
                    ? Math.round(((open - overdue) / maxOpen) * 100)
                    : 0;
                const redPct =
                  maxOpen > 0 ? Math.round((overdue / maxOpen) * 100) : 0;
                const billing = billingByUser.get(row.username);
                const chip = billing ? BILLING_CHIP[billing] : null;
                const idpDate = shortDate(row.idpUpdatedAt);
                return (
                  <tr
                    key={row.username}
                    onClick={() => setSelected(row)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(row);
                      }
                    }}
                    data-tutor-target="people-member-card"
                    data-testid={`people-row-${row.username}`}
                    className={`cursor-pointer align-middle transition hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action/40 ${
                      row.archived ? "bg-surface-sunken" : "bg-surface"
                    }`}
                  >
                    {/* Member */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <UserAvatar username={row.username} size="sm" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`truncate text-body font-medium ${
                                row.archived
                                  ? "text-foreground-muted"
                                  : "text-foreground"
                              }`}
                            >
                              {label}
                            </span>
                            {row.account_type === "lab_head" && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-meta font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                                PI
                              </span>
                            )}
                            {row.lab_manager && (
                              <span className="rounded bg-brand-action/10 px-1.5 py-0.5 text-meta font-semibold text-brand-action">
                                Manager
                              </span>
                            )}
                            {isSelf && (
                              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-meta font-semibold text-blue-800 dark:bg-blue-500/15 dark:text-blue-300">
                                You
                              </span>
                            )}
                            {row.archived && (
                              <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-meta font-semibold text-foreground-muted">
                                Archived
                              </span>
                            )}
                          </div>
                          <span className="truncate text-meta text-foreground-muted">
                            {formatUsernameHandle(row.username)}
                          </span>
                        </div>
                      </div>
                    </td>
                    {/* Workload (PE-2): shared-scale bar so load is comparable. */}
                    <td className="px-4 py-3">
                      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                        <div
                          className="h-full bg-brand-action"
                          style={{ width: `${bluePct}%` }}
                        />
                        <div
                          className="h-full bg-rose-500"
                          style={{ width: `${redPct}%` }}
                        />
                      </div>
                      <div className="mt-1.5 text-meta text-foreground-muted">
                        {open > 0 ? (
                          <>
                            <span className="font-medium text-foreground">
                              {open}
                            </span>{" "}
                            open
                            {overdue > 0 ? (
                              <span className="text-rose-600 dark:text-rose-400">
                                {" "}
                                · {overdue} overdue
                              </span>
                            ) : null}
                          </>
                        ) : (
                          "No open tasks"
                        )}
                      </div>
                    </td>
                    {/* IDP on file (PE-3), contents-free. */}
                    <td className="px-4 py-3">
                      {row.idpExists ? (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-meta font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                            <Icon name="check" className="h-3 w-3" />
                            On file
                          </span>
                          {idpDate && (
                            <span className="block text-meta text-foreground-muted">
                              updated {idpDate}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-surface-sunken px-2 py-0.5 text-meta font-medium text-foreground-muted">
                          Missing
                        </span>
                      )}
                    </td>
                    {/* Cloud seat (billing chip), only when billing is populated. */}
                    {hasBilling && (
                      <td className="px-4 py-3">
                        {chip ? (
                          <Tooltip
                            label="Cloud seat"
                            body="Whether this member's cloud storage sits on a paid seat in your lab's pool."
                          >
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-meta font-medium ${chip.tone}`}
                            >
                              {chip.label}
                            </span>
                          </Tooltip>
                        ) : (
                          <span className="text-meta text-foreground-muted">
                            —
                          </span>
                        )}
                      </td>
                    )}
                    {/* Actions: jump straight to Check-ins, plus the open affordance. */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href="/workbench?tab=oneonone"
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-lg bg-brand-action/10 px-2.5 py-1 text-meta font-medium text-brand-action transition hover:bg-brand-action/20"
                        >
                          Check-ins
                        </Link>
                        <Icon
                          name="chevronRight"
                          className="h-4 w-4 shrink-0 text-foreground-muted"
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <MemberPanel
          row={selected}
          workload={workloadByUser.get(selected.username)}
          labId={labId}
          isHead={isHead}
          currentUser={currentUser}
          onChanged={() =>
            queryClient.invalidateQueries({ queryKey: LAB_ROSTER_QUERY_KEY })
          }
          onClose={() => setSelected(null)}
        />
      )}
    </PageContainer>
  );
}

// --- manager requests (propose-and-ratify, Phase 1) -------------------------
// The head sees pending member-change requests their Lab Managers submitted. The
// head reviews each, completes the real add/remove through the membership
// controls (Settings), and dismisses it. A nudge queue, not a silent mutation.

function ManagerRequestsSection({
  labId,
  headUsername,
}: {
  labId: string;
  headUsername: string;
}) {
  const [proposals, setProposals] = useState<LabMemberProposal[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const identity = getSessionIdentity();
    if (!identity) return;
    try {
      const list = await loadMemberProposals({
        labId,
        username: headUsername,
        identity,
      });
      setProposals(list);
    } catch {
      setProposals([]);
    }
  }, [labId, headUsername]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function dismiss(id: string) {
    const identity = getSessionIdentity();
    if (!identity) return;
    setBusyId(id);
    try {
      await resolveMemberProposal({
        labId,
        username: headUsername,
        identity,
        proposalId: id,
      });
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  if (!proposals || proposals.length === 0) return null;

  return (
    <div className="mb-5 space-y-2 rounded-xl border border-brand-action/30 bg-brand-action/5 p-4">
      <p className="text-body font-semibold text-foreground">
        Requests from your lab managers
      </p>
      <p className="text-meta text-foreground-muted">
        Your managers cannot change the roster themselves, so they send these for
        you to act on. Complete the change in Settings, then dismiss the request.
      </p>
      <ul className="space-y-2 pt-1">
        {proposals.map((p) => (
          <li
            key={p.id}
            className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2"
          >
            <div className="min-w-0 text-meta">
              <p className="text-foreground">
                <span className="font-medium">{p.proposer}</span>
                {p.kind === "remove"
                  ? ` asks to remove ${p.subjectUsername}`
                  : ` asks to invite ${p.target || "a new member"}`}
              </p>
              {p.note && (
                <p className="text-foreground-muted">&ldquo;{p.note}&rdquo;</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href="/settings?section=members"
                className="rounded-lg bg-brand-action/10 px-2.5 py-1 text-meta font-medium text-brand-action hover:bg-brand-action/20"
              >
                Manage membership
              </Link>
              <button
                type="button"
                onClick={() => void dismiss(p.id)}
                disabled={busyId === p.id}
                className="rounded-lg px-2.5 py-1 text-meta text-foreground-muted hover:bg-surface-sunken disabled:opacity-50"
              >
                {busyId === p.id ? "..." : "Dismiss"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- member detail panel (PE-4) ---------------------------------------------

function MemberPanel({
  row,
  workload,
  labId,
  isHead,
  currentUser,
  onChanged,
  onClose,
}: {
  row: RosterRow;
  workload: Workload | undefined;
  labId: string | null;
  /** Whether the VIEWER is the lab head (vs a Lab Manager). Head-only controls
   *  (promote/demote) show only when true; a manager sees propose controls. */
  isHead: boolean;
  currentUser: string | null;
  onChanged: () => void;
  onClose: () => void;
}) {
  const label = row.displayName?.trim() || row.username;
  const actionBtn =
    "flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-body text-foreground hover:bg-surface-hover";

  // Lab Manager (Phase 1): the head can delegate operational powers to a member.
  // Never offered for the PI's own entry (the head holds every power already) and
  // only when we have a labId to act on. Optimistic close + roster refetch on success.
  const isHeadRow = row.account_type === "lab_head";
  const isSelf = !!currentUser && row.username === currentUser;
  const [managerBusy, setManagerBusy] = useState(false);
  const [managerError, setManagerError] = useState<string | null>(null);

  // Manager propose-and-ratify (Phase 1): a manager cannot sign a roster change,
  // so they REQUEST a removal and the head ratifies it through the membership
  // controls. State for the request action.
  const [proposeBusy, setProposeBusy] = useState(false);
  const [proposeMsg, setProposeMsg] = useState<string | null>(null);

  async function toggleLabManager() {
    if (!labId || managerBusy) return;
    const identity = getSessionIdentity();
    if (!identity) {
      setManagerError(
        "Your identity is locked. Reconnect your lab folder and try again.",
      );
      return;
    }
    setManagerBusy(true);
    setManagerError(null);
    try {
      await setLabManagerForHead({
        labId,
        username: row.username,
        makeAdmin: !row.lab_manager,
        identity,
      });
      onChanged();
      onClose();
    } catch (err) {
      setManagerError(
        err instanceof Error ? err.message : "Could not update the manager role.",
      );
    } finally {
      setManagerBusy(false);
    }
  }

  async function requestRemoval() {
    if (!labId || proposeBusy || !currentUser) return;
    const identity = getSessionIdentity();
    if (!identity) {
      setProposeMsg(
        "Your identity is locked. Reconnect your lab folder and try again.",
      );
      return;
    }
    setProposeBusy(true);
    setProposeMsg(null);
    try {
      await submitMemberProposal({
        labId,
        username: currentUser,
        identity,
        kind: "remove",
        subjectUsername: row.username,
      });
      setProposeMsg(
        "Request sent. The lab head will see it and decide whether to remove this member.",
      );
    } catch (err) {
      setProposeMsg(
        err instanceof Error ? err.message : "Could not send the request.",
      );
    } finally {
      setProposeBusy(false);
    }
  }

  return (
    <LivingPopup
      open
      onClose={onClose}
      label={label}
      card={false}
      widthClassName="max-w-md"
    >
      <div
        className="pointer-events-auto w-full space-y-4 rounded-xl bg-surface-raised p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <UserAvatar username={row.username} size="md" />
          <div className="min-w-0">
            <h2 className="truncate text-title font-semibold text-foreground">
              {label}
            </h2>
            <p className="text-meta text-foreground-muted">{formatUsernameHandle(row.username)}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-meta uppercase tracking-wide text-foreground-muted">
              Workload
            </p>
            <p className="text-body font-semibold text-foreground">
              {workload?.open ?? 0} open
              {workload && workload.overdue > 0 ? (
                <span className="text-rose-600 dark:text-rose-400">
                  {" "}
                  · {workload.overdue} overdue
                </span>
              ) : null}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-meta uppercase tracking-wide text-foreground-muted">
              IDP
            </p>
            <p className="text-body font-semibold text-foreground">
              {row.idpExists ? "On file" : "Not on file"}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {/* PE-4: jump to Check-ins and the member's work. Per-member deep-links
              into experiments/notes are a follow-up; these land on the lab-wide
              surface where the PI filters to the member. */}
          <Link href="/workbench?tab=oneonone" className={actionBtn} onClick={onClose}>
            <span className="flex items-center gap-2">
              <Icon name="labTree" className="h-4 w-4 text-foreground-muted" />
              Open Check-ins
            </span>
            <Icon name="chevronRight" className="h-4 w-4 text-foreground-muted" />
          </Link>
          <Link
            href="/lab-work?tab=experiments"
            className={actionBtn}
            onClick={onClose}
          >
            <span className="flex items-center gap-2">
              <Icon name="vial" className="h-4 w-4 text-foreground-muted" />
              Browse lab experiments
            </span>
            <Icon name="chevronRight" className="h-4 w-4 text-foreground-muted" />
          </Link>
          <Link
            href="/lab-work?tab=notes"
            className={actionBtn}
            onClick={onClose}
          >
            <span className="flex items-center gap-2">
              <Icon name="book" className="h-4 w-4 text-foreground-muted" />
              Browse lab notes
            </span>
            <Icon name="chevronRight" className="h-4 w-4 text-foreground-muted" />
          </Link>
        </div>

        {/* Lab Manager (Phase 1): the HEAD delegates operational powers to a
            member. Head-only and never for the PI's own row. */}
        {isHead && !isHeadRow && (
          <div className="space-y-2 rounded-lg border border-border bg-surface px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-body font-medium text-foreground">
                  Lab Manager
                </p>
                <p className="text-meta text-foreground-muted leading-relaxed">
                  {row.lab_manager
                    ? "Can approve purchases, view audit and ops, and propose member changes for you to confirm. You stay the only signer and billing owner."
                    : "Delegate day-to-day operations (approve purchases, view audit and ops, propose member changes for you to confirm). You stay the only signer and billing owner."}
                </p>
              </div>
              <button
                type="button"
                onClick={toggleLabManager}
                disabled={managerBusy || !labId}
                className={`shrink-0 rounded-lg px-3 py-2 text-meta font-medium transition disabled:opacity-50 ${
                  row.lab_manager
                    ? "border border-border bg-surface text-foreground hover:bg-surface-hover"
                    : "btn-brand text-white"
                }`}
              >
                {managerBusy
                  ? "Saving..."
                  : row.lab_manager
                    ? "Remove manager"
                    : "Make manager"}
              </button>
            </div>
            {managerError && (
              <p className="text-meta text-rose-600 dark:text-rose-400">
                {managerError}
              </p>
            )}
          </div>
        )}

        {/* Manager propose-and-ratify (Phase 1): a manager cannot sign a roster
            change, so they request a removal and the head ratifies it. Shown only
            to a manager viewing another non-head member. */}
        {!isHead && !isHeadRow && !isSelf && (
          <div className="space-y-2 rounded-lg border border-border bg-surface px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-body font-medium text-foreground">
                  Request removal
                </p>
                <p className="text-meta text-foreground-muted leading-relaxed">
                  Send the lab head a request to remove this member. Only the head
                  can remove someone, so this queues it for their decision.
                </p>
              </div>
              <button
                type="button"
                onClick={requestRemoval}
                disabled={proposeBusy || !labId}
                className="shrink-0 rounded-lg border border-border bg-surface px-3 py-2 text-meta font-medium text-foreground transition hover:bg-surface-hover disabled:opacity-50"
              >
                {proposeBusy ? "Sending..." : "Request removal"}
              </button>
            </div>
            {proposeMsg && (
              <p className="text-meta text-foreground-muted">{proposeMsg}</p>
            )}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-meta text-foreground-muted hover:bg-surface-sunken"
          >
            Close
          </button>
        </div>
      </div>
    </LivingPopup>
  );
}
