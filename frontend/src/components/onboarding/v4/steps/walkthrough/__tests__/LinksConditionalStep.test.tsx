import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Stub next/navigation's useRouter for the TourController auto-
// navigate effect (Onboarding v4 route-nav fix). push() is a no-op.
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

import { linksConditionalStep } from "../LinksConditionalStep";
import { TourControllerProvider } from "../../../TourController";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";

/**
 * Links conditional walkthrough tests (Lab Links manager 2026-05-22).
 *
 * Verifies:
 *   1. Step shape exposes the expected id + pose + conditional gate.
 *   2. `conditionalOn` keys on `picks.links === "yes"`, not
 *      `picks.account_type`.
 *   3. Solo accounts with links=yes see ONLY beat 1.
 *   4. Lab accounts with links=yes see BOTH beats.
 *   5. The completion uses manualAdvance per Wave 1 universal-pacing
 *      rule (R2 chip C 2026-05-22).
 */

function picks(over: Partial<FeaturePicks> = {}): FeaturePicks {
  return {
    account_type: "solo",
    purchases: "no",
    calendar: "no",
    goals: "no",
    telegram: "no",
    ai_helper: "no",
    links: "yes",
    ...over,
  };
}

describe("linksConditionalStep step shape", () => {
  it("exposes the expected id + pose + target selector", () => {
    expect(linksConditionalStep.id).toBe("links");
    expect(linksConditionalStep.pose).toBe("pointing");
    expect(linksConditionalStep.targetSelector).toBe(
      "[data-tour-target='lab-links-nav-tab']",
    );
  });

  it("conditionalOn passes only when picks.links === 'yes'", () => {
    const gate = linksConditionalStep.conditionalOn!;
    expect(gate(picks({ links: "yes" }))).toBe(true);
    expect(gate(picks({ links: "no" }))).toBe(false);
    expect(gate(picks({ links: "maybe" }))).toBe(false);
    expect(gate(picks({ links: undefined }))).toBe(false);
    expect(gate(null)).toBe(false);
  });

  it("conditional gate is account-type-agnostic (both solo + lab with links=yes pass)", () => {
    const gate = linksConditionalStep.conditionalOn!;
    expect(gate(picks({ account_type: "solo", links: "yes" }))).toBe(true);
    expect(gate(picks({ account_type: "lab", links: "yes" }))).toBe(true);
  });

  it("uses manualAdvance completion (Wave 1 universal-pacing rule)", () => {
    expect(linksConditionalStep.completion.type).toBe("manual");
    expect(
      (linksConditionalStep.completion as { buttonLabel?: string })
        .buttonLabel,
    ).toBe("Got it, next");
  });

  it("targets /links via expectedRoute", () => {
    expect(linksConditionalStep.expectedRoute).toBe("/links");
  });
});

describe("LinksExplainerBody — solo accounts see ONLY beat 1", () => {
  function renderInProvider(p: FeaturePicks) {
    if (typeof linksConditionalStep.speech !== "function") {
      throw new Error("expected speech to be a render function");
    }
    const speechNode = linksConditionalStep.speech();
    return render(
      <TourControllerProvider initialFeaturePicks={p} initialStep="links">
        {speechNode}
      </TourControllerProvider>,
    );
  }

  it("renders beat 1 but NOT beat 2 for solo + links=yes", () => {
    renderInProvider(picks({ account_type: "solo", links: "yes" }));
    expect(screen.getByTestId("links-explainer-beat-1")).toBeInTheDocument();
    expect(
      screen.queryByTestId("links-explainer-beat-2"),
    ).not.toBeInTheDocument();
  });

  it("beat 1 hits the spec phrases", () => {
    renderInProvider(picks({ account_type: "solo", links: "yes" }));
    const beat1 = screen.getByTestId("links-explainer-beat-1");
    expect(beat1.textContent).toMatch(/save bookmarks/i);
    expect(beat1.textContent).toMatch(/Add Link/i);
    expect(beat1.textContent).toMatch(/VPN/i);
    expect(beat1.textContent).toMatch(/freezer inventory/i);
  });

  it("does not contain em-dashes (Grant standing rule)", () => {
    renderInProvider(picks({ account_type: "solo", links: "yes" }));
    const body = screen.getByTestId("links-explainer-body");
    expect(body.textContent ?? "").not.toContain("—");
  });
});

describe("LinksExplainerBody — lab accounts see BOTH beats", () => {
  function renderInProvider(p: FeaturePicks) {
    if (typeof linksConditionalStep.speech !== "function") {
      throw new Error("expected speech to be a render function");
    }
    const speechNode = linksConditionalStep.speech();
    return render(
      <TourControllerProvider initialFeaturePicks={p} initialStep="links">
        {speechNode}
      </TourControllerProvider>,
    );
  }

  it("renders beat 1 AND beat 2 for lab + links=yes", () => {
    renderInProvider(picks({ account_type: "lab", links: "yes" }));
    expect(screen.getByTestId("links-explainer-beat-1")).toBeInTheDocument();
    expect(screen.getByTestId("links-explainer-beat-2")).toBeInTheDocument();
  });

  it("beat 2 mentions the public/teammates teaching", () => {
    renderInProvider(picks({ account_type: "lab", links: "yes" }));
    const beat2 = screen.getByTestId("links-explainer-beat-2");
    expect(beat2.textContent).toMatch(/public/i);
    expect(beat2.textContent).toMatch(/teammates/i);
  });
});
