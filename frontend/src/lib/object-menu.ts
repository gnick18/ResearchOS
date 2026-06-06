// sequence editor master. The shared list-row + sidebar right-click menu builder.
//
// One pure builder turns an object (type + id + name) plus a partial handler set
// into EditMenuItem[] for the website-wide context-menu framework. Only the
// actions whose handler is provided are shown, so a surface that cannot Duplicate
// simply omits that handler and the item never appears (no dead rows). Copy
// reference is ALWAYS present, Rename sits near the top, Delete is a destructive
// group. No surface-specific logic lives here; each surface wires its own
// handlers and opens the menu via openMenu(event, items).
//
// Voice. No em-dashes, no emojis, no mid-sentence colons.

import type { EditMenuItem } from "@/components/sequences/SequenceEditMenu";
import type { ObjectRefType } from "@/lib/references";

/** The object a menu acts on. `name` labels the confirm copy / chip. */
export interface ObjectMenuItem {
  type: ObjectRefType;
  id: string | number;
  name: string;
}

/** Every action the shared menu can offer. A surface passes only the ones it can
 *  honor; the builder shows exactly those (plus Copy reference, always). */
export interface ObjectMenuHandlers {
  onRename?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onMove?: () => void;
  onShare?: () => void;
  onExport?: () => void;
  /** Always wired in practice (Copy reference is the spine of the chip flow),
   *  but kept optional so the builder stays a pure function of what it is given. */
  onCopyReference?: () => void;
}

/**
 * Build the right-click menu items for one object. The order is intentional.
 *   1. Rename (top, the most common edit).
 *   2. Duplicate / Move / Share / Export (the present capabilities, in a group).
 *   3. Copy reference (always, in its own group, the link-to-this affordance).
 *   4. Delete (destructive, its own group, last).
 * Items whose handler is absent are skipped. `group: true` draws a divider before
 * the item, so groups only render a divider when they actually have a first item.
 */
export function buildObjectMenuItems(
  item: ObjectMenuItem,
  handlers: ObjectMenuHandlers,
): EditMenuItem[] {
  const items: EditMenuItem[] = [];

  if (handlers.onRename) {
    items.push({
      id: "object-rename",
      label: "Rename",
      enabled: true,
      onRun: handlers.onRename,
    });
  }

  // The "capabilities" group. The first present item starts the group (divider);
  // the rest follow without one. `firstInGroup` tracks that so a group with only
  // its second member still draws cleanly.
  let capabilityStarted = false;
  const pushCapability = (entry: Omit<EditMenuItem, "group">) => {
    items.push({ ...entry, group: !capabilityStarted });
    capabilityStarted = true;
  };
  if (handlers.onDuplicate) {
    pushCapability({ id: "object-duplicate", label: "Duplicate", enabled: true, onRun: handlers.onDuplicate });
  }
  if (handlers.onMove) {
    pushCapability({ id: "object-move", label: "Move to collection", enabled: true, onRun: handlers.onMove });
  }
  if (handlers.onShare) {
    pushCapability({ id: "object-share", label: "Share", enabled: true, onRun: handlers.onShare });
  }
  if (handlers.onExport) {
    pushCapability({ id: "object-export", label: "Export", enabled: true, onRun: handlers.onExport });
  }

  // Copy reference is ALWAYS present, in its own group, so the link-to-this
  // affordance is in the same spot on every surface.
  if (handlers.onCopyReference) {
    items.push({
      id: "object-copy-reference",
      label: "Copy reference",
      enabled: true,
      group: true,
      onRun: handlers.onCopyReference,
    });
  }

  if (handlers.onDelete) {
    items.push({
      id: "object-delete",
      label: "Delete",
      enabled: true,
      group: true,
      destructive: true,
      onRun: handlers.onDelete,
    });
  }

  return items;
}
