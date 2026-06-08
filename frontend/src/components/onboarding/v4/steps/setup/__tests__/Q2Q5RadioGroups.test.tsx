/**
 * Q2 / Q3 / Q4 share the same yes / no / maybe-later radio shape +
 * local-pick-state-to-avoid-flicker pattern (see Q2 docstring). One
 * suite covers the three to keep the test file count proportional to
 * the actual surface area.
 *
 * P12 hydration: the bodies now seed their local `pick` state from the
 * sidecar's `feature_picks` on mount so a Resume from the mid-tour
 * modal lands on the saved answer. The "disables Next" assertion
 * therefore needs a sidecar with `feature_picks: null` (the genuine
 * pre-Q1 state) to verify the disabled gate. The "persists on click"
 * assertion still uses the post-Q1 sidecar shape since it needs
 * feature_picks to be non-null for the patch callback's spread to
 * survive.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import Q2PurchasesStep from "../Q2PurchasesStep";
import Q3CalendarStep from "../Q3CalendarStep";
import Q4GoalsStep from "../Q4GoalsStep";
import { baseSidecar } from "./baseSidecar";

function postQ1Sidecar(): OnboardingSidecar {
  return baseSidecar({
    feature_picks: {
      account_type: "solo",
      purchases: "maybe",
      calendar: "maybe",
      goals: "maybe",
      ai_helper: "full",
    },
  });
}

/** A sidecar with no feature_picks yet — the only shape where the
 *  Q2-Q5 bodies should disable Next (no saved answer to hydrate from). */
function preQ1Sidecar(): OnboardingSidecar {
  return baseSidecar({ feature_picks: null });
}

const STEPS = [
  {
    name: "Q2PurchasesStep",
    Component: Q2PurchasesStep,
    field: "purchases" as const,
    radioName: "q2-purchases",
  },
  {
    name: "Q3CalendarStep",
    Component: Q3CalendarStep,
    field: "calendar" as const,
    radioName: "q3-calendar",
  },
  {
    name: "Q4GoalsStep",
    Component: Q4GoalsStep,
    field: "goals" as const,
    radioName: "q4-goals",
  },
];

describe.each(STEPS)(
  "v4 yes/no/maybe radio step: $name",
  ({ Component, field, radioName }) => {
    it("disables Next until a pick is made (no feature_picks to hydrate from)", () => {
      const setNextDisabled = vi.fn();
      render(
        <Component
          sidecar={preQ1Sidecar()}
          setNextDisabled={setNextDisabled}
          patchSidecar={vi.fn()}
        />,
      );
      expect(setNextDisabled).toHaveBeenLastCalledWith(true);
    });

    it("hydrates the pick from sidecar.feature_picks on mount (P12 resume)", () => {
      const setNextDisabled = vi.fn();
      // Sidecar has a non-null saved answer on this field; the
      // body should hydrate `pick`, enable Next on mount, and
      // pre-check the matching radio so a Resume from the modal
      // doesn't lose the user's answer.
      const saved = baseSidecar({
        feature_picks: {
          account_type: "solo",
          purchases: "yes",
          calendar: "yes",
          goals: "yes",
          ai_helper: "full",
        },
      });
      render(
        <Component
          sidecar={saved}
          setNextDisabled={setNextDisabled}
          patchSidecar={vi.fn()}
        />,
      );
      expect(setNextDisabled).toHaveBeenLastCalledWith(false);
      // The "yes" radio for the relevant field should be checked.
      const yesRadio = document.querySelector(
        `input[name="${radioName}"][value="yes"]`,
      ) as HTMLInputElement | null;
      expect(yesRadio?.checked).toBe(true);
    });

    it("renders yes / no / maybe options", () => {
      render(
        <Component
          sidecar={postQ1Sidecar()}
          setNextDisabled={vi.fn()}
          patchSidecar={vi.fn()}
        />,
      );
      // Radios share an input name; find all by name and assert count.
      const radios = document.querySelectorAll(
        `input[name="${radioName}"]`,
      );
      expect(radios.length).toBe(3);
    });

    it("persists the chosen value on yes click", async () => {
      let sidecar = postQ1Sidecar();
      const patchSidecar = vi.fn(
        async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
          sidecar = mut(sidecar);
        },
      );
      render(
        <Component
          sidecar={sidecar}
          setNextDisabled={vi.fn()}
          patchSidecar={patchSidecar}
        />,
      );

      // The yes label is consistent across these four steps: starts with "Yes".
      await userEvent.setup().click(screen.getAllByLabelText(/^Yes/i)[0]);

      expect(sidecar.feature_picks?.[field]).toBe("yes");
    });
  },
);
