"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Tooltip from "@/components/Tooltip";
import UserAvatar from "@/components/UserAvatar";
import RequestEditButton from "@/components/RequestEditButton";
import TaskDetailPopup from "@/components/TaskDetailPopup";
import { labApi, tasksApi } from "@/lib/local-api";
import { useLabData } from "@/hooks/useLabData";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { useEditSession } from "@/hooks/useEditSession";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { readAuditEntries, type PiAuditEntry } from "@/lib/lab/pi-audit";
import {
  setPurchaseApproval,
  setFlagForReview,
  declinePurchase,
} from "@/lib/lab/pi-actions";
import { fileService } from "@/lib/file-system/file-service";
import type { PurchaseItem, Task } from "@/lib/types";
import type { LabUserProfileMap } from "@/hooks/useLabUserProfiles";
import type { LabTask } from "@/lib/local-api";

// ─────────────────────────────────────────────────────────────────────────────
// Inline SVG icons. Phase B Batch B3 manager 2026-05-23 introduced SHIELD /
// FLAG / SCROLL for the tile rows; the dashboard manager 2026-05-23 adds
// CHECK / X / OPEN_POPUP / ALL_CLEAR for per-row actions and empty states.
// Stroke uses `currentColor` so the parent's tint drives the look.
// ─────────────────────────────────────────────────────────────────────────────

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

const CHECK_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const X_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const OPEN_POPUP_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M15 3h6v6" />
    <path d="M10 14L21 3" />
    <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
  </svg>
);

const CHEVRON_RIGHT_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const ALL_CLEAR_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

// ─────────────────────────────────────────────────────────────────────────────
// Audit-entries cross-user reader. Used by the tile counts (existing usage,
// preserved) AND by the new Audit-log tab (which surfaces each entry instead
// of just counting). Pulled out so both callers go through one implementation.
// ─────────────────────────────────────────────────────────────────────────────

const AUDIT_SKIP_DIRS = new Set([
  "public",
  "lab",
  "_no_user_",
  "_global_counters.json",
  "_user_metadata.json",
]);

async function listLabUsernames(): Promise<string[]> {
  try {
    const dirs = await fileService.listDirectories("users");
    return dirs.filter((d) => !AUDIT_SKIP_DIRS.has(d));
  } catch {
    return [];
  }
}

interface DecoratedAuditEntry extends PiAuditEntry {
  /** Owner of the file the entry was read from (also === target_user). */
  targetOwner: string;
}

async function loadAuditEntriesByActor(actor: string): Promise<DecoratedAuditEntry[]> {
  const usernames = await listLabUsernames();
  const out: DecoratedAuditEntry[] = [];
  await Promise.all(
    usernames.map(async (u) => {
      try {
        const entries = await readAuditEntries(u);
        for (const e of entries) {
          if (e.actor !== actor) continue;
          out.push({ ...e, targetOwner: u });
        }
      } catch {
        // best-effort, a single broken file shouldn't poison the feed
      }
    }),
  );
  // Newest first.
  out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return out;
}

/**
 * PI Actions dashboard (PiActions dashboard manager, 2026-05-23).
 *
 * The expanded popup body. Tabbed 3-section dashboard replacing the older
 * 3-row count summary that linked dead-end to `/purchases` (and two
 * non-clickable rows for surfaces that didn't exist).
 *
 *   - Tab 1: Pending approvals — list of every PurchaseItem with
 *     `approved === false` across the whole lab. Inline Approve / Decline
 *     buttons (gated by the PI's edit session). React Query invalidate
 *     on success so the tile-count badge updates immediately.
 *   - Tab 2: Flagged by you — tasks + purchase items with
 *     `flagged.by === currentUser`. Click row -> opens the source record's
 *     popup (TaskDetailPopup for both tasks and purchases — purchase
 *     items are a tab inside the parent task popup). Clear flag button
 *     per row (gated by edit session).
 *   - Tab 3: Audit log — read-only feed of every audit entry authored by
 *     the current PI, newest first, capped at the most recent 100.
 *
 * Edit-session gate: mirrors the AnnouncementsWidget composer pattern.
 * When the session is locked, Approve / Decline / Clear-flag buttons
 * render disabled and a single `<RequestEditButton>` sits at the top of
 * the active tab so the PI can unlock in place. Members never see the
 * body at all (account_type guard).
 *
 * Visibility: lab_head only. The catalog already marks the widget
 * `memberVisible: false`, but the defensive guard inside ExpandedView
 * stays for stale layouts (member -> PI -> demote).
 */
