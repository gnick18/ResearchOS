// PI capability revamp Phase 2 (sharing + collaboration manager, 2026-06-07):
// the shared builder that turns a member-owned record into the right-click PI
// action list. ONE builder, three eventual homes (record list rows in this
// pass, roster rows and popup headers in a later pass), so the menu copy and
// the per-type item set stay identical everywhere.
//
// The builder is PURE. It decides WHICH items to show for a given record and
// what each item's label / destructive styling is, but it does NOT run the
// pi-action, invalidate caches, or pop an alert. Those side effects live in the
// consumer hook (usePiRecordMenu) so the same action plumbing (the
// PiActionResult handling that AssignTaskButton / FlagForReviewButton already
// use) is shared, and the builder stays trivially unit-testable.
//
// The items use the app-wide EditMenuItem shape (the same list SequenceEditMenu
// renders through useContextMenu's shared SequenceContextMenu). That surface
// has no per-item icon slot, so we lean on its real vocabulary: the `group`
// divider and `destructive` (rose) styling. Decline is the one destructive row.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import type { EditMenuItem } from "@/components/sequences/SequenceEditMenu";

/** The record types the PI menu surfaces actions for. "inventory_item" is the
 *  Supplies v2 unified-page Supply row (chunk 6, section 4.6): unlike the other
 *  three (which are pure PI-on-a-member-record menus), a Supply row also offers
 *  universal inline-mirror actions (reorder / edit / set status) to its own
 *  owner / editor, with the lab-head approve / decline / flag rows acting on the
 *  supply's linked open purchase line as the additive PI layer. */
export type PiMenuRecordType = "task" | "note" | "purchase" | "inventory_item";

/**
 * The audit log's record_type for a given menu record type. The audit log and
 * the on-disk folders standardize on "purchase_item" for purchases (matching
 * pi-actions.ts setPurchaseApproval / declinePurchase, the purchase_items
 * folder, and the PurchaseItem type), while the menu type is the shorter
 * "purchase". Tasks and notes are already consistent. This is the ONE home for
 * that mapping so the per-record audit filter (Pass B) and the Phase-1 content
 * edit stamp the same record_type. House style is no em-dashes, no mid-sentence
 * colons.
 */
export type AuditRecordType = "task" | "note" | "purchase_item";

export function auditRecordTypeFor(menuType: PiMenuRecordType): AuditRecordType {
  // A Supply's audit history is its linked open purchase line (where the
  // lab-head approve / decline / flag actions land), so "inventory_item" maps to
  // the same "purchase_item" record_type as a purchase. There is no separate
  // inventory audit record_type today.
  return menuType === "purchase" || menuType === "inventory_item"
    ? "purchase_item"
    : menuType;
}

/** The minimal record shape the builder needs. Each caller maps its own record
 *  (Task / Note / PurchaseItem) into this so the builder stays decoupled from
 *  the full record types. */
export interface PiMenuRecord {
  /** Username of the record owner. Tasks use `owner`, notes use `username`,
   *  purchase items inherit their parent task's owner (the caller resolves it). */
  owner: string;
  /** Numeric record id in the owner's namespace. */
  id: number;
  /** Whether the record currently carries a flag-for-review. Drives the
   *  Flag / Clear-flag toggle. */
  flagged: boolean;
  /** Purchase only: current approval state, for the Approve / Decline toggle. */
  approved?: boolean;
  /** inventory_item only: whether the current user may edit the supply's backing
   *  item (whole-lab-edit sharing carries over from inventory). Gates the
   *  universal "Edit item" / "Set status" rows. */
  canEdit?: boolean;
  /** inventory_item only: the supply's first OPEN purchase line, when present, so
   *  the lab-head approve / decline / flag rows act on it (the additive PI
   *  layer). Null / absent when the supply has no open line (on-hand-only), in
   *  which case those rows are omitted. owner is the line's owner (resolved by
   *  the caller from the decorated record). */
  linkedPurchase?: {
    owner: string;
    id: number;
    approved: boolean;
    flagged: boolean;
  } | null;
}

/** The callbacks the consumer hook supplies. Each runs the matching pi-action
 *  (plus invalidation + the existing alert pattern) on the consumer side. */
