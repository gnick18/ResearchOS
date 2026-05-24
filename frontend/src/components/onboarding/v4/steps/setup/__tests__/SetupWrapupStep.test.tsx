import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// next/navigation router stub: SetupWrapupStep only uses router.push in
// the Go-to-home handler; the render path doesn't read from it. Stub
// returns the minimum surface so the import resolves without pulling in
// the App-Router boundary.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// useTourController stub: the wrap-up body calls controller.advance and
// controller.exitTour only inside button handlers. For the rendering
// assertions below we only need the hook to return SOMETHING shaped like
// the real controller; both methods are no-op vi.fns.
vi.mock("../../../TourController", async () => {
  const actual = await vi.importActual<
    typeof import("../../../TourController")
  >("../../../TourController");
  return {
    ...actual,
    useTourController: () => ({
      advance: vi.fn(),
      exitTour: vi.fn(),
      // Other TourControllerValue methods are unused by SetupWrapupStep
      // but the real consumer type includes them; tests don't read these
      // so leaving them out of the stub is fine (the consumer narrows by
      // method access, not by structural shape check).
    }),
  };
});

import SetupWrapupStep from "../SetupWrapupStep";
import { baseSidecar } from "./baseSidecar";

/**
 * FeaturePicks.lab_head field manager 2026-05-24: rendering coverage for
 * the Account type summary row. Confirms the lab_head signal from Q1c
 * reaches the wrap-up screen for all three fixture personas:
 *   - Solo user (lab_head field absent + irrelevant)
 *   - Lab member (account_type=lab, lab_head=false)
 *   - Lab head   (account_type=lab, lab_head=true)
 * Plus a back-compat case where Q1c was skipped (account_type=lab,
 * lab_head=undefined) so the lab line still renders cleanly.
 */
describe("v4 SetupWrapupStep — Account type row", () => {
  it("renders 'Solo' for a solo user", () => {
    render(
      <SetupWrapupStep
        sidecar={baseSidecar({
          feature_picks: { account_type: "solo" },
        })}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );
    expect(screen.getByText(/Solo \(just you on this account\)/)).toBeTruthy();
  });

  it("renders the lab-head addendum when feature_picks.lab_head === true", () => {
    render(
      <SetupWrapupStep
        sidecar={baseSidecar({
          feature_picks: { account_type: "lab", lab_head: true },
        })}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );
    expect(screen.getByText(/You run this lab\./)).toBeTruthy();
  });

  it("renders the lab-member addendum when feature_picks.lab_head === false", () => {
    render(
      <SetupWrapupStep
        sidecar={baseSidecar({
          feature_picks: { account_type: "lab", lab_head: false },
        })}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );
    expect(screen.getByText(/You are a member\./)).toBeTruthy();
  });

  it("falls back to the bare lab line when lab_head is undefined (Q1c skipped)", () => {
    render(
      <SetupWrapupStep
        sidecar={baseSidecar({
          feature_picks: { account_type: "lab" },
        })}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );
    // Renders the bare lab description with NO follow-up sentence. We
    // assert both the positive (lab line present) and negative (no
    // lab-head / member sentence) to confirm the fallback is clean.
    expect(
      screen.getByText(/Lab \(shared folder, multiple users\)$/),
    ).toBeTruthy();
    expect(screen.queryByText(/You run this lab\./)).toBeNull();
    expect(screen.queryByText(/You are a member\./)).toBeNull();
  });
});
