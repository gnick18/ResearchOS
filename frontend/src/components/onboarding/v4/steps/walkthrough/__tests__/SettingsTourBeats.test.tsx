/**
 * §6.10 Settings phase redesign 2026-05-22 (Settings manager).
 *
 * Per-step contract tests for the 7 settings-tour-* narration beats.
 * Each test verifies:
 *
 *   - The step body exports a TourStep with the right id.
 *   - The completion contract is manual ("Got it, next").
 *   - The expectedRoute is `/settings` so a refresh-mid-tour resume
 *     auto-navigates back to Settings before the beat fires.
 *   - The conditional gate predicate matches the per-step rule.
 *   - The speech bubble contains the key phrases from the spec.
 *   - The speech bubble does NOT contain em-dashes (Grant standing rule).
 *
 * Three beats are conditional (calendar / telegram / lab-mode-toggle);
 * the other four (folder / visible-tabs / streak / rerun) fire for
 * everyone (no `conditionalOn`).
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import type { TourStep } from "../../../step-types";
import {
  settingsTourFolderStep,
  settingsTourCalendarStep,
  settingsTourTelegramStep,
  settingsTourLabModeToggleStep,
  settingsTourVisibleTabsStep,
  settingsTourStreakStep,
  settingsTourRerunStep,
} from "../SettingsTourBeats";

/** Helper: produce a FeaturePicks with all "no" / solo defaults. */
function picks(over: Partial<FeaturePicks> = {}): FeaturePicks {
  return {
    account_type: "solo",
    purchases: "no",
    calendar: "no",
    goals: "no",
    telegram: "no",
    ai_helper: "no",
    ...over,
  };
}

/** Render the step's speech and return the body text content. */
function renderSpeech(step: TourStep): string {
  const speech =
    typeof step.speech === "function" ? step.speech() : step.speech;
  const { container, unmount } = render(<>{speech}</>);
  const text = container.textContent ?? "";
  unmount();
  return text;
}

describe("settings-tour-folder (universal)", () => {
  it("has the right id + pose + completion contract", () => {
    expect(settingsTourFolderStep.id).toBe("settings-tour-folder");
    expect(settingsTourFolderStep.pose).toBe("pointing");
    expect(settingsTourFolderStep.completion.type).toBe("manual");
    expect(settingsTourFolderStep.expectedRoute).toBe("/settings");
  });
  it("anchors on the settings-folder-section spotlight target", () => {
    expect(settingsTourFolderStep.targetSelector).toBe(
      "[data-tour-target=\"settings-folder-section\"]",
    );
  });
  it("has no conditionalOn predicate (universal)", () => {
    expect(settingsTourFolderStep.conditionalOn).toBeUndefined();
  });
  it("speech mentions the folder + switching folders", () => {
    const text = renderSpeech(settingsTourFolderStep);
    expect(text).toMatch(/lab folder/i);
    expect(text).toMatch(/switch/i);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(settingsTourFolderStep)).not.toContain("—");
  });
});

describe("settings-tour-calendar (conditional: calendar === yes)", () => {
  it("has the right id + pose + completion contract", () => {
    expect(settingsTourCalendarStep.id).toBe("settings-tour-calendar");
    expect(settingsTourCalendarStep.pose).toBe("pointing");
    expect(settingsTourCalendarStep.completion.type).toBe("manual");
    expect(settingsTourCalendarStep.expectedRoute).toBe("/settings");
  });
  it("has no targetSelector (calendar feeds have no Settings home yet)", () => {
    // FOLLOW-UP: once a calendar-feeds section ships on /settings, this
    // beat picks up the spotlight; the test asserts the current
    // narration-only behavior so the assertion catches the wire-up
    // when it happens.
    expect(settingsTourCalendarStep.targetSelector).toBeUndefined();
  });
  it("conditionalOn passes only when picks.calendar === 'yes'", () => {
    const gate = settingsTourCalendarStep.conditionalOn!;
    expect(gate(picks({ calendar: "yes" }))).toBe(true);
    expect(gate(picks({ calendar: "no" }))).toBe(false);
    expect(gate(picks({ calendar: "maybe" }))).toBe(false);
    expect(gate(null)).toBe(false);
  });
  it("speech mentions .ics URLs + 'calendar'", () => {
    const text = renderSpeech(settingsTourCalendarStep);
    expect(text).toMatch(/\.ics/);
    expect(text).toMatch(/calendar/i);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(settingsTourCalendarStep)).not.toContain("—");
  });
});

describe("settings-tour-telegram (conditional: telegram === yes)", () => {
  it("has the right id + pose + completion contract", () => {
    expect(settingsTourTelegramStep.id).toBe("settings-tour-telegram");
    expect(settingsTourTelegramStep.pose).toBe("pointing");
    expect(settingsTourTelegramStep.completion.type).toBe("manual");
    expect(settingsTourTelegramStep.expectedRoute).toBe("/settings");
  });
  it("anchors on the settings-telegram-section spotlight target", () => {
    expect(settingsTourTelegramStep.targetSelector).toBe(
      "[data-tour-target=\"settings-telegram-section\"]",
    );
  });
  it("conditionalOn passes only when picks.telegram === 'yes'", () => {
    const gate = settingsTourTelegramStep.conditionalOn!;
    expect(gate(picks({ telegram: "yes" }))).toBe(true);
    expect(gate(picks({ telegram: "no" }))).toBe(false);
    expect(gate(picks({ telegram: "maybe" }))).toBe(false);
    expect(gate(null)).toBe(false);
  });
  it("speech mentions Telegram + 'spot'", () => {
    const text = renderSpeech(settingsTourTelegramStep);
    expect(text).toMatch(/Telegram/);
    expect(text).toMatch(/spot/i);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(settingsTourTelegramStep)).not.toContain("—");
  });
});

