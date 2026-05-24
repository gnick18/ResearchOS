"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  labApi,
  purchasesApi,
  fetchAllProjectsIncludingShared,
  fetchAllTasksIncludingShared,
} from "@/lib/local-api";
import { useLabData } from "@/hooks/useLabData";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { useEditSession } from "@/hooks/useEditSession";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { useAppStore } from "@/lib/store";
import UserAvatar from "@/components/UserAvatar";
import Tooltip from "@/components/Tooltip";
import RequestEditButton from "@/components/RequestEditButton";
import NewPurchaseModal from "@/components/NewPurchaseModal";
import PurchaseEditor from "@/components/PurchaseEditor";
import SpendingDashboard from "@/components/SpendingDashboard";
import FundingAccountsManager from "@/components/FundingAccountsManager";
import { setPurchaseApproval } from "@/lib/lab/pi-actions";
import {
  MISC_CATEGORY_LABEL,
  isMiscProject,
} from "@/lib/purchases/misc-project";
import type {
  PurchaseItem,
  FundingAccount,
  Task,
  Project,
} from "@/lib/types";
import type { LabUserProfileMap } from "@/hooks/useLabUserProfiles";
import type { SnapshotTileProps, SidebarTileProps } from "./types";
import SidebarStatTile from "./snapshot/SidebarStatTile";

// ─────────────────────────────────────────────────────────────────────────────
// Inline SVG icons. No emojis — every visible glyph is a stroke-driven SVG
// using `currentColor` so the parent tint drives the rendered look.
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

