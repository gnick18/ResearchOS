import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import Q1AccountTypeStep from "../Q1AccountTypeStep";
import { baseSidecar } from "./baseSidecar";

describe("v4 Q1AccountTypeStep", () => {
  it("disables Next until a pick is made", () => {
    const setNextDisabled = vi.fn();
    render(
      <Q1AccountTypeStep
        sidecar={baseSidecar()}
        setNextDisabled={setNextDisabled}
        patchSidecar={vi.fn()}
      />,
    );
    expect(setNextDisabled).toHaveBeenLastCalledWith(true);
  });

  it("persists account_type=solo + initialFeaturePicks on first solo pick", async () => {
    let sidecar = baseSidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    render(
      <Q1AccountTypeStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await userEvent.setup().click(screen.getByLabelText(/Solo/i));

    expect(patchSidecar).toHaveBeenCalledTimes(1);
    expect(sidecar.feature_picks).toEqual({
      account_type: "solo",
      purchases: "maybe",
      calendar: "maybe",
      goals: "maybe",
      telegram: "maybe",
      ai_helper: "full",
    });
  });

  it("persists account_type=lab on lab pick", async () => {
    let sidecar = baseSidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    render(
      <Q1AccountTypeStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await userEvent.setup().click(screen.getByLabelText(/^Lab/i));

    expect(sidecar.feature_picks?.account_type).toBe("lab");
  });
});
