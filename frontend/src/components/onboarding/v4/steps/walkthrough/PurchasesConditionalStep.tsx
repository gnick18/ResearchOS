"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { purchasesApi, tasksApi } from "@/lib/local-api";
import { patchOnboarding } from "@/lib/onboarding/sidecar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTourController } from "../../TourController";
import type { TourStep } from "../../step-types";
import { appendArtifact, findArtifact } from "./lib/artifacts";
import { readOnboarding } from "@/lib/onboarding/sidecar";

/**
 * §6.14 Purchases (conditional Q2 = yes).
 *
 * Per the proposal: BeakerBot creates a funding source name + a funny
 * sample purchase via cursor. ResearchOS has no standalone funding
 * "source" model: `funding_string` is a per-item string column on
 * `PurchaseItem` (see `lib/types.ts:1231`). So the v4 demo writes the
 * funding string directly into the sample purchase and tracks both
 * artifacts (the parent task + the line item) on the sidecar so Phase
 * 4 (P8) renders both rows in the cleanup grid.
 *
 * **Important artifact handling:** purchase has cleanup_default: "keep"
 * through main tour. If Q1 === "lab", the purchase reappears in the
 * Lab Mode tour's lab-purchases view per §6.14 final-fate-at-cleanup
 * shape. P7 will need to consume the same artifact when wiring the lab
 * tour scope. P7 may not currently reuse it; the artifact tag stays
 * stable so a future P7 patch can opt in without coordination.
 *
 * Funding string name: "BeakerBot's allowance" (placeholder per spec
 * §6.14 sample). Amount: $1000 (carried implicitly via the purchase's
 * total_price field rather than a separate funding-source record).
 *
 * Sample purchase:
 *   item_name      = "12-well Plates Of Premium Hand-Painted Quality"
 *   vendor         = "BeakerBot's Boutique"
 *   price_per_unit = $42.00
 *   quantity       = 1
 *   funding_string = "BeakerBot's allowance"
 *
 * Both strings match the spec's "funny placeholder" tone.
 *
 * **Speech copy rule (Grant standing):** NO EM-DASHES. The speech uses
 * commas, colons, period splits.
 *
 * Classification (per Grant's design correction 2026-05-21): BEAKERBOT
 * DEMO. Speech is "Let me show you how it works. I'll make us a
 * funding source and a sample purchase", an explicit BeakerBot-led
 * promise. The inner React component drives the API spawn directly;
 * no cursorScript is wired into this step body (the cursor primitives
 * aren't expressive enough for this flow), so there's no click/type
 * action to strip. Classification documented for future maintainers.
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

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Inner speech-bubble component
// ---------------------------------------------------------------------------

/**
 * Renders the Purchases demo flow. On mount, BeakerBot kicks off the
 * funding-string + purchase creation. The speech bubble narrates each
 * stage. Auto-advances ~2s after the purchase saves so the user sees
 * the confirmation before the spotlight moves.
 *
 * Idempotent across re-mounts: reads the sidecar's existing artifacts
 * and short-circuits creation if a purchase tagged for this tour is
 * already on disk (the resume-state contract per §8.1).
 */
