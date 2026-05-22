"use client";

import { useEffect, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { readOnboarding } from "@/lib/onboarding/sidecar";
import type { TourStep } from "../../step-types";
import { findArtifact, flushPendingArtifacts, pendingArtifactStore } from "./lib/artifacts";
import {
  cursorScript,
  compactScript,
  safeClickAction,
  safeTypeAction,
} from "./lib/cursor-script";
import { buildWalkthroughStep } from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { TOUR_DOM_EVENTS } from "./lib/tour-events";

/**
 * §6.14 Purchases (conditional Q2 = yes).
 *
 * Live-test R2 rebuild (HR sub-bot 2026-05-22): the previous version
 * called `tasksApi.create` + `purchasesApi.create` directly inside a
 * `useEffect` in the speech-bubble body, so the user saw only the
 * narration copy land, nothing actually moved on the page. Per Grant,
 * BeakerBot's cursor must visibly drive the demo. This version:
 *
 *   1. Clicks "+ New Purchase" on /purchases (opens NewPurchaseModal).
 *   2. Types the item name, vendor, price, quantity, and funding
 *      string into the modal's inputs.
 *   3. Clicks Save. The modal's submit handler (handleSave in
 *      NewPurchaseModal.tsx) drives the real API path:
 *      `tasksApi.create` for the parent task,
 *      `purchasesApi.createFundingAccount` for the funding string row
 *      if missing, and `purchasesApi.create` for the line item. It
 *      then dispatches `tour:purchase-created`.
 *   4. The step's `onEnter` listener catches the event detail and
 *      stashes three artifacts (funding_string + purchase +
 *      purchase_item). `onExit` flushes the pending list into
 *      `wizard_resume_state.artifacts_created`.
 *
 * Funding string name: "BeakerBot's allowance" (placeholder per §6.14
 * sample). Cleanup defaults: `discard` for the funding string (the
 * mascot-named line shouldn't survive into the user's real funding
 * dashboard, R6 fix preserved), `keep` for the purchase + line item
 * (the user gets to choose at the Phase 4 grid).
 *
 * Sample purchase:
 *   item_name      = "12-well Plates Of Premium Hand-Painted Quality"
 *   vendor         = "BeakerBot's Boutique"
 *   price_per_unit = $42.00
 *   quantity       = 1
 *   funding_string = "BeakerBot's allowance"
 *
 * **Speech copy rule (Grant standing):** NO EM-DASHES. The speech uses
 * commas, colons, period splits.
 *
 * Classification: BEAKERBOT DEMO. Speech is "Watch me set up a sample
 * purchase," an explicit BeakerBot-led promise. The cursor script
 * performs every click + type the speech promises.
 *
 * Resume contract: if the sidecar already records a `purchase`
 * artifact (refresh mid-step or back-step into a completed §6.14), the
 * body renders the post-create copy and the cursor script skips the
 * fill-form chain. The artifact probe lives in `PurchasesDemoBody`
 * (for the speech bubble) and in `cursorScript()` (for the action
 * planner).
 *
 * Completion stays MANUAL ("Got it, next") per the live-test R6 fix:
 * users need a beat to absorb the create before the spotlight moves.
 */

// ---------------------------------------------------------------------------
// Sample values (per §6.14)
// ---------------------------------------------------------------------------

const FUNDING_STRING_NAME = "BeakerBot's allowance";
const FUNDING_STRING_AMOUNT = 1000;
const PURCHASE_ITEM_NAME = "12-well Plates Of Premium Hand-Painted Quality";
const PURCHASE_VENDOR = "BeakerBot's Boutique";
const PURCHASE_PRICE = 42;
const PURCHASE_QTY = 1;
const PURCHASE_TASK_NAME = "Sample purchase (tour demo)";

const STEP_ID = "purchases";

// ---------------------------------------------------------------------------
// Inner speech-bubble component
// ---------------------------------------------------------------------------

/**
 * Renders the speech-bubble copy for the cursor demo. The bubble is
 * narration only, the cursor script does the actual work. Two stages
 * are visible to the user:
 *
 *   1. "watching" — the cursor is mid-flight; the bubble explains the
 *      goal.
 *   2. "done" — `tour:purchase-created` fired; the bubble switches to
 *      the post-create wrap-up copy.
 *
 * Idempotent across re-mounts: on mount, reads the sidecar for an
 * existing `purchase` artifact and jumps straight to the "done" stage.
 * The cursor script itself runs a sibling DOM check at script-build
 * time so re-running the step doesn't re-fire the create.
 */
function PurchasesDemoBody() {
  const { currentUser } = useCurrentUser();
  const username = currentUser ?? "";

  const [stage, setStage] = useState<"watching" | "done">("watching");

  // Resume probe: if a `purchase` artifact already lives in the
  // sidecar, this step ran before. Skip straight to the post-create
  // narration so the user isn't told to "watch" a thing that already
  // happened.
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    void (async () => {
      try {
        const cur = await readOnboarding(username);
        const existing = findArtifact(cur, "purchase");
        if (existing && !cancelled) {
          setStage("done");
        }
      } catch {
        // Best-effort probe; on read failure assume fresh entry.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

  // Flip to the "done" view as soon as the tour event fires. The
  // cursor's safeClickAction on the submit button resolves while the
  // form is still mid-save; the event fires after the API resolves.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setStage("done");
    window.addEventListener(TOUR_DOM_EVENTS.purchaseCreated, handler);
    return () => {
      window.removeEventListener(TOUR_DOM_EVENTS.purchaseCreated, handler);
    };
  }, []);

  if (stage === "watching") {
    return (
      <div className="space-y-2" data-testid="purchases-watching">
        <p>
          You wanted the Purchases tab. Watch me set up a sample
          purchase. I&apos;ll click New Purchase, fill in the form, and
          save.
        </p>
        <p className="text-xs text-gray-500">
          Funding string: &ldquo;{FUNDING_STRING_NAME}&rdquo; ($
          {FUNDING_STRING_AMOUNT} placeholder budget). Item:
          &ldquo;{PURCHASE_ITEM_NAME}&rdquo; from {PURCHASE_VENDOR},
          ${PURCHASE_PRICE}.00, quantity {PURCHASE_QTY}.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="purchases-done">
      <p>
        Done. Your sample purchase is on the Purchases tab, charged to
        {" "}{FUNDING_STRING_NAME}. The Purchases tab tracks line items,
        totals roll up by funding string, and each purchase ties back
        to its task. Real labs use this for reagent orders, equipment
        quotes, anything you spend money on.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step body export
// ---------------------------------------------------------------------------

export const purchasesConditionalStep: TourStep = buildWalkthroughStep({
  id: STEP_ID,
  pose: "cheering",
  speech: () => <PurchasesDemoBody />,
  targetSelector: targetSelector(TOUR_TARGETS.purchasesForm),
  // Cursor script — see top-of-file comment. The script is idempotent
  // on resume: at build time, peek at the DOM. If neither the
  // "+ New Purchase" button nor the modal is on screen (the user
  // navigated away), return an empty action list.
  cursorScript: cursorScript(async () => {
    if (typeof document !== "undefined") {
      const modalOpen = document.querySelector(
        `[data-tour-target="${TOUR_TARGETS.purchasesForm}"]`,
      );
      const buttonPresent = document.querySelector(
        `[data-tour-target="${TOUR_TARGETS.purchasesNewButton}"]`,
      );
      if (!modalOpen && !buttonPresent) return [];
    }

    // 1. Click the "+ New Purchase" button. NewPurchaseModal mounts.
    //    safeClickAction returns null when the button isn't on
    //    screen, which covers the "modal already open" resume case.
    const openModal = await safeClickAction(
      targetSelector(TOUR_TARGETS.purchasesNewButton),
    );

    // 2. Type the item name. 25ms cadence keeps the per-input typing
    //    visible without dragging the demo out, the same cadence the
    //    §6.4d methods-create demo uses.
    const typeName = await safeTypeAction(
      targetSelector(TOUR_TARGETS.purchasesFormName),
      PURCHASE_ITEM_NAME,
      25,
    );

    // 3. Type the vendor.
    const typeVendor = await safeTypeAction(
      targetSelector(TOUR_TARGETS.purchasesFormVendor),
      PURCHASE_VENDOR,
      25,
    );

    // 4. Type the price (text input with inputMode=decimal, the
    //    modal parses to float on submit).
    const typePrice = await safeTypeAction(
      targetSelector(TOUR_TARGETS.purchasesFormPrice),
      PURCHASE_PRICE.toFixed(2),
      40,
    );

    // 5. Type the quantity. NewPurchaseModal seeds "1" into the input
    //    by default, so when PURCHASE_QTY === 1 the typed value would
    //    visibly append a second "1" (cursor.typeInto appends to the
    //    existing value). Skip the type step in that case; the
    //    spotlight still moves past the field via the next safeType
    //    action's glide.
    const typeQty = PURCHASE_QTY === 1
      ? null
      : await safeTypeAction(
          targetSelector(TOUR_TARGETS.purchasesFormQuantity),
          String(PURCHASE_QTY),
          40,
        );

    // 6. Type the funding-string name. NewPurchaseModal's submit
    //    handler creates the FundingAccount row if no existing
    //    account matches.
    const typeFunding = await safeTypeAction(
      targetSelector(TOUR_TARGETS.purchasesFormFunding),
      FUNDING_STRING_NAME,
      25,
    );

    // 7. Click Save. NewPurchaseModal.handleSave runs the real API
    //    chain + dispatches `tour:purchase-created`. The step's
    //    onEnter listener captures the artifact ids out of the event
    //    detail; this step's manual-advance completion waits for the
    //    user to acknowledge with "Got it, next".
    const submit = await safeClickAction(
      targetSelector(TOUR_TARGETS.purchasesFormSubmit),
    );

    return compactScript([
      openModal,
      typeName,
      typeVendor,
      typePrice,
      typeQty,
      typeFunding,
      submit,
    ]);
  }),
  // Live-test R6 (preserved): manual "Got it, next" completion so the
  // user paces themselves through the funding-string + line-item demo.
  completion: {
    type: "manual",
    buttonLabel: "Got it, next",
  },
  conditionalOn: (picks) => picks?.purchases === "yes",
  // Capture the artifact ids out of the `tour:purchase-created` DOM
  // event detail (dispatched by NewPurchaseModal on save success). The
  // funding string lands as `cleanup_default: "discard"` (R6 fix) so
  // "BeakerBot's allowance" doesn't survive into the user's real
  // funding dashboard; the purchase + purchase_item land as "keep" so
  // the user can decide at the Phase 4 grid. `onExit` flushes via the
  // shared pendingArtifactStore (same pattern as §6.4d methods-create
  // and §6.1 home-create-project-fill).
  onEnter: () => {
    if (typeof window === "undefined") return;
    const handler = (evt: Event) => {
      const detail = (
        evt as CustomEvent<{
          taskId?: number;
          itemId?: number;
          fundingString?: string | null;
        }>
      ).detail;
      const taskId = detail?.taskId;
      const itemId = detail?.itemId;
      const fundingString = detail?.fundingString;
      if (taskId === undefined || taskId === null) return;
      if (fundingString) {
        pendingArtifactStore.add(STEP_ID, {
          type: "funding_string",
          id: fundingString,
          // R6 follow-up: discard so the mascot-named line is
          // pre-checked for removal at the Phase 4 grid.
          cleanup_default: "discard",
        });
      }
      pendingArtifactStore.add(STEP_ID, {
        type: "purchase",
        id: String(taskId),
        cleanup_default: "keep",
      });
      if (itemId !== undefined && itemId !== null) {
        pendingArtifactStore.add(STEP_ID, {
          type: "purchase_item",
          id: String(itemId),
          cleanup_default: "keep",
        });
      }
      window.removeEventListener(TOUR_DOM_EVENTS.purchaseCreated, handler);
    };
    window.addEventListener(TOUR_DOM_EVENTS.purchaseCreated, handler);
  },
  onExit: async () => {
    await flushPendingArtifacts(STEP_ID);
  },
  // Auto-navigate to /purchases on refresh so the modal anchor + the
  // "+ New Purchase" button resolve when the user reloads mid-step.
  expectedRoute: "/purchases",
});

// Re-exports for tests + P8 cleanup-grid matching.
export {
  FUNDING_STRING_NAME,
  FUNDING_STRING_AMOUNT,
  PURCHASE_ITEM_NAME,
  PURCHASE_VENDOR,
  PURCHASE_PRICE,
  PURCHASE_QTY,
  PURCHASE_TASK_NAME,
};
