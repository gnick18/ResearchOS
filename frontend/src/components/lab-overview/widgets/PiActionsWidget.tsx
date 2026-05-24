"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import Tooltip from "@/components/Tooltip";
import { labApi } from "@/lib/local-api";
import { useLabData } from "@/hooks/useLabData";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { readAuditEntries } from "@/lib/lab/pi-audit";
import { fileService } from "@/lib/file-system/file-service";
import type { PurchaseItem } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Inline SVG icons (Phase B Batch B3 manager, 2026-05-23)
// ─────────────────────────────────────────────────────────────────────────────
// One per row in the PI actions list — same set the SnapshotTile and
// SidebarTile use, so the three surfaces stay visually coherent.
// Stroke uses `currentColor` so the parent's tint drives the look.

const SHIELD_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const FLAG_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" />
  </svg>
);

const SCROLL_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M8 21h12a2 2 0 0 0 2-2v-2H10" />
    <path d="M19 17V5a2 2 0 0 0-2-2H4" />
    <path d="M15 8h-5" />
    <path d="M15 12h-5" />
    <path d="M2 5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v14a2 2 0 0 0 2 2" />
  </svg>
);

/**
 * Lab Mode retirement R3 (R3 widget catalog manager, 2026-05-23):
 * "pending lab head actions" sidebar widget. Replaces the R2 stub.
 *
 * Three rollups, each a single count + jump link:
 *   - Pending purchase approvals: PurchaseItem.approved === false (or
 *     unset). Counted lab-wide via labApi.getAllPurchaseItems.
 *   - Records flagged for review by the active PI: tasks / purchase
 *     items / notes where `flagged?.by === currentUser`. The PI flags
 *     a record FOR an owner; "records I (the PI) flagged" is the
 *     queue the PI walks to confirm they got addressed.
 *   - Audit entries the PI authored that the owner hasn't acked yet.
 *     The on-disk audit log doesn't carry an `acknowledged_at` field
 *     today — we surface a raw "audit entries you wrote" count instead
 *     so the PI sees activity volume. A future Phase could split into
 *     "unread by owner" + "acked".
 *
 * Visibility: this widget is `memberVisible: false` in the catalog,
 * so non-PIs never see it. We add a defensive `account_type` guard
 * here too so a stale layout (member who became a PI then demoted)
 * still suppresses the body.
 */
