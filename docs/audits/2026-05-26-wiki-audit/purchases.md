# Wiki audit: Purchases + Funding

Anchor: main @ 14ea9892
Audit scope: `/wiki/features/purchases` vs `/purchases`, `PurchaseEditor`, `SpendingDashboard`, `LabPurchasesWidget`, `LabPurchasesBurnRateWidget`, `LabPurchasesPendingCountWidget`, `lib/types.ts` purchase helpers.
Wiki page audited: `frontend/src/app/wiki/features/purchases/page.tsx` (510 lines).
Audited by: wiki audit: purchases

Counts at the bottom.

---

## P0 (wrong: page contradicts the app code)

### P0-1. The filter chip strip is described as three chips, the app has four

Wiki says (lines 14, 107, 114): "three filter chips 'All / Project purchases / Miscellaneous'", "a three-chip segmented control", "All three chips display a live count badge".

App code at `frontend/src/app/purchases/page.tsx:404-424` renders FOUR chips:
1. All
2. Project purchases
3. Miscellaneous
4. Awaiting approval (members) / Pending approval (lab heads), label flips per role

The fourth chip was added 2026-05-24 in the Purchases UX fix (Bug 2). The wiki misses it entirely. The screenshot alt-text on line 14 also enumerates only three.

Fix: rewrite the unified-scroll section to describe four chips, call out the per-role label flip, and document the `isPurchasePending` predicate that decides which tasks land in the new chip (the chip counts a task as pending if any line item has `!approved && !declined_at`).

### P0-2. "Recently declined" section is on the wrong widget

Wiki says (lines 411-418): "The Pending Approvals tab also shows a Recently declined section at the bottom so a Lab Head can Re-approve a previously-declined purchase without making the member resubmit."

Code reality: the "Recently declined" + Re-approve UI lives in `PiActionsWidget.tsx:675-863`, not in `LabPurchasesWidget.tsx`. The LabPurchases popup's Pending Approvals tab (`LabPurchasesWidget.tsx:611-668`) renders only the pending-items list. The comment at line 700 in the widget confirms this: declined items "drop out of this Tab A list ... and surfaces in the PiActions popup's Recently declined section".

Fix: either move the prose to clarify "Recently declined lives in the PI Actions widget, not LabPurchases", or split the audience: members see the badge on their own list; lab heads re-approve from PI Actions. The current wording sends a Lab Head looking in the wrong popup.

### P0-3. The "Open in Lab Overview" shortcut next to Export CSV does not exist

Wiki says (lines 362-369): "Next to the export button, Lab Heads see a Open in Lab Overview shortcut that opens the same purchase data inside the LabPurchases Tool popup".

Code reality: `SpendingDashboard.tsx:370-398` only renders the Export CSV button. There is no Lab Overview shortcut anywhere in the dashboard header, and no router import for that intent. The lab-head banner above the chip strip (`/purchases/page.tsx:326-391`) IS the only Lab Overview routing affordance, and it lives at the top of the page, not next to Export CSV.

Fix: delete the paragraph, or rewrite it to describe the actual banner ("Lab Heads landing on /purchases with a non-empty lab queue see an amber banner at the top with an 'Open Lab Overview' CTA").

---

## P1 (missing: shipped surfaces the wiki does not mention)

### P1-1. The lab-head pending-approval banner is undocumented

`/purchases/page.tsx:326-391` renders an amber banner for lab heads with a non-empty lab-wide pending count, pointing them at /lab-overview. Shipped 2026-05-24 (Purchases UX fix Bug 3) and re-touched 2026-05-25 (R2 Literal Reader fix — CTA label changed from "Open lab purchases" to "Open Lab Overview" for honesty). The wiki never mentions the banner, even though the entire purpose is to teach a fresh lab head that /purchases is personal-scope.

### P1-2. `isPurchasePending` predicate + the three-state machine are absent

