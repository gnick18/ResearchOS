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

  it("persists account_type=solo on first solo pick (Q2-Q6 left undefined)", async () => {
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
    // Per the 2026-05-21 fix ("Q2-Q6 fields no longer auto-default to
    // maybe"), Q1 only sets account_type. Each subsequent step's
    // patchSidecar handler adds its field on first explicit pick. This
    // keeps the radios unselected on first encounter so the user isn't
    // ambushed by a pre-selected "Maybe later".
    expect(sidecar.feature_picks).toEqual({
      account_type: "solo",
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
