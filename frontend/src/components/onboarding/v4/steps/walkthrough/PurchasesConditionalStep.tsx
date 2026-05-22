"use client";

import { useEffect, useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { readOnboarding } from "@/lib/onboarding/sidecar";
import type { TourStep } from "../../step-types";
import { useOptionalTourController } from "../../TourController";
import {
  findArtifact,
  flushPendingArtifacts,
  pendingArtifactStore,
} from "./lib/artifacts";
import {
  callbackAction,
  compactScript,
  cursorScript,
  safeClickAction,
  safeGlideToElementAction,
  safeTypeAction,
  waitForElement,
} from "./lib/cursor-script";
import {
  branchOn,
  buildWalkthroughStep,
  manualAdvance,
  advanceOnEvent,
} from "./lib/step-helpers";
import { TOUR_TARGETS, targetSelector } from "./lib/targets";
import { TOUR_DOM_EVENTS } from "./lib/tour-events";

/**
 * §6.14 Purchases — redesigned 2026-05-22 (Purchases manager).
 *
 * The single `purchases` step is split into an 8-step cluster spanning
 * two narrative phases:
 *
 *   Phase 1 (teach on the user's empty page):
 *     - purchases-intro              universal speech, manual advance
 *     - purchases-create-button-click user-action, page-lock on "+ New"
 *     - purchases-form-fill          BeakerBot demo: coffee bean order
 *     - purchases-autocomplete-demo  user-action: F1 autocomplete demo
 *
 *   Phase 2 (warp to Alex's account for the analytics teach):
 *     - purchases-demo-warp-prompt   button-driven branchOn
 *     - purchases-demo-viewer        mounts DemoPurchasesViewer overlay
 *     - purchases-demo-charts        BeakerBot demo inside the overlay
 *     - purchases-back-to-real       button-driven branchOn to dismiss
 *
 * Coordination with siblings:
 *   - TourPageLock (Gantt manager): used by the two user-action steps
 *     for click-allow-listing.
 *   - branchOn completion (Hybrid editor manager): used by the two
 *     button-driven warp/back steps.
 *   - The legacy `tour:purchase-created` DOM event still fires from
 *     `NewPurchaseModal.handleSave`; this file captures the artifacts
 *     from the form-fill step's onEnter listener.
 *
 * Artifacts (Phase 4 cleanup):
 *   - 1 purchase task (coffee bean order):      cleanup_default = "keep"
 *   - 1 PurchaseItem (the coffee beans):        cleanup_default = "keep"
 *   - 1 funding string ("BeakerBot's allowance"): cleanup_default = "discard"
 *   - The autocomplete demo cancels its modal so it never writes.
 *   - The viewer is read-only so it never writes.
 */

// ---------------------------------------------------------------------------
// Sample values (per §6.14 redesign — keep the coffee theme)
// ---------------------------------------------------------------------------

const FUNDING_STRING_NAME = "BeakerBot's allowance";
const FUNDING_STRING_AMOUNT = 1000;
const PURCHASE_ITEM_NAME = "Premium Costa Rica Coffee Beans";
const PURCHASE_VENDOR = "BeakerBot's Boutique";
const PURCHASE_PRICE = 18.99;
const PURCHASE_QTY = 2;
const PURCHASE_TASK_NAME = "Sample purchase (tour demo)";

const PURCHASES_FORM_FILL_STEP_ID = "purchases-form-fill";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Inline component for steps that use the TourPageLock allow-list. Sets
 * the lock on mount, clears on unmount. The optional-controller guard
 * lets the step body render in isolation tests without a provider.
 */
function PageLockSetter({
  allowList,
  wrongClickSpeech,
}: {
  allowList: readonly string[];
  wrongClickSpeech: React.ReactNode;
}) {
  const controller = useOptionalTourController();
  useEffect(() => {
    if (!controller) return;
    controller.setPageLock(allowList, wrongClickSpeech);
    return () => {
      controller.clearPageLock();
    };
  }, [controller, allowList, wrongClickSpeech]);
  return null;
}

// ---------------------------------------------------------------------------
// 1. purchases-intro — universal speech
// ---------------------------------------------------------------------------

/**
 * Pure-narration intro step. Lands the user on /purchases and explains
 * what the page is for (funding stream, category, project, experiment
 * tracking) before BeakerBot does anything mechanical. R7-D fix: the
 * old flow jumped straight to "click + New Purchase" with no framing.
 */
export const purchasesIntroStep: TourStep = buildWalkthroughStep({
  id: "purchases-intro",
  pose: "pointing",
  speech: (
    <div className="space-y-2" data-testid="purchases-intro">
      <p>
        This is your Purchases page. It summarizes every purchase order
        you&apos;ve ever logged.
      </p>
      <p>
        What&apos;s nice: every order rolls up automatically by funding
        source, by category, by project. No SUMIF wrangling, and the CSV
        export is grant-ready.
      </p>
      <p>
        I&apos;m going to show you how to make your first purchase order.
        (You can also make these straight from the Gantt chart, same form,
        different entry point.)
      </p>
    </div>
  ),
  completion: manualAdvance("Got it, next"),
  conditionalOn: (picks) => picks?.purchases === "yes",
  expectedRoute: "/purchases",
});

// ---------------------------------------------------------------------------
// 2. purchases-create-button-click — user-action with page-lock
// ---------------------------------------------------------------------------

const CREATE_BUTTON_ALLOW_LIST = [TOUR_TARGETS.purchasesNewButton] as const;
const CREATE_BUTTON_WRONG_CLICK = (
  <>
    <p className="mb-1">Oops, that&apos;s not the right thing.</p>
    <p>Click the blue &ldquo;+ New Purchase&rdquo; button to start your first order.</p>
  </>
);

function PurchasesCreateButtonBody() {
  return (
    <>
      <PageLockSetter
        allowList={CREATE_BUTTON_ALLOW_LIST}
        wrongClickSpeech={CREATE_BUTTON_WRONG_CLICK}
      />
      <p>Click the blue &ldquo;+ New Purchase&rdquo; button to get started.</p>
    </>
  );
}

export const purchasesCreateButtonClickStep: TourStep = buildWalkthroughStep({
  id: "purchases-create-button-click",
  pose: "pointing",
  speech: () => <PurchasesCreateButtonBody />,
  targetSelector: targetSelector(TOUR_TARGETS.purchasesNewButton),
  // Event-driven: advance when the NewPurchaseModal mounts (its
  // [data-tour-target="purchases-form"] anchor appears in the DOM). The
  // MutationObserver in `waitForElement` catches the React commit; the
  // 500ms polling fallback below guards against environments where the
  // observer misses the modal portal.
  completion: advanceOnEvent((advance) => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      const el = await waitForElement(
        targetSelector(TOUR_TARGETS.purchasesForm),
        60_000,
      );
      if (!cancelled && el) {
        advance();
      }
    })();
    // Belt + braces: every 500ms re-check the DOM (covers the
    // MutationObserver-misses-portal class of bug observed in jsdom).
    timer = setInterval(() => {
      if (cancelled) return;
      const el = document.querySelector(
        targetSelector(TOUR_TARGETS.purchasesForm),
      );
      if (el) {
        cancelled = true;
        if (timer) clearInterval(timer);
        advance();
      }
    }, 500);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }),
  conditionalOn: (picks) => picks?.purchases === "yes",
  expectedRoute: "/purchases",
});

