// sequence editor master (Lab Overview source sub-bot). BeakerSearch step 3, the
// thin HOOK that wires the live Lab Overview page state + handlers into the pure
// buildLabOverviewSource builder and registers the result with the shared
// palette.
//
// All the testable logic lives in lab-overview-beaker-source.ts (no React, no
// store). This hook reads the same React Query caches the page reads (sharing
// each cache by query key so no extra fetch), gates on the role (lab head only,
// returns null otherwise so the provider never merges a Lab Overview source for
// a member), owns the in-palette SELECTED entity + the session-local recent
// actions MRU, closes the handler bag over the real pi-actions / announcement
// handlers + the router + the queryClient invalidations, and calls
// buildLabOverviewSource inside a useMemo so the registration object is stable,
// then useBeakerSearchSource.
//
// The session substitution (the spec's "live PI edit session" does not exist on
// this worktree, the PI capability revamp replaced it with the per-record PI
// edit-confirm gate) is documented in lab-overview-beaker-source.ts. Here the
// inline approve / decline / flag handlers mark the per-record confirm
// (markPiEditConfirmed) BEFORE the write, so the first action on a given owner's
// record is the confirm and the rest write straight through, EXACTLY as
// usePurchasesBeakerSource does. Announcements are author-gated (own only), never
// session-gated.
//
// A few honest simplifications, called out so a reader is not misled:
//   - HOVERED-as-context (Step 4) is wired for the roster MEMBER rows only. The
//     LabRoster row carries data-beaker-target="lab-member:<username>", and the
//     hook resolves the hovered username against the lab users so a hovered member
//     drives the member Suggested when nothing is selected. SELECTED (an in-palette
//     drill) still outranks the hover. Approval / announcement hover does not exist
//     because the page renders no per-item approval LIST (the action bar shows only
//     a COUNT that routes to Purchases), so only member rows are taggable.
//   - A /workbench?user= member view does not exist, so "Open member workload"
//     routes to the lab roster generically (the page's roster section).
//   - BeakerSearch v2 (sub-flow framework, chunk 2). The "Assign a task" and
//     "Flag a record" rows are now MULTI-STAGE in-palette sub-flows (the spec's
//     open question 3, resolved). Assign is pick a task then a member; Flag is
//     pick a record then a reason (a fixed set or free text). The terminal pick
//     runs the real owner-routed assignTask / setFlagForReview here, marking the
//     per-record PI edit-confirm before the write, EXACTLY as the inline approve /
//     decline / flag-approval handlers do. No page surface, no modal.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { labApi } from "@/lib/local-api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountType } from "@/hooks/useAccountType";
import { useLabData } from "@/hooks/useLabData";
import {
  useLabUserProfileMap,
  LAB_USER_PROFILES_QUERY_KEY,
} from "@/hooks/useLabUserProfiles";
import { useArchivedUsers, ARCHIVED_USERS_QUERY_KEY } from "@/hooks/useArchivedUsers";
import { LAB_ANNOUNCEMENTS_QUERY_KEY } from "@/components/lab-overview/widgets/AnnouncementsWidget";
import {
  setPurchaseApproval,
  declinePurchase,
  setFlagForReview,
  assignTask as assignTaskAction,
  purgeAnnouncementNotifications,
  refreshAnnouncementNotifications,
} from "@/lib/lab/pi-actions";
import {
  deleteAnnouncement as deleteAnnouncementApi,
  updateAnnouncement,
  listAnnouncements,
  type AnnouncementEntry,
} from "@/lib/lab/announcements";
import { archiveUser, restoreUser } from "@/lib/lab/user-archive";
import { markPiEditConfirmed, piEditKey } from "@/lib/lab/pi-edit-guard";
import { useBeakerSearchSource } from "@/components/beaker-search/useBeakerSearchSource";
import { useBeakerHoveredKey } from "@/components/beaker-search/BeakerSearchProvider";
import { parseBeakerTargetKey } from "@/components/beaker-search/beaker-hover";
import { isPurchasePending, type PurchaseItem } from "@/lib/types";
import {
  buildLabOverviewSource,
  type LabOverviewApproval,
  type LabOverviewAnnouncement,
  type LabOverviewMember,
  type LabOverviewRecentAction,
  type LabOverviewSelection,
  type LabOverviewSourceData,
  type LabOverviewSourceHandlers,
  type LabOverviewTask,
} from "./lab-overview-beaker-source";