describe("settings-tour-lab-mode-toggle (conditional: solo only)", () => {
  it("has the right id + pose + completion contract", () => {
    expect(settingsTourLabModeToggleStep.id).toBe(
      "settings-tour-lab-mode-toggle",
    );
    expect(settingsTourLabModeToggleStep.pose).toBe("pointing");
    expect(settingsTourLabModeToggleStep.completion.type).toBe("manual");
    expect(settingsTourLabModeToggleStep.expectedRoute).toBe("/settings");
  });
  it("has no targetSelector (no Lab Mode toggle on /settings yet)", () => {
    // FOLLOW-UP: once a Lab Mode toggle ships in Settings, this beat
    // picks up the spotlight. The test pins the current narration-only
    // behavior so the assertion catches the wire-up when it happens.
    expect(settingsTourLabModeToggleStep.targetSelector).toBeUndefined();
  });
  it("conditionalOn passes only when picks.account_type === 'solo'", () => {
    const gate = settingsTourLabModeToggleStep.conditionalOn!;
    expect(gate(picks({ account_type: "solo" }))).toBe(true);
    expect(gate(picks({ account_type: "lab" }))).toBe(false);
    expect(gate(null)).toBe(false);
  });
  it("speech mentions Lab Mode + flipping over", () => {
    const text = renderSpeech(settingsTourLabModeToggleStep);
    expect(text).toMatch(/Lab Mode/);
    expect(text).toMatch(/flips/i);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(settingsTourLabModeToggleStep)).not.toContain("—");
  });
});

describe("settings-tour-visible-tabs (universal)", () => {
  it("has the right id + pose + completion contract", () => {
    expect(settingsTourVisibleTabsStep.id).toBe("settings-tour-visible-tabs");
    expect(settingsTourVisibleTabsStep.pose).toBe("pointing");
    expect(settingsTourVisibleTabsStep.completion.type).toBe("manual");
    expect(settingsTourVisibleTabsStep.expectedRoute).toBe("/settings");
  });
  it("anchors on the settings-tabs-section spotlight target", () => {
    expect(settingsTourVisibleTabsStep.targetSelector).toBe(
      "[data-tour-target=\"settings-tabs-section\"]",
    );
  });
  it("has no conditionalOn predicate (universal)", () => {
    expect(settingsTourVisibleTabsStep.conditionalOn).toBeUndefined();
  });
  it("speech mentions tabs + checkbox", () => {
    const text = renderSpeech(settingsTourVisibleTabsStep);
    expect(text).toMatch(/tab/i);
    expect(text).toMatch(/box/i);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(settingsTourVisibleTabsStep)).not.toContain("—");
  });
});

describe("settings-tour-streak (universal)", () => {
  it("has the right id + pose + completion contract", () => {
    expect(settingsTourStreakStep.id).toBe("settings-tour-streak");
    expect(settingsTourStreakStep.pose).toBe("pointing");
    expect(settingsTourStreakStep.completion.type).toBe("manual");
    expect(settingsTourStreakStep.expectedRoute).toBe("/settings");
  });
  it("anchors on the settings-streak-section spotlight target", () => {
    expect(settingsTourStreakStep.targetSelector).toBe(
      "[data-tour-target=\"settings-streak-section\"]",
    );
  });
  it("has no conditionalOn predicate (universal)", () => {
    expect(settingsTourStreakStep.conditionalOn).toBeUndefined();
  });
  it("speech mentions streak counter + privacy", () => {
    const text = renderSpeech(settingsTourStreakStep);
    expect(text).toMatch(/Streak/i);
    expect(text).toMatch(/private/i);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(settingsTourStreakStep)).not.toContain("—");
  });
});

describe("settings-tour-rerun (universal)", () => {
  it("has the right id + pose + completion contract", () => {
    expect(settingsTourRerunStep.id).toBe("settings-tour-rerun");
    expect(settingsTourRerunStep.pose).toBe("pointing");
    expect(settingsTourRerunStep.completion.type).toBe("manual");
    expect(settingsTourRerunStep.expectedRoute).toBe("/settings");
  });
  it("anchors on the settings-rerun-section spotlight target", () => {
    expect(settingsTourRerunStep.targetSelector).toBe(
      "[data-tour-target=\"settings-rerun-section\"]",
    );
  });
  it("has no conditionalOn predicate (universal)", () => {
    expect(settingsTourRerunStep.conditionalOn).toBeUndefined();
  });
  it("speech mentions re-running the tour + the button", () => {
    const text = renderSpeech(settingsTourRerunStep);
    expect(text).toMatch(/Re-run/i);
    expect(text).toMatch(/button/i);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(settingsTourRerunStep)).not.toContain("—");
  });
});
