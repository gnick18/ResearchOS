import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import Q1bLabConnectInfoStep from "../Q1bLabConnectInfoStep";
import { baseSidecar } from "./baseSidecar";

function labSidecarWith(
  storage: NonNullable<
    NonNullable<OnboardingSidecar["feature_picks"]>["lab_storage"]
  >,
): OnboardingSidecar {
  return baseSidecar({
    feature_picks: {
      account_type: "lab",
      purchases: "maybe",
      calendar: "maybe",
      goals: "maybe",
      telegram: "maybe",
      ai_helper: "full",
      lab_storage: storage,
    },
  });
}

describe("v4 Q1bLabConnectInfoStep", () => {
  it("always leaves Next enabled (informational only)", () => {
    const setNextDisabled = vi.fn();
    render(
      <Q1bLabConnectInfoStep
        sidecar={labSidecarWith("google_drive")}
        setNextDisabled={setNextDisabled}
        patchSidecar={vi.fn()}
      />,
    );
    expect(setNextDisabled).toHaveBeenLastCalledWith(false);
  });

  it("shows the three-path decision for Google Drive", () => {
    render(
      <Q1bLabConnectInfoStep
        sidecar={labSidecarWith("google_drive")}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Already pointed at the lab/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Need to install Google Drive first/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Use a temporary local folder for now/i),
    ).toBeInTheDocument();
  });

  it("renders local-only copy for local pick", () => {
    render(
      <Q1bLabConnectInfoStep
        sidecar={labSidecarWith("local")}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/You picked local-disk-only/i),
    ).toBeInTheDocument();
  });

  it("renders deferred copy when storage is deferred", () => {
    render(
      <Q1bLabConnectInfoStep
        sidecar={labSidecarWith("deferred")}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/You can configure the lab/i),
    ).toBeInTheDocument();
  });

  it("shows OneDrive-tailored install link", () => {
    render(
      <Q1bLabConnectInfoStep
        sidecar={labSidecarWith("onedrive")}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: /install OneDrive/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("onedrive"));
  });
});
