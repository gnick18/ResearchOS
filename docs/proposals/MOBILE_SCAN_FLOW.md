# Mobile scan flow (receive, track, deduct, reorder)

Build contract for the barcode receiving/inventory loop. Mockup signed off 2026-06-08 (`docs/mockups/2026-06-08-mobile-scan-flow.html`, 7 frames). The web data-shape foundation is already on main (`41d5217f9`, units_per_scan + units_remaining on InventoryStock, deductUnitsFromScan + registerTrackedBarcode in barcode-consume.ts).

This doc is the source of truth for the snapshot data shapes and the action contentTypes so the web side and the mobile side build against the same contract.

## The loop

1. Scan a package (Today hero Scan card, or the Send scan affordance).
2. Unknown barcode, "new package":
   - best-effort autopopulate (past purchases by barcode first, optional public UPC db fallback) surfaces a product guess and pre-highlights the likely recent order.
   - three paths: match a recent ordered purchase, add a new purchase order inline (barcode-prefilled, confirm before save), or add as plain inventory.
   - matching a purchase marks it arrived and links it to inventory.
3. "Track this barcode?" set units-per-scan + total-in-box (and the unit label). Skippable.
4. Later scan of a tracked barcode, deduct. Big 1 default + one-tap Deduct, quick +/- and chips for use-3-at-once. No keyboard.
5. "Low, reorder ASAP" reorders from the linked purchase order.

## Snapshot additions (laptop publishes, phone reads)

The existing inventory snapshot (`buildInventorySnapshot`, sealed per device) gains:

- `trackedStocks[]`, one per InventoryStock that has `product_barcode` AND `units_per_scan` set:
  `{ stockId, itemName, vendor, productBarcode, unitsPerScan, unitsRemaining, unitLabel, lowAtCount, purchaseItemId, totalUnits }`
- `recentPurchases[]`, ordered-but-not-arrived purchase items (order_status === "ordered"):
  `{ purchaseItemId, name, vendor, orderedDate, catalog, productBarcode? }`
- `barcodeIndex`, a best-effort map of known `productBarcode -> { name, vendor, catalog }` drawn from past purchases/stocks, for the autopopulate guess.

All additive. The phone matches a scanned value against `trackedStocks[].productBarcode` (known, go to deduct) else `barcodeIndex` (guess for the new-package flow) else unknown (blank new-package flow).

## Action contentTypes (phone uploads device-signed, laptop poll applies)

Phone uploads a device-signed capture via the existing relay upload, with these contentTypes. `runCaptureInboxPoll` / `classifyCapture` gain handlers that apply each to the real data, then invalidate React Query.

- `application/x-researchos-mark-arrived` `{ purchaseItemId }` -> `purchasesApi.setOrderStatus(purchaseItemId, "received")` + create/link an InventoryStock (purchase_item_id link).
- `application/x-researchos-register-tracker` `{ stockId | purchaseItemId, productBarcode, unitsPerScan, totalUnits, unitLabel }` -> `registerTrackedBarcode(...)`.
- `application/x-researchos-deduct` `{ stockId | productBarcode, amount }` -> deduct `amount` from `units_remaining` (foundation `deductUnitsFromScan` extended with a multiplier).
- `application/x-researchos-reorder` `{ purchaseItemId }` -> `createReorderPurchase` / `seedFromPurchaseItem` (a REAL needs-ordering purchase, upgrading the current lands-as-a-Note behavior).

## Chunks

- **W1 (web, foundation tweak):** `deductUnitsFromScan(stock, multiplier = 1)`; keep single-scan default.
- **W2 (web, snapshot):** extend `buildInventorySnapshot` with trackedStocks + recentPurchases + barcodeIndex.
- **W3 (web, poll apply):** the 4 action handlers above in poll.ts, real reorder via createReorderPurchase. FLAG: any new field (e.g. `scan_unit_label` if no existing unit field fits) before committing.
- **M1 (mobile):** Today hero Scan card + Send scan affordance + the scan screen (multi-format, manual entry).
- **M2 (mobile):** the sheets, match/confirm/track/deduct/reorder, against the snapshot + action contract; rainbow top+bottom on every screen.

Web chunks land behind INVENTORY_ENABLED, additive, and wait for verification before merge. Mobile builds on main directly.
