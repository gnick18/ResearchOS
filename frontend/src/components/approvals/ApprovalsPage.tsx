"use client";

// PI-Mode Approvals page (AP-1..AP-3, Grant approved 2026-06-13).
//
// One unified inbox for everything that needs the PI's sign-off:
//   - Pending purchase / supplies approvals across the lab, grouped by order with
//     inline approve / decline (AP-1, AP-2). Reuses OrdersApprovalsLens wholesale.
//   - The flag queue: records the PI flagged for a member to review, with a clear
//     action once it is resolved (AP-3, the flag queue joins the same inbox).
//
// Reuses the existing capability layer: labApi.getAllPurchaseItems + useLabData
// for the queue data, OrdersApprovalsLens for the purchase half, and
// pi-actions.setFlagForReview to clear a flag.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsLabHead } from "@/hooks/useIsLabHead";
import { useLabData } from "@/hooks/useLabData";
import { useLabUserProfileMap } from "@/hooks/useLabUserProfiles";
import { labApi } from "@/lib/local-api";
import { setFlagForReview } from "@/lib/lab/pi-actions";
import type { PiFlag } from "@/lib/types";
import OrdersApprovalsLens, {
  isPendingApproval,
  type LabPurchaseItem,
} from "@/components/supplies/OrdersApprovalsLens";
import UserAvatar from "@/components/UserAvatar";
import { Icon } from "@/components/icons";

type FlagRecordType = "task" | "note" | "purchase_item";

interface FlaggedRecord {
  recordType: FlagRecordType;
  recordId: number;
  owner: string;
  name: string;
  reason: string | null;
  at: string;
}

const TYPE_LABEL: Record<FlagRecordType, string> = {
  task: "Experiment / task",
  note: "Note",
  purchase_item: "Purchase",
};

const PURCHASE_ITEMS_KEY = ["lab", "purchase-items"] as const;
const NOTES_SHARED_KEY = ["lab", "notes-shared"] as const;

