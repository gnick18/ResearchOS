/**
 * Q2 / Q3 / Q4 / Q5 share the same yes / no / maybe-later radio shape +
 * local-pick-state-to-avoid-flicker pattern (see Q2 docstring). One
 * suite covers the four to keep the test file count proportional to
 * the actual surface area.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import Q2PurchasesStep from "../Q2PurchasesStep";
import Q3CalendarStep from "../Q3CalendarStep";
import Q4GoalsStep from "../Q4GoalsStep";
import Q5TelegramStep from "../Q5TelegramStep";
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
  {
    name: "Q5TelegramStep",
    Component: Q5TelegramStep,
    field: "telegram" as const,
    radioName: "q5-telegram",
  },
];

describe.each(STEPS)(
  "v4 yes/no/maybe radio step: $name",
  ({ Component, field, radioName }) => {
    it("disables Next until a pick is made", () => {
      const setNextDisabled = vi.fn();
      render(
        <Component
          sidecar={postQ1Sidecar()}
          setNextDisabled={setNextDisabled}
          patchSidecar={vi.fn()}
        />,
      );
      expect(setNextDisabled).toHaveBeenLastCalledWith(true);
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
