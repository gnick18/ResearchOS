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