export interface PiMenuCallbacks {
  /** Open the record's detail popup / editor exactly as a normal click would,
   *  so the Phase 1 once-per-session gate engages there. */
  onEditAsPi: () => void;
  /** Set the flag-for-review (record is currently unflagged). */
  onFlag: () => void;
  /** Clear the flag (record is currently flagged). */
  onClearFlag: () => void;
  /** Task only: open the assign-to-member flow. */
  onAssign?: () => void;
  /** Purchase only: approve the item (currently not approved). */
  onApprove?: () => void;
  /** Purchase only: decline the item (currently approved or pending). */
  onDecline?: () => void;
  /** Open the per-record audit trail for this record (the read-only viewer,
   *  filtered to this one record). Always offered for a member record. */
  onViewAudit?: () => void;
  /** inventory_item only: add the supply to the reorder cart (universal). */
  onReorder?: () => void;
  /** inventory_item only: open the supply's backing item in the edit form
   *  (offered when the viewer can edit). */
  onEditItem?: () => void;
  /** inventory_item only: open the supply so its stock status can be tapped
   *  (offered when the viewer can edit). */
  onSetStatus?: () => void;
}

export interface BuildPiRecordMenuArgs {
  recordType: PiMenuRecordType;
  record: PiMenuRecord;
  /** The active user (the would-be lab head). */
  viewerUsername: string | null | undefined;
  /** Whether the active user is a lab head (PI). `undefined`/`null` while the
   *  role read is in flight, which (like a non-PI) yields an empty menu. */
  isLabHead: boolean | null | undefined;
  callbacks: PiMenuCallbacks;
  /** Whether to include the leading "Edit as lab head" row. Default true, so the
   *  Pass 1 list-row callers are unchanged. The detail-popup header callers pass
   *  false because the record is ALREADY open there, so "Edit as lab head" would
   *  be redundant and the menu should show only the role actions (assign / flag /
   *  approve / decline). */
  includeEditAsPi?: boolean;
}

/**
 * True when `viewer` is a lab head looking at a record owned by SOMEONE ELSE.
 * Mirrors the gate signal in usePiEditGate (isLabHead AND record.owner !==
 * currentUser). A non-PI, or a PI on their OWN record, gets no PI menu.
 * Exported so row consumers can cheaply early-out before building. A
 * falsy/loading `isLabHead` (undefined/null/false) yields false, exactly as the
 * former `accountType !== "lab_head"` did.
 */
export function isPiViewingMemberRecord(
  isLabHead: boolean | null | undefined,
  viewerUsername: string | null | undefined,
  recordOwner: string | null | undefined,
): boolean {
  if (!isLabHead) return false;
  if (!viewerUsername) return false;
  if (!recordOwner) return false;
  return recordOwner !== viewerUsername;
}

/**
 * Build the EditMenuItem list for one member-owned record. Returns [] for a
 * non-PI viewer, or a lab head looking at their OWN record. The consumer then
 * calls openMenu(e, []) which falls through to the normal right-click glyph, so
 * behavior is byte-identical for everyone who is not a PI on a member's record.
 *
 * Item layout per type:
 *   - all: "Edit as lab head", then the flag toggle.
 *   - task: + "Assign to member..." (grouped after the shared items).
 *   - purchase: + "Approve" / "Decline" reflecting the current approval state.
 */
export function buildPiRecordMenuItems(args: BuildPiRecordMenuArgs): EditMenuItem[] {
  const { recordType, record, viewerUsername, isLabHead, callbacks } = args;
  const includeEditAsPi = args.includeEditAsPi ?? true;

  // inventory_item (Supplies v2 chunk 6) is NOT a pure PI-on-member menu: it
  // offers universal reorder / edit / set-status rows to the owner / editor too,
  // with the PI approve / decline / flag rows as an additive layer on the
  // supply's linked open line. So it bypasses the isPiViewingMemberRecord gate
  // below (which is the right rule for task / note / purchase) and has its own
  // builder.
  if (recordType === "inventory_item") {
    return buildSupplyMenuItems(args);
  }

  if (!isPiViewingMemberRecord(isLabHead, viewerUsername, record.owner)) {
    return [];
  }

  const items: EditMenuItem[] = [];

  // Shared across every record type: open in the popup (the Phase 1 gate runs
  // there) and the flag-for-review toggle. The popup-header callers drop the
  // "Edit as lab head" row (includeEditAsPi=false) because the record is already
  // open there; the flag toggle then leads the menu.
  if (includeEditAsPi) {
    items.push({
      id: "pi-edit-as-lab-head",
      label: "Edit as lab head",
      enabled: true,
      onRun: callbacks.onEditAsPi,
    });
  }

  if (record.flagged) {
    items.push({
      id: "pi-clear-flag",
      label: "Clear flag",
      enabled: true,
      onRun: callbacks.onClearFlag,
    });
  } else {
    items.push({
      id: "pi-flag-for-review",
      label: "Flag for review",
      enabled: true,
      onRun: callbacks.onFlag,
    });
  }

  // Task: assignment.
  if (recordType === "task" && callbacks.onAssign) {
    items.push({
      id: "pi-assign-to-member",
      label: "Assign to member...",
      enabled: true,
      group: true,
      onRun: callbacks.onAssign,
    });
  }

  // Purchase: approve / decline reflecting current state.
  if (recordType === "purchase") {
    if (callbacks.onApprove && !record.approved) {
      items.push({
        id: "pi-approve-purchase",
        label: "Approve",
        enabled: true,
        group: true,
        onRun: callbacks.onApprove,
      });
    }
    if (callbacks.onDecline) {
      items.push({
        id: "pi-decline-purchase",
        label: "Decline",
        enabled: true,
        // Group when it is the first purchase-specific item (i.e. the item is
        // already approved so no Approve row precedes it).
        group: !!record.approved,
        destructive: true,
        onRun: callbacks.onDecline,
      });
    }
  }

  // Read-only per-record audit trail, always last in its own group. Offered for
  // every member record regardless of includeEditAsPi, since a reviewer wants
  // the history both from a list row and from inside the open record.
  if (callbacks.onViewAudit) {
    items.push({
      id: "pi-view-audit-trail",
      label: "View audit trail",
      enabled: true,
      group: true,
      onRun: callbacks.onViewAudit,
    });
  }

  return items;
}