`lib/types.ts:1492-1500` defines the canonical pending predicate and an inline state machine: pending / approved / declined, with `declined_at` as the discriminator. Multiple surfaces (PiActions, LabPurchases pending tab, MetricsWidget, the new awaiting-approval chip) depend on this. The wiki references `PurchaseDeclinedBadge` (line 410) and `declined_at` exists implicitly behind the "decline state" paragraph, but the predicate name and the state machine are never spelled out, so a reader can't reconcile "approved is informational, not blocking" (correct) with "declined drops it out of pending" (also correct) without reading types.ts.

### P1-3. /purchases hidden from lab heads is implied, never stated

Wiki says (lines 372-373): "Lab Heads do not have /purchases in their nav."

Implementation: the route still works; it's just hidden from `AppShell`. Lab heads who deep-link or click the banner DO land on it, see the personal banner, the personal chip strip (now with "Pending approval" label), and a personal spending dashboard. The wiki frames /purchases as member-only but a lab head who arrives there sees a tailored UI. Worth a line.

### P1-4. The lab-head pending banner's CTA renames itself (R2 fix) is the kind of UX detail that should be cited if the wiki documents the banner

Tied to P1-1. If P1-1 is fixed, mention the label "Open Lab Overview" so a reader who screencaps the page recognizes it. (No action if P1-1 is rejected.)

---

## P2 (stale / nit)

### P2-1. Order of the two header buttons is reversed

Wiki says (lines 31-34): "Purchases · N orders · $X.XX total ... To the right is the Manage Funding Accounts button".

Code (`page.tsx:283-297`) renders the buttons in this DOM order: `+ New Purchase` first, then `Manage Funding Accounts` second. Both are in a right-aligned cluster, so Manage Funding Accounts is in fact rightmost. The wiki's phrasing implies Manage Funding is "to the right" of the title block but doesn't say it's to the right of +New Purchase. Marginal; a reader looking at the screenshot will reconcile. Worth a tiny copy fix only if the section gets touched.

### P2-2. The four LabPurchases tab labels are clipped from the actual UI strings

Wiki bullets (lines 379-405): "Pending approvals", "All purchases", "Funding", "Spending".

Code (`LabPurchasesWidget.tsx:512-552`): "Pending approvals", "All purchases", "Funding accounts", "Spending overview".

Two of four are abbreviated. A user searching for "Funding accounts" tab won't match.

### P2-3. Burn-rate range default not stated

Wiki (lines 433-435) lists the four range buttons (4w, 8w, 12w, 6mo) but does not say which is default. Code: `LabPurchasesBurnRateWidget.tsx:79` → `DEFAULT_RANGE: BurnRateRange = "4w"`. The range is persisted to localStorage per the widget. Minor — would help a screenshot caption.

### P2-4. Loose statement: "Lab Mode link" mentioned in a TODO screenshot block

`page.tsx:353` line of the wiki, inside the screenshot TODO comment: "dashboard with the Export CSV button visible (no Lab Mode link)". This is internal capture guidance, not user-facing prose; included here only so the next screenshot recapture doesn't reintroduce a stale "Lab Mode link" reference.

---

## Counts

- P0 (wrong): 3
- P1 (missing): 4
- P2 (stale / nit): 4
- Total: 11 findings

Files referenced:

- `frontend/src/app/wiki/features/purchases/page.tsx`
- `frontend/src/app/purchases/page.tsx`
- `frontend/src/components/PurchaseEditor.tsx`
- `frontend/src/components/SpendingDashboard.tsx`
- `frontend/src/components/lab-overview/widgets/LabPurchasesWidget.tsx`
- `frontend/src/components/lab-overview/widgets/LabPurchasesBurnRateWidget.tsx`
- `frontend/src/components/lab-overview/widgets/PiActionsWidget.tsx`
- `frontend/src/components/lab-head/PurchaseApprovalControls.tsx`
- `frontend/src/lib/types.ts` (PurchaseItem, isPurchasePending)
