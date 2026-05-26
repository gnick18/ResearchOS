/**
 * Q6 AI Helper step: covers the default-pick persistence guarantee plus
 * the standard hydrate / next-gate / radio rendering / persistence beats.
 *
 * Why this suite exists separately from `Q2Q5RadioGroups.test.tsx`:
 * Q6 is the only setup step that pre-selects a default ("full") on mount
 * and enables Next without requiring an explicit click. Before the
 * 2026-05-26 fix (q6 default-radio persistence fix bot, Chip B), the
 * visual default was not committed to the sidecar, so a user who clicked
 * Next without re-clicking landed on the wrapup with ai_helper still
 * undefined and saw "Skipped for now (turn on in Settings)" instead of
 * the "Full prompt" label they expected. The tests below pin both halves
 * of the contract: the visual radio is checked AND the sidecar field is
 * written with "full".
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import Q6AiHelperStep from "../Q6AiHelperStep";
import { baseSidecar } from "./baseSidecar";

/** Sidecar shape immediately after Q1 (account_type set, every other
 *  feature_picks field absent). This is the state Q6 sees on a fresh
 *  walk-through. */
function postQ1NoAiHelper(): OnboardingSidecar {
  return baseSidecar({
    feature_picks: {
      account_type: "solo",
    },
  });
}

describe("Q6AiHelperStep", () => {
  it("enables Next on mount (default 'full' is the recommended pick)", () => {
    const setNextDisabled = vi.fn();
    render(
      <Q6AiHelperStep
        sidecar={postQ1NoAiHelper()}
        setNextDisabled={setNextDisabled}
        patchSidecar={vi.fn()}
      />,
    );
    expect(setNextDisabled).toHaveBeenLastCalledWith(false);
  });

  it("renders the 'Full prompt' radio pre-selected when ai_helper is undefined", () => {
    render(
      <Q6AiHelperStep
        sidecar={postQ1NoAiHelper()}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );
    const fullRadio = document.querySelector(
      `input[name="q6-ai-helper"][value="full"]`,
    ) as HTMLInputElement | null;
    expect(fullRadio?.checked).toBe(true);
  });

  it("seeds ai_helper='full' into the sidecar on mount when undefined (default-radio persistence fix)", async () => {
    let sidecar: OnboardingSidecar = postQ1NoAiHelper();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    render(
      <Q6AiHelperStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );
    await waitFor(() => {
      expect(sidecar.feature_picks?.ai_helper).toBe("full");
    });
  });

  it("does NOT overwrite a saved ai_helper value when re-mounting (Resume / Back-step preserves the user's pick)", async () => {
    let sidecar: OnboardingSidecar = baseSidecar({
      feature_picks: {
        account_type: "solo",
        ai_helper: "minimal",
      },
    });
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    render(
      <Q6AiHelperStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );
    // Wait a tick for any effect-driven patches to fire.
    await Promise.resolve();
    expect(patchSidecar).not.toHaveBeenCalled();
    expect(sidecar.feature_picks?.ai_helper).toBe("minimal");

    const minimalRadio = document.querySelector(
      `input[name="q6-ai-helper"][value="minimal"]`,
    ) as HTMLInputElement | null;
    expect(minimalRadio?.checked).toBe(true);
  });

  it("renders all four radio options (full / medium / minimal / no)", () => {
    render(
      <Q6AiHelperStep
        sidecar={postQ1NoAiHelper()}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );
    const radios = document.querySelectorAll(`input[name="q6-ai-helper"]`);
    expect(radios.length).toBe(4);
  });

  it("persists 'medium' on click of the Medium prompt radio", async () => {
    let sidecar: OnboardingSidecar = postQ1NoAiHelper();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    render(
      <Q6AiHelperStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );
    await userEvent.setup().click(screen.getByLabelText(/^Yes, Medium prompt/i));
    expect(sidecar.feature_picks?.ai_helper).toBe("medium");
  });

  it("persists 'no' on click of the No / Maybe later radio", async () => {
    let sidecar: OnboardingSidecar = postQ1NoAiHelper();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    render(
      <Q6AiHelperStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );
    await userEvent.setup().click(screen.getByLabelText(/No \/ Maybe later/i));
    expect(sidecar.feature_picks?.ai_helper).toBe("no");
  });
});