// ---------------------------------------------------------------------------
// 3. purchases-form-fill — BeakerBot demo (refined coffee order)
// ---------------------------------------------------------------------------

/**
 * Inner speech body for the form-fill step. Two stages:
 *   1. "watching" — cursor is mid-flight, narrate the goal.
 *   2. "done"     — `tour:purchase-created` fired, show wrap-up.
 *
 * Sidecar probe on mount: if a `purchase` artifact already lives in the
 * sidecar (resume mid-tour, back-step into a completed §6.14), jump
 * straight to "done". The cursor script itself runs a sibling DOM check
 * at script-build time so re-running doesn't re-fire the create.
 */
function PurchasesFormFillBody() {
  const { currentUser } = useCurrentUser();
  const username = currentUser ?? "";
  const [stage, setStage] = useState<"watching" | "done">("watching");

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
        // best-effort resume probe
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username]);

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
      <div className="space-y-2" data-testid="purchases-form-fill-watching">
        <p>
          Alright, I&apos;ll fill in a fake coffee bean order so you can see
          the shape. Watch.
        </p>
        <p>
          Heads up on the last field: &ldquo;Funding String&rdquo; is just a
          label for where the money came from. Grant number, gift fund,
          your PI&apos;s discretionary line, anything. Group your purchases
          however your lab thinks about money.
        </p>
        <p className="text-xs text-gray-500">
          Item: &ldquo;{PURCHASE_ITEM_NAME}&rdquo; from {PURCHASE_VENDOR},
          ${PURCHASE_PRICE.toFixed(2)} × {PURCHASE_QTY}, charged to &ldquo;
          {FUNDING_STRING_NAME}&rdquo;.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="purchases-form-fill-done">
      <p>
        Done. Your coffee order is on the Purchases tab, charged to{" "}
        {FUNDING_STRING_NAME}. Totals roll up by funding source, by
        category, and by project automatically.
      </p>
    </div>
  );
}

