// RTL coverage for the onboarding wizard shell chrome and navigation.
//
// We mock the decorative LandingBackdrop (BeakerBot animations) and the Tooltip
// (portal) so the test stays focused on the shell wiring: progress, Back, Skip,
// close, and the finish/close callbacks.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@/components/onboarding/oauth-first/LandingBackdrop", () => ({
  default: () => <div data-testid="mock-backdrop" />,
}));

vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import OnboardingWizardShell from "./OnboardingWizardShell";
import type { WizardTrack } from "./wizard-model";

function makeTrack(stepCount: number, opts?: { skippableIndexes?: number[] }): WizardTrack {
  const skippable = new Set(opts?.skippableIndexes ?? []);
  return {
    id: "test-track",
    label: "Test",
    steps: Array.from({ length: stepCount }, (_, i) => ({
      id: `step-${i}`,
      label: `Step ${i}`,
      skippable: skippable.has(i),
      render: (c) => (
        <div>
          <p>body-{i}</p>
          <button type="button" onClick={c.next}>
            advance-{i}
          </button>
        </div>
      ),
    })),
  };
}

describe("OnboardingWizardShell", () => {
  it("renders the first step body and shows progress for a multi-step track", () => {
    render(
      <OnboardingWizardShell
        track={makeTrack(4)}
        onFinish={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("body-0")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-progress")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-dot-0")).toHaveAttribute("data-active", "true");
  });

  it("hides the progress counter for a single-step track", () => {
    render(
      <OnboardingWizardShell
        track={makeTrack(1)}
        onFinish={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("wizard-progress")).not.toBeInTheDocument();
  });

  it("hides Back on the first step and shows it after advancing", () => {
    render(
      <OnboardingWizardShell
        track={makeTrack(4)}
        onFinish={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("wizard-back")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("advance-0"));
    expect(screen.getByText("body-1")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-back")).toBeInTheDocument();
  });

  it("Back returns to the previous step", () => {
    render(
      <OnboardingWizardShell
        track={makeTrack(4)}
        onFinish={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("advance-0"));
    fireEvent.click(screen.getByTestId("wizard-back"));
    expect(screen.getByText("body-0")).toBeInTheDocument();
  });

  it("shows Skip only on skippable steps", () => {
    render(
      <OnboardingWizardShell
        track={makeTrack(3, { skippableIndexes: [1] })}
        onFinish={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // step 0 is not skippable
    expect(screen.queryByTestId("wizard-skip")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("advance-0"));
    // step 1 is skippable
    expect(screen.getByTestId("wizard-skip")).toBeInTheDocument();
  });

  it("Skip advances the step", () => {
    render(
      <OnboardingWizardShell
        track={makeTrack(3, { skippableIndexes: [0] })}
        onFinish={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("wizard-skip"));
    expect(screen.getByText("body-1")).toBeInTheDocument();
  });

  it("calls onFinish after advancing past the last step", () => {
    const onFinish = vi.fn();
    render(
      <OnboardingWizardShell
        track={makeTrack(2)}
        onFinish={onFinish}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("advance-0"));
    fireEvent.click(screen.getByText("advance-1"));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the close button is clicked (escape from every state)", () => {
    const onClose = vi.fn();
    render(
      <OnboardingWizardShell
        track={makeTrack(4)}
        onFinish={vi.fn()}
        onClose={onClose}
      />,
    );
    expect(screen.getByTestId("wizard-close")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("wizard-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the close button reachable on the first step (no Back, but always an escape)", () => {
    render(
      <OnboardingWizardShell
        track={makeTrack(4)}
        onFinish={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("wizard-back")).not.toBeInTheDocument();
    expect(screen.getByTestId("wizard-close")).toBeInTheDocument();
  });
});
