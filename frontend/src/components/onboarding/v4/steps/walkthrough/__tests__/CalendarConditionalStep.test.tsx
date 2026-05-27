import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Stub next/navigation's useRouter for the TourController auto-
// navigate effect (Onboarding v4 route-nav fix). push() is a no-op.
// R2 chip B Fix 1/3: usePathname now in TourController's dep array.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/",
}));

import { calendarConditionalStep } from "../CalendarConditionalStep";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";

/**
 * §6.15 Calendar step body tests.
 *
 * Verifies:
 *   1. The step body exports a TourStep object with the right id +
 *      conditional gate.
 *   2. The speech ReactNode renders the §6.15 explainer copy (key
 *      phrases checked, no em-dashes).
 *   3. The completion uses manualAdvance per Wave 1 universal-pacing
 *      rule (R2 chip C 2026-05-22).
 *   4. The conditional gate matches `picks.calendar === "yes"`.
 */

function picks(over: Partial<FeaturePicks> = {}): FeaturePicks {
  return {
    account_type: "solo",
    purchases: "no",
    calendar: "yes",
    goals: "no",
    telegram: "no",
    ai_helper: "no",
    ...over,
  };
}

describe("calendarConditionalStep step shape", () => {
  it("exposes the expected id + pose + conditional gate", () => {
    expect(calendarConditionalStep.id).toBe("calendar");
    expect(calendarConditionalStep.pose).toBe("pointing");
    expect(calendarConditionalStep.targetSelector).toBe(
      "[data-tour-target='calendar-tab']",
    );
  });

  it("conditionalOn passes only when picks.calendar === 'yes'", () => {
    const gate = calendarConditionalStep.conditionalOn!;
    expect(gate(picks({ calendar: "yes" }))).toBe(true);
    expect(gate(picks({ calendar: "no" }))).toBe(false);
    expect(gate(picks({ calendar: "maybe" }))).toBe(false);
    expect(gate(null)).toBe(false);
  });

  it("uses manualAdvance completion (Wave 1 universal-pacing rule)", () => {
    expect(calendarConditionalStep.completion.type).toBe("manual");
    expect(
      (calendarConditionalStep.completion as { buttonLabel?: string })
        .buttonLabel,
    ).toBe("Got it, next");
  });
});

describe("CalendarExplainerBody speech copy", () => {
  function renderStandalone() {
    // R2 chip C 2026-05-22: speech is now an inline ReactNode (no
    // hooks, no controller dependency) because the prior
    // CalendarExplainerBody body existed only to schedule the auto-
    // advance timer. With manual advance, no body component is needed,
    // so we can render the speech outside the TourControllerProvider
    // entirely. (Rendering inside the provider would double-mount the
    // speech because the provider's TourOverlay also renders the
    // active step's speech, surfacing as a getByTestId "multiple
    // elements" failure.)
    const speechProp = calendarConditionalStep.speech;
    const speechNode =
      typeof speechProp === "function" ? speechProp() : speechProp;
    return render(<>{speechNode}</>);
  }

  it("renders the §6.15 explainer body", () => {
    renderStandalone();
    const body = screen.getByTestId("calendar-explainer-body");
    // Hits the key spec phrases.
    expect(body.textContent).toMatch(/Calendar tab/);
    expect(body.textContent).toMatch(/meetings/i);
    expect(body.textContent).toMatch(/Link as many feeds/i);
    expect(body.textContent).toMatch(/Outlook/);
    expect(body.textContent).toMatch(/Apple/);
    expect(body.textContent).toMatch(/Google/);
    expect(body.textContent).toMatch(/quick-view bar/i);
  });

  it("does not contain em-dashes (Grant standing rule)", () => {
    renderStandalone();
    const body = screen.getByTestId("calendar-explainer-body");
    expect(body.textContent ?? "").not.toContain("—");
  });
});