export default function ApprovalsPage() {
  const { currentUser } = useCurrentUser();
  const isLabHead = useIsLabHead(currentUser);
  const queryClient = useQueryClient();
  const { tasks } = useLabData();
  const profiles = useLabUserProfileMap();

  const { data: purchaseItems = [] } = useQuery({
    queryKey: PURCHASE_ITEMS_KEY,
    queryFn: () => labApi.getAllPurchaseItems() as Promise<LabPurchaseItem[]>,
  });
  const { data: sharedNotes = [] } = useQuery({
    queryKey: NOTES_SHARED_KEY,
    queryFn: () => labApi.getNotes({ shared_only: true }),
  });

  const refetchAll = () => {
    void queryClient.invalidateQueries({ queryKey: PURCHASE_ITEMS_KEY });
    void queryClient.invalidateQueries({ queryKey: NOTES_SHARED_KEY });
    void queryClient.invalidateQueries({ queryKey: ["lab", "tasks"] });
  };

  const pendingCount = useMemo(
    () => purchaseItems.filter(isPendingApproval).length,
    [purchaseItems],
  );

  // The flag queue: every record THIS PI flagged that is still flagged. Gathered
  // from the three flaggable record types (task / note / purchase), all keyed by
  // the embedded PiFlag whose `by` is the current PI.
  const flagged = useMemo<FlaggedRecord[]>(() => {
    if (!currentUser) return [];
    const out: FlaggedRecord[] = [];
    for (const t of tasks) {
      // LabTask is a slim projection that omits `flagged` from its type, but the
      // runtime record carries it (same cast the Lab Overview action bar uses).
      const flag = (t as { flagged?: PiFlag | null }).flagged;
      if (flag?.by === currentUser) {
        out.push({
          recordType: "task",
          recordId: t.id,
          owner: t.username,
          name: t.name,
          reason: flag.reason ?? null,
          at: flag.at,
        });
      }
    }
    for (const n of sharedNotes) {
      if (n.flagged?.by === currentUser) {
        out.push({
          recordType: "note",
          recordId: n.id,
          owner: n.username,
          name: n.title,
          reason: n.flagged.reason ?? null,
          at: n.flagged.at,
        });
      }
    }
    for (const p of purchaseItems) {
      if (p.flagged?.by === currentUser) {
        out.push({
          recordType: "purchase_item",
          recordId: p.id,
          owner: p.username,
          name: p.item_name,
          reason: p.flagged.reason ?? null,
          at: p.flagged.at,
        });
      }
    }
    // Most recently flagged first.
    return out.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [tasks, sharedNotes, purchaseItems, currentUser]);

  const [clearing, setClearing] = useState<string | null>(null);

  const clearFlag = async (rec: FlaggedRecord) => {
    if (!currentUser) return;
    const key = `${rec.recordType}:${rec.owner}:${rec.recordId}`;
    setClearing(key);
    try {
      await setFlagForReview({
        actor: currentUser,
        targetOwner: rec.owner,
        recordType: rec.recordType,
        recordId: rec.recordId,
        flag: null,
        recordName: rec.name,
      });
      refetchAll();
    } catch (e) {
      console.error("[Approvals] clear flag failed", e);
      window.alert("Could not clear the flag. See console.");
    } finally {
      setClearing(null);
    }
  };

  if (isLabHead === false) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-meta text-foreground-muted">
          Approvals is the lab head&apos;s queue. Sign in as the PI to review
          requests and flags.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-5 space-y-1">
        <h1 className="flex items-center gap-2 text-title font-semibold text-foreground">
          <Icon name="receipt" className="h-5 w-5" />
          Approvals
        </h1>
        <p className="text-meta text-foreground-muted leading-relaxed">
          Everything that needs your sign-off in one place. Approve or decline
          purchase requests, and clear the records you flagged once a member has
          addressed them.
        </p>
      </div>

      {/* AP-1 / AP-2: pending purchase + supplies approvals. */}
      <section className="mb-8">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-body font-medium text-foreground">
            Pending requests
          </h2>
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-meta font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              {pendingCount}
            </span>
          )}
        </div>
        {pendingCount === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-3 text-meta text-foreground-muted">
            No purchase requests waiting. You are all caught up.
          </p>
        ) : (
          <OrdersApprovalsLens
            items={purchaseItems}
            tasks={tasks}
            actor={currentUser ?? ""}
            onChanged={refetchAll}
          />
        )}
      </section>

      {/* AP-3: the flag queue, joined into the same inbox. */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-body font-medium text-foreground">
            Records you flagged
          </h2>
          {flagged.length > 0 && (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-meta font-semibold text-rose-800 dark:bg-rose-500/15 dark:text-rose-300">
              {flagged.length}
            </span>
          )}
        </div>
        {flagged.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-3 text-meta text-foreground-muted">
            Nothing flagged. When you flag a member&apos;s record for review, it
            shows here until you clear it.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {flagged.map((rec) => {
              const key = `${rec.recordType}:${rec.owner}:${rec.recordId}`;
              const ownerLabel =
                profiles[rec.owner]?.displayName?.trim() || rec.owner;
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-center gap-3 bg-surface px-4 py-3"
                >
                  <UserAvatar username={rec.owner} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-body font-medium text-foreground">
                        {rec.name}
                      </span>
                      <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-meta font-medium text-foreground-muted">
                        {TYPE_LABEL[rec.recordType]}
                      </span>
                    </div>
                    <div className="mt-0.5 text-meta text-foreground-muted">
                      {ownerLabel}
                      {rec.reason ? ` · ${rec.reason}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={clearing === key}
                    onClick={() => void clearFlag(rec)}
                    className="shrink-0 rounded-md border border-border px-3 py-1.5 text-meta font-semibold text-foreground hover:bg-surface-sunken disabled:opacity-50"
                  >
                    {clearing === key ? "Clearing…" : "Clear flag"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
