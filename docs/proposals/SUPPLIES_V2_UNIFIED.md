# Supplies v2, the unified page (Route B)

Status: DESIGN, awaiting sign-off. Supersedes the two-tab Supplies hub for the
single-page direction. Grant picked Route B on 2026-06-08 with the note that the
merge needs careful thinking on how two separate interfaces become one unified
system while removing redundancy. This doc does that thinking. No code until the
resolutions below are signed off; then a chunked build behind `INVENTORY_ENABLED`.

Grounded in the three-part UI audit (Purchases UI + plots, Inventory UI,
BeakerSearch + right-click), 2026-06-08.

---

## 1. Goal

One "Supplies" page that answers the two daily questions in one list, with no
duplicate data entry across Inventory and Purchases:
- What do I have, and what needs attention (low, out, expiring)?
- What is on order, and what do I need to order?

The page replaces the separate `/inventory` and `/purchases` surfaces. The
spending analytics become a lab-head drawer, not permanent page space.

---

## 2. The two current models (what we are merging)

- Inventory: `InventoryItem` (the thing: name, vendor, catalog_number, cas, url,
  category enum, container_label, low_at_count, safety fields, typed registry)
  plus `InventoryStock` (physical containers: container_count, status, lot,
  expiration_date, location, `purchase_item_id` FK back to a received purchase).
  Item-scoped. Whole-lab-edit shared by default.
- Purchases: `PurchaseItem` (item_name, vendor, catalog_number, cas, link,
  quantity-to-order, price, shipping, funding, `order_status`, PI approval,
  assignee) grouped under a `Task` (the "order"). Task-scoped. A task batches
  several items for one submission + one funding context + PI approval.

Shared identity fields: `name/item_name, vendor, catalog_number, cas, url/link`.
Orthogonal state: on-hand (count/status/expiry/location) vs ordering
(order_status/price/funding/approval). An order groups items; a supply is one
item. That mismatch is the crux.

---

## 3. The unifying concept: a "Supply"

A **Supply** is one physical thing the lab buys and/or keeps, identified by its
identity fields. It has up to two orthogonal state sections:
- **On hand** (from Inventory): the stocks, counts, statuses, expiries, locations.
- **Ordering** (from Purchases): open order lines for it, plus its order history.

Crucially we do **not** merge the two tables. We keep `InventoryItem`/`Stock` and
`PurchaseItem`/`Task` as-is (no destructive migration, no risk to existing data),
and add a thin **link + view layer** that presents them as one Supply. This is
the single most important resolution: a view-layer union, not a schema merge.

A Supply can be:
- **Both** (the common reagent): an InventoryItem with stocks AND open/past
  purchase lines. The default.
- **On-hand only** (never ordered through us, e.g. a hand-me-down stock): an
  InventoryItem with stocks, no purchase lines.
- **Order-only** (a service or one-off, e.g. a conference flight, a repair): a
  PurchaseItem with no InventoryItem. Shown in the list with only an Ordering
  badge; never grows an on-hand section.

---

## 4. The hard resolutions

### 4.1 Linking a purchase line to a supply (the redundancy killer)
Problem: before receipt there is no FK tying an open `PurchaseItem` to its
`InventoryItem`, so "on order" cannot reliably attach to the right supply row.

Resolution: add **one additive optional field** `inventory_item_id` on
`PurchaseItem` (nullable, FLAG, no migration of old rows).
- A purchase started via **"Reorder"** from a supply stamps `inventory_item_id`
  directly. This is the clean, primary path and the redundancy killer: identity
  is copied from the InventoryItem, never retyped.
- An **ad-hoc** purchase (typed fresh in an order) is matched to a supply by
  identity (`vendor + catalog_number` when both present, else normalized name).
  The match is a display-time resolver, not a write; a "Link to inventory item"
  affordance lets the user confirm/stamp it.
- An **unmatched** purchase (flight, service) is an order-only Supply.
- The existing `InventoryStock.purchase_item_id` FK already covers the
  post-receipt direction (received line -> stock). We are adding the pre-receipt
  direction.

### 4.2 Orders still exist; the list is per-supply
An "order" is a real concept (a cart you submit together for one funding context
and one PI approval pass). We keep it, but it stops being the primary surface:
- The **default view is the per-Supply list**. Each row shows on-hand + on-order
  badges. No order/task grouping in the default view.
- The **cart / order** becomes a transient grouping used only at
  submission time: "Reorder" adds a supply to a draft order; a small cart
  affordance lets you review the batch, set funding once, and submit. After
  submission those lines show as "on order" on their supply rows.
- Lab-head **approval** and **funding** move into (a) the Supply detail panel's
  Ordering section, and (b) a dedicated lab-head **"Orders & approvals" lens**
  (a filter/view, not a second page) where a PI works the queue order-by-order.
  This keeps per-item approval state intact without cluttering the member's
  per-supply list.

### 4.3 The receiving bridge (mostly built)
Receiving an order line (`order_status -> received`) already offers the
do-not-add / create-item / add-stock choice (`ReceiveToInventoryDialog`). In the
unified model this is the moment a Supply's Ordering state becomes On-hand state.
We keep that flow; when the line carried `inventory_item_id`, "add stock to
existing" is pre-selected (no re-pick).

