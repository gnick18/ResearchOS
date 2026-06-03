/**
 * §6.10 Settings — `personalization-color` step tests.
 *
 * Pivoted 2026-05-23 (master inline edit). Users now pick their color
 * during user creation via UserColorPickerPopup, so the walkthrough
 * step no longer demos color-picking. Instead it spotlights the "Tint
 * header with my color" toggle, runs entirely user-paced (no cursor
 * demo), and lets the user toggle, tweak colors, or just continue.
 *
 * The legacy `settingsMoreStep` body was deleted 2026-06-03 (dead,
 * unreachable, superseded by the live settings-tour-streak beat).
 * Its absence from TOUR_STEP_ORDER is guarded in step-machine.test.ts.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { TourStep } from "../../../step-types";
import {
  settingsColorStep,
  SETTINGS_COLOR_PAGE_LOCK_ALLOW_LIST,
} from "../SettingsColorStep";

function renderSpeech(step: TourStep): string {
  const speech =
    typeof step.speech === "function" ? step.speech() : step.speech;
  const { container, unmount } = render(<>{speech}</>);
  const text = container.textContent ?? "";
  unmount();
  return text;
}

describe("personalization-color (refined, §6.10 phase redesign)", () => {
  it("has the right id + pose + completion contract", () => {
    expect(settingsColorStep.id).toBe("personalization-color");
    expect(settingsColorStep.pose).toBe("pointing");
    expect(settingsColorStep.completion.type).toBe("manual");
    expect(settingsColorStep.expectedRoute).toBe("/settings");
  });

  it("targets the combined color + tint wrapper (hand-walk fix 2026-05-27)", () => {
    // Hand-walk fix 2026-05-27 (Grant): the spotlight now wraps BOTH the
    // color picker and the tint toggle (settings-color-and-tint), not
    // just the toggle. The user's mental model here is "play with the
    // colors or the tint", so the highlight encompasses both. The tint
    // toggle itself stays in the page-lock allow-list (asserted below).
    expect(settingsColorStep.targetSelector).toBe(
      "[data-tour-target=\"settings-color-and-tint\"]",
    );
  });

  it("has no cursorScript: the step is user-paced from mount", () => {
    expect(settingsColorStep.cursorScript).toBeUndefined();
  });

  it("speech explains the toggle + invites the user to play with it (Wave 2E copy)", () => {
    const text = renderSpeech(settingsColorStep);
    // Explains the toggle's purpose.
    expect(text).toMatch(/top bar/i);
    // References that color was already picked at account creation. Wave
    // 2E copy says "picked a color during setup" (was: "picked your color
    // when you set up your account") so the regex now allows either
    // "picked a color" or "picked your color".
    expect(text).toMatch(/picked (?:a|your) color/i);
    // Invites the user to play with the toggle. The prior copy also
    // mentioned "swatches" but the Wave 2E rewrite dropped that
    // elaboration to match Grant's exact 2026-05-27 script.
    expect(text).toMatch(/play with it|toggle/i);
    // Manual advance prompt.
    expect(text).toMatch(/Got it, next/i);
  });

  it("speech is em-dash free", () => {
    expect(renderSpeech(settingsColorStep)).not.toContain("—");
  });

  it("mounts a page-lock allow-list permitting toggle + palette swatches", () => {
    expect(settingsColorStep.pageLock).toBeDefined();
    expect(settingsColorStep.pageLock?.allowList).toBeDefined();
    const allow = settingsColorStep.pageLock!.allowList as ReadonlyArray<string>;
    // Tint toggle itself + its descendants.
    expect(allow.some((s) => s.includes("settings-color-tint-toggle"))).toBe(
      true,
    );
    // Palette swatches stay reachable so the user can refine colors.
    expect(allow).toContain("[data-color-swatch]");
    // Clear-secondary button anchor (gradient feature) stays permitted.
    expect(allow.some((s) => s.includes("settings-color-picker-clear-secondary"))).toBe(
      true,
    );
  });

  it("exports the page-lock allow-list as a named constant for re-use", () => {
    // Smoke check: the exported constant is the SAME array passed to
    // the step's pageLock.allowList, so tests / dev tools can probe
    // the exact selectors without re-typing them.
    expect(SETTINGS_COLOR_PAGE_LOCK_ALLOW_LIST).toBe(
      settingsColorStep.pageLock?.allowList,
    );
  });
});
