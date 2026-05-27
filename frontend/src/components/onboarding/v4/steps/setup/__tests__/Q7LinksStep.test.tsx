/**
 * Q7 Links step (Lab Links manager 2026-05-22): mirrors the
 * Q5TelegramStep shape — three options (yes / no / maybe later),
 * Next disabled until a pick is made, sidecar patched on click,
 * hydration from sidecar on mount so Resume / back-step lands on
 * the saved answer.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import Q7LinksStep from "../Q7LinksStep";
import { baseSidecar } from "./baseSidecar";

function postQ1Sidecar(): OnboardingSidecar {
  return baseSidecar({
    feature_picks: {
      account_type: "solo",
      purchases: "maybe",
      calendar: "maybe",
      goals: "maybe",
      telegram: "maybe",
      ai_helper: "full",
    },
  });
}

function preQ1Sidecar(): OnboardingSidecar {
  return baseSidecar({ feature_picks: null });
}

describe("Q7LinksStep", () => {
  it("disables Next until a pick is made (no feature_picks to hydrate from)", () => {
    const setNextDisabled = vi.fn();
    render(
      <Q7LinksStep
        sidecar={preQ1Sidecar()}
        setNextDisabled={setNextDisabled}
        patchSidecar={vi.fn()}
      />,
    );
    expect(setNextDisabled).toHaveBeenLastCalledWith(true);
  });

  it("renders three options: yes / no / maybe later", () => {
    render(
      <Q7LinksStep
        sidecar={postQ1Sidecar()}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );
    const radios = document.querySelectorAll(`input[name="q7-links"]`);
    expect(radios.length).toBe(3);
    // Spot-check the visible labels.
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
    expect(screen.getByText("Maybe later")).toBeInTheDocument();
  });

  it("renders the neutral-voice question copy (no 'lab' in the question)", () => {
    render(
      <Q7LinksStep
        sidecar={postQ1Sidecar()}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );
    // The brief explicitly called this out — the question copy must
    // read naturally for both solo and lab accounts. The 2026-05-27
    // tour script rewrite updated the body intro to match the
    // descriptor; the test asserts on the new "Links tab" wording.
    const lead = screen.getByText(
      /The Links tab is a dedicated space to save important bookmarks/i,
    );
    expect(lead).toBeInTheDocument();
  });

  it("persists 'yes' on click", async () => {
    let sidecar = postQ1Sidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    render(
      <Q7LinksStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );
    await userEvent.setup().click(screen.getByLabelText(/^Yes/i));
    expect(sidecar.feature_picks?.links).toBe("yes");
  });

  it("persists 'no' on click", async () => {
    let sidecar = postQ1Sidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    render(
      <Q7LinksStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );
    await userEvent.setup().click(screen.getByLabelText(/^No/i));
    expect(sidecar.feature_picks?.links).toBe("no");
  });

  it("hydrates the pick from sidecar on mount (Resume path)", () => {
    const setNextDisabled = vi.fn();
    const saved = baseSidecar({
      feature_picks: {
        account_type: "lab",
        purchases: "yes",
        calendar: "yes",
        goals: "yes",
        telegram: "yes",
        ai_helper: "full",
        links: "yes",
      },
    });
    render(
      <Q7LinksStep
        sidecar={saved}
        setNextDisabled={setNextDisabled}
        patchSidecar={vi.fn()}
      />,
    );
    expect(setNextDisabled).toHaveBeenLastCalledWith(false);
    const yesRadio = document.querySelector(
      `input[name="q7-links"][value="yes"]`,
    ) as HTMLInputElement | null;
    expect(yesRadio?.checked).toBe(true);
  });
});