export default function PiActionsWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const { tasks } = useLabData();

  const { data: items = [] } = useQuery<Array<PurchaseItem & { username: string }>>({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: accountType === "lab_head",
  });

  // Audit entries the active PI wrote across every lab member's file.
  // We have to scan each user's `_pi_audit.json`; this is the same
  // pattern `useLabUserProfileMap` uses (parallel per-user reads).
  // Cached for 60s so the sidebar widget doesn't refetch on every
  // re-render.
  const { data: auditCount = 0 } = useQuery<number>({
    queryKey: ["lab", "pi-audit-count", currentUser ?? ""],
    enabled: accountType === "lab_head" && !!currentUser,
    queryFn: async () => {
      if (!currentUser) return 0;
      let usernames: string[] = [];
      try {
        const skipDirs = new Set([
          "public",
          "lab",
          "_no_user_",
          "_global_counters.json",
          "_user_metadata.json",
        ]);
        const dirs = await fileService.listDirectories("users");
        usernames = dirs.filter((d) => !skipDirs.has(d));
      } catch {
        return 0;
      }
      let total = 0;
      await Promise.all(
        usernames.map(async (u) => {
          try {
            const entries = await readAuditEntries(u);
            for (const e of entries) {
              if (e.actor === currentUser) total++;
            }
          } catch {
            // best-effort
          }
        }),
      );
      return total;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const pendingApprovals = useMemo(() => {
    return items.filter((it) => !it.approved).length;
  }, [items]);

  const flagsByMe = useMemo(() => {
    if (!currentUser) return 0;
    let count = 0;
    // Tasks (flag lives on the raw `Task`; LabTask doesn't surface it,
    // so we widen the type locally to read the optional `flagged`
    // field. Same trick RecentActivityWidget uses.)
    type WithFlag = { flagged?: { by: string } | null };
    for (const t of tasks as Array<typeof tasks[number] & WithFlag>) {
      if (t.flagged?.by === currentUser) count++;
    }
    // Purchase items.
    for (const it of items) {
      if (it.flagged?.by === currentUser) count++;
    }
    // Notes: same fetch cost issue as RecentActivityWidget — we skip
    // here for the same reason. The PI can still see flagged notes
    // via the dedicated flag-queue surface (Lab Inbox).
    return count;
  }, [tasks, items, currentUser]);

  if (accountType !== "lab_head") {
    // memberVisible: false should keep this from rendering at all,
    // but render an empty body just in case a stale layout slipped
    // through.
    return null;
  }

  // Phase B Batch B3: row link behavior is now per-row.
  //
  // The earlier R3 implementation linked every row to "/lab-overview"
  // — but Lab Overview is the surface the popup OPENS FROM, so the
  // Literal persona flagged it as a dead-end (click sends you back to
  // the surface you're already on). Of the three rows:
  //
  //   - "Purchase approvals" — has a real surface at /purchases for
  //     members, and the lab-head equivalent is the in-popup
  //     `LabPurchasesWidget`. Members keep /purchases; we keep that
  //     link so PIs at least land on the legacy approvals view.
  //   - "Flagged by you" — there's NO dedicated flag-queue surface
  //     today (/lab-inbox 307-redirects to /lab-overview, and no
  //     other route exists). Per brief: non-clickable rather than
  //     dead-linking. FOLLOW-UP: build a flag-queue surface
  //     (`/lab-overview?surface=flags` or `/flags`) and re-enable
  //     the link.
  //   - "Audit entries" — no audit-log surface today; same
  //     treatment. FOLLOW-UP: an audit-log view (probably
  //     `/lab-overview?surface=audit` once a deep audit drawer
  //     lands).
  const rows: Array<{
    label: string;
    count: number;
    href: string | null;
    tone: "amber" | "red" | "gray";
    icon: React.ReactElement;
    iconClass: string;
  }> = [
    {
      label: "Pending approvals",
      count: pendingApprovals,
      href: "/purchases",
      tone: "amber",
      icon: SHIELD_ICON,
      iconClass: "text-amber-600",
    },
    {
      label: "Flagged by you",
      count: flagsByMe,
      // FOLLOW-UP (Phase B Batch B3 manager, 2026-05-23): no
      // flag-queue surface exists; row is non-clickable instead of
      // dead-linking to /lab-overview.
      href: null,
      tone: "red",
      icon: FLAG_ICON,
      iconClass: "text-red-500",
    },
    {
      label: "Audit entries",
      count: auditCount,
      // FOLLOW-UP (Phase B Batch B3 manager, 2026-05-23): no
      // audit-log surface exists; non-clickable for the same reason.
      href: null,
      tone: "gray",
      icon: SCROLL_ICON,
      iconClass: "text-gray-500",
    },
  ];

  // Time-window context — the brief asks for "Counted across <date>
  // - <date>" so the PI knows what window each count covers. We
  // surface "since you joined" (effectively all-time for the counts
  // we maintain) so the label is honest. A future refinement could
  // narrow to a rolling 30-day window if the lab grows past the
  // point where the all-time count is meaningful.
  const today = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return (
    <div className="space-y-1.5">
      <ul className="space-y-1">
        {rows.map((row) => {
          const inner = (
            <div className="flex items-center gap-2 px-1.5 py-1 min-w-0">
              <span
                aria-hidden="true"
                className={`flex-shrink-0 ${row.iconClass}`}
              >
                {row.icon}
              </span>
              <span className="text-xs text-gray-700 truncate flex-1 min-w-0">
                {row.label}
              </span>
              <span
                className={`text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded flex-shrink-0 ${
                  row.count === 0
                    ? "bg-gray-100 text-gray-400"
                    : row.tone === "amber"
                      ? "bg-amber-100 text-amber-800"
                      : row.tone === "red"
                        ? "bg-red-100 text-red-800"
                        : "bg-gray-200 text-gray-700"
                }`}
              >
                {row.count}
              </span>
            </div>
          );
          return (
            <li key={row.label}>
              {row.href ? (
                <Link
                  href={row.href}
                  className="block rounded hover:bg-gray-50"
                >
                  {inner}
                </Link>
              ) : (
                // Non-clickable row. Tooltip explains why so the
                // user isn't left wondering whether it's broken.
                <Tooltip
                  label="No dedicated queue surface yet; counted here for awareness."
                  placement="top"
                >
                  <div className="rounded cursor-default">{inner}</div>
                </Tooltip>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[10px] text-gray-400 pl-1.5">
        Counted across your lab (through {today}).
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase B Batch B3 (Phase B Batch B3 manager, 2026-05-23): unique
// per-widget tile designs.
// ─────────────────────────────────────────────────────────────────────────────
// SnapshotTile shows ALL three counts (a small stack of icon + label
// + badge rows) — the PI's at-a-glance "what needs me?" tile. The
// snapshot intentionally pays the audit-count query cost here too:
// the cache is 60s, the per-user file scan is read-only, and the
// alternative ("approvals only" headline) under-represents the
// widget's value.
//
// SidebarTile shows the SINGLE most-urgent count (pending approvals,
// amber when > 0) since the sidebar rail is narrow and the PI's
// triage cue is "is there anything blocking purchases".
import type { SnapshotTileProps, SidebarTileProps } from "./types";

/**
 * Shared count aggregator — reused by both tiles. Avoids re-querying
 * (React Query dedupes by key anyway, but pulling once also keeps
 * the three counts in lock-step within a render).
 */
function usePiActionCounts() {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const { tasks } = useLabData();
  const { data: items = [], isLoading: itemsLoading } = useQuery<
    Array<PurchaseItem & { username: string }>
  >({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: accountType === "lab_head",
  });
  const { data: auditCount = 0, isLoading: auditLoading } = useQuery<number>({
    queryKey: ["lab", "pi-audit-count", currentUser ?? ""],
    enabled: accountType === "lab_head" && !!currentUser,
    queryFn: async () => {
      if (!currentUser) return 0;
      let usernames: string[] = [];
      try {
        const skipDirs = new Set([
          "public",
          "lab",
          "_no_user_",
          "_global_counters.json",
          "_user_metadata.json",
        ]);
        const dirs = await fileService.listDirectories("users");
        usernames = dirs.filter((d) => !skipDirs.has(d));
      } catch {
        return 0;
      }
      let total = 0;
      await Promise.all(
        usernames.map(async (u) => {
          try {
            const entries = await readAuditEntries(u);
            for (const e of entries) {
              if (e.actor === currentUser) total++;
            }
          } catch {
            // best-effort
          }
        }),
      );
      return total;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const pending = useMemo(
    () => items.filter((it) => !it.approved).length,
    [items],
  );
  const flagsByMe = useMemo(() => {
    if (!currentUser) return 0;
    let count = 0;
    type WithFlag = { flagged?: { by: string } | null };
    for (const t of tasks as Array<typeof tasks[number] & WithFlag>) {
      if (t.flagged?.by === currentUser) count++;
    }
    for (const it of items) {
      if (it.flagged?.by === currentUser) count++;
    }
    return count;
  }, [tasks, items, currentUser]);
  return {
    accountType,
    pending,
    flagsByMe,
    auditCount,
    isLoading: itemsLoading || auditLoading,
  };
}

export function SnapshotTile(_props: SnapshotTileProps) {
  const { accountType, pending, flagsByMe, auditCount, isLoading } =
    usePiActionCounts();
  if (accountType !== "lab_head") return null;
  // 3-row stack: icon + label + count badge per row. The amber row
  // (pending approvals) leads visually because it's the only count
  // that actually blocks lab work.
  const rows: Array<{
    label: string;
    count: number;
    icon: React.ReactElement;
    iconClass: string;
    badgeClass: string;
  }> = [
    {
      label: "Pending approvals",
      count: pending,
      icon: SHIELD_ICON,
      iconClass: "text-amber-600",
      badgeClass:
        pending === 0
          ? "bg-gray-100 text-gray-400"
          : "bg-amber-100 text-amber-800",
    },
    {
      label: "Flagged",
      count: flagsByMe,
      icon: FLAG_ICON,
      iconClass: "text-red-500",
      badgeClass:
        flagsByMe === 0 ? "bg-gray-100 text-gray-400" : "bg-gray-200 text-gray-700",
    },
    {
      label: "Audit entries",
      count: auditCount,
      icon: SCROLL_ICON,
      iconClass: "text-gray-500",
      badgeClass:
        auditCount === 0
          ? "bg-gray-100 text-gray-400"
          : "bg-gray-100 text-gray-600",
    },
  ];
  return (
    <div className="flex flex-col h-full min-h-0 gap-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span aria-hidden="true" className="text-amber-600 flex-shrink-0">
          {SHIELD_ICON}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-gray-500 font-medium truncate">
          What needs you
        </span>
      </div>
      <ul className="flex-1 min-h-0 flex flex-col justify-center gap-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-1.5 min-w-0">
            <span
              aria-hidden="true"
              className={`flex-shrink-0 ${row.iconClass}`}
            >
              {row.icon}
            </span>
            <span className="text-[11px] text-gray-700 truncate flex-1 min-w-0">
              {row.label}
            </span>
            <span
              className={`text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded flex-shrink-0 ${row.badgeClass}`}
            >
              {isLoading ? "—" : row.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const ExpandedView = PiActionsWidget;

// ─────────────────────────────────────────────────────────────────────────────
// SidebarTile — slim horizontal row showing the single most-urgent
// count (pending purchase approvals). Amber-tinted when > 0 so the
// row reads as "needs your attention" at a glance.
// ─────────────────────────────────────────────────────────────────────────────

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { accountType, pending, isLoading } = usePiActionCounts();
  if (accountType !== "lab_head") return null;
  const urgent = pending > 0;
  const interactive = !!onClick;
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md transition-colors ${
        interactive
          ? "cursor-pointer hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
          : ""
      } ${urgent ? "bg-amber-50" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`flex items-center justify-center flex-shrink-0 ${
          urgent ? "text-amber-600" : "text-gray-400"
        }`}
      >
        {SHIELD_ICON}
      </span>
      <span
        className={`text-xs font-medium truncate flex-1 min-w-0 ${
          urgent ? "text-amber-900" : "text-gray-700"
        }`}
      >
        {isLoading
          ? "Pending…"
          : urgent
            ? `${pending} pending`
            : "Nothing pending"}
      </span>
      {urgent && (
        <span className="text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 flex-shrink-0">
          {pending}
        </span>
      )}
    </div>
  );
}