### 4.4 Reorder is informed by on-hand
Because both states live on one row, "Reorder" knows the on-hand count: the
button reads "Reorder (1 left, low at 2)" and prefills quantity from the gap.
This is redundancy removal as a feature, not just dedup.

### 4.5 Spending analytics
Per the approved plots decision: the time-series + breakdown charts + range
controls live in a lab-head **"View spending" drawer**; funding-budget cards in
the existing Manage Funding popup (lab-head). The member's Supplies list never
spends permanent height on charts.

### 4.6 Interaction parity (approved)
The unified rows get full BeakerSearch + right-click parity (Inventory has none
today): palette commands (add supply, reorder, set status, filter by attention /
on-order, scan, import, open spending) and a right-click menu (reorder, edit, set
status, move location, approve/decline for lab-head, view audit). `usePiRecordMenu`
gains an `inventory_item` / `supply` record type. Inventory's strong inline
controls (tap-status, count steppers) are preserved on the row + detail panel.

---

## 5. The unified UI

- **Filters (answer the daily questions):** All | Needs attention (expiring +
  low + out) | On order | (lab-head) Awaiting approval. Search across identity
  fields.
- **Row:** identity (name, category, vendor, catalog) + an On-hand badge (count
  + worst status, or "expires Nd") + an On-order badge (needs ordering / ordered)
  + a Reorder affordance. Order-only rows show only the order badge.
- **Detail panel (click a row):** two orthogonal sections. **On hand** (stocks,
  tap-status, step-count, lot/expiry/location, storage-map link, Reorder) and
  **Ordering** (open lines, price, funding, PI approval for lab-head, order
  history). Sections render only if that side exists.
- **Cart / submit:** a small draft-order affordance to batch reorders, set
  funding once, submit (and, in lab mode, route for approval).
- **Lab-head "Orders & approvals" lens:** order-grouped view for the PI to
  approve/decline/flag, plus the spending drawer. Members never see it.
- **Storage map + scan + import:** unchanged, reached from the page header /
  palette.

---

## 6. Migration + safety

- **Additive only.** One new nullable `inventory_item_id` on `PurchaseItem`
  (its own FLAG/chunk, no field on disk before its chunk). No table merge, no
  destructive change, existing inventory + purchase data untouched.
- **Behind `INVENTORY_ENABLED`** the whole time; the old `/inventory` +
  `/purchases` routes keep working until the unified page is proven, then they
  redirect into the unified surface (kept as deep-link targets for the loop
  strip / search).
- Whole-lab-edit sharing default carries over from inventory; purchase
  ownership/approval gating (the C2-C5 audit work) is unchanged.

---

## 7. Edge cases resolved

- Same item, two vendors: two Supplies (identity includes vendor); fine.
- Solo user (no lab): no approval lens, no funding pressure; cart submit just
  flips lines to "ordered".
- A purchase typed before its inventory item exists: order-only until received,
  then the receive flow creates the item and back-links.
- Order-only things never grow an on-hand section; on-hand-only never grow an
  ordering section.

---

## 8. Phased build (each shippable behind the flag, each tsc + vitest gated)

1. **Link layer:** add `inventory_item_id` FLAG on `PurchaseItem`; the
   identity-match resolver (pure, tested); the "Supply" view-model that unions an
   InventoryItem + its stocks + its open/past purchase lines. Data + tests only.
2. **Unified list (read):** the per-Supply list with on-hand + on-order badges +
   filters + search, behind the flag at a new route (or `/inventory` reused).
3. **Detail panel:** the two-section panel; reuse existing StockRow controls +
   the purchase line controls.
4. **Reorder + cart:** Reorder stamps `inventory_item_id`, prefills from the gap;
   the draft-order/cart submit + funding-once; wire the receive bridge's
   pre-selected "add to existing".
5. **Lab-head lens + spending drawer:** the order-grouped approvals view; move
   the plots into the drawer; funding cards into the popup.
6. **Interaction parity:** the Supplies BeakerSearch source + right-click menu +
   hover tagging + deep-links; `usePiRecordMenu` supply type.
7. **Retire the split:** `/inventory` + `/purchases` redirect into the unified
   page; SuppliesTabs (two-tab hub) removed; loop-strip deep-links repointed.

Chunks 1-4 serialize (shared view-model + the high-touch list). 5-6 can run after
3 lands. 7 is last, after the unified page is dogfood-proven.

---

## 9. Resolved decisions (signed off 2026-06-08)

1. **Route + URL: new `/supplies` route.** The unified page lives at `/supplies`;
   `/inventory` and `/purchases` redirect into it (kept as deep-link targets for
   the loop strip + global search). Update nav (`lib/nav.ts`), the SuppliesTabs
   deep-links, and wiki/screenshots in chunk 7.
2. **Reorder: keep the order/cart batch.** Reorder adds to a draft order; review
   the batch, set funding once, submit (routes for PI approval in lab mode).
   Matches today's task-grouped model and preserves one-funding-context +
   one-approval-pass per order.
3. **Order-only things: in scope, behind a filter.** Flights / services / repairs
   stay in Supplies (they are purchases) but segregated by a filter/category
   (reuse today's "Miscellaneous" bucket) so the default list stays
   reagent/equipment-focused. No second purchases page.
