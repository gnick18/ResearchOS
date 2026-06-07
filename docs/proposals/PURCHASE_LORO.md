# Purchase items on Loro (in-lab live collab)

Status: DESIGN LOCKED 2026-06-07 (Grant). Building in chunks. Author: collab manager.
Builds on the notes Loro pilot + the experiment task-doc model + the DO collab engine
(see project_unified_model_phase1/2/3, project_experiment_collab, COLLAB_STORAGE_D1_DO_MIGRATION.md).

## Goal

Bring the Loro-backed collab model that notes and experiment markdown surfaces have to
PURCHASE ITEMS, in-lab first. The value over today's plain JSON + shared-folder
file-watch auto-refresh:
- Conflict-free CONCURRENT field edits (two people editing different fields of the same
  purchase item merge cleanly; same field is last-write-wins, the right semantic for a
  structured record).
- Instant live approval / order-status across the lab via the relay (the lab head
  approves, the requester sees it immediately, no file-poll wait).
- Version history + per-field attribution via the existing entity VC engine (later).
- The foundation external purchase sharing will build on (same as notes -> external).

In-lab first. External purchase sharing is a later, separate arc (reuses grant/inbox/accept).

## Locked decisions (Grant 2026-06-07)

1. Goal: IN-LAB live collab first (foundation for external later).
2. Doc granularity: ONE Loro doc PER purchase item (mirrors one-doc-per-note), each with
   its own `.loro` sidecar + the existing `.json` mirror kept for legacy readers / lists /
   the approval workflow.

## Data model (grounding)

A `PurchaseItem` (frontend/src/lib/types.ts) is a FLAT STRUCTURED record (~20 scalar
fields: item_name, quantity, link, cas, price_per_unit, shipping_fees, total_price,
notes, funding_string, vendor, category, assigned_to, order_status, approval state
machine approved/approved_by/approved_at/declined_at/declined_by, flagged, attribution
last_edited_by/_at). Stored at `users/<owner>/purchase_items/<id>.json`, read/written via
`lib/purchases/owner-scoped-api.ts` + `lib/local-api.ts` (JsonStore), and the lab-head
approval workflow writes it directly in `lib/lab/pi-actions.ts` (setPurchaseApproval /
declinePurchase / setOrderStatus, all gated by assertLiveSession).

## Loro model

A purchase item is STRUCTURED, not text, so the doc is a FIELD MAP, not a LoroText:
- `meta` LoroMap: `collab_doc_id` (same key notes/tasks use, so getCollabDocId +
  buildCollabBaseDoc adopt-from-DO are reused entity-agnostically).
- `fields` LoroMap: one key per PurchaseItem scalar field. LoroMap is last-write-wins per
  key, so concurrent edits to DIFFERENT fields merge and same-field is LWW. Numbers /
  strings / booleans / null stored directly; no nested CRDT needed for v1 (flagged is a
  small object, store as a serialized value or a nested map).
- Deterministic seed from the `.json` record (a fixed seed actor + single import) so two
  devices rebuilding from the same JSON converge rather than fork (mirror seedTaskDoc).

Sidecar: `users/<owner>/purchase_items/<id>.loro`. Persist writes BOTH the `.loro` and
the `.json` mirror (mirror task-sidecar-store), so every legacy reader (lists, lab-wide
approval queue, pi-actions) keeps working unchanged while Loro owns the live truth when on.

## Reuse vs new

REUSE (entity-agnostic, done): the relay DO, getCollabDocId, buildCollabBaseDoc adopt,
the always-on connect-token, useCollabSession, the sidecar+mirror persistence pattern,
the module handle-cache pattern. NEW: purchase-doc.ts (field-map model), purchase-
sidecar-store.ts, purchase-store.ts (openPurchaseDoc + handle), the UI/read wiring, and
routing pi-actions writes through the doc.

## Flag

New `PURCHASE_LORO_ENABLED` (default false) in lib/loro/config.ts, independent of
LORO_PILOT_ENABLED, so this stays dormant until deliberately turned on.

## Chunked plan

1. FOUNDATION (isolated, testable, no UI): purchase-doc.ts (field-map Loro model + seed
   from PurchaseItem + field accessors + a toPurchaseFields projection), purchase-sidecar-
   store.ts (loadOrRebuild + persist = .loro sidecar + .json mirror at
   users/<owner>/purchase_items/<id>.{loro,json}), purchase-store.ts (openPurchaseDoc(owner,
   id) + PurchaseDocHandle, mirroring task-store: debounced commit, subscribe,
   commitPending, entity-agnostic collab adopt). Tests. Flag-gated. NO read/write wiring yet.
2. READ wiring: the Purchases lists + per-task panel read the Loro field projection and
   subscribe for live updates; auto-connect on open (mint collab_doc_id on the shared
   context, grant-on-share parity).
3. WRITE wiring: route the field edits + the pi-actions approval/order-status writes
   through the Loro doc (update fields map -> persist .loro + .json mirror -> relay fans
   out), KEEPING the assertLiveSession gate intact. The .json mirror keeps legacy readers
   correct.
4. Polish / presence (optional) + version history via the entity VC engine.

## Non-goals (v1)

- Not external purchase sharing (later arc, reuses grant/inbox/accept).
- Not changing the approval security model (assertLiveSession stays authoritative).
- Not changing notes/experiments.

## Voice

No em-dashes, no emojis, no mid-sentence colons.
