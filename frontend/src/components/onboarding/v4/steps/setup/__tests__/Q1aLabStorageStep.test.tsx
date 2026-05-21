import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import Q1aLabStorageStep from "../Q1aLabStorageStep";
import { baseSidecar } from "./baseSidecar";

describe("v4 Q1aLabStorageStep", () => {
  function labSidecar(over?: Partial<OnboardingSidecar>): OnboardingSidecar {
    return baseSidecar({
      feature_picks: {
        account_type: "lab",
        purchases: "maybe",
        calendar: "maybe",
        goals: "maybe",
        telegram: "maybe",
        ai_helper: "full",
      },
      ...over,
    });
  }

  it("renders all five storage options", () => {
    render(
      <Q1aLabStorageStep
        sidecar={labSidecar()}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Local disk only/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Google Drive/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/OneDrive/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Box shared folder/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/I'll figure it out later/i)).toBeInTheDocument();
  });

  it("disables Next until a storage is picked", () => {
    const setNextDisabled = vi.fn();
    render(
      <Q1aLabStorageStep
        sidecar={labSidecar()}
        setNextDisabled={setNextDisabled}
        patchSidecar={vi.fn()}
      />,
    );
    expect(setNextDisabled).toHaveBeenLastCalledWith(true);
  });

  it("writes lab_storage on pick", async () => {
    let sidecar = labSidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    render(
      <Q1aLabStorageStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await userEvent.setup().click(screen.getByLabelText(/Google Drive/i));

    expect(sidecar.feature_picks?.lab_storage).toBe("google_drive");
  });
});