const LIST_ICON = (
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
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const DOLLAR_ICON = (
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
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const CHART_ICON = (
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
    <line x1="12" y1="20" x2="12" y2="10" />
    <line x1="18" y1="20" x2="18" y2="4" />
    <line x1="6" y1="20" x2="6" y2="16" />
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

const PLUS_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const SEARCH_ICON = (
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
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
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

const SETTINGS_ICON = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

// ─────────────────────────────────────────────────────────────────────────────
// LabPurchasesWidget ExpandedView (LabPurchases popup expansion manager,
// 2026-05-23).
//
// The popup body IS the lab head's purchases page. Members visit
// `/purchases` directly; lab heads have the route hidden in AppShell and
// open this widget instead. Everything the regular `/purchases` page
// offers a single user should be possible inline here, scoped lab-wide.
//
// Four tabs:
//   A. Pending approvals — inline Approve / Decline per item, lab-wide
//      list, scrolls internally. Lands first when count > 0.
//   B. All purchases — full purchase task list mirroring `/purchases`
//      with category chips, owner filter, search, sort, and click-to-
//      expand inline PurchaseEditor.
//   C. Funding accounts — SpendingDashboard inline + "Edit funding
//      accounts" button that toggles FundingAccountsManager.
//   D. Spending overview — last 4 weeks bar chart + per-category +
//      per-member breakdown, all read-only analytics.
//
// Header chrome:
//   - Tabs with pending count badge on A and dollar total on D
//   - Top-right "+ New purchase" button visible from any tab
//   - Title strip handled by the popup wrapper (kept simple)
//
// Visibility: lab_head only. Defensive accountType guard returns null
// for non-PI users.
//
// Edit-session gate: copies the PiActionsWidget pattern. The session is
// a global lab-head unlock; once unlocked, the PI can approve/decline
// across owners and the PurchaseEditor lifts its own internal lock.
// Locked state shows disabled buttons inside `<Tooltip>` + a
// `<RequestEditButton>` strip.
// ─────────────────────────────────────────────────────────────────────────────

type TabId = "pending" | "all" | "funding" | "spending";

export default function LabPurchasesWidget(_props?: {
  isEditing?: boolean;
  surface?: "canvas" | "sidebar";
}) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const queryClient = useQueryClient();
  const session = useEditSession();
  const profileMap = useLabUserProfileMap();
  const { tasks: labTasks, users } = useLabData();
  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);

  // Lab-wide purchase items — items decorated with `username` for
  // attribution + funding rollups.
  const { data: items = [], isLoading: itemsLoading } = useQuery<
    Array<PurchaseItem & { username: string }>
  >({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: accountType === "lab_head",
  });

  // Same items, decorated with `owner` instead of `username`, for
  // SpendingDashboard which expects the `/purchases` shape.
  // SpendingDashboard joins items -> tasks via `${owner}:${task_id}`
  // and items -> projects via `${owner}:${project_id}`; the shape
  // returned by `labApi.getAllPurchaseItems` uses `username` so we
  // rename in place when feeding the dashboard.
  const itemsForDashboard = useMemo(
    () =>
      items.map((it) => ({
        ...it,
        owner: it.username,
      })) as Array<PurchaseItem & { owner: string }>,
    [items],
  );

  // Lab-wide funding accounts. Reused as the data source for Tab C +
  // for the SnapshotTile's funding rollup.
  const { data: fundingAccounts = [] } = useQuery<FundingAccount[]>({
    queryKey: ["funding-accounts"],
    queryFn: purchasesApi.listFundingAccounts,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: accountType === "lab_head",
  });

  // Cross-owner tasks + projects so the All-Purchases tab + Spending
  // dashboard can render the same shapes /purchases consumes. The
  // currentUser keyspace already includes shared tasks + shared
  // projects, so we reuse the same query keys to dedupe the cache.
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser ?? ""],
    queryFn: fetchAllTasksIncludingShared,
    enabled: accountType === "lab_head",
  });
  const { data: allProjects = [] } = useQuery({
    queryKey: ["projects", currentUser ?? "", { includeHidden: true }],
    queryFn: () => fetchAllProjectsIncludingShared({ includeHidden: true }),
    enabled: accountType === "lab_head",
  });

  const userColor = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users) map.set(u.username, u.color || "#6b7280");
    return map;
  }, [users]);

  // Lab-wide task lookup keyed by `${username}:${id}` so PendingApprovalsTab
  // rows can show the parent task name without a per-row query. Lifted
  // to the parent so the memo is unconditional (hooks-rules).
  const labTasksByKey = useMemo(() => {
    const map = new Map<string, (typeof labTasks)[number]>();
    for (const t of labTasks) map.set(`${t.username}:${t.id}`, t);
    return map;
  }, [labTasks]);

  const pendingItems = useMemo(
    () => items.filter((it) => !it.approved),
    [items],
  );

  // Total approved spend (used as the Tab D badge — "$X" of approved spend
  // across the lab). Mirrors the SnapshotTile's approved-only predicate so
  // the two surfaces agree.
  const approvedTotal = useMemo(
    () =>
      items
        .filter((it) => it.approved === undefined || it.approved === true)
        .reduce((sum, it) => sum + (it.total_price ?? 0), 0),
    [items],
  );

  // Tab selection — smart default: land on pending if there's anything
  // waiting; otherwise All purchases (the most useful neutral landing).
  const [userPickedTab, setUserPickedTab] = useState<TabId | null>(null);
  const derivedDefaultTab: TabId =
    pendingItems.length > 0 ? "pending" : "all";
  const activeTab: TabId = userPickedTab ?? derivedDefaultTab;
  const setActiveTab = (next: TabId) => setUserPickedTab(next);

  const [showNewPurchase, setShowNewPurchase] = useState(false);

  // Session-unlocked flag mirrors PiActionsWidget. The session is a
  // global lab-head unlock — once unlocked, the PI can act on any
  // owner's purchase items.
  const isLabHead = accountType === "lab_head";
  const sessionUnlocked =
    session.state === "unlocked" &&
    session.active?.username === currentUser &&
    isLabHead;
  const sessionId = sessionUnlocked ? session.active?.id ?? null : null;

  if (!isLabHead) {
    return null;
  }

  const invalidatePurchases = () => {
    void queryClient.invalidateQueries({ queryKey: ["lab", "purchase-items"] });
    void queryClient.invalidateQueries({ queryKey: ["purchases"] });
    void queryClient.invalidateQueries({ queryKey: ["purchases-all"] });
  };
  const invalidateAudit = () => {
    void queryClient.invalidateQueries({
      queryKey: ["lab", "pi-audit-count", currentUser ?? ""],
    });
    void queryClient.invalidateQueries({
      queryKey: ["lab", "pi-audit-entries", currentUser ?? ""],
    });
  };

  return (
    <div className="flex flex-col min-h-0 space-y-3">
      {/* Tab strip + new-purchase button. The "+ New purchase" button is
          visible from every tab so the PI never has to bounce back to a
          particular tab to log a new order. */}
      <div className="flex items-start justify-between gap-2 border-b border-gray-200 pb-2">
        <TabStrip
          activeTab={activeTab}
          onChange={setActiveTab}
          pendingCount={pendingItems.length}
          approvedTotal={approvedTotal}
        />
        <button
          type="button"
          onClick={() => setShowNewPurchase(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 transition-colors flex-shrink-0"
          data-testid="lab-purchases-new"
        >
          <span aria-hidden="true">{PLUS_ICON}</span>
          New purchase
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {activeTab === "pending" && (
          <PendingApprovalsTab
            items={pendingItems}
            itemsLoading={itemsLoading}
            profileMap={profileMap}
            sessionUnlocked={sessionUnlocked}
            sessionId={sessionId}
            actor={currentUser ?? ""}
            labTasksByKey={labTasksByKey}
            onAfterChange={() => {
              invalidatePurchases();
              invalidateAudit();
            }}
          />
        )}
        {activeTab === "all" && (
          <AllPurchasesTab
            tasks={allTasks}
            projects={allProjects}
            items={itemsForDashboard}
            profileMap={profileMap}
            userColor={userColor}
          />
        )}
        {activeTab === "funding" && (
          <FundingTab
            purchaseItems={itemsForDashboard}
            tasks={allTasks}
            projects={allProjects}
            fundingAccounts={fundingAccounts}
            selectedProjectIds={selectedProjectIds}
          />
        )}
        {activeTab === "spending" && (
          <SpendingOverviewTab
            items={items}
            profileMap={profileMap}
            userColor={userColor}
            labTasks={labTasks}
          />
        )}
      </div>

      {/* + New purchase modal — portals/absolute-positions over the popup. */}
      {showNewPurchase && (
        <NewPurchaseModal
          open={showNewPurchase}
          onClose={() => {
            setShowNewPurchase(false);
            invalidatePurchases();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab strip
// ─────────────────────────────────────────────────────────────────────────────

interface TabStripProps {
  activeTab: TabId;
  onChange: (next: TabId) => void;
  pendingCount: number;
  approvedTotal: number;
}

function TabStrip({
  activeTab,
  onChange,
  pendingCount,
  approvedTotal,
}: TabStripProps) {
  const tabs: Array<{
    id: TabId;
    label: string;
    badge: string | null;
    activeBg: string;
    badgeActive: string;
    badgeInactive: string;
    icon: React.ReactElement;
  }> = [
    {
      id: "pending",
      label: "Pending approvals",
      badge: pendingCount > 0 ? String(pendingCount) : null,
      activeBg: "bg-amber-100 text-amber-800",
      badgeActive: "bg-amber-200 text-amber-900",
      badgeInactive:
        pendingCount === 0
          ? "bg-gray-100 text-gray-400"
          : "bg-amber-100 text-amber-800",
      icon: SHIELD_ICON,
    },
    {
      id: "all",
      label: "All purchases",
      badge: null,
      activeBg: "bg-blue-100 text-blue-800",
      badgeActive: "bg-blue-200 text-blue-900",
      badgeInactive: "bg-gray-100 text-gray-400",
      icon: LIST_ICON,
    },
    {
      id: "funding",
      label: "Funding accounts",
      badge: null,
      activeBg: "bg-emerald-100 text-emerald-800",
      badgeActive: "bg-emerald-200 text-emerald-900",
      badgeInactive: "bg-gray-100 text-gray-400",
      icon: DOLLAR_ICON,
    },
    {
      id: "spending",
      label: "Spending overview",
      badge: approvedTotal > 0 ? formatCompactCurrency(approvedTotal) : null,
      activeBg: "bg-gray-200 text-gray-800",
      badgeActive: "bg-gray-300 text-gray-800",
      badgeInactive:
        approvedTotal === 0
          ? "bg-gray-100 text-gray-400"
          : "bg-gray-200 text-gray-700",
      icon: CHART_ICON,
    },
  ];

  return (
    <div
      className="flex items-center gap-1 flex-wrap"
      role="tablist"
      aria-label="Lab purchases sections"
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
            {t.badge !== null && (
              <span
                className={`ml-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums ${
                  isActive ? t.badgeActive : t.badgeInactive
                }`}
              >
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab A: Pending approvals
// ─────────────────────────────────────────────────────────────────────────────

interface PendingApprovalsTabProps {
  items: Array<PurchaseItem & { username: string }>;
  itemsLoading: boolean;
  profileMap: LabUserProfileMap;
  sessionUnlocked: boolean;
  sessionId: string | null;
  actor: string;
  /** Lab-wide task lookup so we can show the parent task name per row. */
  labTasksByKey: Map<string, { id: number; name: string; username: string }>;
  onAfterChange: () => void;
}

function PendingApprovalsTab({
  items,
  itemsLoading,
  profileMap,
  sessionUnlocked,
  sessionId,
  actor,
  labTasksByKey,
  onAfterChange,
}: PendingApprovalsTabProps) {
  if (itemsLoading) {
    return (
      <p className="text-xs text-gray-500 italic px-1 py-3">
        Loading pending approvals...
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={ALL_CLEAR_ICON}
        iconClass="text-emerald-500"
        label="Nothing waiting on you"
        sub="Every purchase request has been reviewed."
      />
    );
  }

  return (
    <div className="space-y-2">
      {!sessionUnlocked && (
        <LockedBanner actor={actor} targetLabel="purchase approvals" />
      )}
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
              parentTaskName={
                labTasksByKey.get(`${item.username}:${item.task_id}`)?.name ??
                ""
              }
              onAfterChange={onAfterChange}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

interface PendingApprovalRowProps {
  item: PurchaseItem & { username: string };
  profileMap: LabUserProfileMap;
  sessionUnlocked: boolean;
  sessionId: string | null;
  actor: string;
  parentTaskName: string;
  onAfterChange: () => void;
}

function PendingApprovalRow({
  item,
  profileMap,
  sessionUnlocked,
  sessionId,
  actor,
  parentTaskName,
  onAfterChange,
}: PendingApprovalRowProps) {
  const [busy, setBusy] = useState(false);
  const requesterName =
    profileMap[item.username]?.displayName?.trim() || item.username;
  const fundingLabel = item.funding_string || "no funding string";
  const totalDollars =
    typeof item.total_price === "number"
      ? `$${item.total_price.toFixed(2)}`
      : "—";

  // Decline path: PurchaseItem has no `declined_at` field yet (parallel
  // chip a8536c41 may add one; until then, decline flips approved back
  // to pending via setPurchaseApproval(..., approved: false)). The brief
  // explicitly allows this: "decline goes through the back-flip-to-
  // pending path. This is intentional."
  const handleApprove = async () => {
    if (!sessionUnlocked || !sessionId || busy) return;
    setBusy(true);
    try {
      await setPurchaseApproval({
        actor,
        sessionId,
        targetOwner: item.username,
        purchaseItemId: item.id,
        approved: true,
        itemName: item.item_name,
      });
      onAfterChange();
    } catch (err) {
      console.error("[lab-purchases-popup] approve failed", err);
      alert("Failed to approve. See console for details.");
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async () => {
    if (!sessionUnlocked || !sessionId || busy) return;
    setBusy(true);
    try {
      await setPurchaseApproval({
        actor,
        sessionId,
        targetOwner: item.username,
        purchaseItemId: item.id,
        approved: false,
        itemName: item.item_name,
      });
      onAfterChange();
    } catch (err) {
      console.error("[lab-purchases-popup] decline failed", err);
      alert("Failed to decline. See console for details.");
    } finally {
      setBusy(false);
    }
  };

  const buttonsDisabledTip = !sessionUnlocked
    ? `Unlock an edit session to approve / decline.`
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
          {requesterName}
          {parentTaskName && (
            <>
              <span className="text-gray-400 mx-1">·</span>
              <span className="truncate">{parentTaskName}</span>
            </>
          )}
          <span className="text-gray-400 mx-1">·</span>
          <span>{fundingLabel}</span>
          <span className="text-gray-400 mx-1">·</span>
          <span className="tabular-nums">{totalDollars}</span>
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
          <ApproveButton
            onClick={handleApprove}
            disabled={busy}
            busy={busy}
          />
        )}
        {buttonsDisabledTip ? (
          <Tooltip label={buttonsDisabledTip} placement="top">
            <span>
              <DeclineButton onClick={handleDecline} disabled busy={busy} />
            </span>
          </Tooltip>
        ) : (
          <DeclineButton
            onClick={handleDecline}
            disabled={busy}
            busy={busy}
          />
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
      data-testid="lab-purchases-approve"
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
      data-testid="lab-purchases-decline"
    >
      <span aria-hidden="true">{X_ICON}</span>
      {busy ? "Saving" : "Decline"}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab B: All purchases
// ─────────────────────────────────────────────────────────────────────────────

type PurchaseCategoryFilter = "all" | "project" | "misc";
type SortOrder = "newest" | "oldest";

interface AllPurchasesTabProps {
  tasks: Task[];
  projects: Project[];
  /** Purchase items decorated with owner — used to compute per-task totals. */
  items: Array<PurchaseItem & { owner: string }>;
  profileMap: LabUserProfileMap;
  userColor: Map<string, string>;
}

function AllPurchasesTab({
  tasks,
  projects,
  items,
  profileMap,
  userColor,
}: AllPurchasesTabProps) {
  const [categoryFilter, setCategoryFilter] =
    useState<PurchaseCategoryFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("__all__");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Filter to purchase tasks. The /purchases page does the same filter
  // off `fetchAllTasksIncludingShared`. Tasks already carry `owner`.
  const purchaseTasks = useMemo(
    () => tasks.filter((t) => t.task_type === "purchase"),
    [tasks],
  );

  // Items grouped by parent task — same composite-key keying the
  // /purchases page uses (`${owner}:${task_id}`).
  const itemsByTask = useMemo(() => {
    const map = new Map<string, PurchaseItem[]>();
    for (const it of items) {
      const k = `${it.owner}:${it.task_id}`;
      const bucket = map.get(k) ?? [];
      bucket.push(it);
      map.set(k, bucket);
    }
    return map;
  }, [items]);

  // Unique owners across the purchase tasks for the owner dropdown.
  const owners = useMemo(() => {
    const set = new Set<string>();
    for (const t of purchaseTasks) set.add(t.owner);
    return Array.from(set).sort();
  }, [purchaseTasks]);

  // Counts for the category chips.
  const { miscTaskCount, projectTaskCount } = useMemo(() => {
    let misc = 0;
    let proj = 0;
    for (const t of purchaseTasks) {
      const project = projects.find(
        (p) => p.id === t.project_id && p.owner === t.owner,
      );
      if (project && isMiscProject(project)) misc += 1;
      else proj += 1;
    }
    return { miscTaskCount: misc, projectTaskCount: proj };
  }, [purchaseTasks, projects]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return purchaseTasks.filter((task) => {
      // Category gate
      const project = projects.find(
        (p) => p.id === task.project_id && p.owner === task.owner,
      );
      const taskIsMisc = !!project && isMiscProject(project);
      if (categoryFilter === "misc" && !taskIsMisc) return false;
      if (categoryFilter === "project" && taskIsMisc) return false;

      // Owner gate
      if (ownerFilter !== "__all__" && task.owner !== ownerFilter) return false;

      // Search: substring on task name + any item name within the task
      if (q.length > 0) {
        const taskMatches = task.name.toLowerCase().includes(q);
        if (taskMatches) return true;
        const taskItems = itemsByTask.get(`${task.owner}:${task.id}`) ?? [];
        const itemMatches = taskItems.some((it) =>
          it.item_name.toLowerCase().includes(q),
        );
        if (!itemMatches) return false;
      }
      return true;
    });
  }, [purchaseTasks, projects, categoryFilter, ownerFilter, search, itemsByTask]);

  const sortedTasks = useMemo(() => {
    const next = [...filteredTasks];
    next.sort((a, b) =>
      sortOrder === "newest"
        ? b.start_date.localeCompare(a.start_date)
        : a.start_date.localeCompare(b.start_date),
    );
    return next;
  }, [filteredTasks, sortOrder]);

  return (
    <div className="flex flex-col gap-2 min-h-0">
      {/* Category chip row */}
      <div
        className="flex items-center gap-2 flex-wrap"
        role="tablist"
        aria-label="Filter purchases by category"
      >
        {([
          { key: "all", label: "All", count: purchaseTasks.length },
          {
            key: "project",
            label: "Project",
            count: projectTaskCount,
          },
          {
            key: "misc",
            label: MISC_CATEGORY_LABEL,
            count: miscTaskCount,
          },
        ] as const).map((chip) => {
          const isActive = categoryFilter === chip.key;
          return (
            <button
              key={chip.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => setCategoryFilter(chip.key)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                isActive
                  ? "bg-amber-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {chip.label}
              <span
                className={`ml-1.5 text-[10px] tabular-nums ${
                  isActive ? "text-amber-100" : "text-gray-400"
                }`}
              >
                {chip.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Owner + search + sort row */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
          <span>Owner</span>
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="border border-gray-200 rounded-md px-2 py-1 text-xs bg-white"
          >
            <option value="__all__">All members</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {profileMap[o]?.displayName?.trim() || o}
              </option>
            ))}
          </select>
        </label>
        <div className="relative flex-1 min-w-[140px]">
          <span
            aria-hidden="true"
            className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
          >
            {SEARCH_ICON}
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search item or task name..."
            className="w-full pl-7 pr-2 py-1 border border-gray-200 rounded-md text-xs bg-white"
          />
        </div>
        <button
          type="button"
          onClick={() =>
            setSortOrder((s) => (s === "newest" ? "oldest" : "newest"))
          }
          className="px-2 py-1 text-xs border border-gray-200 rounded-md text-gray-600 hover:bg-gray-50"
        >
          {sortOrder === "newest" ? "Newest first" : "Oldest first"}
        </button>
      </div>

      {/* Task list */}
      <div className="overflow-y-auto pr-1" style={{ maxHeight: "60vh" }}>
        {sortedTasks.length === 0 ? (
          <p className="text-xs text-gray-400 italic px-1 py-3">
            No purchases match your filters.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {sortedTasks.map((task) => {
              const tkey = `${task.owner}:${task.id}`;
              const isOpen = expandedKey === tkey;
              const taskItems = itemsByTask.get(tkey) ?? [];
              const total = taskItems.reduce(
                (s, it) => s + (it.total_price ?? 0),
                0,
              );
              const project = projects.find(
                (p) => p.id === task.project_id && p.owner === task.owner,
              );
              const projectName = project
                ? isMiscProject(project)
                  ? MISC_CATEGORY_LABEL
                  : project.name
                : "—";
              const fundingStrings = Array.from(
                new Set(
                  taskItems
                    .map((it) => it.funding_string)
                    .filter((v): v is string => !!v),
                ),
              );
              const ownerName =
                profileMap[task.owner]?.displayName?.trim() || task.owner;
              const anyPending = taskItems.some((it) => !it.approved);
              return (
                <li key={tkey}>
                  <div className="border border-gray-200 rounded-md bg-white overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedKey(isOpen ? null : tkey)}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 hover:bg-gray-50 text-left"
                    >
                      <span
                        className="w-1 h-7 rounded-sm flex-shrink-0"
                        style={{
                          backgroundColor:
                            userColor.get(task.owner) || "#6b7280",
                        }}
                        aria-hidden="true"
                      />
                      <UserAvatar username={task.owner} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-900 truncate">
                          {task.name}
                        </p>
                        <p className="text-[11px] text-gray-500 truncate">
                          {ownerName}
                          <span className="text-gray-400 mx-1">·</span>
                          {projectName}
                          <span className="text-gray-400 mx-1">·</span>
                          {taskItems.length} item
                          {taskItems.length === 1 ? "" : "s"}
                          {fundingStrings.length > 0 && (
                            <>
                              <span className="text-gray-400 mx-1">·</span>
                              <span className="truncate">
                                {fundingStrings.join(", ")}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                        <span className="text-xs font-semibold text-gray-700 tabular-nums">
                          ${total.toFixed(2)}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            anyPending
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {anyPending ? "Pending" : "Approved"}
                        </span>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="border-t border-gray-100 bg-gray-50/50">
                        {/* PurchaseEditor brings its own per-record audit
                            + edit-session gate. Pass username + the
                            shared-with-me hint so writes route to the
                            correct owner directory (mirroring the
                            /purchases page at lines 415-421). */}
                        <PurchaseEditor
                          taskId={task.id}
                          taskType={task.task_type}
                          isSharedWithMe={task.is_shared_with_me ?? false}
                          ownerLabel={task.owner}
                          username={task.owner}
                        />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab C: Funding accounts (SpendingDashboard + FundingAccountsManager)
// ─────────────────────────────────────────────────────────────────────────────

interface FundingTabProps {
  purchaseItems: Array<PurchaseItem & { owner: string }>;
  tasks: Task[];
  projects: Project[];
  fundingAccounts: FundingAccount[];
  selectedProjectIds: string[];
}

function FundingTab({
  purchaseItems,
  tasks,
  projects,
  fundingAccounts,
  selectedProjectIds,
}: FundingTabProps) {
  const [showManager, setShowManager] = useState(false);

  return (
    <div
      className="overflow-y-auto pr-1"
      style={{ maxHeight: "65vh" }}
    >
      <div className="flex items-center justify-end mb-2">
        <button
          type="button"
          onClick={() => setShowManager((v) => !v)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 transition-colors"
        >
          <span aria-hidden="true">{SETTINGS_ICON}</span>
          {showManager ? "Hide funding manager" : "Edit funding accounts"}
        </button>
      </div>
      {showManager && (
        <FundingAccountsManager fundingAccounts={fundingAccounts} />
      )}
      <SpendingDashboard
        purchaseItems={purchaseItems}
        tasks={tasks}
        projects={projects}
        fundingAccounts={fundingAccounts}
        selectedProjectIds={selectedProjectIds}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab D: Spending overview (4-week bar chart + per-category + per-member)
// ─────────────────────────────────────────────────────────────────────────────

interface SpendingOverviewTabProps {
  items: Array<PurchaseItem & { username: string }>;
  profileMap: LabUserProfileMap;
  userColor: Map<string, string>;
  /** Lab-wide tasks (LabTask shape with `username`). Used to bridge each
   *  purchase item to its parent task's start_date (items have no own
   *  timestamp). */
  labTasks: Array<{ id: number; name: string; username: string; start_date: string; project_id: number }>;
}

function SpendingOverviewTab({
  items,
  profileMap,
  userColor,
  labTasks,
}: SpendingOverviewTabProps) {
  // Approved-only predicate matches the SnapshotTile + MetricsWidget so
  // analytics never silently double-count pending requests.
  const approved = useMemo(
    () =>
      items.filter(
        (it) => it.approved === undefined || it.approved === true,
      ),
    [items],
  );

  // Task lookup so we can attribute each item to a date.
  const taskByKey = useMemo(() => {
    const map = new Map<string, (typeof labTasks)[number]>();
    for (const t of labTasks) map.set(`${t.username}:${t.id}`, t);
    return map;
  }, [labTasks]);

  // Last 4 weeks: weekly buckets, oldest -> newest left-to-right.
  const weeklyBuckets = useMemo(() => {
    const buckets: Array<{ label: string; startIso: string; endIso: string; total: number }> = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    // Walk back 4 weeks from today; each bucket is a 7-day window
    // ending on the day BEFORE the next bucket's start, so they don't
    // overlap.
    for (let i = 3; i >= 0; i--) {
      const end = new Date(now);
      end.setDate(end.getDate() - i * 7);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      const startIso = start.toISOString().slice(0, 10);
      const endIso = end.toISOString().slice(0, 10);
      const label = start.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      buckets.push({ label, startIso, endIso, total: 0 });
    }
    for (const it of approved) {
      const t = taskByKey.get(`${it.username}:${it.task_id}`);
      if (!t || !t.start_date) continue;
      const iso = t.start_date.slice(0, 10);
      for (const b of buckets) {
        if (iso >= b.startIso && iso <= b.endIso) {
          b.total += it.total_price ?? 0;
          break;
        }
      }
    }
    return buckets;
  }, [approved, taskByKey]);

  const maxWeekly = useMemo(
    () => Math.max(0, ...weeklyBuckets.map((b) => b.total)),
    [weeklyBuckets],
  );

  // Per-category breakdown. A category is either the funding_string
  // (preferred) or "Uncategorized". The brief asks for the Misc-Project
  // categorization too, but funding string is the more useful axis here
  // because spending overview is about *what bucket the money came
  // from*. We surface project type as a secondary axis later if needed.
  const perCategory = useMemo(() => {
    const totals = new Map<string, number>();
    for (const it of approved) {
      const key = it.funding_string || "Uncategorized";
      totals.set(key, (totals.get(key) ?? 0) + (it.total_price ?? 0));
    }
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [approved]);

  const perCategoryMax = useMemo(
    () => Math.max(0, ...perCategory.map(([, v]) => v)),
    [perCategory],
  );

  // Per-member breakdown.
  const perMember = useMemo(() => {
    const totals = new Map<string, number>();
    for (const it of approved) {
      totals.set(
        it.username,
        (totals.get(it.username) ?? 0) + (it.total_price ?? 0),
      );
    }
    const grand = Array.from(totals.values()).reduce((a, b) => a + b, 0);
    return {
      rows: Array.from(totals.entries()).sort((a, b) => b[1] - a[1]),
      grand,
    };
  }, [approved]);

  if (approved.length === 0) {
    return (
      <EmptyState
        icon={CHART_ICON}
        iconClass="text-gray-400"
        label="No approved spend yet"
        sub="Charts populate once a purchase is approved."
      />
    );
  }

  return (
    <div
      className="space-y-4 overflow-y-auto pr-1"
      style={{ maxHeight: "65vh" }}
    >
      {/* 4-week bar chart */}
      <section className="bg-white border border-gray-200 rounded-lg p-3">
        <header className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-gray-700">
            Last 4 weeks (approved)
          </h4>
          <span className="text-[10px] text-gray-500 tabular-nums">
            Total {formatCompactCurrency(
              weeklyBuckets.reduce((s, b) => s + b.total, 0),
            )}
          </span>
        </header>
        <div className="flex items-end gap-2 h-32" role="img" aria-label="Last 4 weeks spend bar chart">
          {weeklyBuckets.map((b) => {
            const pct = maxWeekly > 0 ? (b.total / maxWeekly) * 100 : 0;
            return (
              <div key={b.startIso} className="flex-1 flex flex-col items-center min-w-0">
                <div className="w-full flex-1 flex items-end">
                  <Tooltip
                    label={`Week of ${b.label}: $${b.total.toFixed(2)}`}
                    placement="top"
                  >
                    <div
                      className="w-full bg-emerald-400 rounded-t"
                      style={{ height: `${Math.max(2, pct)}%` }}
                    />
                  </Tooltip>
                </div>
                <p className="text-[10px] text-gray-500 mt-1 truncate w-full text-center">
                  {b.label}
                </p>
                <p className="text-[10px] text-gray-700 tabular-nums">
                  ${b.total.toFixed(0)}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Per-category */}
      <section className="bg-white border border-gray-200 rounded-lg p-3">
        <header className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-gray-700">
            By funding source
          </h4>
        </header>
        {perCategory.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No data.</p>
        ) : (
          <ul className="space-y-1.5">
            {perCategory.slice(0, 8).map(([name, total]) => {
              const pct =
                perCategoryMax > 0 ? (total / perCategoryMax) * 100 : 0;
              return (
                <li key={name} className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-700 truncate w-32 flex-shrink-0">
                    {name}
                  </span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-400 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-gray-700 tabular-nums w-20 text-right flex-shrink-0">
                    ${total.toFixed(2)}
                  </span>
                </li>
              );
            })}
            {perCategory.length > 8 && (
              <li className="text-[10px] text-gray-400 italic">
                + {perCategory.length - 8} more
              </li>
            )}
          </ul>
        )}
      </section>

      {/* Per-member */}
      <section className="bg-white border border-gray-200 rounded-lg p-3">
        <header className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-gray-700">By member</h4>
          <span className="text-[10px] text-gray-500 tabular-nums">
            Total {formatCompactCurrency(perMember.grand)}
          </span>
        </header>
        {perMember.rows.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No data.</p>
        ) : (
          <ul className="space-y-1.5">
            {perMember.rows.map(([username, total]) => {
              const pct =
                perMember.grand > 0 ? (total / perMember.grand) * 100 : 0;
              const displayName =
                profileMap[username]?.displayName?.trim() || username;
              return (
                <li key={username} className="flex items-center gap-2">
                  <UserAvatar username={username} size="sm" />
                  <span className="text-[11px] text-gray-700 truncate w-24 flex-shrink-0">
                    {displayName}
                  </span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor:
                          userColor.get(username) || "#34d399",
                      }}
                    />
                  </div>
                  <span className="text-[11px] text-gray-700 tabular-nums w-20 text-right flex-shrink-0">
                    ${total.toFixed(2)}{" "}
                    <span className="text-gray-400">
                      ({Math.round(pct)}%)
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers — locked banner, empty state, currency formatting
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

function formatCompactCurrency(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (n >= 100_000) return `$${(n / 1000).toFixed(0)}k`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1_000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SnapshotTile + SidebarTile — UNCHANGED from the Phase B redesign.
// Per the LabPurchases popup expansion brief: "Don't touch the
// SnapshotTile / SidebarTile beyond keeping the existing imports they
// need." Only the ExpandedView (default export) was rebuilt.
// ─────────────────────────────────────────────────────────────────────────────

const PURCHASES_TILE_ICON = (
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
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const PURCHASES_SIDEBAR_ICON = (
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
);

function formatCompactCurrencyPurchases(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (n >= 100_000) return `$${(n / 1000).toFixed(0)}k`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 1_000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

/**
 * SnapshotTile: top 3 funding sources by approved spend, rendered as
 * horizontal progress bars with $-remaining + $-of-budget annotations.
 * The funding picture IS the signal (Phase B redesign).
 */
export function SnapshotTile(_props: SnapshotTileProps) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const { data: items = [], isLoading: itemsLoading } = useQuery<
    Array<PurchaseItem & { username: string }>
  >({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: accountType === "lab_head",
  });
  const { data: fundingAccounts = [], isLoading: fundingLoading } = useQuery<
    FundingAccount[]
  >({
    queryKey: ["funding-accounts"],
    queryFn: purchasesApi.listFundingAccounts,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: accountType === "lab_head",
  });
  if (accountType !== "lab_head") return null;

  const isLoading = itemsLoading || fundingLoading;
  const isApproved = (it: PurchaseItem) =>
    it.approved === undefined || it.approved === true;

  const spentByName = new Map<string, number>();
  for (const it of items) {
    if (!isApproved(it)) continue;
    const key = it.funding_string || "__uncategorized__";
    spentByName.set(key, (spentByName.get(key) ?? 0) + (it.total_price ?? 0));
  }
  const budgetByName = new Map<string, number>();
  for (const acct of fundingAccounts) {
    budgetByName.set(acct.name, acct.total_budget);
  }

  type FundingRow = { name: string; spent: number; budget: number | null };
  const rows: FundingRow[] = [];
  for (const [name, spent] of spentByName.entries()) {
    if (name === "__uncategorized__") continue;
    rows.push({ name, spent, budget: budgetByName.get(name) ?? null });
  }
  rows.sort((a, b) => b.spent - a.spent);
  const top3 = rows.slice(0, 3);

  const pendingCount = items.filter((it) => !isApproved(it)).length;

  return (
    <div className="relative h-full overflow-hidden flex flex-col">
      <div className="flex items-center gap-1.5 text-gray-500">
        <span aria-hidden="true" className="text-emerald-600 flex-shrink-0">
          {PURCHASES_TILE_ICON}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-medium">
          Funding
        </span>
      </div>
      {pendingCount > 0 && (
        <span
          className="absolute top-0 right-0 text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full font-medium"
          aria-label={`${pendingCount} pending`}
        >
          {pendingCount} pending
        </span>
      )}
      <div className="mt-2 flex-1 min-h-0 flex flex-col gap-2">
        {isLoading ? (
          <p className="text-xs text-gray-400 italic m-auto">Loading...</p>
        ) : top3.length === 0 ? (
          <p className="text-xs text-gray-400 italic m-auto">
            No funding sources set
          </p>
        ) : (
          top3.map((row) => {
            const pct =
              row.budget && row.budget > 0
                ? Math.min(150, (row.spent / row.budget) * 100)
                : null;
            const remaining =
              row.budget !== null ? row.budget - row.spent : null;
            const barColor =
              pct === null
                ? "bg-gray-300"
                : pct > 100
                  ? "bg-red-400"
                  : pct > 80
                    ? "bg-amber-400"
                    : "bg-blue-400";
            return (
              <div key={row.name} className="min-w-0">
                <p className="text-xs font-medium text-gray-700 truncate">
                  {row.name}
                </p>
                {pct !== null ? (
                  <>
                    <div
                      className="mt-1 h-2 bg-gray-100 rounded-full overflow-hidden"
                      role="progressbar"
                      aria-valuenow={Math.round(pct)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className={`h-full rounded-full ${barColor}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[10px] text-gray-500 tabular-nums">
                      <span>
                        {remaining !== null && remaining >= 0
                          ? `${formatCompactCurrencyPurchases(remaining)} remaining`
                          : `${formatCompactCurrencyPurchases(Math.abs(remaining ?? 0))} over`}
                      </span>
                      <span>
                        {formatCompactCurrencyPurchases(row.spent)} of{" "}
                        {formatCompactCurrencyPurchases(row.budget ?? 0)}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="mt-0.5 text-[10px] text-gray-500 tabular-nums">
                    {formatCompactCurrencyPurchases(row.spent)} spent · no
                    budget set
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export const ExpandedView = LabPurchasesWidget;

export function SidebarTile({ onClick }: SidebarTileProps) {
  const { currentUser } = useCurrentUser();
  const accountType = useAccountType(currentUser);
  const { data: items = [], isLoading } = useQuery<
    Array<PurchaseItem & { username: string }>
  >({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: accountType === "lab_head",
  });
  if (accountType !== "lab_head") return null;

  const pending = items.filter((it) => !it.approved);
  const pendingValue = pending.reduce((s, it) => s + (it.total_price ?? 0), 0);
  const hasPending = pending.length > 0;

  return (
    <SidebarStatTile
      icon={PURCHASES_SIDEBAR_ICON}
      iconClassName={hasPending ? "text-amber-600" : "text-gray-400"}
      label={hasPending ? "Pending" : "No pending purchases"}
      stat={
        isLoading
          ? "—"
          : hasPending
            ? (
              <span className="inline-flex items-baseline gap-1.5">
                <span>{pending.length}</span>
                <span className="text-[11px] text-gray-500 font-normal">
                  {formatCompactCurrencyPurchases(pendingValue)}
                </span>
              </span>
            )
            : ""
      }
      onClick={onClick}
    />
  );
}

