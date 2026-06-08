// sequence editor master (Lab Overview source sub-bot). BeakerSearch step 3, a
// per-page SOURCE, the Lab Overview page.
//
// This module is the PURE builder behind the Lab Overview BeakerSearch
// registration. It takes a plain snapshot of the page state (lab members, the
// pending purchase approvals, assignable tasks, announcements, the inbox
// snapshot counts, the in-palette selection, and the role signal) plus a bag of
// handler callbacks, and returns one BeakerSearchSource (context card +
// commands + suggested ids + nav groups). It reads NO store, holds NO React,
// and calls NO Date.now(), so the context-card copy, the command ids / groups /
// enabled gating, the Suggested ordering, and the nav groups are all unit-tested
// without rendering. The thin useLabOverviewBeakerSource hook (co-located) wires
// the live queries + handlers into this builder inside a useMemo.
//
// IMPORTANT, the spec is partly STALE. docs/proposals/beakersearch-lab-overview.md
// was written before the PI capability revamp (2026-06-07). The OLD timed
// edit-session model it describes (useLiveEditSession, start/end/extendEditSession,
// "4:12 left", LabHeadPasswordModal, "Unlock edit mode", a session line on the
// card) NO LONGER EXISTS. The current Lab Overview is a curated hub. This builder
// is built to the CURRENT page + the GRANT-APPROVED mockup
// (docs/mockups/beakersearch-lab-overview-palette.html), NOT the session model.
// The PI capability revamp replaced the password + live-session with a
// once-per-record CONFIRM gate (pi-edit-guard). So the inline approve / decline /
// assign / flag run through that confirm (the first action on an owner record
// confirms it), and the announcements composer is AUTHOR-gated, never
// session-gated. There is NO session line on the context card and no
// "Unlock edit mode" headline anywhere.
//
// The whole source only exists for a lab head (the route bounces a member). The
// hook returns null for a member so the provider never merges it. This builder
// is only ever called for a lab head.
//
// Voice in comments and copy, no em-dashes, no en-dashes, no emojis, no
// mid-sentence colons.

import type { IconName } from "@/components/icons";
import type { BeakerSearchSource } from "@/components/beaker-search/types";
import type {
  EditorCommand,
  PaletteContextCard,
  PaletteNavGroup,
  PaletteNavItem,
  PaletteSubflow,
} from "@/components/sequences/editor-commands";

// ── Page-defined command groups ────────────────────────────────────────────
// These print between the page's nav groups and the global "Go to" / "App"
// layer, in first-appearance order (see editor-commands commandGroupOrder).
export const LAB_OVERVIEW_GROUP_SELECTED = "Selected";
export const LAB_OVERVIEW_GROUP_APPROVALS = "Approvals";
export const LAB_OVERVIEW_GROUP_ASSIGN = "Task assignment";
export const LAB_OVERVIEW_GROUP_FLAG = "Flag for review";
export const LAB_OVERVIEW_GROUP_ANNOUNCEMENTS = "Announcements";
export const LAB_OVERVIEW_GROUP_MEMBERS = "Members";
export const LAB_OVERVIEW_GROUP_CREATE = "Create";
export const LAB_OVERVIEW_GROUP_NAVIGATE = "Navigate";

// Above this many pending approvals, the per-item approve / decline rows
// collapse into "Approve all pending (N)" so Suggested never balloons (mockup
// + the stale spec's 3.3 collapse rule, kept on the curated page).
const PENDING_COLLAPSE_THRESHOLD = 4;

// The registry has no "megaphone" / "inbox" / "cart" / "flag" glyph (icon-guard
// blocks new inline svg), so reuse registered glyphs. "users" reads as members /
// the lab, "userPlus" as assign, "book" as an announcement, "alert" as a flag /
// the inbox attention, "box" as a purchase order (mirrors Purchases ICON_ORDER),
// "check" an approval, "close" a decline, "plus" a create, "eye" an open, the
// rest are literal.
const ICON_LAB: IconName = "users";
const ICON_MEMBER: IconName = "users";
const ICON_APPROVE: IconName = "check";
const ICON_DECLINE: IconName = "close";
const ICON_ASSIGN: IconName = "userPlus";
const ICON_FLAG: IconName = "alert";
const ICON_ANNOUNCEMENT: IconName = "book";
const ICON_INBOX: IconName = "alert";
const ICON_APPROVAL_ITEM: IconName = "box";
const ICON_NEW: IconName = "plus";
const ICON_OPEN: IconName = "eye";
const ICON_SECTION: IconName = "list";

// BeakerSearch v2 (sub-flow framework, chunk 2). The fixed flag-reason set the
// flag-a-record sub-flow's stage 2 offers, named once so the picker + tests share
// the same labels. A typed query that matches none of these completes via
// onSubmitRaw with the raw text as the flag.
const LAB_OVERVIEW_FLAG_REASONS: { id: string; label: string; detail: string }[] = [
  { id: "needs-receipt", label: "Needs a receipt", detail: "ask the owner to attach proof of purchase" },
  { id: "over-budget", label: "Check the budget", detail: "confirm there is funding for this" },
  { id: "duplicate", label: "Possible duplicate", detail: "we may already have this" },
  { id: "clarify", label: "Needs clarification", detail: "ask the owner for more detail" },
];

