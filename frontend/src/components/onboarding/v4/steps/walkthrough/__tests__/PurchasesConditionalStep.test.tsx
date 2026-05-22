import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";

/**
 * §6.14 Purchases — 8-step cluster body tests (Purchases manager
 * 2026-05-22 redesign).
 *
 * Covers:
 *   - Step shape (id, pose, gate, completion type) for every cluster
 *     member.
 *   - purchases-form-fill cursor script (typing + save) + onEnter
 *     listener (captures 3 artifacts via tour:purchase-created).
 *   - purchases-create-button-click event-driven completion fires when
 *     the modal mounts.
 *   - purchases-demo-warp-prompt button-driven branchOn.
 *   - purchases-demo-viewer onEnter dispatches the open event.
 *   - purchases-back-to-real onExit dispatches the close event.
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
  purchasesIntroStep,
  purchasesCreateButtonClickStep,
  purchasesFormFillStep,
  purchasesAutocompleteDemoStep,
  purchasesDemoWarpPromptStep,
  purchasesDemoViewerStep,
  purchasesDemoChartsStep,
  purchasesBackToRealStep,
  purchasesConditionalStep,
  FUNDING_STRING_NAME,
  PURCHASE_ITEM_NAME,
  PURCHASE_VENDOR,
  PURCHASE_PRICE,
  PURCHASE_QTY,
} from "../PurchasesConditionalStep";
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
    version: 1 as const,
    first_seen_at: "2026-05-22T00:00:00.000Z",
    active_seconds: 0,
    feature_picks: null,
    wizard_completed_at: null,
    wizard_skipped_at: null,
    wizard_force_show: false,
    wizard_resume_state: {
      current_step: "purchases-form-fill",
      skipped_steps: [],
      artifacts_created: [],
    },
    lab_tour_pending: false,
    lab_tour_dismissed_at: null,
  };
}

describe("purchases cluster — step shape", () => {
  it("every cluster member has the right id + manual or event completion + purchases gate", () => {
    const members = [
      purchasesIntroStep,
      purchasesCreateButtonClickStep,
      purchasesFormFillStep,
      purchasesAutocompleteDemoStep,
      purchasesDemoWarpPromptStep,
      purchasesDemoViewerStep,
      purchasesDemoChartsStep,
      purchasesBackToRealStep,
    ];
    const ids = members.map((m) => m.id);
    expect(ids).toEqual([
      "purchases-intro",
      "purchases-create-button-click",
      "purchases-form-fill",
      "purchases-autocomplete-demo",
      "purchases-demo-warp-prompt",
      "purchases-demo-viewer",
      "purchases-demo-charts",
      "purchases-back-to-real",
    ]);
    for (const m of members) {
      expect(["manual", "event", "branch"]).toContain(m.completion.type);
      const gate = m.conditionalOn!;
      expect(gate(picks({ purchases: "yes" }))).toBe(true);
      expect(gate(picks({ purchases: "no" }))).toBe(false);
      expect(gate(null)).toBe(false);
      expect(m.expectedRoute).toBe("/purchases");
    }
  });

  it("purchases-create-button-click uses event-driven completion (modal mount)", () => {
    expect(purchasesCreateButtonClickStep.completion.type).toBe("event");
  });

  it("purchases-form-fill uses manual completion + cheering pose? No — typing-on-laptop per redesign", () => {
    expect(purchasesFormFillStep.pose).toBe("typing-on-laptop");
    expect(purchasesFormFillStep.completion.type).toBe("manual");
  });

  it("purchases-demo-warp-prompt uses branchOn completion to skip to the viewer", () => {
    expect(purchasesDemoWarpPromptStep.completion.type).toBe("branch");
    if (purchasesDemoWarpPromptStep.completion.type === "branch") {
      expect(purchasesDemoWarpPromptStep.completion.branches[0].nextStep).toBe(
        "purchases-demo-viewer",
      );
    }
  });

  it("legacy purchasesConditionalStep alias resolves to the form-fill step", () => {
    // Back-compat shim: the cleanup grid + older importers expect a
    // body that owns the `onEnter` artifact capture. The form-fill
    // step is the new home for that contract.
    expect(purchasesConditionalStep.id).toBe("purchases-form-fill");
  });
});

describe("purchases-form-fill cursorScript", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    pendingArtifactStore.reset();
  });

  it("returns no actions when neither the button nor the form is on screen", async () => {
    const script = purchasesFormFillStep.cursorScript;
    if (!script) throw new Error("expected cursorScript");
    const actions = await script();
    expect(actions).toEqual([]);
  });

  it("builds the typing + save chain when the form is mounted", async () => {
    // The form is already open when this step fires (the previous
    // step's user click opened it). The script skips the open-modal
    // click and goes straight to typing. Quantity gets a clear-value
    // callback before its type action (R1 fix-pass P1-4: prevents the
    // seeded "1" from concatenating with typed "2" to land "12").
    document.body.innerHTML = `
      <button data-tour-target="purchases-new-button">+ New Purchase</button>
      <form data-tour-target="purchases-form">
        <input data-tour-target="purchases-form-name" />
        <input data-tour-target="purchases-form-vendor" />
        <input data-tour-target="purchases-form-price" />
        <input data-tour-target="purchases-form-quantity" value="1" />
        <input data-tour-target="purchases-form-funding" />
        <button data-tour-target="purchases-form-submit">Save</button>
      </form>
    `;
    const script = purchasesFormFillStep.cursorScript;
    if (!script) throw new Error("expected cursorScript");
    const actions = await script();
    // 5 typed fields (name, vendor, price, qty, funding) + 1 clearQty
    // callback + 1 submit = 7.
    expect(actions).toHaveLength(7);
    expect(actions[0]).toMatchObject({ type: "type", text: PURCHASE_ITEM_NAME });
    expect(actions[1]).toMatchObject({ type: "type", text: PURCHASE_VENDOR });
    expect(actions[2]).toMatchObject({
      type: "type",
      text: PURCHASE_PRICE.toFixed(2),
    });
    expect(actions[3]).toMatchObject({ type: "callback" });
    expect(actions[4]).toMatchObject({
      type: "type",
      text: String(PURCHASE_QTY),
    });
    expect(actions[5]).toMatchObject({
      type: "type",
      text: FUNDING_STRING_NAME,
    });
    expect(actions[6]).toMatchObject({ type: "click" });
  });

  it("clear-quantity callback resets the seeded value to empty before typing", async () => {
    // R1 fix-pass P1-4: the quantity field seeds with "1" in
    // NewPurchaseModal.EMPTY_STATE. Without a clear, BeakerBotCursor's
    // typeInto would append the typed "2" to produce "12". The
    // clear-callback uses the React-safe HTMLInputElement.value setter
    // + an "input" event to flush React onChange to "" before the
    // type loop appends.
    document.body.innerHTML = `
      <form data-tour-target="purchases-form">
        <input data-tour-target="purchases-form-name" />
        <input data-tour-target="purchases-form-vendor" />
        <input data-tour-target="purchases-form-price" />
        <input data-tour-target="purchases-form-quantity" value="1" />
        <input data-tour-target="purchases-form-funding" />
        <button data-tour-target="purchases-form-submit">Save</button>
      </form>
    `;
    const qtyEl = document.querySelector(
      '[data-tour-target="purchases-form-quantity"]',
    ) as HTMLInputElement;
    expect(qtyEl.value).toBe("1");
    const script = purchasesFormFillStep.cursorScript;
    if (!script) throw new Error("expected cursorScript");
    const actions = await script();
    const callback = actions.find((a) => a.type === "callback");
    expect(callback).toBeDefined();
    // Manually invoke the callback (cursor playback would do this) and
    // assert the field is cleared.
    if (callback && callback.type === "callback") {
      await callback.fn();
    }
    expect(qtyEl.value).toBe("");
  });
});

describe("purchases-form-fill onEnter / onExit artifact capture", () => {
  beforeEach(() => {
    pendingArtifactStore.reset();
  });

  it("captures funding_string + purchase + purchase_item from tour:purchase-created", () => {
    const onEnter = purchasesFormFillStep.onEnter;
    if (!onEnter) throw new Error("expected onEnter");
    onEnter({ username: "alex" });

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

    const pending = pendingArtifactStore.peek("purchases-form-fill");
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
    const onEnter = purchasesFormFillStep.onEnter;
    if (!onEnter) throw new Error("expected onEnter");
    onEnter({ username: "alex" });

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TOUR_DOM_EVENTS.purchaseCreated, {
          detail: { taskId: 7, itemId: 8, fundingString: null },
        }),
      );
    });

    const pending = pendingArtifactStore.peek("purchases-form-fill");
    const types = pending.map((a) => a.type);
    expect(types).not.toContain("funding_string");
    expect(types).toContain("purchase");
    expect(types).toContain("purchase_item");
  });

  it("ignores events with no taskId", () => {
    const onEnter = purchasesFormFillStep.onEnter;
    if (!onEnter) throw new Error("expected onEnter");
    onEnter({ username: "alex" });

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TOUR_DOM_EVENTS.purchaseCreated, {
          detail: { fundingString: FUNDING_STRING_NAME },
        }),
      );
    });

    expect(pendingArtifactStore.peek("purchases-form-fill")).toEqual([]);
  });
});

describe("purchases-demo-charts cursorScript", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("glides to the dashboard then clicks Category and Project lens toggles", async () => {
    // R1 fix-pass P0-3: the prior single-glide demo left the speech
    // beats stranded on a stale lens. The cursor now visibly switches
    // lenses between beats so the chart matches the narration.
    document.body.innerHTML = `
      <section data-tour-target="demo-spending-dashboard">
        <div data-tour-target="spending-breakdown-lens-toggle">
          <button data-tour-target="spending-breakdown-lens-project">Project</button>
          <button data-tour-target="spending-breakdown-lens-vendor">Vendor</button>
          <button data-tour-target="spending-breakdown-lens-category">Category</button>
        </div>
      </section>
    `;
    const script = purchasesDemoChartsStep.cursorScript;
    if (!script) throw new Error("expected cursorScript");
    const actions = await script();
    // glide + callback + click(Category) + callback + click(Project) = 5
    expect(actions).toHaveLength(5);
    expect(actions[0]).toMatchObject({ type: "glide" });
    expect(actions[1]).toMatchObject({ type: "callback" });
    expect(actions[2]).toMatchObject({ type: "click" });
    expect(actions[3]).toMatchObject({ type: "callback" });
    expect(actions[4]).toMatchObject({ type: "click" });
    // Verify the two clicks land on the right lens buttons.
    const categoryBtn = document.querySelector(
      '[data-tour-target="spending-breakdown-lens-category"]',
    );
    const projectBtn = document.querySelector(
      '[data-tour-target="spending-breakdown-lens-project"]',
    );
    expect(actions[2]).toMatchObject({ target: categoryBtn });
    expect(actions[4]).toMatchObject({ target: projectBtn });
  });
});

describe("purchases-demo-warp-prompt body", () => {
  it("renders exactly zero CTA buttons in the body (branchOn owns the click)", () => {
    // R1 fix-pass P1-5: the body previously rendered its own "Take me
    // to the demo page" button in addition to the branchOn-rendered
    // button at the bubble's action row, producing duplicates.
    if (typeof purchasesDemoWarpPromptStep.speech !== "function") {
      throw new Error("expected speech to be a function");
    }
    const SpeechBody = purchasesDemoWarpPromptStep.speech as () => React.ReactNode;
    const { container } = render(<>{SpeechBody()}</>);
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(0);
  });

  it("onExit dispatches the viewer-open event", async () => {
    const onExit = purchasesDemoWarpPromptStep.onExit;
    if (!onExit) throw new Error("expected onExit");
    const listener = vi.fn();
    window.addEventListener(TOUR_DOM_EVENTS.demoPurchasesViewerOpen, listener);
    try {
      await onExit();
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(
        TOUR_DOM_EVENTS.demoPurchasesViewerOpen,
        listener,
      );
    }
  });
});

describe("purchases-back-to-real body", () => {
  it("renders exactly zero CTA buttons in the body (manualAdvance owns the click)", () => {
    // R1 fix-pass P1-6: the body previously rendered its own "Back to
    // my page" button alongside the manualAdvance-rendered button.
    if (typeof purchasesBackToRealStep.speech !== "function") {
      throw new Error("expected speech to be a function");
    }
    const SpeechBody = purchasesBackToRealStep.speech as () => React.ReactNode;
    const { container } = render(<>{SpeechBody()}</>);
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(0);
  });
});

describe("purchases-demo-viewer / -back-to-real overlay events", () => {
  it("purchases-demo-viewer.onEnter dispatches tour:demo-purchases-viewer-open", () => {
    const onEnter = purchasesDemoViewerStep.onEnter;
    if (!onEnter) throw new Error("expected onEnter");
    const listener = vi.fn();
    window.addEventListener(TOUR_DOM_EVENTS.demoPurchasesViewerOpen, listener);
    try {
      onEnter({ username: "alex" });
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(
        TOUR_DOM_EVENTS.demoPurchasesViewerOpen,
        listener,
      );
    }
  });

  it("purchases-back-to-real.onExit dispatches tour:demo-purchases-viewer-close", async () => {
    const onExit = purchasesBackToRealStep.onExit;
    if (!onExit) throw new Error("expected onExit");
    const listener = vi.fn();
    window.addEventListener(TOUR_DOM_EVENTS.demoPurchasesViewerClose, listener);
    try {
      await onExit();
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(
        TOUR_DOM_EVENTS.demoPurchasesViewerClose,
        listener,
      );
    }
  });
});

describe("purchases-form-fill speech body rendering", () => {
  beforeEach(() => {
    readOnboardingMock.mockReset();
    readOnboardingMock.mockResolvedValue(emptySidecar());
    pendingArtifactStore.reset();
  });

  function renderBody() {
    if (typeof purchasesFormFillStep.speech !== "function") {
      throw new Error("expected speech to be a function");
    }
    const SpeechBody = purchasesFormFillStep.speech as () => React.ReactNode;
    // Render the speech node directly — the body is wired to read
    // useCurrentUser via the mock + listen for the DOM event without
    // any TourController context, so we don't need the provider here.
    return render(<>{SpeechBody()}</>);
  }

  it("starts in 'watching' stage and previews the coffee bean order", async () => {
    renderBody();
    await waitFor(() => {
      expect(
        screen.getByTestId("purchases-form-fill-watching"),
      ).toBeInTheDocument();
    });
    const node = screen.getByTestId("purchases-form-fill-watching");
    expect(node.textContent).toMatch(/coffee bean/i);
    expect(node.textContent).toMatch(/BeakerBot's allowance/);
  });

  it("flips to 'done' when tour:purchase-created fires", async () => {
    renderBody();
    await waitFor(() =>
      expect(
        screen.getByTestId("purchases-form-fill-watching"),
      ).toBeInTheDocument(),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent(TOUR_DOM_EVENTS.purchaseCreated, {
          detail: { taskId: 1, itemId: 2, fundingString: FUNDING_STRING_NAME },
        }),
      );
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("purchases-form-fill-done"),
      ).toBeInTheDocument(),
    );
  });
});