export default function PiActionsWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const queryClient = useQueryClient();
  const session = useEditSession();
  const profileMap = useLabUserProfileMap();
  const { tasks } = useLabData();

  const { data: items = [] } = useQuery<Array<PurchaseItem & { username: string }>>({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: accountType === "lab_head",
  });

  // Audit-entries reader. PiActions follow-up Item 1 (2026-05-23):
  // consolidated to a single canonical query — the tile components now
  // derive their count via `entries.length` through the same
  // `usePiActionCounts` hook below, dropping the parallel
  // `pi-audit-count` key that previously walked every user's
  // `_pi_audit.json` independently.
  const { data: auditEntries = [] } = useQuery<DecoratedAuditEntry[]>({
    queryKey: ["lab", "pi-audit-entries", currentUser ?? ""],
    queryFn: () => loadAuditEntriesByActor(currentUser ?? ""),
    enabled: accountType === "lab_head" && !!currentUser,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // PiActions follow-up Item 3 (2026-05-23): "pending" means truly
  // waiting on the PI. Declined items now persist a `declined_at` stamp
  // and live in the separate "Recently declined" section below; they
  // disappear from the pending list and from the SnapshotTile's pending
  // count badge so the PI doesn't get nagged about items they already
  // turned down.
  const pendingItems = useMemo(
    () => items.filter((it) => !it.approved && !it.declined_at),
    [items],
  );
  const declinedItems = useMemo(
    () =>
      items
        .filter((it) => it.declined_at != null && !it.approved)
        // Newest decline first so the PI sees their most recent action.
        .sort((a, b) =>
          (b.declined_at ?? "").localeCompare(a.declined_at ?? ""),
        ),
    [items],
  );

  // flagsByMe — preserved from the original tile-count widget. The
  // type-widening trick (Task carries `flagged` but `LabTask` doesn't
  // expose it) is the same one RecentActivityWidget uses.
  type WithFlag = { flagged?: { by: string; at: string; reason?: string | null } | null };
  type FlagRow =
    | {
        kind: "task";
        record: LabTask & WithFlag;
        owner: string;
        flag: NonNullable<WithFlag["flagged"]>;
      }
    | {
        kind: "purchase_item";
        record: PurchaseItem & { username: string };
        owner: string;
        flag: NonNullable<WithFlag["flagged"]>;
      };

  const flagRows: FlagRow[] = useMemo(() => {
    if (!currentUser) return [];
    const out: FlagRow[] = [];
    for (const t of tasks as Array<LabTask & WithFlag>) {
      const f = t.flagged;
      if (f && f.by === currentUser) {
        out.push({ kind: "task", record: t, owner: t.username, flag: f });
      }
    }
    for (const it of items) {
      const f = (it as PurchaseItem & WithFlag).flagged;
      if (f && f.by === currentUser) {
        out.push({ kind: "purchase_item", record: it, owner: it.username, flag: f });
      }
    }
    // Newest flag first.
    out.sort((a, b) => b.flag.at.localeCompare(a.flag.at));
    return out;
  }, [tasks, items, currentUser]);

  // Default to whichever tab has a non-zero count; ties broken in
  // declaration order (Pending > Flagged > Audit). If all zero, land on
  // Pending — that's the section the PI most often opens this for.
  // We split user-driven state from data-derived default so the smart
  // default keeps applying as queries resolve (initial render sees
  // empty arrays; subsequent renders carry the real counts) WITHOUT
  // calling setState inside an effect. Once the user clicks a tab,
  // `userPickedTab` wins and a later invalidation (which may drop the
  // active count to zero after the PI acts) can't yank them out.
  const [userPickedTab, setUserPickedTab] = useState<TabId | null>(null);
  const derivedDefaultTab: TabId =
    pendingItems.length > 0
      ? "pending"
      : flagRows.length > 0
        ? "flagged"
        : auditEntries.length > 0
          ? "audit"
          : "pending";
  const activeTab: TabId = userPickedTab ?? derivedDefaultTab;
  const setActiveTab = (next: TabId) => setUserPickedTab(next);

  // Popup orchestration for the Flagged-tab click-to-source flow. Mirrors
  // the CommentFeedWidget Lab Inbox R1 pattern: open the source record's
  // TaskDetailPopup over the current popup so the PI never loses their
  // place. Purchase-item flags resolve to the parent task and open the
  // popup with the Items tab pre-selected.
  const [activeRecordPopup, setActiveRecordPopup] = useState<RecordPopupTarget | null>(null);

  const isLabHead = accountType === "lab_head";
  const sessionUnlocked =
    session.state === "unlocked" &&
    session.active?.username === currentUser &&
    isLabHead;
  const sessionId = sessionUnlocked ? (session.active?.id ?? null) : null;

  if (!isLabHead) {
    // memberVisible: false should keep this from rendering at all, but
    // we keep the defensive guard for stale layouts.
    return null;
  }

  const today = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const invalidatePurchases = () => {
    void queryClient.invalidateQueries({ queryKey: ["lab", "purchase-items"] });
    void queryClient.invalidateQueries({ queryKey: ["purchases"] });
    void queryClient.invalidateQueries({ queryKey: ["purchases-all"] });
  };
  const invalidateFlags = () => {
    void queryClient.invalidateQueries({ queryKey: ["lab", "purchase-items"] });
    void queryClient.invalidateQueries({ queryKey: ["lab", "tasks"] });
  };
  const invalidateAudit = () => {
    // PiActions follow-up Item 1 (2026-05-23): single canonical key.
    // The `pi-audit-count` key is gone (tiles now share this query via
    // `usePiActionCounts` and derive the count from `.length`).
    void queryClient.invalidateQueries({
      queryKey: ["lab", "pi-audit-entries", currentUser ?? ""],
    });
  };

  return (
    <div className="flex flex-col min-h-0 space-y-3">
      <TabStrip
        activeTab={activeTab}
        onChange={setActiveTab}
        counts={{
          pending: pendingItems.length,
          flagged: flagRows.length,
          audit: auditEntries.length,
        }}
      />

      <div className="flex-1 min-h-0">
        {activeTab === "pending" && (
          <PendingApprovalsTab
            items={pendingItems}
            declinedItems={declinedItems}
            profileMap={profileMap}
            sessionUnlocked={sessionUnlocked}
            sessionId={sessionId}
            actor={currentUser ?? ""}
            onAfterChange={() => {
              invalidatePurchases();
              invalidateAudit();
            }}
          />
        )}
        {activeTab === "flagged" && (
          <FlaggedByMeTab
            rows={flagRows}
            profileMap={profileMap}
            sessionUnlocked={sessionUnlocked}
            sessionId={sessionId}
            actor={currentUser ?? ""}
            onOpenRecord={(target) => setActiveRecordPopup(target)}
            onAfterChange={() => {
              invalidateFlags();
              invalidateAudit();
            }}
          />
        )}
        {activeTab === "audit" && (
          <AuditLogTab entries={auditEntries} profileMap={profileMap} />
        )}
      </div>

      <p className="text-[10px] text-gray-400 pl-0.5">
        Counted across your lab (through {today}).
      </p>

      {activeRecordPopup && (
        <RecordPopupMount
          target={activeRecordPopup}
          currentUser={currentUser}
          onClose={() => {
            setActiveRecordPopup(null);
            // The PI may have cleared the flag inside the source popup,
            // so refresh the lists we render here.
            invalidateFlags();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab strip
// ─────────────────────────────────────────────────────────────────────────────

type TabId = "pending" | "flagged" | "audit";

interface TabStripProps {
  activeTab: TabId;
  onChange: (next: TabId) => void;
  counts: { pending: number; flagged: number; audit: number };
}

function TabStrip({ activeTab, onChange, counts }: TabStripProps) {
  // Tab visual treatment mirrors the SettingsTabStrip pattern (pill
  // backgrounds for the active state) but per-tab tinted: amber for
  // pending (same hue as the existing PurchaseApprovalBadge), red for
  // flagged, neutral for audit so the eye lands on Pending first.
  const tabs: Array<{
    id: TabId;
    label: string;
    count: number;
    activeBg: string;
    badgeActive: string;
    badgeInactive: string;
    icon: React.ReactElement;
  }> = [
    {
      id: "pending",
      label: "Pending approvals",
      count: counts.pending,
      activeBg: "bg-amber-100 text-amber-800",
      badgeActive: "bg-amber-200 text-amber-900",
      badgeInactive:
        counts.pending === 0
          ? "bg-gray-100 text-gray-400"
          : "bg-amber-100 text-amber-800",
      icon: SHIELD_ICON,
    },
    {
      id: "flagged",
      label: "Flagged by you",
      count: counts.flagged,
      activeBg: "bg-red-100 text-red-800",
      badgeActive: "bg-red-200 text-red-900",
      badgeInactive:
        counts.flagged === 0
          ? "bg-gray-100 text-gray-400"
          : "bg-red-100 text-red-800",
      icon: FLAG_ICON,
    },
    {
      id: "audit",
      label: "Audit log",
      count: counts.audit,
      activeBg: "bg-gray-200 text-gray-800",
      badgeActive: "bg-gray-300 text-gray-800",
      badgeInactive:
        counts.audit === 0
          ? "bg-gray-100 text-gray-400"
          : "bg-gray-200 text-gray-700",
      icon: SCROLL_ICON,
    },
  ];

  return (
    <div
      className="flex items-center gap-1 border-b border-gray-200 pb-2"
      role="tablist"
      aria-label="PI actions sections"
    >
      {tabs.map((t) => {
        const isActive = activeTab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              isActive
                ? t.activeBg
                : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            }`}
          >
            <span aria-hidden="true" className="flex-shrink-0">
              {t.icon}
            </span>
            <span>{t.label}</span>
            <span
              className={`ml-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums ${
                isActive ? t.badgeActive : t.badgeInactive
              }`}
            >
              {t.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 1: Pending approvals
// ─────────────────────────────────────────────────────────────────────────────

interface PendingApprovalsTabProps {
  items: Array<PurchaseItem & { username: string }>;
  declinedItems: Array<PurchaseItem & { username: string }>;
  profileMap: LabUserProfileMap;
  sessionUnlocked: boolean;
  sessionId: string | null;
  actor: string;
  onAfterChange: () => void;
}

function PendingApprovalsTab({
  items,
  declinedItems,
  profileMap,
  sessionUnlocked,
  sessionId,
  actor,
  onAfterChange,
}: PendingApprovalsTabProps) {
  // PiActions follow-up Item 3 (2026-05-23): "Recently declined" is a
  // separate collapsible section under the pending list (UX choice over
  // an inline declined-pill row in the pending list itself). Rationale:
  // mixing pending + declined in one scroll dilutes the urgency of the
  // pending list (which is the surface the PI opened the widget for).
  // Keeping declined items visible (vs hidden) honors Grant's direction
  // — the PI sees what they turned down and can re-approve in one click,
  // but the visual hierarchy stays "what needs you" first.
  const [declinedOpen, setDeclinedOpen] = useState(false);

  // Empty state only when BOTH lists are empty — a declined-only state
  // is interesting on its own ("you've declined N this week, nothing
  // new is pending") and shouldn't get the all-clear celebration.
  if (items.length === 0 && declinedItems.length === 0) {
    return (
      <EmptyState
        icon={ALL_CLEAR_ICON}
        iconClass="text-emerald-500"
        label="Nothing waiting on you"
        sub="Every purchase request has been approved or declined."
      />
    );
  }

  return (
    <div className="space-y-2">
      {!sessionUnlocked && (
        <LockedBanner actor={actor} targetLabel="purchase approvals" />
      )}
      {items.length === 0 ? (
        <p className="text-xs text-gray-500 italic px-1">
          Nothing pending — every recent request was approved or declined.
        </p>
      ) : (
        <ul
          className="space-y-1.5 overflow-y-auto pr-1"
          style={{ maxHeight: "60vh" }}
        >
          {items.map((item) => (
            <li key={`${item.username}:${item.id}`}>
              <PendingApprovalRow
                item={item}
                profileMap={profileMap}
                sessionUnlocked={sessionUnlocked}
                sessionId={sessionId}
                actor={actor}
                onAfterChange={onAfterChange}
              />
            </li>
          ))}
        </ul>
      )}

      {declinedItems.length > 0 && (
        <DeclinedSection
          items={declinedItems}
          open={declinedOpen}
          onToggle={() => setDeclinedOpen((v) => !v)}
          profileMap={profileMap}
          sessionUnlocked={sessionUnlocked}
          sessionId={sessionId}
          actor={actor}
          onAfterChange={onAfterChange}
        />
      )}
    </div>
  );
}

// ── Recently declined section (PiActions follow-up Item 3) ──────────────
//
// Collapsible block below the pending list. Single "Re-approve" button
// per row routes through setPurchaseApproval (which now wipes the
// declined_at + declined_by fields), so the item snaps back to approved
// in one click.

interface DeclinedSectionProps {
  items: Array<PurchaseItem & { username: string }>;
  open: boolean;
  onToggle: () => void;
  profileMap: LabUserProfileMap;
  sessionUnlocked: boolean;
  sessionId: string | null;
  actor: string;
  onAfterChange: () => void;
}

function DeclinedSection({
  items,
  open,
  onToggle,
  profileMap,
  sessionUnlocked,
  sessionId,
  actor,
  onAfterChange,
}: DeclinedSectionProps) {
  return (
    <div className="mt-2 pt-2 border-t border-gray-200">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-1 py-1 rounded text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="text-gray-400">
            {X_ICON}
          </span>
          Recently declined
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums bg-gray-100 text-gray-600">
            {items.length}
          </span>
        </span>
        <span
          aria-hidden="true"
          className={`text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}
        >
          {CHEVRON_RIGHT_ICON}
        </span>
      </button>
      {open && (
        <ul
          className="mt-1.5 space-y-1.5 overflow-y-auto pr-1"
          style={{ maxHeight: "40vh" }}
        >
          {items.map((item) => (
            <li key={`declined:${item.username}:${item.id}`}>
              <DeclinedRow
                item={item}
                profileMap={profileMap}
                sessionUnlocked={sessionUnlocked}
                sessionId={sessionId}
                actor={actor}
                onAfterChange={onAfterChange}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface DeclinedRowProps {
  item: PurchaseItem & { username: string };
  profileMap: LabUserProfileMap;
  sessionUnlocked: boolean;
  sessionId: string | null;
  actor: string;
  onAfterChange: () => void;
}

function DeclinedRow({
  item,
  profileMap,
  sessionUnlocked,
  sessionId,
  actor,
  onAfterChange,
}: DeclinedRowProps) {
  const [busy, setBusy] = useState(false);
  const requesterName =
    profileMap[item.username]?.displayName?.trim() || item.username;
  const declinerName = item.declined_by
    ? profileMap[item.declined_by]?.displayName?.trim() || item.declined_by
    : "you";
  const declinedRelative = item.declined_at
    ? formatRelative(item.declined_at)
    : "";

  const handleReApprove = async () => {
    if (!sessionUnlocked || !sessionId || busy) return;
    setBusy(true);
    try {
      const result = await setPurchaseApproval({
        actor,
        sessionId,
        targetOwner: item.username,
        purchaseItemId: item.id,
        approved: true,
        itemName: item.item_name,
      });
      if (!result.ok && result.reason === "data-write") {
        console.error("[pi-actions-dashboard] re-approve failed", result.error);
        alert("Failed to re-approve. See console for details.");
        return;
      }
      onAfterChange();
      if (!result.ok && result.reason === "audit") {
        console.warn("[pi-actions-dashboard] re-approve audit failed", result.error);
      }
    } finally {
      setBusy(false);
    }
  };

  const tip = !sessionUnlocked ? "Unlock edit mode to re-approve." : null;

  return (
    <div className="flex items-center gap-2.5 px-2 py-2 rounded-md border border-gray-200 bg-gray-50 hover:bg-white transition-colors">
      <UserAvatar username={item.username} size="sm" />
      <div className="flex-1 min-w-0">
        <p
          className="text-xs font-medium text-gray-700 truncate"
          title={item.item_name}
        >
          {item.item_name}
        </p>
        <p className="text-[11px] text-gray-500 truncate">
          {requesterName} <span className="text-gray-400">·</span>{" "}
          <span className="text-red-700">Declined {declinedRelative}</span>
          {item.declined_by && item.declined_by !== actor && (
            <>
              {" "}
              <span className="text-gray-400">·</span> by {declinerName}
            </>
          )}
        </p>
      </div>
      <div className="flex-shrink-0">
        {tip ? (
          <Tooltip label={tip} placement="top">
            <span>
              <ReApproveButton onClick={handleReApprove} disabled busy={busy} />
            </span>
          </Tooltip>
        ) : (
          <ReApproveButton
            onClick={handleReApprove}
            disabled={busy}
            busy={busy}
          />
        )}
      </div>
    </div>
  );
}

function ReApproveButton({
  onClick,
  disabled,
  busy,
}: {
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
      data-testid="pi-actions-reapprove"
    >
      <span aria-hidden="true">{CHECK_ICON}</span>
      {busy ? "Saving" : "Re-approve"}
    </button>
  );
}

interface PendingApprovalRowProps {
  item: PurchaseItem & { username: string };
  profileMap: LabUserProfileMap;
  sessionUnlocked: boolean;
  sessionId: string | null;
  actor: string;
  onAfterChange: () => void;
}

function PendingApprovalRow({
  item,
  profileMap,
  sessionUnlocked,
  sessionId,
  actor,
  onAfterChange,
}: PendingApprovalRowProps) {
  const [busy, setBusy] = useState(false);
  const requesterName =
    profileMap[item.username]?.displayName?.trim() || item.username;
  const fundingLabel = item.funding_string || "—";
  const totalDollars =
    typeof item.total_price === "number" ? `$${item.total_price.toFixed(2)}` : "—";

  // PiActions follow-up Item 3 (2026-05-23): Approve clears any prior
  // decline (setPurchaseApproval wipes declined_at + declined_by on
  // approve). Decline goes through the new `declinePurchase` writer
  // which persists declined_at + declined_by — so a declined item
  // disappears from the pending list and shows up in "Recently declined"
  // below with a Re-approve button.
  const handleApprove = async () => {
    if (!sessionUnlocked || !sessionId || busy) return;
    setBusy(true);
    try {
      const result = await setPurchaseApproval({
        actor,
        sessionId,
        targetOwner: item.username,
        purchaseItemId: item.id,
        approved: true,
        itemName: item.item_name,
      });
      if (!result.ok && result.reason === "data-write") {
        console.error("[pi-actions-dashboard] approve failed", result.error);
        alert("Failed to approve. See console for details.");
        return;
      }
      onAfterChange();
      if (!result.ok && result.reason === "audit") {
        console.warn("[pi-actions-dashboard] approve audit failed", result.error);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async () => {
    if (!sessionUnlocked || !sessionId || busy) return;
    setBusy(true);
    try {
      const result = await declinePurchase({
        actor,
        sessionId,
        targetOwner: item.username,
        purchaseItemId: item.id,
        itemName: item.item_name,
      });
      if (!result.ok && result.reason === "data-write") {
        console.error("[pi-actions-dashboard] decline failed", result.error);
        alert("Failed to decline. See console for details.");
        return;
      }
      onAfterChange();
      if (!result.ok && result.reason === "audit") {
        console.warn("[pi-actions-dashboard] decline audit failed", result.error);
      }
    } finally {
      setBusy(false);
    }
  };

  const buttonsDisabledTip = !sessionUnlocked
    ? "Unlock edit mode to approve / decline."
    : null;

  return (
    <div className="flex items-center gap-2.5 px-2 py-2 rounded-md border border-gray-200 bg-white hover:bg-gray-50 transition-colors">
      <UserAvatar username={item.username} size="sm" />
      <div className="flex-1 min-w-0">
        <p
          className="text-xs font-medium text-gray-900 truncate"
          title={item.item_name}
        >
          {item.item_name}
        </p>
        <p className="text-[11px] text-gray-500 truncate">
          {requesterName} <span className="text-gray-400">·</span> {fundingLabel}{" "}
          <span className="text-gray-400">·</span> {totalDollars}
        </p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {buttonsDisabledTip ? (
          <Tooltip label={buttonsDisabledTip} placement="top">
            <span>
              <ApproveButton onClick={handleApprove} disabled busy={busy} />
            </span>
          </Tooltip>
        ) : (
          <ApproveButton onClick={handleApprove} disabled={busy} busy={busy} />
        )}
        {buttonsDisabledTip ? (
          <Tooltip label={buttonsDisabledTip} placement="top">
            <span>
              <DeclineButton onClick={handleDecline} disabled busy={busy} />
            </span>
          </Tooltip>
        ) : (
          <DeclineButton onClick={handleDecline} disabled={busy} busy={busy} />
        )}
      </div>
    </div>
  );
}

function ApproveButton({
  onClick,
  disabled,
  busy,
}: {
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
      data-testid="pi-actions-approve"
    >
      <span aria-hidden="true">{CHECK_ICON}</span>
      {busy ? "Saving" : "Approve"}
    </button>
  );
}

function DeclineButton({
  onClick,
  disabled,
  busy,
}: {
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed"
      data-testid="pi-actions-decline"
    >
      <span aria-hidden="true">{X_ICON}</span>
      {busy ? "Saving" : "Decline"}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 2: Flagged by you
// ─────────────────────────────────────────────────────────────────────────────

type FlagKind = "task" | "purchase_item";

interface FlagRowData {
  kind: FlagKind;
  /** The numeric record id in the owner's namespace. */
  recordId: number;
  /** Task id whose popup hosts this record. For task flags it === recordId;
   *  for purchase-item flags it's the parent task id (the popup opens
   *  with the Items tab pre-selected). */
  hostTaskId: number;
  recordName: string;
  owner: string;
  flag: { by: string; at: string; reason?: string | null };
}

interface FlaggedByMeTabProps {
  rows: Array<
    | {
        kind: "task";
        record: LabTask;
        owner: string;
        flag: FlagRowData["flag"];
      }
    | {
        kind: "purchase_item";
        record: PurchaseItem & { username: string };
        owner: string;
        flag: FlagRowData["flag"];
      }
  >;
  profileMap: LabUserProfileMap;
  sessionUnlocked: boolean;
  sessionId: string | null;
  actor: string;
  onOpenRecord: (target: RecordPopupTarget) => void;
  onAfterChange: () => void;
}

function FlaggedByMeTab({
  rows,
  profileMap,
  sessionUnlocked,
  sessionId,
  actor,
  onOpenRecord,
  onAfterChange,
}: FlaggedByMeTabProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={FLAG_ICON}
        iconClass="text-gray-400"
        label="No flags pending your follow-up"
        sub="Records you flag for review across the lab show up here."
      />
    );
  }

  return (
    <div className="space-y-2">
      {!sessionUnlocked && (
        <LockedBanner actor={actor} targetLabel="flag actions" />
      )}
      <ul
        className="space-y-1.5 overflow-y-auto pr-1"
        style={{ maxHeight: "60vh" }}
      >
        {rows.map((row) => {
          const data: FlagRowData =
            row.kind === "task"
              ? {
                  kind: "task",
                  recordId: row.record.id,
                  hostTaskId: row.record.id,
                  recordName: row.record.name,
                  owner: row.owner,
                  flag: row.flag,
                }
              : {
                  kind: "purchase_item",
                  recordId: row.record.id,
                  hostTaskId: row.record.task_id,
                  recordName: row.record.item_name,
                  owner: row.owner,
                  flag: row.flag,
                };
          return (
            <li key={`${data.kind}:${data.owner}:${data.recordId}`}>
              <FlaggedRow
                data={data}
                profileMap={profileMap}
                sessionUnlocked={sessionUnlocked}
                sessionId={sessionId}
                actor={actor}
                onOpenRecord={onOpenRecord}
                onAfterChange={onAfterChange}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface FlaggedRowProps {
  data: FlagRowData;
  profileMap: LabUserProfileMap;
  sessionUnlocked: boolean;
  sessionId: string | null;
  actor: string;
  onOpenRecord: (target: RecordPopupTarget) => void;
  onAfterChange: () => void;
}

function FlaggedRow({
  data,
  profileMap,
  sessionUnlocked,
  sessionId,
  actor,
  onOpenRecord,
  onAfterChange,
}: FlaggedRowProps) {
  const [busy, setBusy] = useState(false);
  const ownerName =
    profileMap[data.owner]?.displayName?.trim() || data.owner;

  const handleClear = async () => {
    if (!sessionUnlocked || !sessionId || busy) return;
    setBusy(true);
    try {
      // setFlagForReview(..., flag: null) is the PI-side clear path; it
      // appends an audit entry for the clear and reuses the same write
      // routing as the set. clearFlagAsOwner exists in pi-actions but is
      // owner-only and skips the audit log; the PI clearing their own
      // flag belongs in the audit trail so we use the unlock-required
      // path here.
      await setFlagForReview({
        actor,
        sessionId,
        targetOwner: data.owner,
        recordType: data.kind,
        recordId: data.recordId,
        flag: null,
        recordName: data.recordName,
      });
      onAfterChange();
    } catch (err) {
      console.error("[pi-actions-dashboard] clear flag failed", err);
      alert("Failed to clear flag. See console for details.");
    } finally {
      setBusy(false);
    }
  };

  const flaggedRelative = formatRelative(data.flag.at);
  const kindLabel = data.kind === "task" ? "task" : "purchase";

  return (
    <div className="flex items-start gap-2.5 px-2 py-2 rounded-md border border-gray-200 bg-white hover:bg-gray-50 transition-colors">
      <span
        aria-hidden="true"
        className={`flex-shrink-0 mt-0.5 ${data.kind === "task" ? "text-emerald-600" : "text-amber-600"}`}
        title={kindLabel}
      >
        {data.kind === "task" ? SCROLL_ICON : SHIELD_ICON}
      </span>
      <div className="flex-1 min-w-0">
        <button
          type="button"
          onClick={() =>
            onOpenRecord({
              taskId: data.hostTaskId,
              owner: data.owner,
              initialTab: data.kind === "purchase_item" ? "purchases" : undefined,
            })
          }
          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline rounded focus:outline-none focus:ring-2 focus:ring-emerald-300 truncate max-w-full"
          title={`Open ${data.recordName} in a popup`}
        >
          <span className="truncate">{data.recordName}</span>
          <span aria-hidden="true" className="flex-shrink-0">
            {OPEN_POPUP_ICON}
          </span>
        </button>
        <p className="text-[11px] text-gray-500 truncate">
          {ownerName} <span className="text-gray-400">·</span> flagged{" "}
          {flaggedRelative}
        </p>
        {data.flag.reason && (
          <p className="text-[11px] text-gray-600 italic mt-0.5 break-words line-clamp-2">
            {data.flag.reason}
          </p>
        )}
      </div>
      <div className="flex-shrink-0">
        {sessionUnlocked ? (
          <button
            type="button"
            onClick={handleClear}
            disabled={busy}
            className="text-[11px] text-gray-600 hover:text-gray-900 hover:underline px-1.5 py-0.5 rounded disabled:opacity-50"
            data-testid="pi-actions-clear-flag"
          >
            {busy ? "Clearing" : "Clear flag"}
          </button>
        ) : (
          <Tooltip label="Unlock edit mode to clear flags." placement="top">
            <span className="text-[11px] text-gray-300 px-1.5 py-0.5 cursor-not-allowed">
              Clear flag
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 3: Audit log
// ─────────────────────────────────────────────────────────────────────────────

const AUDIT_DISPLAY_INITIAL = 100;
const AUDIT_DISPLAY_STEP = 100;

interface AuditLogTabProps {
  entries: DecoratedAuditEntry[];
  profileMap: LabUserProfileMap;
}

function AuditLogTab({ entries, profileMap }: AuditLogTabProps) {
  // PiActions follow-up Item 2 (2026-05-23): the display cap is now an
  // escapable user choice instead of a silent DOM-side truncate. The
  // initial render still slices to 100 (cheap DOM + no jank for very
  // large labs), but the PI can click "Show more" to bump it by 100, or
  // "Show all" to lift the cap entirely. The underlying entries array is
  // already cached, so this is render-side only — no extra reads.
  const [displayLimit, setDisplayLimit] = useState<number>(AUDIT_DISPLAY_INITIAL);
  const capped = useMemo(
    () => entries.slice(0, displayLimit),
    [entries, displayLimit],
  );
  const hasMore = entries.length > displayLimit;

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={SCROLL_ICON}
        iconClass="text-gray-400"
        label="You haven't taken any PI actions yet"
        sub="Approvals, flags, and per-field edits you make show up here."
      />
    );
  }

  return (
    <ul
      className="space-y-1 overflow-y-auto pr-1"
      style={{ maxHeight: "60vh" }}
    >
      {capped.map((entry) => (
        <li key={entry.id}>
          <AuditRow entry={entry} profileMap={profileMap} />
        </li>
      ))}
      {hasMore && (
        <li className="pt-2">
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-gray-50">
            <p className="text-[11px] text-gray-500">
              Showing {capped.length} of {entries.length} entries.
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setDisplayLimit((v) => v + AUDIT_DISPLAY_STEP)
                }
                className="text-[11px] font-medium text-emerald-700 hover:text-emerald-800 hover:underline px-1.5 py-0.5 rounded focus:outline-none focus:ring-2 focus:ring-emerald-300"
                data-testid="pi-actions-audit-show-more"
              >
                Show more
              </button>
              <span aria-hidden="true" className="text-gray-300">
                ·
              </span>
              <button
                type="button"
                onClick={() => setDisplayLimit(entries.length)}
                className="text-[11px] font-medium text-gray-600 hover:text-gray-900 hover:underline px-1.5 py-0.5 rounded focus:outline-none focus:ring-2 focus:ring-gray-300"
                data-testid="pi-actions-audit-show-all"
              >
                Show all
              </button>
            </div>
          </div>
        </li>
      )}
    </ul>
  );
}

function AuditRow({
  entry,
  profileMap,
}: {
  entry: DecoratedAuditEntry;
  profileMap: LabUserProfileMap;
}) {
  const ownerName =
    profileMap[entry.targetOwner]?.displayName?.trim() || entry.targetOwner;
  const verb = describeAuditEntry(entry);
  const when = formatRelative(entry.timestamp);
  const recordLabel = `${entry.record_type} #${entry.record_id}`;
  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 transition-colors">
      <span aria-hidden="true" className="text-gray-400 flex-shrink-0 mt-0.5">
        {SCROLL_ICON}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-gray-700 truncate">
          <span className="font-medium text-gray-900">{verb}</span>{" "}
          <span className="text-gray-500">on</span>{" "}
          <span
            className="text-gray-700"
            title={`${entry.record_type} id ${entry.record_id}`}
          >
            {recordLabel}
          </span>{" "}
          <span className="text-gray-400">·</span>{" "}
          <span className="text-gray-500">{ownerName}</span>
        </p>
        <p
          className="text-[10px] text-gray-400 truncate"
          title={new Date(entry.timestamp).toLocaleString()}
        >
          {when}
        </p>
      </div>
    </div>
  );
}

/**
 * Map a PiAuditEntry to a short human verb. Driven by record_type +
 * field_path rather than a rigid enum so new record types or fields fall
 * back to a sensible default ("edited <field>") instead of breaking.
 */
function describeAuditEntry(entry: PiAuditEntry): string {
  const f = entry.field_path;
  if (entry.record_type === "purchase_item" && f === "approved") {
    return entry.new_value === true ? "approved purchase" : "cleared approval";
  }
  // PiActions follow-up Item 3 (2026-05-23): persisted decline path
  // emits its own field_path so the audit log can distinguish "PI turned
  // it down" from "PI cleared approval back to pending."
  if (entry.record_type === "purchase_item" && f === "declined") {
    return "declined purchase";
  }
  if (f === "flagged") {
    return entry.new_value == null ? "cleared flag" : "flagged for review";
  }
  if (entry.record_type === "task" && f === "assignee") {
    return "assigned task";
  }
  if (f === "transient-read") {
    return "auto-read method";
  }
  return `edited ${f}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers — locked banner, empty state, relative time, record popup
// ─────────────────────────────────────────────────────────────────────────────

interface LockedBannerProps {
  actor: string;
  targetLabel: string;
}

function LockedBanner({ actor, targetLabel }: LockedBannerProps) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-amber-200 bg-amber-50 text-xs text-amber-900">
      <span>
        Edit mode is locked. Unlock to take actions on {targetLabel}.
      </span>
      <RequestEditButton
        username={actor}
        targetLabel={targetLabel}
        variant="subtle"
      />
    </div>
  );
}

interface EmptyStateProps {
  icon: React.ReactElement;
  iconClass: string;
  label: string;
  sub?: string;
}

function EmptyState({ icon, iconClass, label, sub }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 text-gray-500">
      <span aria-hidden="true" className={`mb-2 ${iconClass}`}>
        {icon}
      </span>
      <p className="text-sm font-medium text-gray-700">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-1 max-w-sm">{sub}</p>}
    </div>
  );
}

function formatRelative(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Record popup mount (Flagged tab click-to-source) ─────────────────────

interface RecordPopupTarget {
  /** Task id whose popup we open. For purchase-item flags this is the
   *  parent task id; the popup opens with the Items tab pre-selected. */
  taskId: number;
  /** Target task owner — the user whose folder hosts the task file. */
  owner: string;
  /** Optional initial tab inside the popup. "purchases" jumps straight to
   *  the items table for purchase-task popups. */
  initialTab?: "purchases";
}

function RecordPopupMount({
  target,
  currentUser,
  onClose,
}: {
  target: RecordPopupTarget;
  currentUser: string | null;
  onClose: () => void;
}) {
  const isOwner = !!currentUser && currentUser === target.owner;
  const ownerArg = isOwner ? undefined : target.owner;

  const taskQuery = useQuery<Task | null>({
    queryKey: ["pi-actions", "popup-task", target.owner, target.taskId],
    queryFn: () => tasksApi.get(target.taskId, ownerArg),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  if (taskQuery.isLoading) {
    return <PopupLoading onClose={onClose} />;
  }
  if (!taskQuery.data) {
    return <PopupMissing onClose={onClose} />;
  }
  return (
    <TaskDetailPopup
      task={taskQuery.data}
      onClose={onClose}
      readOnly={!isOwner}
      username={isOwner ? undefined : target.owner}
      initialTab={target.initialTab}
    />
  );
}

function PopupLoading({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl px-6 py-5 flex items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-600" />
        <p className="text-sm text-gray-500">Loading record…</p>
      </div>
    </div>
  );
}

function PopupMissing({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl px-6 py-5 max-w-sm flex flex-col gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-medium text-gray-900">Record not found</p>
        <p className="text-xs text-gray-500">
          The source record may have been deleted or renamed. Close this
          message and refresh.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="self-end mt-1 text-xs text-emerald-700 hover:text-emerald-800 font-medium"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tile views (unchanged from Phase B Batch B3). Both call
// `usePiActionCounts` which still issues the per-user audit-count scan +
// the lab-wide purchase items query, so the tile badges stay correct
// regardless of whether the dashboard popup is open.
// ─────────────────────────────────────────────────────────────────────────────

import type { SnapshotTileProps, SidebarTileProps } from "./types";

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
  // PiActions follow-up Item 1 (2026-05-23): single canonical audit
  // query — shared with the dashboard above via React Query's keyed
  // dedupe. The tile components derive their badge count via
  // `entries.length` here instead of running a parallel `pi-audit-count`
  // query that walked every user's `_pi_audit.json` independently.
  const { data: auditEntries = [], isLoading: auditLoading } = useQuery<
    DecoratedAuditEntry[]
  >({
    queryKey: ["lab", "pi-audit-entries", currentUser ?? ""],
    enabled: accountType === "lab_head" && !!currentUser,
    queryFn: () => loadAuditEntriesByActor(currentUser ?? ""),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const auditCount = auditEntries.length;
  // PiActions follow-up Item 3 (2026-05-23): pending count excludes
  // declined items so the SnapshotTile badge matches the dashboard's
  // Tab 1 pending list — the PI shouldn't get nagged into clicking
  // through for items they already turned down.
  const pending = useMemo(
    () => items.filter((it) => !it.approved && !it.declined_at).length,
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