// ── The plain entity snapshots the builder reads (decorated with owner) ──────

/** A lab member, from the lab roster, decorated with a display name + workload
 *  counts + archived flag. `username` is lab-wide (no owner namespacing). */
export interface LabOverviewMember {
  username: string;
  /** Human display name (falls back to username at the call site). */
  displayName: string;
  /** Open (incomplete) tasks owned by this member. */
  openTasks: number;
  /** Overdue (past end_date, incomplete) tasks owned by this member. */
  overdueTasks: number;
  /** True when the member is archived (drives the Restore vs Archive choice). */
  archived: boolean;
}

/** An assignable lab task, from useLabData().tasks. `owner` is the task OWNER
 *  (the targetOwner assignTask routes to). `id` is the numeric task id in the
 *  owner's namespace. `projectName` is the owning project's name (resolved in the
 *  hook) for the fuzzy match + the picker detail line, undefined when standalone. */
export interface LabOverviewTask {
  id: number;
  name: string;
  owner: string;
  /** The owning project's name, for the fuzzy match + detail. Undefined when the
   *  task is standalone (no project). */
  projectName?: string;
}

/** A pending purchase approval, from labApi.getAllPurchaseItems() filtered by
 *  isPurchasePending. `owner` is the item OWNER (the targetOwner pi-actions
 *  needs). `id` is the numeric purchase_item id in the owner's namespace. */
export interface LabOverviewApproval {
  id: number;
  owner: string;
  itemName: string;
  /** Pre-formatted "$89.00" price string (the builder never re-formats money). */
  priceLabel: string;
}

/** A lab-wide announcement, from listAnnouncements(). The composer is PI-only
 *  and author-gated (own only), never session-gated. */
export interface LabOverviewAnnouncement {
  id: string;
  author: string;
  /** A short preview of the body, for the nav detail line. */
  preview: string;
  pinned: boolean;
}

// ── The in-palette SELECTED entity (the mockup's selection-aware Suggested) ──
// Lab Overview has no inline record selection (it is a feed-and-sections hub).
// SELECTED therefore maps to an entity the PI picks INSIDE the palette via a
// NAVIGATE drill (a member, a pending approval, an own announcement), which then
// re-drives Suggested. Null at rest.
export type LabOverviewSelection =
  | { kind: "member"; member: LabOverviewMember }
  | { kind: "approval"; approval: LabOverviewApproval }
  | { kind: "announcement"; announcement: LabOverviewAnnouncement }
  | null;

// ── A captured recent PI action (the session-local MRU, the "Recent actions"
// group). Reopen routes the PI back to the target. ──────────────────────────
export interface LabOverviewRecentAction {
  /** Stable id minted per run by the hook. */
  id: string;
  /** What the PI did, e.g. 'Approved "Falcon tubes"'. */
  label: string;
  /** Owner + a relative-time-free echo, e.g. "morgan". The hook supplies any
   *  time text; the builder never calls Date.now(). */
  detail: string;
  /** Which inline action it was (drives the row tone + icon). */
  kind: "approve" | "decline" | "flag" | "assign";
}

// ── The plain state snapshot the builder reads ─────────────────────────────
export interface LabOverviewSourceData {
  /** Active lab members (archived filtered out by the hook for the jump list,
   *  but the full set is passed so an archived member drilled into still offers
   *  Restore). The hook passes the display-ready list. */
  members: LabOverviewMember[];
  /** Every pending purchase approval across the lab, owner-decorated. */
  pendingApprovals: LabOverviewApproval[];
  /** Every assignable lab task across the lab, owner-decorated (the assign
   *  sub-flow's stage 1, fuzzy by name + project). */
  tasks: LabOverviewTask[];
  /** Lab-wide announcements, newest-first. */
  announcements: LabOverviewAnnouncement[];

  // The inbox snapshot (useActionBarCounts), for the context-card line.
  pending: number;
  flagged: number;
  mentions: number;

  // Role + identity.
  currentUser: string;

  // The in-palette selection (mockup selection-aware Suggested). Null at rest.
  selected: LabOverviewSelection;

  // The hovered member (HOVERED). The roster row the cursor was over when the
  // palette opened, resolved by the hook from the data-beaker-target key
  // ("lab-member:<username>"). SELECTED always outranks this, so an in-palette
  // drill wins over a stale hover. Null when nothing tagged was under the
  // pointer. Only member rows are taggable on this page (the page renders no
  // per-item approval LIST, so approval / announcement hover does not exist).
  hovered: { kind: "member"; member: LabOverviewMember } | null;
}

// ── The handler bag (closures over the page's real handlers + invalidations) ─
export interface LabOverviewSourceHandlers {
  // In-palette selection (a NAVIGATE drill sets these; clearing returns to the
  // resting Suggested).
  selectMember: (member: LabOverviewMember) => void;
  selectApproval: (approval: LabOverviewApproval) => void;
  selectAnnouncement: (announcement: LabOverviewAnnouncement) => void;

