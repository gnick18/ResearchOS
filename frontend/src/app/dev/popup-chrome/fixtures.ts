// Fixture data for the /dev/popup-chrome review gallery.
//
// The real object popups read their content from the connected research folder.
// This dev route has no folder, so every popup would otherwise render its
// no-folder empty state — which makes the chrome impossible to judge (you can't
// see how a populated header / body / footer reads). These fixtures seed REAL
// in-memory engines (the same HistoryEngine + MemoryStorage harness the unit
// tests use) so each popup renders with a populated version list and genuinely
// reconstructed diffs, exactly as it would over a real sidecar.
//
// Throwaway, same lifetime as the rest of /dev/popup-chrome: delete the whole
// route once the popup-chrome rollout is signed off.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { HistoryEngine } from "@/lib/history/engine";
import { MemoryStorage, makeSpacedClock } from "@/lib/history/test-utils";
import type { Note, Task } from "@/lib/types";

/** A minimal "list" task for the TaskDetailPopup row (routes through the simple
 *  CalmPopupShell path where the violet title marker lives). */
export const FIXTURE_TASK: Task = {
  id: 1,
  project_id: 1,
  name: "Order reagents for cohort 2",
  start_date: "2025-12-28",
  duration_days: 3,
  end_date: "2025-12-31",
  is_high_level: false,
  is_complete: false,
  task_type: "list",
  weekend_override: null,
  method_ids: [],
  deviation_log: null,
  tags: null,
  sort_order: 0,
  experiment_color: null,
  sub_tasks: null,
  method_attachments: [],
  owner: "dev",
  shared_with: [],
};

/** A seeded running-log note for the NoteDetailPopup row (so its entry tabs +
 *  sky accents render with content). */
export const FIXTURE_NOTE: Note = {
  id: 1,
  title: "Buffer prep, cohort 2",
  description: "Stock solutions and bench notes",
  is_running_log: true,
  is_shared: false,
  username: "dev",
  updated_at: "2025-12-31T18:00:00.000Z",
  entries: [
    {
      id: "e1",
      title: "Dec 31 - received",
      date: "2025-12-31",
      content:
        "NaCl received from Fisher. Doubled order covers the second cohort. Filtered all stocks through a 0.22 micron membrane before use.",
      created_at: "2025-12-31T18:00:00.000Z",
      updated_at: "2025-12-31T18:00:00.000Z",
    },
    {
      id: "e2",
      title: "Dec 28 - prep",
      date: "2025-12-28",
      content:
        "Laid out the buffer series, high-salt condition last to keep the bench clear of cross contamination.",
      created_at: "2025-12-28T15:00:00.000Z",
      updated_at: "2025-12-28T15:00:00.000Z",
    },
  ],
};

/** Owner + id the gallery passes to PurchaseHistoryPopup; the seed must match. */
export const FIXTURE_OWNER = "dev";
export const FIXTURE_PURCHASE_ID = 1;

/** A purchase-item record as the live store holds it (the viewer canonicalizes
 *  it, stripping the volatile total / stamp fields). Only the display fields
 *  the purchase adapter surfaces matter for the diff. */
type PurchaseFields = Record<string, string | number | boolean>;

const PURCHASE_VERSIONS: { actor: string; record: PurchaseFields }[] = [
  // v1 create: the request as first entered.
  {
    actor: "mira",
    record: {
      id: FIXTURE_PURCHASE_ID,
      item_name: "Sodium chloride, ACS grade, 500 g",
      quantity: 2,
      price_per_unit: 48.5,
      shipping_fees: 12,
      vendor: "Sigma-Aldrich",
      category: "Reagents",
      cas: "7647-14-5",
      link: "https://www.sigmaaldrich.com/US/en/product/sial/s9888",
      funding_string: "NIH R01-GM123456",
      notes: "For the buffer prep series.",
      assigned_to: "mira",
      order_status: "requested",
      approved: false,
    },
  },
  // v2: PI re-sources to a cheaper vendor (price + vendor + link change).
  {
    actor: "morgan",
    record: {
      id: FIXTURE_PURCHASE_ID,
      item_name: "Sodium chloride, ACS grade, 500 g",
      quantity: 2,
      price_per_unit: 41.75,
      shipping_fees: 12,
      vendor: "Fisher Scientific",
      category: "Reagents",
      cas: "7647-14-5",
      link: "https://www.fishersci.com/shop/products/sodium-chloride-acs-7647-14-5/S271500",
      funding_string: "NIH R01-GM123456",
      notes: "For the buffer prep series.",
      assigned_to: "mira",
      order_status: "requested",
      approved: false,
    },
  },
  // v3: PI approves it and bumps the quantity for the second cohort.
  {
    actor: "morgan",
    record: {
      id: FIXTURE_PURCHASE_ID,
      item_name: "Sodium chloride, ACS grade, 500 g",
      quantity: 4,
      price_per_unit: 41.75,
      shipping_fees: 12,
      vendor: "Fisher Scientific",
      category: "Reagents",
      cas: "7647-14-5",
      link: "https://www.fishersci.com/shop/products/sodium-chloride-acs-7647-14-5/S271500",
      funding_string: "NIH R01-GM123456",
      notes: "Doubled for the second cohort. Approved on the group call.",
      assigned_to: "mira",
      order_status: "approved",
      approved: true,
      approved_by: "morgan",
    },
  },
  // v4 (HEAD): ordered, status moves to received.
  {
    actor: "mira",
    record: {
      id: FIXTURE_PURCHASE_ID,
      item_name: "Sodium chloride, ACS grade, 500 g",
      quantity: 4,
      price_per_unit: 41.75,
      shipping_fees: 9.5,
      vendor: "Fisher Scientific",
      category: "Reagents",
      cas: "7647-14-5",
      link: "https://www.fishersci.com/shop/products/sodium-chloride-acs-7647-14-5/S271500",
      funding_string: "NIH R01-GM123456",
      notes: "Doubled for the second cohort. Approved on the group call.",
      assigned_to: "mira",
      order_status: "received",
      approved: true,
      approved_by: "morgan",
    },
  },
];

/**
 * Build a real HistoryEngine over in-memory storage, seeded with the purchase
 * version chain above. A spaced clock puts each save in its own session so every
 * version renders as a distinct, selectable row. Genesis is anchored at the
 * empty doc (prevState null on the first append), so reconstruction resolves
 * without a headCanonical, exactly like a fresh tracked record.
 */
export async function makeSeededPurchaseHistoryEngine(): Promise<HistoryEngine> {
  const engine = new HistoryEngine({
    storage: new MemoryStorage(),
    clock: makeSpacedClock(),
  });
  let prev: unknown = null;
  for (const v of PURCHASE_VERSIONS) {
    await engine.appendEdit({
      type: prev === null ? "create" : "update",
      entityType: "purchase_items",
      id: FIXTURE_PURCHASE_ID,
      owner: FIXTURE_OWNER,
      actor: v.actor,
      prevState: prev,
      nextState: v.record,
    });
    prev = v.record;
  }
  return engine;
}
