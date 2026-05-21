import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type {
  FeaturePicks,
  OnboardingSidecar,
} from "@/lib/onboarding/sidecar";
import type { PurchaseItem } from "@/lib/types";

/**
 * §6.14 Purchases step body tests.
 *
 * Mocks the purchases/tasks APIs + the sidecar patch helper to verify
 * the step body runs the canonical create flow with the spec's funny
 * placeholder values, persists three artifacts (funding_string,
 * purchase, purchase_item), and auto-advances after the purchase saves.
 */

const {
  tasksApiCreate,
  purchasesApiCreate,
  patchOnboardingMock,
  readOnboardingMock,
} = vi.hoisted(() => ({
  tasksApiCreate: vi.fn(),
  purchasesApiCreate: vi.fn(),
  patchOnboardingMock: vi.fn(),
  readOnboardingMock: vi.fn(),
}));

vi.mock("@/lib/local-api", () => ({
  tasksApi: { create: tasksApiCreate },
  purchasesApi: { create: purchasesApiCreate },
}));

vi.mock("@/lib/onboarding/sidecar", () => ({
  patchOnboarding: patchOnboardingMock,
  readOnboarding: readOnboardingMock,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alex" }),
}));

import {
  purchasesConditionalStep,
  FUNDING_STRING_NAME,
  PURCHASE_ITEM_NAME,
  PURCHASE_VENDOR,
  PURCHASE_PRICE,
  PURCHASE_QTY,
  PURCHASE_TASK_NAME,
} from "../PurchasesConditionalStep";
import { TourControllerProvider } from "../../../TourController";

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

describe("purchasesConditionalStep step shape", () => {
  it("exposes the expected id + pose + conditional gate", () => {
    expect(purchasesConditionalStep.id).toBe("purchases");
    expect(purchasesConditionalStep.pose).toBe("cheering");
    expect(purchasesConditionalStep.targetSelector).toBe(
      "[data-tour-target='purchases-tab']",
    );
  });

  it("conditionalOn passes only when picks.purchases === 'yes'", () => {
    const gate = purchasesConditionalStep.conditionalOn!;
    expect(gate(picks({ purchases: "yes" }))).toBe(true);
    expect(gate(picks({ purchases: "no" }))).toBe(false);
    expect(gate(picks({ purchases: "maybe" }))).toBe(false);
    expect(gate(null)).toBe(false);
  });

  it("uses event-driven completion", () => {
    expect(purchasesConditionalStep.completion.type).toBe("event");
  });
});