/**
 * Build the right-click menu for a Supplies v2 unified-page Supply row
 * (recordType "inventory_item", section 4.6). Two layers:
 *   - Universal: "Reorder" (anyone), then "Edit item" / "Set status..." when the
 *     viewer can edit the backing item (record.canEdit). These mirror the row's
 *     inline controls so the menu is additive, never the only path.
 *   - Lab-head: when a lab head views a member-owned open purchase line
 *     (record.linkedPurchase), the approve / decline / flag rows act on that
 *     line, and "View audit trail" opens that line's history. Members never see
 *     this layer (the own-record / non-PI rules are unchanged for it).
 *
 * Returns [] only when there is nothing to offer (e.g. a non-editable supply
 * with no member-owned open line for a non-PI), so a member on their own supply
 * still gets the universal rows, while a bystander gets the normal right-click
 * fall-through.
 */
function buildSupplyMenuItems(args: BuildPiRecordMenuArgs): EditMenuItem[] {
  const { record, callbacks, isLabHead, viewerUsername } = args;
  const items: EditMenuItem[] = [];

  // ── Universal inline-mirror actions. ──────────────────────────────────────
  if (callbacks.onReorder) {
    items.push({
      id: "supply-reorder",
      label: "Reorder",
      enabled: true,
      onRun: callbacks.onReorder,
    });
  }
  if (record.canEdit) {
    if (callbacks.onEditItem) {
      items.push({
        id: "supply-edit-item",
        label: "Edit item",
        enabled: true,
        onRun: callbacks.onEditItem,
      });
    }
    if (callbacks.onSetStatus) {
      items.push({
        id: "supply-set-status",
        label: "Set status...",
        enabled: true,
        onRun: callbacks.onSetStatus,
      });
    }
  }

  // ── Lab-head layer: act on the member-owned open purchase line. ────────────
  const linked = record.linkedPurchase ?? null;
  const piOnLine =
    !!linked && isPiViewingMemberRecord(isLabHead, viewerUsername, linked.owner);
  if (linked && piOnLine) {
    if (callbacks.onApprove && !linked.approved) {
      items.push({
        id: "supply-approve-line",
        label: "Approve order line",
        enabled: true,
        group: true,
        onRun: callbacks.onApprove,
      });
    }
    if (callbacks.onDecline) {
      items.push({
        id: "supply-decline-line",
        label: "Decline order line",
        enabled: true,
        // Group when it leads the PI block (no Approve row precedes it).
        group: !!linked.approved,
        destructive: true,
        onRun: callbacks.onDecline,
      });
    }
    if (linked.flagged) {
      if (callbacks.onClearFlag) {
        items.push({
          id: "supply-clear-flag",
          label: "Clear flag on order line",
          enabled: true,
          group: true,
          onRun: callbacks.onClearFlag,
        });
      }
    } else if (callbacks.onFlag) {
      items.push({
        id: "supply-flag-line",
        label: "Flag order line for review",
        enabled: true,
        group: true,
        onRun: callbacks.onFlag,
      });
    }
  }

  // ── View audit (lab head only), the linked purchase line's history (where the
  // PI actions land). Shown with the rest of the PI layer, so it requires a
  // member-owned open line, never appearing on a member's own supply. ──────────
  if (piOnLine && callbacks.onViewAudit) {
    items.push({
      id: "supply-view-audit-trail",
      label: "View audit trail",
      enabled: true,
      group: true,
      onRun: callbacks.onViewAudit,
    });
  }

  return items;
}
