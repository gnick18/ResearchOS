/**
 * §6.10 Settings — refined `personalization-color` step tests.
 *
 * Settings manager 2026-05-22 (§6.10 phase redesign). The prior single-
 * paragraph speech ("Now let's pick your color. Watch the chrome shift
 * live.") gains a second paragraph inviting the optional secondary
 * pick, AND the step mounts a page-lock allow-list so the user can
 * optionally click any palette swatch (primary + secondary, once the
 * gradient sub-bot a621daf4 ships) + the Clear-secondary button.
 *
 * Defensive primary-only (gradient sub-bot in flight): the allow-list
 * permits the existing `[data-color-swatch]` attribute on every
 * palette button and the new `settings-color-picker-clear-secondary`
 * anchor. The secondary palette UI doesn't exist yet, so the cursor
 * script clicks only the primary swatch and leaves the optional stage
 * to whatever palette ships.
 *
 * The legacy `settingsMoreStep` survives in the file with @deprecated
 * JSDoc but is no longer in TOUR_STEP_ORDER. Tests for that body are
 * intentionally dropped here.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { TourStep } from "../../../step-types";
import {
  settingsColorStep,
  settingsMoreStep,
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

  it("targets the settings color picker", () => {
    expect(settingsColorStep.targetSelector).toBe(
      "[data-tour-target=\"settings-color-picker\"]",
    );
  });

  it("retains the cursorScript for the primary swatch demo", () => {
    expect(settingsColorStep.cursorScript).toBeDefined();
  });

  it("speech invites the optional secondary pick", () => {
    const text = renderSpeech(settingsColorStep);
    // Primary demo phrase from the prior body.
    expect(text).toMatch(/Watch the chrome shift live/);
    // New: optional-secondary invitation.
    expect(text).toMatch(/gradient/i);
    expect(text).toMatch(/second color/i);
    expect(text).toMatch(/Got it, next/i);
  });

  it("speech is em-dash free", () => {
    expect(renderSpeech(settingsColorStep)).not.toContain("—");
  });

  it("mounts a page-lock allow-list permitting palette swatches + Got-it button", () => {
    expect(settingsColorStep.pageLock).toBeDefined();
    expect(settingsColorStep.pageLock?.allowList).toBeDefined();
    const allow = settingsColorStep.pageLock!.allowList as ReadonlyArray<string>;
    // Primary + (future) secondary palette swatches share the
    // data-color-swatch attribute, so the allow-list extends to both
    // without a follow-up edit when the gradient sub-bot lands.
    expect(allow).toContain("[data-color-swatch]");
    // Defensive: the Clear-secondary button (gradient sub-bot)
    // anchor is allow-listed even though the anchor doesn't exist
    // yet — when gradient ships, the user can clear the secondary
    // pick without the page-lock blocking the click.
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

describe("@deprecated settings-more step body (retained for back-compat)", () => {
  it("still exports under the legacy id", () => {
    // Regression guard: the @deprecated body survives in the file so
    // git history + back-compat importers stay compiling. The body is
    // NOT in TOUR_STEP_ORDER, so the machine never lands on it. This
    // assertion just confirms the file still exports the symbol.
    expect(settingsMoreStep.id).toBe("settings-more");
    expect(settingsMoreStep.completion.type).toBe("auto");
  });
});
