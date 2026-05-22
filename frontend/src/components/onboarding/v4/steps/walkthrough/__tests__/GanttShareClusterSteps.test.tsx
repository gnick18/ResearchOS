/**
 * Regression tests for the §6.8 lab-share cluster speech bodies'
 * page-lock allow-lists. Pinning these explicitly because two R2 bugs
 * shipped from drift between the speech invitation, the actual data
 * shape, and the allow-list:
 *
 *   - `gantt-share-user-sees-edit` allow-listed the wrong experiment
 *     (BeakerBot's coffee experiment) when the note actually lives on
 *     Fake A. Users couldn't open the bar that had the note.
 *   - `gantt-share-user-explores` speech invited the user to "open the
 *     results tab" but the allow-list didn't include it, so a
 *     legitimate click tripped the Oops flash.
 *
 * The tests render each step's speech body inside a stub
 * TourController and assert the targets passed to `setPageLock`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const setPageLockMock = vi.fn();
const clearPageLockMock = vi.fn();

vi.mock("../../../TourController", () => ({
  useTourController: () => ({
    noteManualAdvance: () => {},
    exitTour: () => {},
    setPageLock: setPageLockMock,
    clearPageLock: clearPageLockMock,
  }),
  // The share-cluster step bodies all use the optional variant. Return
  // the same stub so the page-lock effect actually runs.
  useOptionalTourController: () => ({
    noteManualAdvance: () => {},
    exitTour: () => {},
    setPageLock: setPageLockMock,
    clearPageLock: clearPageLockMock,
  }),
}));

import {
  ganttShareUserExploresStep,
  ganttShareUserSeesEditStep,
} from "../GanttShareClusterSteps";
import { TOUR_TARGETS } from "../lib/targets";

function renderSpeechFor(step: { speech: unknown }) {
  const node =
    typeof step.speech === "function"
      ? (step.speech as () => React.ReactNode)()
      : (step.speech as React.ReactNode);
  return render(<>{node}</>);
}

describe("Gantt share cluster allow-list regression (R2 fix)", () => {
  beforeEach(() => {
    setPageLockMock.mockClear();
    clearPageLockMock.mockClear();
  });

  describe("gantt-share-user-explores (P1: results-tab in allow-list)", () => {
    it("allow-lists the results tab so the speech invitation stays honest", () => {
      // The speech bubble explicitly mentions "opening the results tab"
      // as a safe poke. The allow-list must include it or the Oops
      // flash fires on a legitimate click.
      renderSpeechFor(ganttShareUserExploresStep);
      expect(setPageLockMock).toHaveBeenCalledTimes(1);
      const [targets] = setPageLockMock.mock.calls[0];
      expect(targets).toContain(TOUR_TARGETS.experimentResultsTab);
    });

    it("allow-lists the notes-tab affordances (read-only safe surface)", () => {
      renderSpeechFor(ganttShareUserExploresStep);
      const [targets] = setPageLockMock.mock.calls[0];
      expect(targets).toContain(TOUR_TARGETS.taskPopupNotesTab);
      expect(targets).toContain(TOUR_TARGETS.taskPopupNotesTextarea);
      expect(targets).toContain(TOUR_TARGETS.taskPopupClose);
    });

    it("registers an onExit hook that closes the popup before the next step", () => {
      // Without this, the next step's polling stage detector flips
      // 1→2 on popup-presence-at-entry and the user is stuck (the
      // shared-to-me popup has no share button).
      expect(typeof ganttShareUserExploresStep.onExit).toBe("function");
    });
  });

  describe("gantt-share-user-sees-edit (P0: Fake A targeting)", () => {
    it("allow-lists the Fake A gantt bar (where BeakerBot's note lives)", () => {
      // `appendBeakerBotNote` resolves Fake A via `resolveFakeTaskIds`
      // and writes the note to it. The allow-list must point at the
      // same bar or the user can't open the popup carrying the note.
      renderSpeechFor(ganttShareUserSeesEditStep);
      expect(setPageLockMock).toHaveBeenCalledTimes(1);
      const [targets] = setPageLockMock.mock.calls[0];
      expect(targets).toContain(TOUR_TARGETS.ganttBarFakeA);
    });

    it("does NOT allow-list the shared-coffee experiment (regression pin)", () => {
      // Pre-R2 the list pointed at ganttBarSharedExperiment, which is
      // BeakerBot's "Make some coffee together" — wrong bar, no note.
      renderSpeechFor(ganttShareUserSeesEditStep);
      const [targets] = setPageLockMock.mock.calls[0];
      expect(targets).not.toContain(TOUR_TARGETS.ganttBarSharedExperiment);
    });

    it("allow-lists the notes-tab + close so the user can read the note", () => {
      renderSpeechFor(ganttShareUserSeesEditStep);
      const [targets] = setPageLockMock.mock.calls[0];
      expect(targets).toContain(TOUR_TARGETS.taskPopupNotesTab);
      expect(targets).toContain(TOUR_TARGETS.taskPopupNotesTextarea);
      expect(targets).toContain(TOUR_TARGETS.taskPopupClose);
    });
  });
});