  // Inline PI actions. Each wraps the real pi-actions call + the PI edit-confirm
  // (markPiEditConfirmed before the write) + the spec invalidation keys; the
  // builder never calls an api.
  approveApproval: (approval: LabOverviewApproval) => void;
  declineApproval: (approval: LabOverviewApproval) => void;
  /** Approve every pending approval across the lab, owner-routed per item. */
  approveAllPending: () => void;
  /** Flag a pending approval's purchase item for review. */
  flagApproval: (approval: LabOverviewApproval) => void;

  // Assignment + flag terminal writes (the multi-stage sub-flows' final picks).
  // Each wraps the real owner-routed pi-action + the per-record PI edit-confirm
  // (markPiEditConfirmed before the write, the same gate the approve / decline /
  // flag-approval handlers use) + the spec invalidations; the builder never calls
  // an api. The mockup's "Assign a task" / "Flag a record" rows drive these.
  /** Assign a picked task to a picked member (owner-routed, with the confirm). */
  assignTask: (task: LabOverviewTask, assignee: string) => void;
  /** Flag a picked record for review with a picked / typed reason (owner-routed,
   *  with the confirm). `record` is the flaggable record (a pending approval). */
  flagRecord: (record: LabOverviewApproval, flag: string) => void;

  // Announcements (author-gated, NOT session-gated). The composer + own-entry
  // edit / pin / delete.
  openAnnouncementComposer: () => void;
  editAnnouncement: (announcement: LabOverviewAnnouncement) => void;
  togglePinAnnouncement: (announcement: LabOverviewAnnouncement) => void;
  deleteAnnouncement: (announcement: LabOverviewAnnouncement) => void;

  // Members (UI-gated, mirrors the roster rule).
  archiveMember: (member: LabOverviewMember) => void;
  restoreMember: (member: LabOverviewMember) => void;
  openRoster: () => void;

  // Create.
  openProjectCreate: () => void;

  // Navigate out.
  openApprovalOnPurchases: (approval: LabOverviewApproval) => void;
  openPurchasesApprovalQueue: () => void;
  openLabInbox: () => void;
  openLabExperiments: () => void;
  openLabNotes: () => void;

  // Reopen a recent action (the MRU rows).
  reopenRecentAction: (action: LabOverviewRecentAction) => void;
}

// ── Context card (mockup, no session line) ──────────────────────────────────

/** The inbox snapshot line, e.g. "3 approvals, 2 flagged by you, 1 mention
 *  await you", or "You are all caught up" when all three are zero. Mirrors the
 *  action bar's "What needs you" copy. */
export function buildInboxSnapshot(data: LabOverviewSourceData): string {
  const segments: string[] = [];
  if (data.pending > 0) {
    segments.push(`${data.pending} approval${data.pending === 1 ? "" : "s"}`);
  }
  if (data.flagged > 0) {
    segments.push(`${data.flagged} flagged by you`);
  }
  if (data.mentions > 0) {
    segments.push(`${data.mentions} mention${data.mentions === 1 ? "" : "s"}`);
  }
  if (segments.length === 0) return "You are all caught up";
  return `${joinWithAnd(segments)} await you`;
}

/** "a, b and c" joiner so the snapshot reads as prose. */
function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The members-count meta, e.g. "8 members" (or "just you so far" when alone). */
function buildMembersMeta(data: LabOverviewSourceData): string {
  const n = data.members.length;
  if (n <= 1) return "just you so far";
  return `${n} member${n === 1 ? "" : "s"}`;
}

// ── Context resolution (SELECTED > HOVERED) ─────────────────────────────────

/** The resolved context entity for the selection-aware lines + Suggested. A real
 *  in-palette SELECTED drill (member / approval / announcement) always wins. When
 *  nothing is selected, a hovered roster MEMBER drives the SAME member context,
 *  only the framing ("Pointing at" vs "Selected") flips via `isHovered`. Approval
 *  / announcement hover does not exist (no taggable rows), so the hovered path is
 *  member-only. Null when neither a selection nor a hovered member is present. */
function resolveContext(data: LabOverviewSourceData):
  | { kind: "member"; member: LabOverviewMember; isHovered: boolean }
  | { kind: "approval"; approval: LabOverviewApproval; isHovered: boolean }
  | { kind: "announcement"; announcement: LabOverviewAnnouncement; isHovered: boolean }
  | null {
  const sel = data.selected;
  if (sel?.kind === "member") {
    return { kind: "member", member: sel.member, isHovered: false };
  }
  if (sel?.kind === "approval") {
    return { kind: "approval", approval: sel.approval, isHovered: false };
  }
  if (sel?.kind === "announcement") {
    return { kind: "announcement", announcement: sel.announcement, isHovered: false };
  }
  const hov = data.hovered;
  if (hov?.kind === "member") {
    return { kind: "member", member: hov.member, isHovered: true };
  }
  return null;
}

