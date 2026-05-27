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
 * Three beats are conditional (calendar / telegram / account-type-toggle);
 * the other four (folder / visible-tabs / streak / rerun) fire for
 * everyone (no `conditionalOn`).
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";
import type { TourStep } from "../../../step-types";
import {
  settingsTourFolderStep,
  // settingsTourCalendarStep retired 2026-05-27.
  settingsTourTelegramStep,
  settingsTourAccountTypeToggleStep,
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
  it("speech mentions the folder + switching folders honestly", () => {
    // Settings fix manager R1 (2026-05-22): the prior speech promised
    // an in-Settings "Change folder" button that doesn't exist. The
    // reworked speech still mentions the lab folder + the act of
    // switching, but routes the user to sign-out + re-pick on the
    // entry screen instead of pointing at vapor UI.
    const text = renderSpeech(settingsTourFolderStep);
    expect(text).toMatch(/lab folder/i);
    expect(text).toMatch(/switch/i);
    // The fix is the honesty signal: speech now mentions the entry
    // screen as the real switch surface.
    expect(text).toMatch(/entry screen/i);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(settingsTourFolderStep)).not.toContain("—");
  });
});

// settings-tour-calendar retired 2026-05-27 (Grant hand-walk): the
// step told the user to "head over to the Calendar tab" while the
// tour page-lock kept them on /settings. Confusing, no actionable
// content on the surface. The step body stays @deprecated in
// SettingsTourBeats.tsx for git history; no describe block here
// because the step is no longer in TOUR_STEP_ORDER.

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
  it("speech mentions Telegram + the neutral linked/not-linked framing", () => {
    // R2 chip C 2026-05-22: the prior copy ("You linked it during
    // setup. ...this is the spot") was false for users who picked Q6 =
    // yes-later (Q5=yes still gates this step, but they did NOT link).
    // The reworked speech is neutral about whether the user linked
    // already and points them at the steps in the Settings section.
    const text = renderSpeech(settingsTourTelegramStep);
    expect(text).toMatch(/Telegram/);
    expect(text).toMatch(/wire it up anytime/i);
    expect(text).not.toMatch(/You linked it during setup/i);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(settingsTourTelegramStep)).not.toContain("—");
  });
});

describe("settings-tour-account-type-toggle (conditional: solo only)", () => {
  it("has the right id + pose + completion contract", () => {
    expect(settingsTourAccountTypeToggleStep.id).toBe(
      "settings-tour-account-type-toggle",
    );
    expect(settingsTourAccountTypeToggleStep.pose).toBe("pointing");
    expect(settingsTourAccountTypeToggleStep.completion.type).toBe("manual");
    expect(settingsTourAccountTypeToggleStep.expectedRoute).toBe("/settings");
  });
  it("has no targetSelector (no account-type toggle on /settings yet)", () => {
    // FOLLOW-UP: once an account-type toggle ships in Settings, this
    // beat picks up the spotlight. The test pins the current narration-
    // only behavior so the assertion catches the wire-up when it happens.
    expect(settingsTourAccountTypeToggleStep.targetSelector).toBeUndefined();
  });
  it("conditionalOn passes only when picks.account_type === 'solo'", () => {
    const gate = settingsTourAccountTypeToggleStep.conditionalOn!;
    expect(gate(picks({ account_type: "solo" }))).toBe(true);
    expect(gate(picks({ account_type: "lab" }))).toBe(false);
    expect(gate(null)).toBe(false);
  });
  it("speech mentions pivoting to lab + routes to the user picker honestly", () => {
    // Settings fix manager R1 (2026-05-22): the prior speech promised
    // an in-Settings account-type toggle that doesn't exist (the switch
    // lives in the user picker today). The reworked speech routes users
    // to the user picker. Wave 2E (2026-05-27) tightened the copy to
    // match Grant's exact script: "not here in Settings" replaces the
    // prior "Settings doesn't carry it yet" framing.
    const text = renderSpeech(settingsTourAccountTypeToggleStep);
    expect(text).toMatch(/pivot from (?:a )?solo/i);
    expect(text).toMatch(/user picker/i);
    // The honesty signal: speech explicitly disclaims Settings here.
    expect(text).toMatch(/not here in Settings|Settings doesn't carry it/i);
  });
  it("speech is em-dash free", () => {
    expect(renderSpeech(settingsTourAccountTypeToggleStep)).not.toContain("—");
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
