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

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsLabHead } from "@/hooks/useIsLabHead";
import { useLabSession } from "@/hooks/useLabSession";
import { useLabData } from "@/hooks/useLabData";
import { useLabRosterRows, type RosterRow } from "@/hooks/useLabRoster";
import { getLabRemote } from "@/lib/lab/lab-do-client";
import {
  fetchLabRoster,
  type LabBillingStatus,
} from "@/lib/billing/client";
import UserAvatar from "@/components/UserAvatar";
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

export default function PeoplePage() {
  const { currentUser } = useCurrentUser();
  const isLabHead = useIsLabHead(currentUser);
  const session = useLabSession();
  const labId = (session && !session.loading ? session.labId : null) ?? null;

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

  if (isLabHead === false) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-meta text-foreground-muted">
          The People page is the lab head&apos;s view of the lab. Sign in as the
          PI to manage your roster.
        </p>
      </div>
    );
  }

  const activeCount = rows.filter((r) => !r.archived).length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="space-y-1">
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
            {isLabHead && (
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

      {isLoading ? (
        <p className="text-meta text-foreground-muted">Loading your lab…</p>
      ) : rows.length === 0 ? (
        <p className="text-meta text-foreground-muted">
          No lab members yet. They appear here as they join your lab folder.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {rows.map((row) => {
            const label = row.displayName?.trim() || row.username;
            const isSelf = row.username === currentUser;
            const w = workloadByUser.get(row.username);
            const billing = billingByUser.get(row.username);
            const chip = billing ? BILLING_CHIP[billing] : null;
            return (
              <li key={row.username}>
                <button
                  type="button"
                  onClick={() => setSelected(row)}
                  data-testid={`people-row-${row.username}`}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-hover ${
                    row.archived ? "bg-surface-sunken" : "bg-surface"
                  }`}
                >
                  <UserAvatar username={row.username} size="sm" />
                  <div className="min-w-0 flex-1">
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
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta text-foreground-muted">
                      <span className="truncate">@{row.username}</span>
                      {/* Workload (PE-2). */}
                      {w && (w.open > 0 || w.overdue > 0) ? (
                        <span>
                          {w.open} open
                          {w.overdue > 0 ? (
                            <span className="text-rose-600 dark:text-rose-400">
                              {" "}
                              · {w.overdue} overdue
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span>No open tasks</span>
                      )}
                      {/* IDP on file (PE-3), contents-free. */}
                      <span className="inline-flex items-center gap-1">
                        {row.idpExists ? (
                          <>
                            <Icon
                              name="check"
                              className="h-3 w-3 text-emerald-600 dark:text-emerald-400"
                            />
                            IDP on file
                          </>
                        ) : (
                          "No IDP on file"
                        )}
                      </span>
                    </div>
                  </div>
                  {chip ? (
                    <Tooltip
                      label="Cloud seat"
                      body="Whether this member's cloud storage sits on a paid seat in your lab's pool."
                    >
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-meta font-medium ${chip.tone}`}
                      >
                        {chip.label}
                      </span>
                    </Tooltip>
                  ) : null}
                  <Icon
                    name="chevronRight"
                    className="h-4 w-4 shrink-0 text-foreground-muted"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <MemberPanel
          row={selected}
          workload={workloadByUser.get(selected.username)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// --- member detail panel (PE-4) ---------------------------------------------

function MemberPanel({
  row,
  workload,
  onClose,
}: {
  row: RosterRow;
  workload: Workload | undefined;
  onClose: () => void;
}) {
  const label = row.displayName?.trim() || row.username;
  const actionBtn =
    "flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-body text-foreground hover:bg-surface-hover";
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
            <p className="text-meta text-foreground-muted">@{row.username}</p>
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
          <Link href="/lab-experiments" className={actionBtn} onClick={onClose}>
            <span className="flex items-center gap-2">
              <Icon name="vial" className="h-4 w-4 text-foreground-muted" />
              Browse lab experiments
            </span>
            <Icon name="chevronRight" className="h-4 w-4 text-foreground-muted" />
          </Link>
          <Link href="/lab-notes" className={actionBtn} onClick={onClose}>
            <span className="flex items-center gap-2">
              <Icon name="book" className="h-4 w-4 text-foreground-muted" />
              Browse lab notes
            </span>
            <Icon name="chevronRight" className="h-4 w-4 text-foreground-muted" />
          </Link>
        </div>

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