function buildContextCard(data: LabOverviewSourceData): PaletteContextCard {
  // Selection line (the mockup's selection-aware second line). No session line.
  // A real selection reads "Selected ...", a hovered member reads "Pointing at
  // ...", so the user knows which one drives Suggested.
  let selection: PaletteContextCard["selection"];
  const sel = resolveContext(data);
  if (sel?.kind === "member") {
    const m = sel.member;
    const bits = [`${m.openTasks} open`];
    if (m.overdueTasks > 0) bits.push(`${m.overdueTasks} overdue`);
    if (m.archived) bits.push("archived");
    const lead = sel.isHovered ? "Pointing at " : "Selected member ";
    selection = {
      iconName: ICON_MEMBER,
      text: `${lead}${m.displayName}, ${bits.join(", ")}`,
    };
  } else if (sel?.kind === "approval") {
    const a = sel.approval;
    selection = {
      iconName: ICON_APPROVAL_ITEM,
      text: `Selected "${a.itemName}", ${a.owner}, ${a.priceLabel}`,
    };
  } else if (sel?.kind === "announcement") {
    selection = {
      iconName: ICON_ANNOUNCEMENT,
      text: `Selected your announcement, "${sel.announcement.preview}"`,
    };
  }

  return {
    iconName: ICON_LAB,
    title: "Lab Overview",
    meta: `${buildMembersMeta(data)}, ${buildInboxSnapshot(data)}`,
    selection,
  };
}

// ── Sub-flows (BeakerSearch v2, chunk 2, both MULTI-STAGE) ──────────────────
// Both mirror the gantt add-dependency STACK flow (stage 1 onPick RETURNS a
// second PaletteSubflow that the framework promotes to the stacked breadcrumb
// view). Stage 1 sets presentation "stack" so the flow opens stacked from the
// first stage. The terminal pick calls the real owner-routed pi-action via the
// handler (which marks the per-record PI edit-confirm before the write).

/** The MULTI-STAGE assign flow. Stage 1 lists the lab's tasks (fuzzy by name +
 *  project); picking a task RETURNS stage 2 (the lab members, person tone), whose
 *  pick calls the real owner-routed assignTask then COMPLETES (returns void). */
function buildAssignTaskSubflow(
  data: LabOverviewSourceData,
  handlers: LabOverviewSourceHandlers,
): PaletteSubflow {
  return {
    title: "Assign a task to a lab member",
    placeholder: "Pick a task to assign",
    presentation: "stack",
    items: data.tasks.map((task) => ({
      id: `${task.owner}:${task.id}`,
      label: task.name,
      // The owner echo (and the project when present) widens the fuzzy match and
      // shows whose task it is in the row detail.
      detail: task.projectName ? `${task.projectName}, ${task.owner}` : task.owner,
      keywords: [task.owner, task.projectName].filter(Boolean).join(" "),
      iconName: ICON_SECTION,
      tone: "task",
      onRun: () => {},
    })),
    onPick: (chosen): PaletteSubflow => {
      const task =
        data.tasks.find((t) => `${t.owner}:${t.id}` === chosen.id) ?? data.tasks[0];
      return {
        title: `Assign "${task.name}" to a lab member`,
        placeholder: "Pick a lab member",
        items: data.members.map((m) => ({
          id: m.username,
          label: m.displayName,
          detail: m.displayName === m.username ? undefined : m.username,
          keywords: m.username,
          iconName: ICON_MEMBER,
          tone: "person",
          onRun: () => {},
        })),
        onPick: (memberItem) => {
          handlers.assignTask(task, memberItem.id);
        },
      };
    },
  };
}

/** The member-scoped assign flow (the selection-aware "Assign a task to X" row).
 *  A single stage that lists the lab's tasks; picking one calls the real
 *  owner-routed assignTask for the already-known member then COMPLETES. */
function buildAssignToMemberSubflow(
  member: LabOverviewMember,
  data: LabOverviewSourceData,
  handlers: LabOverviewSourceHandlers,
): PaletteSubflow {
  return {
    title: `Assign a task to ${member.displayName}`,
    placeholder: "Pick a task to assign",
    items: data.tasks.map((task) => ({
      id: `${task.owner}:${task.id}`,
      label: task.name,
      detail: task.projectName ? `${task.projectName}, ${task.owner}` : task.owner,
      keywords: [task.owner, task.projectName].filter(Boolean).join(" "),
      iconName: ICON_SECTION,
      tone: "task",
      onRun: () => {},
    })),
    onPick: (chosen) => {
      const task =
        data.tasks.find((t) => `${t.owner}:${t.id}` === chosen.id) ?? data.tasks[0];
      handlers.assignTask(task, member.username);
    },
  };
}

/** The MULTI-STAGE flag flow. Stage 1 lists the flaggable records (the pending
 *  purchase approvals, label = item name + owner); picking a record RETURNS stage
 *  2 (the fixed flag reasons, plus a free-text completion via onSubmitRaw), whose
 *  pick calls the real owner-routed setFlagForReview then COMPLETES. */
