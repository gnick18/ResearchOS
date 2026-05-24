"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { labApi } from "@/lib/local-api";
import { useLabData } from "@/hooks/useLabData";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { readAuditEntries } from "@/lib/lab/pi-audit";
import { fileService } from "@/lib/file-system/file-service";
import type { PurchaseItem } from "@/lib/types";

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

  const rows: Array<{
    label: string;
    count: number;
    href: string;
    tone: "amber" | "red" | "gray";
  }> = [
    {
      label: "Purchase approvals",
      count: pendingApprovals,
      href: "/purchases",
      tone: "amber",
    },
    {
      label: "Flagged by you",
      count: flagsByMe,
      href: "/lab-overview",
      tone: "red",
    },
    {
      label: "Audit entries",
      count: auditCount,
      href: "/lab-overview",
      tone: "gray",
    },
  ];

  return (
    <ul className="space-y-1">
      {rows.map((row) => (
        <li key={row.label}>
          <Link
            href={row.href}
            className="flex items-center justify-between gap-2 px-1.5 py-1 rounded hover:bg-gray-50 group"
          >
            <span className="text-xs text-gray-700 truncate">{row.label}</span>
            <span
              className={`text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded ${
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
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase A snapshot + expanded contract (Phase A redispatch manager, 2026-05-23)
// ─────────────────────────────────────────────────────────────────────────────
// The widget body above is unchanged from R3 + Mira polish
// (notificationWriteQueue, tombstoned-user filtering, pre-Phase-3
// handling). Snapshot tile reads the same purchase-items cache; the
// `auditCount` query the body uses is heavier (per-user file scan)
// and we skip it on the snapshot for the same "is there activity"
// glanceability reason as RecentActivityWidget.
import StatTile from "./snapshot/StatTile";
import type { SnapshotTileProps } from "./types";

export function SnapshotTile(_props: SnapshotTileProps) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const { data: items = [], isLoading } = useQuery<Array<PurchaseItem & { username: string }>>({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: accountType === "lab_head",
  });
  if (accountType !== "lab_head") return null;
  const pending = items.filter((it) => !it.approved).length;
  return (
    <StatTile
      icon={
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      }
      iconClassName="text-amber-600"
      label="Pending PI actions"
      stat={isLoading ? "—" : pending}
      sub={
        pending === 0
          ? "All caught up"
          : `purchase approval${pending === 1 ? "" : "s"}`
      }
    />
  );
}

export const ExpandedView = PiActionsWidget;

// ─────────────────────────────────────────────────────────────────────────────
// SidebarTile (customizable PI sidebar manager #146, 2026-05-23)
// ─────────────────────────────────────────────────────────────────────────────
import SidebarStatTile from "./snapshot/SidebarStatTile";
import type { SidebarTileProps } from "./types";

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const { data: items = [], isLoading } = useQuery<Array<PurchaseItem & { username: string }>>({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: accountType === "lab_head",
  });
  if (accountType !== "lab_head") return null;
  const pending = items.filter((it) => !it.approved).length;
  return (
    <SidebarStatTile
      icon={
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
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      }
      iconClassName="text-amber-600"
      label="PI actions"
      stat={isLoading ? "—" : pending}
      sub={pending === 0 ? "All caught up" : `approval${pending === 1 ? "" : "s"}`}
      onClick={onClick}
    />
  );
}
