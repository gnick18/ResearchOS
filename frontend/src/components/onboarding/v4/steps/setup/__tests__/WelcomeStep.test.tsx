import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import WelcomeStep from "../WelcomeStep";

describe("v4 WelcomeStep", () => {
  it("renders the elevator pitch + the Let's go hint", () => {
    render(
      <WelcomeStep
        sidecar={null}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/local-first place/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Let.s go/i, { selector: "span" }),
    ).toBeInTheDocument();
  });

  it("describes Skip walkthrough as wrap-up with auto-cleanup (not the retired cleanup grid)", () => {
    render(
      <WelcomeStep
        sidecar={null}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );

    // The retired cleanup-grid phrasing must NOT appear.
    expect(screen.queryByText(/cleanup grid/i)).toBeNull();
    // Copy-trim pass (2026-06): the cleanup + first-project promise now
    // reads "Anything we build together along the way gets cleaned up at
    // the end, except your first project." Assert the cleanup + kept-
    // first-project framing on the rendered body.
    expect(
      screen.getByText(/gets cleaned up at the end/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/except your first project/i),
    ).toBeInTheDocument();
  });

  it("leaves Next enabled (no required pick on welcome)", () => {
    const setNextDisabled = vi.fn();
    render(
      <WelcomeStep
        sidecar={null}
        setNextDisabled={setNextDisabled}
        patchSidecar={vi.fn()}
      />,
    );
    expect(setNextDisabled).toHaveBeenLastCalledWith(false);
  });
});