function buildFlagRecordSubflow(
  data: LabOverviewSourceData,
  handlers: LabOverviewSourceHandlers,
): PaletteSubflow {
  return {
    title: "Flag a record for review",
    placeholder: "Pick a record to flag",
    presentation: "stack",
    items: data.pendingApprovals.map((record) => ({
      id: `${record.owner}:${record.id}`,
      label: record.itemName,
      detail: `${record.owner}, ${record.priceLabel}`,
      keywords: `${record.owner} purchase approval pending`,
      iconName: ICON_APPROVAL_ITEM,
      tone: "task",
      onRun: () => {},
    })),
    onPick: (chosen): PaletteSubflow => {
      const record =
        data.pendingApprovals.find((r) => `${r.owner}:${r.id}` === chosen.id) ??
        data.pendingApprovals[0];
      return {
        title: `Flag "${record.itemName}" for review`,
        placeholder: "Pick a reason or type your own",
        items: LAB_OVERVIEW_FLAG_REASONS.map((reason) => ({
          id: reason.id,
          label: reason.label,
          detail: reason.detail,
          keywords: reason.label,
          iconName: ICON_FLAG,
          onRun: () => {},
        })),
        onPick: (reasonItem) => {
          const reason = LAB_OVERVIEW_FLAG_REASONS.find((r) => r.id === reasonItem.id);
          handlers.flagRecord(record, reason ? reason.label : reasonItem.label);
        },
        // A typed reason that matches none of the fixed set flags with the raw text.
        onSubmitRaw: (query) => {
          const trimmed = query.trim();
          if (!trimmed) return;
          handlers.flagRecord(record, trimmed);
        },
      };
    },
  };
}

// ── Commands ────────────────────────────────────────────────────────────────

/** The full command set with stable ids + page-defined groups. The
 *  selection-specific rows carry the stable ids the Suggested rule names. */