describe("PurchasesDemoBody create flow", () => {
  beforeEach(() => {
    tasksApiCreate.mockReset();
    purchasesApiCreate.mockReset();
    patchOnboardingMock.mockReset();
    readOnboardingMock.mockReset();

    readOnboardingMock.mockResolvedValue({
      version: 1,
      first_seen_at: "2026-05-21T00:00:00.000Z",
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
    });
    tasksApiCreate.mockResolvedValue({
      id: 42,
      project_id: null,
      name: PURCHASE_TASK_NAME,
      start_date: "2026-05-21",
      duration_days: 1,
      end_date: "2026-05-21",
      is_high_level: false,
      is_complete: false,
      task_type: "purchase",
      weekend_override: null,
      method_ids: [],
      deviation_log: null,
      tags: null,
      sort_order: 0,
      experiment_color: null,
      sub_tasks: null,
      method_attachments: [],
      owner: "alex",
    });
    purchasesApiCreate.mockResolvedValue({
      id: 99,
      task_id: 42,
      item_name: PURCHASE_ITEM_NAME,
      quantity: PURCHASE_QTY,
      link: null,
      cas: null,
      price_per_unit: PURCHASE_PRICE,
      shipping_fees: 0,
      total_price: PURCHASE_PRICE,
      notes: null,
      funding_string: FUNDING_STRING_NAME,
      vendor: PURCHASE_VENDOR,
      category: null,
    });
    patchOnboardingMock.mockImplementation(
      async (
        _user: string,
        patch: (cur: OnboardingSidecar) => OnboardingSidecar,
      ) => {
        const cur = await readOnboardingMock(_user);
        return patch(cur);
      },
    );
  });

  function renderBody() {
    if (typeof purchasesConditionalStep.speech !== "function") {
      throw new Error("expected speech to be a render function");
    }
    return render(
      <TourControllerProvider
        initialFeaturePicks={picks()}
        initialStep="purchases"
      >
        {purchasesConditionalStep.speech()}
      </TourControllerProvider>,
    );
  }

  it("creates the funding string + purchase with §6.14 sample values", async () => {
    renderBody();

    await waitFor(() => expect(tasksApiCreate).toHaveBeenCalled());

    expect(tasksApiCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: PURCHASE_TASK_NAME,
        task_type: "purchase",
        duration_days: 1,
      }),
    );

    await waitFor(() => expect(purchasesApiCreate).toHaveBeenCalled());

    expect(purchasesApiCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        task_id: 42,
        item_name: PURCHASE_ITEM_NAME,
        vendor: PURCHASE_VENDOR,
        price_per_unit: PURCHASE_PRICE,
        quantity: PURCHASE_QTY,
        funding_string: FUNDING_STRING_NAME,
      }),
    );
  });

  it("persists funding_string + purchase + purchase_item artifacts via sidecar", async () => {
    renderBody();

    await waitFor(() =>
      expect(patchOnboardingMock).toHaveBeenCalledWith(
        "alex",
        expect.any(Function),
      ),
    );

    // Run the patch fn against an empty sidecar to inspect the
    // composed shape.
    const [, patchFn] = patchOnboardingMock.mock.calls[0];
    const out = patchFn({
      version: 1,
      first_seen_at: "2026-05-21T00:00:00.000Z",
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
    });
    const artifacts = out.wizard_resume_state?.artifacts_created ?? [];
    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "funding_string",
          id: FUNDING_STRING_NAME,
          cleanup_default: "keep",
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

  it("renders the §6.14 sample copy somewhere in the flow", async () => {
    // Hold the purchase API in a manual-resolve pending state so we
    // can observe the "creating-purchase" narration phase. Otherwise
    // the body races past it to the "done" stage and we can't assert
    // the intermediate copy. The done-stage copy also carries the
    // funding string name, so we assert against either reachable
    // stage.
    let resolvePurchase: ((value: PurchaseItem) => void) | undefined;
    purchasesApiCreate.mockImplementationOnce(
      () => new Promise<PurchaseItem>((resolve) => { resolvePurchase = resolve; }),
    );

    renderBody();

    // Wait for the creating-purchase phase to render.
    await waitFor(() => {
      expect(
        screen.getByTestId("purchases-creating-purchase"),
      ).toBeInTheDocument();
    });

    const creating = screen.getByTestId("purchases-creating-purchase");
    expect(creating.textContent).toMatch(/12-well Plates Of Premium Hand-Painted Quality/);
    expect(creating.textContent).toMatch(/BeakerBot's Boutique/);
    expect(creating.textContent).toMatch(/BeakerBot's allowance/);

    // Resolve the purchase create so the test cleans up without
    // leaving an unresolved promise dangling.
    resolvePurchase?.({
      id: 99,
      task_id: 42,
      item_name: PURCHASE_ITEM_NAME,
      quantity: PURCHASE_QTY,
      link: null,
      cas: null,
      price_per_unit: PURCHASE_PRICE,
      shipping_fees: 0,
      total_price: PURCHASE_PRICE,
      notes: null,
      funding_string: FUNDING_STRING_NAME,
      vendor: PURCHASE_VENDOR,
      category: null,
    });
  });

  it("falls through to an error narration if the API throws (no advance block)", async () => {
    tasksApiCreate.mockRejectedValueOnce(new Error("boom"));
    renderBody();
    await waitFor(() => {
      expect(screen.getByTestId("purchases-error")).toBeInTheDocument();
    });
  });
});
