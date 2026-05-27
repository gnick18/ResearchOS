/**
 * Page-intro step shape tests (transition-intro sub-bot, 2026-05-26).
 *
 * Pins the contract for the new pure-narration page-intro steps:
 *   - workbench-page-intro
 *   - home-page-intro
 *   - project-page-intro
 *   - settings-page-intro
 *   - search-page-intro
 *
 * Every intro step must:
 *   - have NO cursorScript (speech-only narration)
 *   - have NO targetSelector (speech-only, dimmable overlay only)
 *   - use manual completion ("Got it, next")
 *   - set the correct expectedRoute so the route change fires
 *   - sit in TOUR_STEP_ORDER right before the first cursor / user-action
 *     beat on the destination route
 *
 * Also enforces ordering: each intro's TOUR_STEP_ORDER index must be
 * IMMEDIATELY BEFORE the named "first action beat" on that route.
 */
import { describe, expect, it } from "vitest";
import { TOUR_STEP_ORDER } from "../../../step-machine";
import { TOUR_STEPS } from "../../../step-registry";
import { workbenchPageIntroStep } from "../WorkbenchPageIntroStep";
import { homePageIntroStep } from "../HomePageIntroStep";
import { projectPageIntroStep } from "../ProjectPageIntroStep";
import { settingsPageIntroStep } from "../SettingsPageIntroStep";
import { searchPageIntroStep } from "../SearchPageIntroStep";

const INTRO_STEPS = [
  { step: workbenchPageIntroStep, id: "workbench-page-intro", route: "/workbench", firstActionId: "workbench-create-experiment-open" },
  { step: homePageIntroStep, id: "home-page-intro", route: "/", firstActionId: "home-create-project" },
  { step: projectPageIntroStep, id: "project-page-intro", route: undefined, firstActionId: "project-overview-prose" },
  { step: settingsPageIntroStep, id: "settings-page-intro", route: "/settings", firstActionId: "personalization-animations" },
  { step: searchPageIntroStep, id: "search-page-intro", route: "/search", firstActionId: "search-demo" },
] as const;

describe("page-intro step shape (transition-intro sub-bot)", () => {
  for (const { step, id, route, firstActionId } of INTRO_STEPS) {
    describe(id, () => {
      it("has the expected id", () => {
        expect(step.id).toBe(id);
      });

      it("has no cursorScript (pure narration)", () => {
        expect(step.cursorScript).toBeUndefined();
      });

      it("has no targetSelector (speech-only)", () => {
        expect(step.targetSelector).toBeUndefined();
      });

      it("uses manual completion", () => {
        expect(step.completion.type).toBe("manual");
      });

      it("sets the destination expectedRoute", () => {
        expect(step.expectedRoute).toBe(route);
      });

      it("is registered in TOUR_STEPS", () => {
        expect(TOUR_STEPS[id], `missing registry entry for ${id}`).toBeDefined();
      });

      it("appears in TOUR_STEP_ORDER", () => {
        expect(TOUR_STEP_ORDER).toContain(id);
      });

      it(`sits immediately before ${firstActionId} in TOUR_STEP_ORDER`, () => {
        const introIdx = TOUR_STEP_ORDER.indexOf(id);
        const actionIdx = TOUR_STEP_ORDER.indexOf(firstActionId);
        expect(introIdx).toBeGreaterThanOrEqual(0);
        expect(actionIdx).toBeGreaterThanOrEqual(0);
        expect(introIdx + 1).toBe(actionIdx);
      });
    });
  }

  it("no intro step contains an em-dash (Grant style rule)", () => {
    for (const { step, id } of INTRO_STEPS) {
      const speech =
        typeof step.speech === "function" ? step.speech() : step.speech;
      const text = JSON.stringify(speech);
      expect(
        text.includes("—"),
        `${id} speech contains an em-dash`,
      ).toBe(false);
    }
  });
});
