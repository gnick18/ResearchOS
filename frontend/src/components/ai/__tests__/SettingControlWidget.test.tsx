// Render tests for the inline setting control (inline-settings bot, 2026-06-19).
// A boolean control reads the live value and writes on toggle (deps mocked); a
// sensitive key renders the handoff card, not a toggle.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import SettingControlWidget, {
  type SettingControlDeps,
} from "../SettingControlWidget";
import { DEFAULT_SETTINGS, type UserSettings } from "@/lib/settings/user-settings";

afterEach(cleanup);

function makeDeps(over: Partial<UserSettings>): {
  deps: SettingControlDeps;
  patch: ReturnType<typeof vi.fn>;
} {
  const patch = vi.fn(async (_u: string, p: Partial<UserSettings>) => {
    return { ...DEFAULT_SETTINGS, ...p } as UserSettings;
  });
  const deps: SettingControlDeps = {
    getCurrentUser: vi.fn(async () => "tester"),
    readUserSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, ...over })),
    patchUserSettings: patch,
  };
  return { deps, patch };
}

describe("SettingControlWidget boolean control", () => {
  it("reads the live value and writes on toggle", async () => {
    const { deps, patch } = makeDeps({ sidebarShowTasks: true });
    render(<SettingControlWidget settingKey="sidebarShowTasks" deps={deps} />);

    // The toggle reflects the live value (checked) once the read resolves.
    const toggle = await screen.findByRole("checkbox");
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));

    // Flipping it off writes the new value through patchUserSettings.
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("tester", { sidebarShowTasks: false }),
    );
    // The Saved confirmation appears after the write.
    expect(await screen.findByTestId("setting-saved")).toBeTruthy();
  });
});

describe("SettingControlWidget sensitive key", () => {
  it("renders a handoff card, not a toggle", async () => {
    const { deps, patch } = makeDeps({});
    render(<SettingControlWidget settingKey="account_type" deps={deps} />);

    // A handoff "Open settings" button is present and no toggle is rendered.
    expect(await screen.findByTestId("setting-handoff-open")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    // It never reads or writes the user's settings for a sensitive key.
    expect(patch).not.toHaveBeenCalled();
  });
});
