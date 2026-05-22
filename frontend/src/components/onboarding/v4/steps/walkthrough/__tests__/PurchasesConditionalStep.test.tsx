import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";

/**
 * §6.14 Purchases step body tests.
 *
 * R2 rebuild (HR sub-bot 2026-05-22): the step no longer drives the
 * funding-string + purchase create from inside a useEffect. Instead,
 * BeakerBot's cursor clicks "+ New Purchase" on /purchases, types into
 * the NewPurchaseModal, and clicks Save; the modal dispatches
 * `tour:purchase-created` and the step's onEnter listener stashes
 * three artifacts (funding_string, purchase, purchase_item) which
 * onExit flushes to the sidecar.
 *
 * These tests cover:
 *   - The exported step shape (id, pose, gate, manual completion).
 *   - The cursor script's planned action chain (open modal, type each
 *     field, click submit) — by mounting the targets ourselves and
 *     letting the script resolve.
 *   - The onEnter listener captures the three artifacts when the
 *     `tour:purchase-created` event fires.
 *   - The speech bubble's resume probe + post-create stage flip.
 */

const { readOnboardingMock } = vi.hoisted(() => ({
  readOnboardingMock: vi.fn(),
}));

vi.mock("@/lib/onboarding/sidecar", () => ({
  readOnboarding: readOnboardingMock,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alex" }),
}));

// Stub next/navigation so the TourController auto-navigate effect
// doesn't blow up in jsdom.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import {
  purchasesConditionalStep,
  FUNDING_STRING_NAME,
  PURCHASE_ITEM_NAME,
  PURCHASE_VENDOR,
  PURCHASE_PRICE,
  PURCHASE_QTY,
} from "../PurchasesConditionalStep";
import { TourControllerProvider } from "../../../TourController";
import { pendingArtifactStore } from "../lib/artifacts";
import { TOUR_DOM_EVENTS } from "../lib/tour-events";

function picks(over: Partial<FeaturePicks> = {}): FeaturePicks {
  return {
    account_type: "solo",
    purchases: "yes",
    calendar: "no",
    goals: "no",
    telegram: "no",
    ai_helper: "no",
    ...over,
  };
}

function emptySidecar() {
  return {
    version: 1,
    first_seen_at: "2026-05-22T00:00:00.000Z",
    active_seconds: 0,
    feature_picks: null,
    wizard_completed_at: null,
    wizard_skipped_at: null,
    wizard_force_show: false,
    wizard_resume_state: {
      current_step: "purchases",
      skipped_steps: [],
      artifacts_created: [],
    },
    lab_tour_pending: false,
    lab_tour_dismissed_at: null,
  };
}

describe("purchasesConditionalStep step shape", () => {
  beforeEach(() => {
    readOnboardingMock.mockReset();
    readOnboardingMock.mockResolvedValue(emptySidecar());
    pendingArtifactStore.reset();
  });

  it("exposes the expected id + pose + conditional gate", () => {
    expect(purchasesConditionalStep.id).toBe("purchases");
    expect(purchasesConditionalStep.pose).toBe("cheering");
    // Spotlight now points at the form (mounts when the cursor clicks
    // "+ New Purchase"). The spotlight silently no-ops while the form
    // is unmounted.
    expect(purchasesConditionalStep.targetSelector).toBe(
      "[data-tour-target=\"purchases-form\"]",
    );
  });

  it("conditionalOn passes only when picks.purchases === 'yes'", () => {
    const gate = purchasesConditionalStep.conditionalOn!;
    expect(gate(picks({ purchases: "yes" }))).toBe(true);
    expect(gate(picks({ purchases: "no" }))).toBe(false);
    expect(gate(picks({ purchases: "maybe" }))).toBe(false);
    expect(gate(null)).toBe(false);
  });

  it("uses manual-advance completion (live-test R6: was event-driven 2s auto-advance, too fast for users to read)", () => {
    expect(purchasesConditionalStep.completion.type).toBe("manual");
  });

  it("auto-navigates to /purchases", () => {
    expect(purchasesConditionalStep.expectedRoute).toBe("/purchases");
  });
});

describe("purchasesConditionalStep cursorScript", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    pendingArtifactStore.reset();
  });

  it("returns no actions when neither the button nor the form is on screen (resume guard)", async () => {
    const script = purchasesConditionalStep.cursorScript;
    if (!script) throw new Error("expected a cursorScript");
    const actions = await script();
    expect(actions).toEqual([]);
  });

  it("builds the full action chain when the button + form anchors exist", async () => {
    // Mount the full target set so every safeClickAction /
    // safeTypeAction resolves. In production these mount one-by-one
    // as the cursor progresses; here we mount them all at once so the
    // script-build pass can verify the planned chain.
    document.body.innerHTML = `
      <button data-tour-target="purchases-new-button">+ New Purchase</button>
      <form data-tour-target="purchases-form">
        <input data-tour-target="purchases-form-name" />
        <input data-tour-target="purchases-form-vendor" />
        <input data-tour-target="purchases-form-price" />
        <input data-tour-target="purchases-form-quantity" />
        <input data-tour-target="purchases-form-funding" />
        <button data-tour-target="purchases-form-submit">Save</button>
      </form>
    `;
    const script = purchasesConditionalStep.cursorScript;
    if (!script) throw new Error("expected a cursorScript");
    const actions = await script();

    // PURCHASE_QTY === 1 → the quantity-type step is intentionally
    // null (the modal seeds "1" into the input by default). Expect
    // exactly 6 actions: open + 4 typed fields + submit.
    expect(actions).toHaveLength(6);
    expect(actions[0]).toMatchObject({ type: "click" });
    expect(actions[1]).toMatchObject({ type: "type", text: PURCHASE_ITEM_NAME });
    expect(actions[2]).toMatchObject({ type: "type", text: PURCHASE_VENDOR });
    expect(actions[3]).toMatchObject({
      type: "type",
      text: PURCHASE_PRICE.toFixed(2),
    });
    expect(actions[4]).toMatchObject({
      type: "type",
      text: FUNDING_STRING_NAME,
    });
    expect(actions[5]).toMatchObject({ type: "click" });
    void PURCHASE_QTY;
  });
});

