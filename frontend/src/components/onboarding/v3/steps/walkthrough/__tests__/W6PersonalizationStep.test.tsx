import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import type { UserSettings } from "@/lib/settings/user-settings";

const readSettings = vi.fn<(u: string) => Promise<UserSettings>>();
const patchSettings = vi.fn<(u: string, p: Partial<UserSettings>) => Promise<UserSettings>>();

vi.mock("@/lib/settings/user-settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings/user-settings")>(
    "@/lib/settings/user-settings",
  );
  return {
    ...actual,
    readUserSettings: (u: string) => readSettings(u),
    patchUserSettings: (u: string, p: Partial<UserSettings>) => patchSettings(u, p),
  };
});

import W6PersonalizationStep from "../W6PersonalizationStep";

function baseSidecar(): OnboardingSidecar {
  return {
    version: 4,
    first_seen_at: "2026-05-20T00:00:00.000Z",
    active_seconds: 0,
    feature_picks: null,
    wizard_completed_at: null,
    wizard_skipped_at: null,
    wizard_force_show: false,
    wizard_resume_state: null,
    lab_tour_pending: false,
    lab_tour_dismissed_at: null,
  };
}

function baseSettings(over: Partial<UserSettings> = {}): UserSettings {
  return {
    schemaVersion: 1,
    visibleTabs: [],
    defaultLandingTab: "/",
    defaultGanttViewMode: "2week",
    defaultCalendarViewMode: "month",
    showSharedByDefault: true,
    displayName: null,
    color: "#3b82f6",
    coloredHeader: true,
    animationType: "rock",
    dateFormat: "MDY",
    timeFormat: "12h",
    telegramNotifications: true,
    telegramAutoReconnect: false,
    confirmDestructiveActions: true,
    sidebarShowTasks: true,
    sidebarShowCalendarEvents: false,
    sidebarEventsHorizonDays: 7,
    hideGoalsFromLab: false,
    offlineMode: false,
    ...over,
  };
}

beforeEach(() => {
  readSettings.mockReset();
  patchSettings.mockReset();
});

describe("W6PersonalizationStep", () => {
  it("persists a color pick and logs a settings_change artifact encoding from→to", async () => {
    readSettings.mockResolvedValue(baseSettings({ color: "#3b82f6" }));
    patchSettings.mockResolvedValue(baseSettings({ color: "#ef4444" }));

    let sidecar = baseSidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );

    render(
      <W6PersonalizationStep
        username="test-user"
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await waitFor(() => {
      expect(readSettings).toHaveBeenCalledWith("test-user");
    });

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Pick #ef4444"));

    await waitFor(() => {
      expect(patchSettings).toHaveBeenCalledWith("test-user", {
        color: "#ef4444",
      });
    });
    await waitFor(() => {
      const artifact = sidecar.wizard_resume_state?.artifacts_created.find(
        (a) => a.type === "settings_change",
      );
      expect(artifact?.id).toBe("color:#3b82f6→#ef4444");
      expect(artifact?.cleanup_default).toBe("keep");
    });
  });

  it("does not log a duplicate artifact when picking the current color", async () => {
    readSettings.mockResolvedValue(baseSettings({ color: "#3b82f6" }));
    let sidecar = baseSidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );

    render(
      <W6PersonalizationStep
        username="test-user"
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await waitFor(() => expect(readSettings).toHaveBeenCalled());

    const user = userEvent.setup();
    // Default #3b82f6 is already selected; clicking it is a no-op.
    await user.click(screen.getByLabelText("Pick #3b82f6"));

    expect(patchSettings).not.toHaveBeenCalled();
  });
});