function PurchasesDemoBody() {
  const { currentUser } = useCurrentUser();
  const { advance, noteEventFired } = useTourController();
  const username = currentUser ?? "";

  const [stage, setStage] = useState<
    "idle" | "creating-funding" | "creating-purchase" | "done" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    taskId: number;
    itemId: number;
  } | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) {
        clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
    };
  }, []);

  const persistArtifacts = useCallback(
    async (taskId: number, itemId: number) => {
      if (!username) return;
      try {
        await patchOnboarding(username, (cur) => {
          let next = appendArtifact(cur, {
            type: "funding_string",
            id: FUNDING_STRING_NAME,
            // §6.14 (live-test R6 follow-up 2026-05-22): the tour's
            // funding string is named "BeakerBot's allowance" which
            // is obviously throwaway — keeping it post-tour leaves a
            // mascot-named line in the real user's purchase
            // dashboard. Flipped to "discard" so the cleanup grid
            // pre-checks it for removal; a user who actually wants a
            // BeakerBot-themed funding line can uncheck the row.
            cleanup_default: "discard",
          });
          next = appendArtifact(next, {
            type: "purchase",
            id: String(taskId),
            // §6.14: purchase is cleanup_default: "keep" through main
            // tour; the lab-mode tour (Q1=lab path, §6.16) reuses the
            // same purchase artifact for its lab-purchases view. Final
            // fate is the user's call at the Phase 4 cleanup grid.
            cleanup_default: "keep",
          });
          // Also record the line item id so cleanup can scope its
          // delete to this specific row (the parent task may carry
          // other line items if the user keeps adding to it during
          // the tour).
          next = appendArtifact(next, {
            type: "purchase_item",
            id: String(itemId),
            cleanup_default: "keep",
          });
          return next;
        });
      } catch (err) {
        console.error(
          "[onboarding-v4] Purchases artifact persist failed:",
          err,
        );
      }
    },
    [username],
  );

  // Auto-run the creation flow once on mount. The startedRef + sidecar
  // probe guards against double-create on a re-mount (the controller
  // can re-render the speech bubble component without losing the
  // step). Re-entries pick up the existing artifact and skip straight
  // to the "done" stage.
  useEffect(() => {
    if (startedRef.current || !username) return;
    startedRef.current = true;

    void (async () => {
      try {
        // Probe an existing v4 purchase artifact. If present, skip
        // creation and jump to done so the resume contract holds.
        const cur = await readOnboarding(username);
        const existingPurchase = findArtifact(cur, "purchase");
        if (existingPurchase) {
          const taskId = Number(existingPurchase.id);
          if (Number.isFinite(taskId)) {
            setCreated({ taskId, itemId: -1 });
            setStage("done");
            // Resume path: existing artifact found, jump straight to
            // the done view. Manual advance via the Got it, next
            // button below — no timer.
            return;
          }
        }

        // Stage 1: announce the funding-string create. ResearchOS
        // doesn't have a separate funding-source record; we narrate
        // it then carry it into the purchase line item below.
        setStage("creating-funding");
        // Tiny pause so the narration lands.
        await new Promise((res) => setTimeout(res, 700));

        // Stage 2: create the parent task + purchase line item with
        // the funding string baked in.
        setStage("creating-purchase");
        const purchaseTask = await tasksApi.create({
          name: PURCHASE_TASK_NAME,
          start_date: todayLocal(),
          duration_days: 1,
          task_type: "purchase",
        });
        const item = await purchasesApi.create({
          task_id: purchaseTask.id,
          item_name: PURCHASE_ITEM_NAME,
          quantity: PURCHASE_QTY,
          price_per_unit: PURCHASE_PRICE,
          vendor: PURCHASE_VENDOR,
          funding_string: FUNDING_STRING_NAME,
        });

        setCreated({ taskId: purchaseTask.id, itemId: item.id });
        await persistArtifacts(purchaseTask.id, item.id);
        setStage("done");
        // Live-test R6 (2026-05-22): the auto-advance after 2s was
        // too fast for the user to read the demo's confirmation copy
        // (purchase task, line item, funding string narration). The
        // step now waits for the manual "Got it, next" button surfaced
        // by `completion: { type: "manual" }` below. No timer.
      } catch (err) {
        console.error(
          "[onboarding-v4] Purchases demo create failed:",
          err,
        );
        setError(
          "Couldn't create the sample purchase. The Purchases tab still works, this is just the tour demo. You can move on.",
        );
        setStage("error");
        // Even the error path waits for manual advance so the user
        // sees the inline failure copy.
      }
    })();
  }, [username, advance, noteEventFired, persistArtifacts]);

  if (stage === "idle" || stage === "creating-funding") {
    return (
      <div className="space-y-2" data-testid="purchases-creating-funding">
        <p>
          You wanted the Purchases tab. Let me show you how it works.
          I&apos;ll make us a funding source and a sample purchase.
        </p>
        <p className="text-xs text-gray-500">
          Setting up &ldquo;{FUNDING_STRING_NAME}&rdquo; ($
          {FUNDING_STRING_AMOUNT})...
        </p>
      </div>
    );
  }
  if (stage === "creating-purchase") {
    return (
      <div className="space-y-2" data-testid="purchases-creating-purchase">
        <p>
          Funding string ready. Now a sample purchase order:
          &ldquo;{PURCHASE_ITEM_NAME},&rdquo; vendor {PURCHASE_VENDOR},
          ${PURCHASE_PRICE}.00, quantity {PURCHASE_QTY}. Charging it
          against {FUNDING_STRING_NAME}.
        </p>
      </div>
    );
  }
  if (stage === "error") {
    return (
      <div className="space-y-2" data-testid="purchases-error">
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
          {error}
        </p>
      </div>
    );
  }
  // done
  return (
    <div className="space-y-2" data-testid="purchases-done">
      <p>
        Done. Your sample purchase is on the Purchases tab, charged to
        {" "}{FUNDING_STRING_NAME}. The Purchases tab tracks line items,
        totals roll up by funding string, and each purchase ties back
        to its task. Real labs use this for reagent orders, equipment
        quotes, anything you spend money on.
      </p>
      {created ? (
        <p className="text-xs text-gray-500">
          Task #{created.taskId}
          {created.itemId > 0 ? ` (line item #${created.itemId})` : ""}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step body export
// ---------------------------------------------------------------------------

/**
 * §6.14 conditional walkthrough step. The inner component creates the
 * funding string + sample purchase then auto-advances ~2s after the
 * purchase saves (per spec). Completion is event-driven so the bubble
 * doesn't render a redundant "Got it, next" button.
 *
 * Conditional gate (purchases === "yes") is enforced by
 * `step-machine.ts isStepGatedOut`. `conditionalOn` here mirrors that
 * predicate for self-description.
 *
 * `onEnter` navigates to /purchases via `router.push` once P7 wires up
 * the router on the TourController context. Until then the spotlight
 * silently no-ops on missing target selectors (per TourSpotlight's
 * unresolved-selector behavior) and the demo runs purely via the API.
 */
export const purchasesConditionalStep: TourStep = {
  id: "purchases",
  pose: "cheering",
  speech: () => <PurchasesDemoBody />,
  // Live-test R6 (2026-05-22): the prior event-driven completion fired
  // 2s after the purchase save, which was too fast for the user to
  // read the demo's confirmation copy. Switched to manual so the user
  // paces themselves through the funding-string + line-item demo.
  completion: {
    type: "manual",
    buttonLabel: "Got it, next",
  },
  // Spotlight target: the Purchases tab nav button. Selector is the
  // same shape AppShell sidebar uses; TourSpotlight silently no-ops
  // when the user is on a non-Purchases route.
  targetSelector: "[data-tour-target='purchases-tab']",
  conditionalOn: (picks) => picks?.purchases === "yes",
  // Auto-navigate to /purchases on refresh so the demo's tab + cards
  // are visible (per Grant's refresh-mid-tour bug).
  expectedRoute: "/purchases",
};

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
