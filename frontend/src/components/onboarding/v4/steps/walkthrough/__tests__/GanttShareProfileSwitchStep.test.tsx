/**
 * Tests for the visible-but-faked profile-switch step (Gantt manager
 * 2026-05-22 — see ONBOARDING_V4_GANTT_REDESIGN.md).
 *
 * What's covered:
 *  - The step body renders the BeakerBot visual switch modal.
 *  - The sessionStorage tour-mid-switch flag is set on enter and
 *    cleared on completion / unmount.
 *  - The genuine `appendBeakerBotNote` call fires during the typing
 *    phase so the next step (`gantt-share-user-sees-edit`) has a real
 *    note to surface.
 *
 * The real `setCurrentUser` user-context swap is intentionally NOT
 * tested here — the current implementation ships a visible-but-faked
 * fallback, so the real-swap contract is a follow-up.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

const appendBeakerBotNoteMock = vi.fn().mockResolvedValue(true);
const resolveFakeTaskIdsMock = vi.fn().mockResolvedValue({
  fakeAId: 1,
  fakeBId: 2,
  projectId: 1,
});

vi.mock("../lib/gantt-share-helpers", () => ({
  appendBeakerBotNote: (text: string) => appendBeakerBotNoteMock(text),
}));

vi.mock("../lib/gantt-redesign-helpers", () => ({
  resolveFakeTaskIds: () => resolveFakeTaskIdsMock(),
}));

vi.mock("../../../TourController", () => ({
  useTourController: () => ({
    noteManualAdvance: () => {},
    exitTour: () => {},
    setPageLock: () => {},
    clearPageLock: () => {},
  }),
  useOptionalTourController: () => null,
}));

import {
  ganttShareProfileSwitchStep,
  TOUR_MID_SWITCH_KEY,
  BEAKERBOT_NOTE_TEXT,
} from "../GanttShareProfileSwitchStep";

function renderSpeech() {
  const speech =
    typeof ganttShareProfileSwitchStep.speech === "function"
      ? ganttShareProfileSwitchStep.speech()
      : ganttShareProfileSwitchStep.speech;
  return render(<>{speech}</>);
}

describe("GanttShareProfileSwitchStep (Gantt manager 2026-05-22)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    appendBeakerBotNoteMock.mockClear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it("declares the right step id and pose", () => {
    expect(ganttShareProfileSwitchStep.id).toBe("gantt-share-profile-switch");
    expect(ganttShareProfileSwitchStep.pose).toBe("typing-on-laptop");
  });

  it("sets the tour-mid-switch sessionStorage flag on mount", () => {
    const { unmount } = renderSpeech();
    const raw = sessionStorage.getItem(TOUR_MID_SWITCH_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.step).toBe("gantt-share-profile-switch");
    expect(parsed.mode).toBe("faked");
    unmount();
  });

  it("clears the tour-mid-switch flag on unmount", () => {
    const { unmount } = renderSpeech();
    expect(sessionStorage.getItem(TOUR_MID_SWITCH_KEY)).toBeTruthy();
    unmount();
    expect(sessionStorage.getItem(TOUR_MID_SWITCH_KEY)).toBeNull();
  });

  it("fires appendBeakerBotNote during the typing beat", async () => {
    renderSpeech();
    expect(appendBeakerBotNoteMock).not.toHaveBeenCalled();
    // Advance through the switching-in beat (1200ms) and into the
    // typing beat (2600ms) where the note write fires.
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(appendBeakerBotNoteMock).toHaveBeenCalledWith(BEAKERBOT_NOTE_TEXT);
  });

  it("uses manual completion", () => {
    expect(ganttShareProfileSwitchStep.completion.type).toBe("manual");
  });
});