describe("purchasesConditionalStep onEnter / onExit artifact capture", () => {
  beforeEach(() => {
    pendingArtifactStore.reset();
  });

  it("captures funding_string + purchase + purchase_item from tour:purchase-created", () => {
    const onEnter = purchasesConditionalStep.onEnter;
    if (!onEnter) throw new Error("expected onEnter");
    onEnter();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TOUR_DOM_EVENTS.purchaseCreated, {
          detail: {
            taskId: 42,
            itemId: 99,
            fundingString: FUNDING_STRING_NAME,
          },
        }),
      );
    });

    const pending = pendingArtifactStore.peek("purchases");
    expect(pending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "funding_string",
          id: FUNDING_STRING_NAME,
          cleanup_default: "discard",
        }),
        expect.objectContaining({
          type: "purchase",
          id: "42",
          cleanup_default: "keep",
        }),
        expect.objectContaining({
          type: "purchase_item",
          id: "99",
          cleanup_default: "keep",
        }),
      ]),
    );
  });

  it("skips funding_string capture when the event detail omits it", () => {
    const onEnter = purchasesConditionalStep.onEnter;
    if (!onEnter) throw new Error("expected onEnter");
    onEnter();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TOUR_DOM_EVENTS.purchaseCreated, {
          detail: { taskId: 7, itemId: 8, fundingString: null },
        }),
      );
    });

    const pending = pendingArtifactStore.peek("purchases");
    const types = pending.map((a) => a.type);
    expect(types).not.toContain("funding_string");
    expect(types).toContain("purchase");
    expect(types).toContain("purchase_item");
  });

  it("ignores events with no taskId", () => {
    const onEnter = purchasesConditionalStep.onEnter;
    if (!onEnter) throw new Error("expected onEnter");
    onEnter();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TOUR_DOM_EVENTS.purchaseCreated, {
          detail: { fundingString: FUNDING_STRING_NAME },
        }),
      );
    });

    expect(pendingArtifactStore.peek("purchases")).toEqual([]);
  });
});

describe("PurchasesDemoBody speech-bubble rendering", () => {
  beforeEach(() => {
    readOnboardingMock.mockReset();
    readOnboardingMock.mockResolvedValue(emptySidecar());
    pendingArtifactStore.reset();
  });

  function renderBody() {
    if (typeof purchasesConditionalStep.speech !== "function") {
      throw new Error("expected speech to be a render function");
    }
    // TourControllerProvider renders the active step's speech node
    // inside its own InProductWalkthroughOverlay, so we don't pass
    // the speech() as a child — that would mount the body twice.
    return render(
      <TourControllerProvider
        initialFeaturePicks={picks()}
        initialStep="purchases"
      >
        <div />
      </TourControllerProvider>,
    );
  }

  it("starts in 'watching' stage and shows the demo plan", async () => {
    renderBody();
    await waitFor(() => {
      expect(screen.getByTestId("purchases-watching")).toBeInTheDocument();
    });
    const node = screen.getByTestId("purchases-watching");
    expect(node.textContent).toMatch(/New Purchase/);
    expect(node.textContent).toMatch(/BeakerBot's allowance/);
    expect(node.textContent).toMatch(
      /12-well Plates Of Premium Hand-Painted Quality/,
    );
  });

  it("flips to 'done' stage when tour:purchase-created fires", async () => {
    renderBody();
    await waitFor(() =>
      expect(screen.getByTestId("purchases-watching")).toBeInTheDocument(),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent(TOUR_DOM_EVENTS.purchaseCreated, {
          detail: { taskId: 1, itemId: 2, fundingString: FUNDING_STRING_NAME },
        }),
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId("purchases-done")).toBeInTheDocument(),
    );
  });

  it("jumps straight to 'done' when the sidecar already records a purchase artifact (resume)", async () => {
    readOnboardingMock.mockResolvedValueOnce({
      ...emptySidecar(),
      wizard_resume_state: {
        current_step: "purchases",
        skipped_steps: [],
        artifacts_created: [
          {
            type: "purchase",
            id: "42",
            cleanup_default: "keep" as const,
          },
        ],
      },
    });
    renderBody();
    await waitFor(() => {
      expect(screen.getByTestId("purchases-done")).toBeInTheDocument();
    });
  });
});
