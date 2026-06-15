// Coverage for the OnboardingWizard host: it maps each selection to the right
// track and threads finish / close. The shell is mocked to capture the track id
// and to expose finish/close triggers, so the test stays focused on the host
// wiring (not the step bodies).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));

// Org tier flags on, so the org tracks build (the host has a defensive bounce
// when they are off, which we cover separately by leaving them on here).
vi.mock("@/lib/dept/config", () => ({ DEPT_TIER_ENABLED: true }));
vi.mock("@/lib/institution/config", () => ({ INSTITUTION_TIER_ENABLED: true }));

// Capture the track passed to the shell and surface finish/close triggers.
vi.mock("./OnboardingWizardShell", () => ({
  default: ({
    track,
    onFinish,
    onClose,
  }: {
    track: { id: string };
    onFinish: () => void;
    onClose: () => void;
  }) => (
    <div>
      <span data-testid="track-id">{track.id}</span>
      <button type="button" onClick={onFinish}>
        finish
      </button>
      <button type="button" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

import OnboardingWizard from "./OnboardingWizard";

describe("OnboardingWizard track selection", () => {
  const cases: Array<[string, string]> = [
    ["solo-local", "solo-local"],
    ["solo-free", "solo-free"],
    ["pi-create", "pi-create"],
    ["org-dept", "org-dept"],
    ["org-inst", "org-institution"],
  ];

  it.each(cases)("selection %s builds track %s", (selection, trackId) => {
    render(
      <OnboardingWizard
        selection={selection as never}
        onFinish={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("track-id")).toHaveTextContent(trackId);
  });

  it("calls the onFinish override when finishing", () => {
    const onFinish = vi.fn();
    render(<OnboardingWizard selection="solo-free" onFinish={onFinish} />);
    fireEvent.click(screen.getByText("finish"));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("calls the onClose override when closing", () => {
    const onClose = vi.fn();
    render(<OnboardingWizard selection="solo-free" onClose={onClose} />);
    fireEvent.click(screen.getByText("close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("routes research finish to the app root by default", () => {
    replace.mockClear();
    render(<OnboardingWizard selection="solo-free" />);
    fireEvent.click(screen.getByText("finish"));
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("routes org finish to the portal by default", () => {
    replace.mockClear();
    render(<OnboardingWizard selection="org-dept" />);
    fireEvent.click(screen.getByText("finish"));
    expect(replace).toHaveBeenCalledWith("/department");
  });
});
