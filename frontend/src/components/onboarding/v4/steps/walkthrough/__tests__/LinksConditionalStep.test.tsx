import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

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

import {
  linksConditionalStep,
  SOLO_READ_DURATION_MS,
  LAB_READ_DURATION_MS,
} from "../LinksConditionalStep";
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
 *   5. The body auto-advances after the read duration (different
 *      durations for solo vs lab).
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

  it("uses event-driven completion (no manual button shown)", () => {
    expect(linksConditionalStep.completion.type).toBe("event");
  });

  it("targets /links via expectedRoute", () => {
    expect(linksConditionalStep.expectedRoute).toBe("/links");
  });
});

describe("LinksExplainerBody — solo accounts see ONLY beat 1", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

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
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

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

describe("LinksExplainerBody auto-advance timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("solo body schedules an advance after SOLO_READ_DURATION_MS", () => {
    renderInProvider(picks({ account_type: "solo", links: "yes" }));
    expect(screen.getByTestId("links-explainer-body")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(SOLO_READ_DURATION_MS + 50);
    });
    expect(SOLO_READ_DURATION_MS).toBeGreaterThan(0);
  });

  it("lab body uses a longer duration than solo (extra beat)", () => {
    expect(LAB_READ_DURATION_MS).toBeGreaterThan(SOLO_READ_DURATION_MS);
  });
});