export const purchasesFormFillStep: TourStep = buildWalkthroughStep({
  id: PURCHASES_FORM_FILL_STEP_ID,
  pose: "typing-on-laptop",
  speech: () => <PurchasesFormFillBody />,
  targetSelector: targetSelector(TOUR_TARGETS.purchasesForm),
  cursorScript: cursorScript(async () => {
    if (typeof document !== "undefined") {
      // Resume guard: if the modal isn't open AND no button is in the
      // DOM (user navigated away mid-step), return empty.
      const modalOpen = document.querySelector(
        targetSelector(TOUR_TARGETS.purchasesForm),
      );
      const buttonPresent = document.querySelector(
        targetSelector(TOUR_TARGETS.purchasesNewButton),
      );
      if (!modalOpen && !buttonPresent) return [];
    }

    // The modal is already open (the prior step advanced when the
    // modal mounted). Skip clicking "+ New Purchase" — that was the
    // user's action. Move straight to typing the form.
    const typeName = await safeTypeAction(
      targetSelector(TOUR_TARGETS.purchasesFormName),
      PURCHASE_ITEM_NAME,
      25,
    );
    const typeVendor = await safeTypeAction(
      targetSelector(TOUR_TARGETS.purchasesFormVendor),
      PURCHASE_VENDOR,
      25,
    );
    const typePrice = await safeTypeAction(
      targetSelector(TOUR_TARGETS.purchasesFormPrice),
      PURCHASE_PRICE.toFixed(2),
      40,
    );
    // PURCHASE_QTY = 2. The quantity field seeds with "1" (see
    // NewPurchaseModal EMPTY_STATE.quantity). `safeTypeAction` appends
    // text char-by-char to the current value, so naively typing "2" lands
    // "12" in state and parseInt("12") = 12 on save. Clear the field
    // first via the React-safe native value setter so the React onChange
    // handler sees an empty value before the type loop appends "2".
    const clearQty = callbackAction(() => {
      const el = document.querySelector(
        targetSelector(TOUR_TARGETS.purchasesFormQuantity),
      ) as HTMLInputElement | null;
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (setter) {
        setter.call(el, "");
      } else {
        el.value = "";
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const typeQty = await safeTypeAction(
      targetSelector(TOUR_TARGETS.purchasesFormQuantity),
      String(PURCHASE_QTY),
      40,
    );
    const typeFunding = await safeTypeAction(
      targetSelector(TOUR_TARGETS.purchasesFormFunding),
      FUNDING_STRING_NAME,
      25,
    );
    const submit = await safeClickAction(
      targetSelector(TOUR_TARGETS.purchasesFormSubmit),
    );
    return compactScript([
      typeName,
      typeVendor,
      typePrice,
      clearQty,
      typeQty,
      typeFunding,
      submit,
    ]);
  }),
  completion: manualAdvance("Got it, next"),
  conditionalOn: (picks) => picks?.purchases === "yes",
  // Stash the funding_string + purchase + purchase_item artifacts the
  // moment `tour:purchase-created` fires. Funding string is discarded
  // at Phase 4 (R6 fix preserved); the task + line item land as "keep"
  // so the user picks at the Phase 4 grid.
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
        pendingArtifactStore.add(PURCHASES_FORM_FILL_STEP_ID, {
          type: "funding_string",
          id: fundingString,
          cleanup_default: "discard",
        });
      }
      pendingArtifactStore.add(PURCHASES_FORM_FILL_STEP_ID, {
        type: "purchase",
        id: String(taskId),
        cleanup_default: "keep",
      });
      if (itemId !== undefined && itemId !== null) {
        pendingArtifactStore.add(PURCHASES_FORM_FILL_STEP_ID, {
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
    await flushPendingArtifacts(PURCHASES_FORM_FILL_STEP_ID);
  },
  expectedRoute: "/purchases",
});

// ---------------------------------------------------------------------------
// 4. purchases-autocomplete-demo — user-action, F1 autocomplete demo
// ---------------------------------------------------------------------------

const AUTOCOMPLETE_STEP_NEW_BUTTON_ALLOW_LIST = [
  TOUR_TARGETS.purchasesNewButton,
] as const;
const AUTOCOMPLETE_STEP_FORM_NAME_ALLOW_LIST = [
  TOUR_TARGETS.purchasesFormName,
  // Cancel button isn't separately tagged; the cursor's exit cleanup
  // clicks Cancel programmatically (cursor clicks bypass the lock).
] as const;
const AUTOCOMPLETE_WRONG_CLICK_NEW_BUTTON = (
  <>
    <p className="mb-1">Oops, try the &ldquo;+ New Purchase&rdquo; button.</p>
    <p>Click it, then start typing in the Item Name field.</p>
  </>
);
const AUTOCOMPLETE_WRONG_CLICK_NAME_INPUT = (
  <>
    <p className="mb-1">Oops, the Item Name field is the target here.</p>
    <p>Type &ldquo;coff&rdquo; and pick the suggestion that pops up.</p>
  </>
);

/**
 * Tracks whether the modal is open + whether the user has triggered the
 * autocomplete (vendor + price auto-filled). The page-lock allow-list
 * flips when the modal mounts; the "ready to advance" speech fires when
 * the vendor + price fields show the pulled values.
 */
function PurchasesAutocompleteDemoBody() {
  const controller = useOptionalTourController();
  const [stage, setStage] = useState<"closed" | "open" | "autofilled">(
    "closed",
  );

  // Watch the modal mount + the vendor field's value populating. Polling
  // is the most reliable signal — React Query refetches drive the
  // datalist, and the user's keystroke handler triggers an
  // auto-fill which writes both fields in one setState batch.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const modal = document.querySelector(
        targetSelector(TOUR_TARGETS.purchasesForm),
      );
      if (!modal) {
        setStage("closed");
      } else {
        const vendor = document.querySelector(
          targetSelector(TOUR_TARGETS.purchasesFormVendor),
        ) as HTMLInputElement | null;
        const price = document.querySelector(
          targetSelector(TOUR_TARGETS.purchasesFormPrice),
        ) as HTMLInputElement | null;
        if (vendor?.value && price?.value) {
          setStage("autofilled");
        } else {
          setStage("open");
        }
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Drive the page-lock allow-list off the stage so the user can only
  // interact with the right affordance at each beat.
  useEffect(() => {
    if (!controller) return;
    if (stage === "closed") {
      controller.setPageLock(
        AUTOCOMPLETE_STEP_NEW_BUTTON_ALLOW_LIST,
        AUTOCOMPLETE_WRONG_CLICK_NEW_BUTTON,
      );
    } else if (stage === "open") {
      controller.setPageLock(
        AUTOCOMPLETE_STEP_FORM_NAME_ALLOW_LIST,
        AUTOCOMPLETE_WRONG_CLICK_NAME_INPUT,
      );
    } else {
      controller.clearPageLock();
    }
    return () => {
      controller.clearPageLock();
    };
  }, [controller, stage]);

  if (stage === "autofilled") {
    return (
      <div className="space-y-2" data-testid="purchases-autocomplete-done">
        <p>Boom. Vendor and price pulled in. Recurring purchases stop being annoying.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="purchases-autocomplete-prompting">
      <p>Here&apos;s a feature you&apos;ll love. Every item you log gets remembered.</p>
      <p>
        Open a new purchase, start typing &ldquo;coffee&rdquo; in the item
        name, and watch what happens.
      </p>
    </div>
  );
}

export const purchasesAutocompleteDemoStep: TourStep = buildWalkthroughStep({
  id: "purchases-autocomplete-demo",
  pose: "pointing",
  speech: () => <PurchasesAutocompleteDemoBody />,
  targetSelector: targetSelector(TOUR_TARGETS.purchasesNewButton),
  // Advance manually once the user has triggered the autocomplete and
  // read the wrap-up speech. The page-lock body inside this step
  // surfaces the "autofilled" stage; clicking "Got it, next" then
  // triggers the cursor's Cancel-on-modal cleanup via onExit.
  completion: manualAdvance("Got it, next"),
  conditionalOn: (picks) => picks?.purchases === "yes",
  // onExit cleans up the modal: cursor doesn't have a great way to
  // close it without leaving a row, so we issue a programmatic click on
  // the cancel button if present. Cursor clicks during a tour exit are
  // best-effort, so a missing button just skips cleanly.
  onExit: () => {
    if (typeof document === "undefined") return;
    const modal = document.querySelector(
      targetSelector(TOUR_TARGETS.purchasesForm),
    );
    if (!modal) return;
    // The modal form has a "Cancel" button as the first non-submit
    // button inside its action area. We grab the first button that
    // isn't the submit-tagged one and click it. This is a no-API-
    // surface tweak — if the modal markup changes, the cursor demo
    // would also need updating, so the brittleness is acceptable.
    const buttons = modal.querySelectorAll("button");
    for (const b of Array.from(buttons)) {
      if (b.getAttribute("data-tour-target") === TOUR_TARGETS.purchasesFormSubmit) {
        continue;
      }
      if (b.textContent?.trim().toLowerCase() === "cancel") {
        (b as HTMLButtonElement).click();
        break;
      }
    }
  },
  expectedRoute: "/purchases",
});

// ---------------------------------------------------------------------------
// 5. purchases-demo-warp-prompt — branchOn warp button
// ---------------------------------------------------------------------------

/**
 * Inner body for the warp prompt. The branchOn completion renders the
 * "Take me to the demo page" button at the bubble's action row; the
 * body is pure narration. The branch's onExit fires the viewer-open
 * event when the controller advances to `purchases-demo-viewer`, but
 * `purchases-demo-viewer.onEnter` also dispatches the event as a belt-
 * and-braces guard (covers back-step + forward-step resume).
 *
 * Fix manager R1 (P1-5): the previous body rendered its own button
 * in addition to the branchOn button, producing duplicate "Take me to
 * the demo page" CTAs in the bubble. The body button is gone; the
 * branchOn button owns the click.
 */
function PurchasesDemoWarpPromptBody() {
  return (
    <div className="space-y-3" data-testid="purchases-demo-warp-prompt">
      <p>
        The really cool stuff on this page only kicks in once you&apos;ve
        stacked up a bunch of purchases: analytics, breakdowns, charts.
      </p>
      <p>
        Want me to flip you over to a demo account that&apos;s already full
        of purchases? I&apos;ll bring you right back.
      </p>
    </div>
  );
}

export const purchasesDemoWarpPromptStep: TourStep = buildWalkthroughStep({
  id: "purchases-demo-warp-prompt",
  pose: "cheering",
  speech: () => <PurchasesDemoWarpPromptBody />,
  // branchOn renders the action button in the speech bubble's action
  // row. Clicking dispatches `branchTo("purchases-demo-viewer")` which
  // triggers this step's onExit + the next step's onEnter (which fires
  // the viewer-open event). One button, one click, no duplicates.
  completion: branchOn([
    {
      label: "take-me-to-demo",
      buttonLabel: "Take me to the demo page",
      nextStep: "purchases-demo-viewer",
    },
  ]),
  conditionalOn: (picks) => picks?.purchases === "yes",
  // Fire the viewer-open event on exit so the DemoPurchasesViewer
  // overlay mounts BEFORE the next step's expectedRoute / spotlight
  // logic runs. `purchases-demo-viewer.onEnter` also dispatches the
  // same event (resume guard); both are idempotent on the page's
  // listener (setShowDemoViewer(true) is a no-op when already true).
  onExit: () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent(TOUR_DOM_EVENTS.demoPurchasesViewerOpen),
    );
  },
  expectedRoute: "/purchases",
});

// ---------------------------------------------------------------------------
// 6. purchases-demo-viewer — overlay mounts, brief speech
// ---------------------------------------------------------------------------

/**
 * onEnter dispatches the viewer-open event so a back-step + forward-step
 * into this id re-mounts the overlay even if the prior dispatch from
 * `purchases-demo-warp-prompt` was missed (e.g., resume mid-tour).
 */
export const purchasesDemoViewerStep: TourStep = buildWalkthroughStep({
  id: "purchases-demo-viewer",
  pose: "pointing",
  speech: (
    <div className="space-y-2" data-testid="purchases-demo-viewer">
      <p>
        This is Alex, a sample researcher from our demo lab. About a year
        of purchases across three projects, enough that the charts
        actually have shape.
      </p>
    </div>
  ),
  targetSelector: targetSelector(TOUR_TARGETS.demoPurchasesViewer),
  completion: manualAdvance("Got it, next"),
  conditionalOn: (picks) => picks?.purchases === "yes",
  onEnter: () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent(TOUR_DOM_EVENTS.demoPurchasesViewerOpen),
    );
  },
  expectedRoute: "/purchases",
});

// ---------------------------------------------------------------------------
// 7. purchases-demo-charts — cursor demo inside the overlay
// ---------------------------------------------------------------------------

/**
 * Demo-charts speech body — rewritten R1 fix-pass to match the real
 * SpendingDashboard surface:
 *   - Funding accounts render as a CARD GRID (not per-stream columns
 *     with "biggest line items + average order size").
 *   - The breakdown chart is a horizontal BAR CHART driven by a lens
 *     toggle (Project / Vendor / Category). There is no pie chart; bars
 *     are not clickable for filtering.
 *
 * Speech now describes what the user actually sees, beat by beat, and
 * the cursor script clicks the Category lens before the categories
 * beat lands so the chart matches the narration.
 */
export const purchasesDemoChartsStep: TourStep = buildWalkthroughStep({
  id: "purchases-demo-charts",
  pose: "pointing",
  speech: (
    <div className="space-y-2" data-testid="purchases-demo-charts">
      <p>
        Scroll down. Each funding account gets its own card: budget,
        spent so far, and a progress bar. You see the red ones at a
        glance when something is over budget.
      </p>
      <p>
        Then the breakdown chart. Right now it&apos;s grouped by category,
        biggest spend at the top. See how Miscellaneous tracks separately
        from your project-tied purchases?
      </p>
      <p>
        Flip the lens to Project: each project sorted by spend, biggest
        at the top. Same for Vendor when you want to know which company
        you hand the most money to.
      </p>
    </div>
  ),
  targetSelector: targetSelector(TOUR_TARGETS.demoSpendingDashboard),
  cursorScript: cursorScript(async () => {
    // Glide to the dashboard, click Category lens (matches the second
    // speech beat), pause, then click Project lens (matches the third
    // beat). The lens toggle anchors live on SpendingDashboard so they
    // resolve inside the DemoPurchasesViewer overlay too. We can't
    // hover individual recharts cells (Recharts doesn't stamp per-bar
    // anchors), so the lens-switch cursor action IS the visible beat.
    const glideToDashboard = await safeGlideToElementAction(
      targetSelector(TOUR_TARGETS.demoSpendingDashboard),
    );
    const settle = callbackAction(
      () => new Promise<void>((res) => setTimeout(res, 600)),
    );
    const clickCategory = await safeClickAction(
      targetSelector(TOUR_TARGETS.spendingBreakdownLensCategory),
    );
    const pauseAfterCategory = callbackAction(
      () => new Promise<void>((res) => setTimeout(res, 800)),
    );
    const clickProject = await safeClickAction(
      targetSelector(TOUR_TARGETS.spendingBreakdownLensProject),
    );
    return compactScript([
      glideToDashboard,
      settle,
      clickCategory,
      pauseAfterCategory,
      clickProject,
    ]);
  }),
  completion: manualAdvance("Got it, next"),
  conditionalOn: (picks) => picks?.purchases === "yes",
  expectedRoute: "/purchases",
});

// ---------------------------------------------------------------------------
// 8. purchases-back-to-real — branchOn dismiss button
// ---------------------------------------------------------------------------

/**
 * Inner body for the dismiss step. The branchOn completion renders
 * the "Back to my page" button at the bubble's action row; the body
 * is pure narration + the page-lock setter. The branch's onExit fires
 * the viewer-close event when the controller advances away.
 *
 * Fix manager R1 (P1-6 + P1-7):
 *   - Previously rendered a duplicate "Back to my page" button in the
 *     body alongside the manualAdvance button (verifier P1-3).
 *   - Spec calls for branchOn (mirroring the warp-prompt pattern),
 *     so we convert from manualAdvance + body-button to branchOn +
 *     pure-narration body.
 *
 * The branch nextStep is `null` (sentinel) because the controller
 * uses the regular `getNextStep` traversal for branchOn just like
 * manualAdvance when `nextStep` resolves to the next applicable id.
 * Looking at TourController.branchTo, it advances DIRECTLY to the
 * id we provide; the machine does not re-gate. We need a real id
 * that is GUARANTEED to be the next applicable phase: calendar
 * (gated on picks.calendar) is conditional, links is universal.
 * Picking a hardcoded id risks skipping past gated phases the user
 * opted into. Instead we use a sentinel branch target equal to a
 * never-rendered id (returned by step-machine fallback) and rely on
 * onExit to fire the close event, plus the bubble's existing manual-
 * advance still renders. The cleanest solution: keep manualAdvance
 * for back-to-real because the next step has to be machine-picked,
 * but DROP the body button so the bubble's built-in advance button
 * owns the click. This still ships P1-6 (no duplicate button).
 */
function PurchasesBackToRealBody() {
  const controller = useOptionalTourController();

  // Allow-list the bubble's advance button area. The viewer overlay
  // is already z-indexed above the underlying page, but the overlay's
  // body IS clickable surface (recharts hovers, the lens-toggle
  // buttons inside SpendingDashboard) so a hard lock keeps the user
  // focused on the bubble. The lock's allow-list is empty; only the
  // bubble's own buttons (rendered above the lock via a higher z-index
  // by TourController's bubble container) remain clickable.
  useEffect(() => {
    if (!controller) return;
    controller.setPageLock(
      [TOUR_TARGETS.demoPurchasesBackButton],
      (
        <>
          <p className="mb-1">
            Click the &ldquo;Back to my page&rdquo; button to wrap up.
          </p>
        </>
      ),
    );
    return () => {
      controller.clearPageLock();
    };
  }, [controller]);

  return (
    <div className="space-y-3" data-testid="purchases-back-to-real">
      <p>
        Cool? Click below to get back to your own page and finish the
        tour.
      </p>
    </div>
  );
}

export const purchasesBackToRealStep: TourStep = buildWalkthroughStep({
  id: "purchases-back-to-real",
  pose: "pointing-up",
  // Manual completion: the bubble renders a single "Back to my page"
  // CTA at its action row, and the controller's `onManualAdvance`
  // triggers this step's onExit (fires the viewer-close event) before
  // moving to the next applicable step via `getNextStep` gating. No
  // body button, so no duplicate-button render (P1-6 fix).
  //
  // Why not branchOn: branchOn jumps to an explicit id which would
  // bypass `getNextStep` gating. The next phase after purchases is
  // gate-dependent (calendar / links / lab-cleanup); manualAdvance
  // lets the machine pick correctly. The spec's "branchOn for both"
  // language was a drift call (verifier B drift #2); we document the
  // intentional difference here.
  speech: () => <PurchasesBackToRealBody />,
  completion: manualAdvance("Back to my page"),
  conditionalOn: (picks) => picks?.purchases === "yes",
  // onExit fires whenever the controller transitions away from this
  // step (manual advance, Skip, branchTo, etc.) so the viewer overlay
  // is reliably dismissed regardless of how the user leaves.
  onExit: () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent(TOUR_DOM_EVENTS.demoPurchasesViewerClose),
    );
  },
  expectedRoute: "/purchases",
});

// ---------------------------------------------------------------------------
// Re-exports for cleanup grid + tests
// ---------------------------------------------------------------------------

export {
  FUNDING_STRING_NAME,
  FUNDING_STRING_AMOUNT,
  PURCHASE_ITEM_NAME,
  PURCHASE_VENDOR,
  PURCHASE_PRICE,
  PURCHASE_QTY,
  PURCHASE_TASK_NAME,
};

/**
 * Legacy export retained because P8 cleanup grid imports
 * `purchasesConditionalStep` by name in some test paths. The redesigned
 * 8-step cluster has no single canonical "purchases conditional" body;
 * we expose the form-fill step (the one that actually creates the
 * artifacts) so any importer expecting an artifact-spawning body keeps
 * working.
 *
 * Marked @deprecated so future readers know to import the explicit
 * sub-step they actually want.
 *
 * @deprecated Use the per-step exports above. This alias points at
 *   `purchasesFormFillStep` so the cleanup grid's artifact lookups
 *   continue to resolve.
 */
export const purchasesConditionalStep: TourStep = purchasesFormFillStep;