function buildCommands(
  data: LabOverviewSourceData,
  handlers: LabOverviewSourceHandlers,
): EditorCommand[] {
  const out: EditorCommand[] = [];
  // SELECTED > HOVERED. A hovered roster member drives the SAME member action
  // rows (same ids, same gating) as a selected member, so Suggested can name them
  // either way. A real selection still outranks the hover.
  const sel = resolveContext(data);

  // ── Selection-aware actions (the mockup's selection-aware Suggested). ──────
  if (sel?.kind === "member") {
    const m = sel.member;
    out.push({
      id: "lab-overview-member-open",
      label: `Open ${m.displayName}'s workload`,
      // A /workbench?user= view does not exist, so this routes to the roster /
      // workbench generically (see the hook's note).
      detail: `${m.openTasks} open${m.overdueTasks > 0 ? `, ${m.overdueTasks} overdue` : ""}`,
      group: LAB_OVERVIEW_GROUP_SELECTED,
      iconName: ICON_OPEN,
      run: () => handlers.openRoster(),
    });
    out.push({
      id: "lab-overview-member-assign",
      label: `Assign a task to ${m.displayName}`,
      detail: "owner-routed, notifies the assignee",
      group: LAB_OVERVIEW_GROUP_SELECTED,
      iconName: ICON_ASSIGN,
      enabled: data.tasks.length > 0,
      run: () => {},
      subflow: () => buildAssignToMemberSubflow(m, data, handlers),
    });
    if (m.archived) {
      out.push({
        id: "lab-overview-member-restore",
        label: `Restore ${m.displayName}`,
        detail: "returns them to day-to-day surfaces",
        group: LAB_OVERVIEW_GROUP_SELECTED,
        iconName: ICON_MEMBER,
        run: () => handlers.restoreMember(m),
      });
    } else {
      out.push({
        id: "lab-overview-member-archive",
        label: `Archive ${m.displayName}`,
        detail: "hides them, keeps their data searchable",
        group: LAB_OVERVIEW_GROUP_SELECTED,
        iconName: ICON_MEMBER,
        // Mirror the roster's "NOT self" rule.
        enabled: m.username !== data.currentUser,
        run: () => handlers.archiveMember(m),
      });
    }
  } else if (sel?.kind === "approval") {
    const a = sel.approval;
    out.push({
      id: "lab-overview-approval-approve",
      label: `Approve "${a.itemName}"`,
      detail: `${a.owner}, pending to approved`,
      group: LAB_OVERVIEW_GROUP_SELECTED,
      iconName: ICON_APPROVE,
      run: () => handlers.approveApproval(a),
    });
    out.push({
      id: "lab-overview-approval-decline",
      label: `Decline "${a.itemName}"`,
      detail: "marks declined",
      group: LAB_OVERVIEW_GROUP_SELECTED,
      iconName: ICON_DECLINE,
      run: () => handlers.declineApproval(a),
    });
    out.push({
      id: "lab-overview-approval-flag",
      label: `Flag "${a.itemName}" for review`,
      detail: "sends the owner a bell",
      group: LAB_OVERVIEW_GROUP_SELECTED,
      iconName: ICON_FLAG,
      run: () => handlers.flagApproval(a),
    });
    out.push({
      id: "lab-overview-approval-open",
      label: `Open "${a.itemName}" on Purchases`,
      detail: `${a.owner}, ${a.priceLabel}`,
      group: LAB_OVERVIEW_GROUP_SELECTED,
      iconName: ICON_OPEN,
      run: () => handlers.openApprovalOnPurchases(a),
    });
  } else if (sel?.kind === "announcement") {
    const an = sel.announcement;
    const own = an.author === data.currentUser;
    out.push({
      id: "lab-overview-announcement-edit",
      label: "Edit this announcement",
      detail: own ? "your announcement" : "only the author can edit",
      group: LAB_OVERVIEW_GROUP_SELECTED,
      iconName: ICON_ANNOUNCEMENT,
      enabled: own,
      run: () => handlers.editAnnouncement(an),
    });
    out.push({
      id: "lab-overview-announcement-pin",
      label: an.pinned ? "Unpin this announcement" : "Pin this announcement",
      detail: own ? (an.pinned ? "currently pinned" : "floats it to the top") : "only the author can pin",
      group: LAB_OVERVIEW_GROUP_SELECTED,
      iconName: ICON_ANNOUNCEMENT,
      enabled: own,
      run: () => handlers.togglePinAnnouncement(an),
    });
    out.push({
      id: "lab-overview-announcement-delete",
      label: "Delete this announcement",
      detail: own ? "removes it for everyone" : "only the author can delete",
      group: LAB_OVERVIEW_GROUP_SELECTED,
      iconName: "trash",
      enabled: own,
      run: () => handlers.deleteAnnouncement(an),
    });
  }

  // ── Approvals (the inline PI actions, gated by the per-record confirm in the
  // handler, the first action confirms). ────────────────────────────────────
  const pending = data.pendingApprovals;
  const many = pending.length > PENDING_COLLAPSE_THRESHOLD;
  if (pending.length > 0) {
    if (!many) {
      const first = pending[0];
      out.push({
        id: "lab-overview-approve-first",
        label: `Approve "${first.itemName}"`,
        detail: `${first.owner}, pending to approved`,
        group: LAB_OVERVIEW_GROUP_APPROVALS,
        iconName: ICON_APPROVE,
        run: () => handlers.approveApproval(first),
      });
      out.push({
        id: "lab-overview-decline-first",
        label: `Decline "${first.itemName}"`,
        detail: `${first.owner}, marks declined`,
        group: LAB_OVERVIEW_GROUP_APPROVALS,
        iconName: ICON_DECLINE,
        run: () => handlers.declineApproval(first),
      });
    }
    if (pending.length > 1) {
      out.push({
        id: "lab-overview-approve-all",
        label: `Approve all pending (${pending.length})`,
        detail: `${pending.length} item${pending.length === 1 ? "" : "s"} across the lab`,
        group: LAB_OVERVIEW_GROUP_APPROVALS,
        iconName: ICON_APPROVE,
        run: () => handlers.approveAllPending(),
      });
    }
  }
  out.push({
    id: "lab-overview-review-on-purchases",
    label: "Review pending approvals on Purchases",
    detail:
      data.pending > 0
        ? `${data.pending} awaiting`
        : "open the awaiting-approval filter",
    keywords: "purchase order approve queue",
    group: LAB_OVERVIEW_GROUP_APPROVALS,
    iconName: ICON_APPROVAL_ITEM,
    run: () => handlers.openPurchasesApprovalQueue(),
  });

  // ── Task assignment (MULTI-STAGE sub-flow, pick a task then a member). Gated
  // to when there is at least one assignable task AND one member. The terminal
  // pick runs the real owner-routed assignTask via the handler (per-record
  // confirm before the write). run stays a no-op for a caller without the
  // framework (there is no v1 surface to fall back to here). ─────────────────
  out.push({
    id: "lab-overview-assign-task",
    label: "Assign a task to a lab member",
    detail: "owner-routed, notifies the assignee",
    keywords: "delegate give member",
    group: LAB_OVERVIEW_GROUP_ASSIGN,
    iconName: ICON_ASSIGN,
    enabled: data.tasks.length > 0 && data.members.length > 0,
    run: () => {},
    subflow: () => buildAssignTaskSubflow(data, handlers),
  });

  // ── Flag for review (MULTI-STAGE sub-flow, pick a record then a reason). Gated
  // to when there is at least one flaggable record. The terminal pick runs the
  // real owner-routed setFlagForReview via the handler (per-record confirm before
  // the write). ─────────────────────────────────────────────────────────────
  out.push({
    id: "lab-overview-flag-record",
    label: "Flag a record for review",
    detail: "sends the owner a bell",
    keywords: "review follow up attention",
    group: LAB_OVERVIEW_GROUP_FLAG,
    iconName: ICON_FLAG,
    enabled: data.pendingApprovals.length > 0,
    run: () => {},
    subflow: () => buildFlagRecordSubflow(data, handlers),
  });

  // ── Announcements (author-gated, NOT session-gated). ──────────────────────
  out.push({
    id: "lab-overview-post-announcement",
    label: "Post an announcement",
    detail: "everyone in the lab sees it",
    keywords: "broadcast notice message",
    group: LAB_OVERVIEW_GROUP_ANNOUNCEMENTS,
    iconName: ICON_ANNOUNCEMENT,
    run: () => handlers.openAnnouncementComposer(),
  });
  // Own announcements get edit / pin / delete rows in the long tail too (the
  // mockup's "Announcements" command group). Member announcements are read-only.
  for (const an of data.announcements) {
    if (an.author !== data.currentUser) continue;
    out.push({
      id: `lab-overview-announcement-edit-${an.id}`,
      label: `Edit announcement, "${an.preview}"`,
      detail: "your announcement",
      keywords: "announcement",
      group: LAB_OVERVIEW_GROUP_ANNOUNCEMENTS,
      iconName: ICON_ANNOUNCEMENT,
      run: () => handlers.editAnnouncement(an),
    });
    out.push({
      id: `lab-overview-announcement-pin-${an.id}`,
      label: an.pinned
        ? `Unpin announcement, "${an.preview}"`
        : `Pin announcement, "${an.preview}"`,
      detail: an.pinned ? "currently pinned" : "floats it to the top",
      keywords: "announcement pin",
      group: LAB_OVERVIEW_GROUP_ANNOUNCEMENTS,
      iconName: ICON_ANNOUNCEMENT,
      run: () => handlers.togglePinAnnouncement(an),
    });
    out.push({
      id: `lab-overview-announcement-delete-${an.id}`,
      label: `Delete announcement, "${an.preview}"`,
      detail: "removes it for everyone",
      keywords: "announcement delete",
      group: LAB_OVERVIEW_GROUP_ANNOUNCEMENTS,
      iconName: "trash",
      run: () => handlers.deleteAnnouncement(an),
    });
  }

  // ── Members. ──────────────────────────────────────────────────────────────
  out.push({
    id: "lab-overview-open-roster",
    label: "Open the lab roster",
    detail: "manage members, archive or restore",
    keywords: "roster members manage archive",
    group: LAB_OVERVIEW_GROUP_MEMBERS,
    iconName: ICON_MEMBER,
    run: () => handlers.openRoster(),
  });

  // ── Create. ───────────────────────────────────────────────────────────────
  out.push({
    id: "lab-overview-new-project",
    label: "New project",
    detail: "owned by you",
    group: LAB_OVERVIEW_GROUP_CREATE,
    iconName: ICON_NEW,
    run: () => handlers.openProjectCreate(),
  });

  // ── Navigate out. ─────────────────────────────────────────────────────────
  out.push({
    id: "lab-overview-open-inbox",
    label: "Open flagged records and mentions",
    detail: "the lab inbox",
    keywords: "inbox flags mentions follow up",
    group: LAB_OVERVIEW_GROUP_NAVIGATE,
    iconName: ICON_INBOX,
    run: () => handlers.openLabInbox(),
  });
  out.push({
    id: "lab-overview-browse-experiments",
    label: "Browse lab experiments",
    detail: "the lab-wide experiments view",
    keywords: "experiments workbench",
    group: LAB_OVERVIEW_GROUP_NAVIGATE,
    iconName: ICON_SECTION,
    run: () => handlers.openLabExperiments(),
  });
  out.push({
    id: "lab-overview-browse-notes",
    label: "Browse lab notes",
    detail: "shared notes across the lab",
    keywords: "notes workbench shared",
    group: LAB_OVERVIEW_GROUP_NAVIGATE,
    iconName: ICON_SECTION,
    run: () => handlers.openLabNotes(),
  });

  return out;
}