/** A "$1,234.56" money string (mirrors the Purchases source's money helper). */
function money(n: number | null | undefined): string {
  return `$${(n ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** A short single-line preview of an announcement body for the nav rows. */
function previewOf(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
}

/** How many recent PI actions the MRU keeps. */
const RECENT_ACTIONS_CAP = 5;

/** The page-owned UI state + setters the source drives. LabOverviewPage threads
 *  these in (the project-create opener it already owns), mirroring the other
 *  per-page source hooks. */
export interface UseLabOverviewBeakerSourceArgs {
  /** Open the New project modal (the page's NewProjectButton flow). */
  openProjectCreate: () => void;
  /** Scroll to / focus the embedded lab roster section. */
  scrollToRoster: () => void;
  router: { push: (href: string) => void };
}

/** Register the Lab Overview page's BeakerSearch source while the page is
 *  mounted, lab head only. Call once from LabOverviewPage after its reads. */
export function useLabOverviewBeakerSource(
  args: UseLabOverviewBeakerSourceArgs,
): void {
  const queryClient = useQueryClient();
  const { currentUser: providerCurrentUser } = useCurrentUser();
  const currentUser = providerCurrentUser ?? "";

  const accountType = useAccountType(currentUser || null);
  const isLabHead = accountType === "lab_head";

  // ── Queries, mirroring the page's keys so the cache is shared (no refetch). ─
  const { users, tasks, projects } = useLabData();
  const profileMap = useLabUserProfileMap();
  const archivedSet = useArchivedUsers();

  const { data: labPurchaseItems = [] } = useQuery<
    Array<PurchaseItem & { username: string }>
  >({
    queryKey: ["lab", "purchase-items"],
    queryFn: () => labApi.getAllPurchaseItems(),
    enabled: isLabHead,
  });

  const { data: announcementEntries = [] } = useQuery<AnnouncementEntry[]>({
    queryKey: LAB_ANNOUNCEMENTS_QUERY_KEY,
    queryFn: listAnnouncements,
    enabled: isLabHead,
  });

  const { data: sharedNotes = [] } = useQuery({
    queryKey: ["lab", "notes-shared"],
    queryFn: () => labApi.getNotes({ shared_only: true }),
    enabled: isLabHead,
  });

  // ── Derived inbox snapshot (mirrors useActionBarCounts on the page). ──────
  const pending = useMemo(
    () => labPurchaseItems.filter(isPurchasePending).length,
    [labPurchaseItems],
  );

  const flagged = useMemo(() => {
    if (!currentUser) return 0;
    let count = 0;
    for (const t of tasks as Array<(typeof tasks)[number] & { flagged?: { by: string } | null }>) {
      if (t.flagged?.by === currentUser) count++;
    }
    for (const it of labPurchaseItems) {
      if (it.flagged?.by === currentUser) count++;
    }
    return count;
  }, [tasks, labPurchaseItems, currentUser]);

  const mentions = useMemo(() => {
    if (!currentUser) return 0;
    let count = 0;
    for (const n of sharedNotes) {
      for (const c of n.comments ?? []) {
        if ((c.mentions ?? []).includes(currentUser)) count++;
      }
    }
    return count;
  }, [sharedNotes, currentUser]);

  // ── Members (display name + workload counts + archived). The jump list shows
  // ACTIVE members; an archived member only surfaces once drilled into (so the
  // Restore row appears). Mirrors the roster's active-first view. ────────────
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const members = useMemo<LabOverviewMember[]>(() => {
    const byUser = new Map<string, { open: number; overdue: number }>();
    for (const t of tasks) {
      if (t.is_complete) continue;
      const slot = byUser.get(t.username) ?? { open: 0, overdue: 0 };
      slot.open += 1;
      if (t.end_date && t.end_date < todayIso) slot.overdue += 1;
      byUser.set(t.username, slot);
    }
    return users
      .filter((u) => !archivedSet.has(u.username))
      .map((u) => {
        const counts = byUser.get(u.username) ?? { open: 0, overdue: 0 };
        return {
          username: u.username,
          displayName: profileMap[u.username]?.displayName || u.username,
          openTasks: counts.open,
          overdueTasks: counts.overdue,
          archived: false,
        };
      });
  }, [users, tasks, archivedSet, profileMap, todayIso]);

  // ── Pending approvals (owner-decorated; the username field is the owner). ──
  const pendingApprovals = useMemo<LabOverviewApproval[]>(
    () =>
      labPurchaseItems.filter(isPurchasePending).map((it) => ({
        id: it.id,
        owner: it.username,
        itemName: it.item_name,
        priceLabel: money(it.total_price),
      })),
    [labPurchaseItems],
  );

  // ── Assignable tasks (the assign sub-flow's stage 1, owner-decorated, fuzzy by
  // name + project). Owner is the task username; the project name is resolved from
  // the lab projects by id + owner (project ids are owner-namespaced). Completed
  // tasks are dropped so the picker offers live work only. ───────────────────
  const assignableTasks = useMemo<LabOverviewTask[]>(() => {
    const projectName = new Map<string, string>();
    for (const p of projects) {
      projectName.set(`${p.username}:${p.id}`, p.name);
    }
    return tasks
      .filter((t) => !t.is_complete)
      .map((t) => ({
        id: t.id,
        name: t.name,
        owner: t.username,
        projectName: projectName.get(`${t.username}:${t.project_id}`),
      }));
  }, [tasks, projects]);

  // ── Announcements (newest-first, with a single-line preview). ─────────────
  const announcements = useMemo<LabOverviewAnnouncement[]>(
    () =>
      announcementEntries.map((a) => ({
        id: a.id,
        author: a.author,
        preview: previewOf(a.text),
        pinned: !!a.pinned,
      })),
    [announcementEntries],
  );

  // ── HOVERED. The roster row the cursor was over when the palette opened (null
  // while closed). Parse its data-beaker-target key the way LabRoster stamps it
  // ("lab-member:<username>"), then resolve to the live member. SELECTED still
  // outranks this in the builder, so an in-palette drill wins over a stale hover.
  // An archived member is resolvable too (so the hovered path can offer Restore),
  // so this resolves against the full roster, not just the active jump list. ──
  const hoveredKey = useBeakerHoveredKey();
  const hovered = useMemo<LabOverviewSourceData["hovered"]>(() => {
    const parsed = parseBeakerTargetKey(hoveredKey);
    if (!parsed || parsed.kind !== "lab-member") return null;
    const active = members.find((m) => m.username === parsed.key);
    if (active) return { kind: "member", member: active };
    const archivedUser = users.find((u) => u.username === parsed.key);
    if (!archivedUser || !archivedSet.has(archivedUser.username)) return null;
    let open = 0;
    let overdue = 0;
    for (const t of tasks) {
      if (t.is_complete || t.username !== archivedUser.username) continue;
      open += 1;
      if (t.end_date && t.end_date < todayIso) overdue += 1;
    }
    return {
      kind: "member",
      member: {
        username: archivedUser.username,
        displayName: profileMap[archivedUser.username]?.displayName || archivedUser.username,
        openTasks: open,
        overdueTasks: overdue,
        archived: true,
      },
    };
  }, [hoveredKey, members, users, archivedSet, tasks, todayIso, profileMap]);

  // ── In-palette selection + the recent-actions MRU (session-local). ────────
  const [selected, setSelected] = useState<LabOverviewSelection>(null);
  const [recentActions, setRecentActions] = useState<LabOverviewRecentAction[]>(
    [],
  );
  // A monotonic id counter for the MRU rows, mirroring the Purchases hook's
  // exportSeq. Bumped alongside the list append so each row carries a stable id.
  const [actionSeq, setActionSeq] = useState(0);

  const pushRecent = useCallback(
    (entry: Omit<LabOverviewRecentAction, "id">) => {
      const nextSeq = actionSeq + 1;
      setActionSeq(nextSeq);
      setRecentActions((prev) =>
        [{ id: String(nextSeq), ...entry }, ...prev].slice(0, RECENT_ACTIONS_CAP),
      );
    },
    [actionSeq],
  );

  const refetch = useCallback(
    (queryKey: readonly (string | number)[]) =>
      queryClient.refetchQueries({ queryKey: [...queryKey] }),
    [queryClient],
  );

  // ── Handlers (real apis + the PI edit-confirm + invalidations). ───────────
  const handlers = useMemo<LabOverviewSourceHandlers>(() => {
    return {
      selectMember: (member) => setSelected({ kind: "member", member }),
      selectApproval: (approval) => setSelected({ kind: "approval", approval }),
      selectAnnouncement: (announcement) =>
        setSelected({ kind: "announcement", announcement }),

      approveApproval: (a) => {
        // The first approve IS the PI edit-confirm for this owner's record.
        markPiEditConfirmed(piEditKey(a.owner, "purchase", a.id));
        void setPurchaseApproval({
          actor: currentUser,
          targetOwner: a.owner,
          purchaseItemId: a.id,
          approved: true,
          itemName: a.itemName,
        }).then(() => {
          void refetch(["lab", "purchase-items"]);
          void refetch(["purchases-all"]);
        });
        pushRecent({
          label: `Approved "${a.itemName}"`,
          detail: a.owner,
          kind: "approve",
        });
      },
      declineApproval: (a) => {
        markPiEditConfirmed(piEditKey(a.owner, "purchase", a.id));
        void declinePurchase({
          actor: currentUser,
          targetOwner: a.owner,
          purchaseItemId: a.id,
          itemName: a.itemName,
        }).then(() => {
          void refetch(["lab", "purchase-items"]);
          void refetch(["purchases-all"]);
        });
        pushRecent({
          label: `Declined "${a.itemName}"`,
          detail: a.owner,
          kind: "decline",
        });
      },
      approveAllPending: () => {
        for (const a of pendingApprovals) {
          markPiEditConfirmed(piEditKey(a.owner, "purchase", a.id));
          void setPurchaseApproval({
            actor: currentUser,
            targetOwner: a.owner,
            purchaseItemId: a.id,
            approved: true,
            itemName: a.itemName,
          });
        }
        void refetch(["lab", "purchase-items"]);
        void refetch(["purchases-all"]);
        pushRecent({
          label: `Approved all pending (${pendingApprovals.length})`,
          detail: "across the lab",
          kind: "approve",
        });
      },
      flagApproval: (a) => {
        markPiEditConfirmed(piEditKey(a.owner, "purchase", a.id));
        void setFlagForReview({
          actor: currentUser,
          targetOwner: a.owner,
          recordType: "purchase_item",
          recordId: a.id,
          flag: { by: currentUser, at: new Date().toISOString() },
          recordName: a.itemName,
        }).then(() => {
          void refetch(["lab", "purchase-items"]);
          void refetch(["purchases-all"]);
        });
        pushRecent({
          label: `Flagged "${a.itemName}"`,
          detail: a.owner,
          kind: "flag",
        });
      },

      // ── The two MULTI-STAGE sub-flow terminal writes. Each marks the per-record
      // PI edit-confirm before the owner-routed pi-action, EXACTLY as the inline
      // approve / decline / flag-approval handlers do. ──────────────────────────
      assignTask: (task, assignee) => {
        // The first assign IS the PI edit-confirm for this owner's task record.
        markPiEditConfirmed(piEditKey(task.owner, "task", task.id));
        void assignTaskAction({
          actor: currentUser,
          sessionId: undefined,
          targetOwner: task.owner,
          taskId: task.id,
          assignee,
          taskName: task.name,
        }).then(() => {
          void refetch(["lab", "tasks"]);
          void refetch(["tasks"]);
        });
        pushRecent({
          label: `Assigned "${task.name}" to ${assignee}`,
          detail: task.owner,
          kind: "assign",
        });
      },
      flagRecord: (record, flag) => {
        markPiEditConfirmed(piEditKey(record.owner, "purchase", record.id));
        void setFlagForReview({
          actor: currentUser,
          sessionId: undefined,
          targetOwner: record.owner,
          recordType: "purchase_item",
          recordId: record.id,
          flag: { by: currentUser, at: new Date().toISOString(), reason: flag },
          recordName: record.itemName,
        }).then(() => {
          void refetch(["lab", "purchase-items"]);
          void refetch(["purchases-all"]);
        });
        pushRecent({
          label: `Flagged "${record.itemName}"`,
          detail: `${record.owner}, ${flag}`,
          kind: "flag",
        });
      },

      openAnnouncementComposer: () => args.scrollToRoster(),
      editAnnouncement: (an) => {
        // Editing the body needs the inline card editor; the palette routes the
        // PI to the Announcements section where the editor lives.
        args.scrollToRoster();
        void an;
      },
      togglePinAnnouncement: (an) => {
        void updateAnnouncement({
          id: an.id,
          author: currentUser,
          pinned: !an.pinned,
        }).then((updated) => {
          if (updated) {
            void refreshAnnouncementNotifications({
              excludeAuthor: currentUser,
              announcementId: an.id,
              text: an.preview,
            });
          }
          void refetch(LAB_ANNOUNCEMENTS_QUERY_KEY);
        });
      },
      deleteAnnouncement: (an) => {
        if (
          typeof window !== "undefined" &&
          !window.confirm("Delete this announcement?")
        ) {
          return;
        }
        void deleteAnnouncementApi({ id: an.id, author: currentUser }).then(
          (ok) => {
            if (ok) {
              void purgeAnnouncementNotifications({
                excludeAuthor: currentUser,
                announcementId: an.id,
              });
            }
            void refetch(LAB_ANNOUNCEMENTS_QUERY_KEY);
          },
        );
      },

      archiveMember: (m) => {
        void archiveUser(m.username, currentUser).then(() => {
          void refetch(ARCHIVED_USERS_QUERY_KEY);
          void refetch(LAB_USER_PROFILES_QUERY_KEY);
          void refetch(["lab", "users"]);
        });
        setSelected(null);
      },
      restoreMember: (m) => {
        void restoreUser(m.username, currentUser).then(() => {
          void refetch(ARCHIVED_USERS_QUERY_KEY);
          void refetch(LAB_USER_PROFILES_QUERY_KEY);
          void refetch(["lab", "users"]);
        });
        setSelected(null);
      },
      openRoster: () => args.scrollToRoster(),

      openProjectCreate: () => args.openProjectCreate(),

      openApprovalOnPurchases: () => args.router.push("/purchases"),
      openPurchasesApprovalQueue: () => args.router.push("/purchases"),
      openLabInbox: () => args.router.push("/lab-inbox"),
      openLabExperiments: () => args.router.push("/lab-experiments"),
      openLabNotes: () => args.router.push("/lab-notes"),

      reopenRecentAction: () => args.router.push("/purchases"),
    };
  }, [args, currentUser, refetch, pendingApprovals, pushRecent]);

  const source = useMemo(() => {
    if (!isLabHead) return null;
    const data: LabOverviewSourceData = {
      members,
      pendingApprovals,
      tasks: assignableTasks,
      announcements,
      pending,
      flagged,
      mentions,
      currentUser,
      selected,
      hovered,
    };
    return buildLabOverviewSource(data, handlers, recentActions);
  }, [
    isLabHead,
    members,
    pendingApprovals,
    assignableTasks,
    announcements,
    pending,
    flagged,
    mentions,
    currentUser,
    selected,
    hovered,
    handlers,
    recentActions,
  ]);

  useBeakerSearchSource(source);
}
