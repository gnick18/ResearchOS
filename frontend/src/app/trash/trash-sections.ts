// VCP R2 trash everywhere: the entity-type section list for the /trash route.
// Extracted from page.tsx so it can be unit-tested in isolation (the page is a
// heavy "use client" component) and so a regression test can assert that EVERY
// trashable entity type has a visible section here. A type present in
// `TrashEntityType` but absent from this list is written to `_trash/<type>/` on
// disk yet INVISIBLE on /trash — the user can't restore it. That is exactly the
// bug that left soft-deleted molecules + storage locations stranded.

import type { TrashEntityType } from "@/lib/trash";

/** Order in which entity-type sections render. Notes first (most-used),
 *  then the rest roughly by familiarity. Must cover every `TrashEntityType`;
 *  see `trash-sections.test.ts` for the coverage guard. */
export const SECTION_ORDER: Array<{ key: TrashEntityType; label: string }> = [
  { key: "note", label: "Notes" },
  { key: "task", label: "Tasks" },
  { key: "project", label: "Projects" },
  { key: "method", label: "Methods" },
  { key: "purchase_item", label: "Purchase items" },
  { key: "high_level_goal", label: "High-level goals" },
  { key: "lab_link", label: "Lab links" },
  { key: "mass_spec_protocol", label: "Mass spec protocols" },
  { key: "sequence", label: "Sequences" },
  { key: "molecule", label: "Molecules" },
  { key: "inventory_item", label: "Inventory items" },
  { key: "inventory_stock", label: "Inventory stocks" },
  { key: "storage_node", label: "Storage locations" },
];