// ── Suggested ───────────────────────────────────────────────────────────────

/** The ordered ids of the contextually relevant commands ("what needs you").
 *  These ids must exist in buildCommands; ids that are absent are silently
 *  skipped by the palette. A selection re-drives the top (the mockup's
 *  selection-aware Suggested); otherwise the nothing-selected set. */
function buildSuggestedIds(data: LabOverviewSourceData): string[] {
  // SELECTED > HOVERED, both lead with the same per-member action ids.
  const sel = resolveContext(data);

  if (sel?.kind === "member") {
    const ids = ["lab-overview-member-open", "lab-overview-member-assign"];
    ids.push(
      sel.member.archived
        ? "lab-overview-member-restore"
        : "lab-overview-member-archive",
    );
    return ids;
  }
  if (sel?.kind === "approval") {
    return [
      "lab-overview-approval-approve",
      "lab-overview-approval-decline",
      "lab-overview-approval-flag",
      "lab-overview-approval-open",
    ];
  }
  if (sel?.kind === "announcement") {
    return [
      "lab-overview-announcement-edit",
      "lab-overview-announcement-pin",
      "lab-overview-announcement-delete",
    ];
  }

  // Nothing selected, the resting "what needs you" set. Lead with approvals
  // (collapsing the per-item rows when there are many), then assign / flag,
  // then Post an announcement + New project + the route-outs.
  const ids: string[] = [];
  const pending = data.pendingApprovals;
  const many = pending.length > PENDING_COLLAPSE_THRESHOLD;
  if (pending.length > 0) {
    if (!many) {
      ids.push("lab-overview-approve-first", "lab-overview-decline-first");
    }
    if (pending.length > 1) ids.push("lab-overview-approve-all");
    ids.push("lab-overview-review-on-purchases");
  }
  ids.push("lab-overview-assign-task", "lab-overview-flag-record");
  ids.push("lab-overview-post-announcement", "lab-overview-new-project");
  ids.push("lab-overview-open-inbox");
  return ids;
}

/** The Suggested heading hint. */
function buildSuggestedHint(data: LabOverviewSourceData): string | undefined {
  const sel = resolveContext(data);
  if (sel?.kind === "member") {
    return sel.isHovered
      ? "for the member you were pointing at"
      : "for the selected member";
  }
  if (sel?.kind === "approval") return "for the selected approval";
  if (sel?.kind === "announcement") return "for your announcement";
  return "what needs you";
}

// ── Navigate ──────────────────────────────────────────────────────────────

/** Jump to a member (drills into the member selection, re-driving Suggested). */
function memberNavItem(
  member: LabOverviewMember,
  handlers: LabOverviewSourceHandlers,
): PaletteNavItem {
  const bits = [`${member.openTasks} open`];
  bits.push(member.overdueTasks > 0 ? `${member.overdueTasks} overdue` : "on track");
  if (member.archived) bits.push("archived");
  return {
    id: `lab-member-${member.username}`,
    label: member.displayName,
    detail: bits.join(", "),
    keywords: member.username,
    iconName: ICON_MEMBER,
    tone: "person",
    onRun: () => handlers.selectMember(member),
  };
}

/** Jump to a pending approval (drills into the approval selection). */
function approvalNavItem(
  approval: LabOverviewApproval,
  handlers: LabOverviewSourceHandlers,
): PaletteNavItem {
  return {
    id: `lab-approval-${approval.owner}-${approval.id}`,
    label: approval.itemName,
    detail: `${approval.owner}, ${approval.priceLabel}`,
    keywords: `${approval.owner} purchase approval pending`,
    iconName: ICON_APPROVAL_ITEM,
    tone: "task",
    onRun: () => handlers.selectApproval(approval),
  };
}

/** Build the nav groups (the mockup's groups). Jump to a member (person tone),
 *  Pending approvals (task tone), Jump to a section (neutral route-outs), then
 *  the Recent actions MRU when non-empty. */
function buildNavGroups(
  data: LabOverviewSourceData,
  handlers: LabOverviewSourceHandlers,
  recentActions: LabOverviewRecentAction[],
): PaletteNavGroup[] {
  const groups: PaletteNavGroup[] = [];

  // Jump to a member (active members; person tone, pink).
  const memberItems = data.members.map((m) => memberNavItem(m, handlers));
  if (memberItems.length > 0) {
    groups.push({
      title: "Jump to a member",
      hint: `${memberItems.length} member${memberItems.length === 1 ? "" : "s"}`,
      items: memberItems,
    });
  }

  // Pending approvals (task tone, amber).
  const approvalItems = data.pendingApprovals.map((a) =>
    approvalNavItem(a, handlers),
  );
  if (approvalItems.length > 0) {
    groups.push({
      title: "Pending approvals",
      hint: `${approvalItems.length}`,
      items: approvalItems,
    });
  }

  // Jump to a section (route-outs, neutral). On-screen sections + the inbox.
  groups.push({
    title: "Jump to a section",
    items: [
      {
        id: "lab-section-inbox",
        label: "Open the lab inbox",
        detail: "flags and mentions",
        iconName: ICON_INBOX,
        onRun: () => handlers.openLabInbox(),
      },
      {
        id: "lab-section-purchases",
        label: "Review pending approvals on Purchases",
        detail: data.pending > 0 ? `${data.pending} awaiting` : "the approval queue",
        iconName: ICON_APPROVAL_ITEM,
        onRun: () => handlers.openPurchasesApprovalQueue(),
      },
      {
        id: "lab-section-roster",
        label: "Go to the lab roster",
        detail: "members, archive or restore",
        iconName: ICON_MEMBER,
        onRun: () => handlers.openRoster(),
      },
    ],
  });

  // Recent actions (the session-local MRU). Omit when empty.
  if (recentActions.length > 0) {
    groups.push({
      title: "Recent actions",
      items: recentActions.map((action) => ({
        id: `lab-recent-${action.id}`,
        label: action.label,
        detail: action.detail,
        keywords: "recent reopen",
        iconName: recentActionIcon(action.kind),
        tone: action.kind === "approve" ? "task" : undefined,
        onRun: () => handlers.reopenRecentAction(action),
      })),
    });
  }

  return groups;
}

/** The registered glyph for a recent action kind. */
function recentActionIcon(kind: LabOverviewRecentAction["kind"]): IconName {
  switch (kind) {
    case "approve":
      return ICON_APPROVE;
    case "decline":
      return ICON_DECLINE;
    case "flag":
      return ICON_FLAG;
    case "assign":
      return ICON_ASSIGN;
    default:
      return ICON_SECTION;
  }
}

// ── Assembly ────────────────────────────────────────────────────────────────

/** Build the whole Lab Overview BeakerSearch source from a pure state snapshot
 *  plus the captured recent PI actions (the MRU). */
export function buildLabOverviewSource(
  data: LabOverviewSourceData,
  handlers: LabOverviewSourceHandlers,
  recentActions: LabOverviewRecentAction[] = [],
): BeakerSearchSource {
  return {
    id: "lab-overview",
    contextCard: buildContextCard(data),
    commands: buildCommands(data, handlers),
    suggestedIds: buildSuggestedIds(data),
    suggestedHint: buildSuggestedHint(data),
    navGroups: buildNavGroups(data, handlers, recentActions),
  };
}

// Re-export so the hook / tests can name the icon type without re-deriving it.
export type { IconName };
