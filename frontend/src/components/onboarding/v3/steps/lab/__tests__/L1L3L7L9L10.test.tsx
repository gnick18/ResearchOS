import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

import L1WhatIsLabMode from "../L1WhatIsLabMode";
import L3SeeBeakerBotTask from "../L3SeeBeakerBotTask";
import L7GanttAndActivityFeed from "../L7GanttAndActivityFeed";
import L9LabSearch from "../L9LabSearch";
import L10LabWrap from "../L10LabWrap";

/**
 * Consolidated test file for the five static-display lab steps. Each
 * step:
 *  - Renders a data-step-id attr on its root for deterministic
 *    verification.
 *  - Leaves Next enabled.
 *  - Does NOT call patchSidecar.
 */

function baseSidecar(
  patch: Partial<OnboardingSidecar> = {},
): OnboardingSidecar {
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
    ...patch,
  };
}

describe("L1WhatIsLabMode", () => {
  it("renders the data-step-id and enables Next", () => {
    const setNextDisabled = vi.fn();
    render(<L1WhatIsLabMode setNextDisabled={setNextDisabled} />);
    expect(document.querySelector("[data-step-id='L1']")).not.toBeNull();
    expect(setNextDisabled).toHaveBeenCalledWith(false);
  });
});

describe("L3SeeBeakerBotTask", () => {
  it("shows the workbench preview with the edit-demo dot when artifacts exist", () => {
    const sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "L3",
        skipped_steps: [],
        artifacts_created: [
          { type: "lab_user", id: "beakerbot", cleanup_default: "discard" },
          { type: "lab_task", id: "edit-demo:1", cleanup_default: "discard" },
        ],
      },
    });
    render(<L3SeeBeakerBotTask sidecar={sidecar} setNextDisabled={vi.fn()} />);
    expect(document.querySelector("[data-step-id='L3']")).not.toBeNull();
    expect(screen.getByText(/Experiment from BeakerBot/i)).toBeTruthy();
    expect(screen.getByText(/Shared with you, edit permission/i)).toBeTruthy();
  });

  it("nudges back to L2 when no artifacts are present", () => {
    render(
      <L3SeeBeakerBotTask sidecar={baseSidecar()} setNextDisabled={vi.fn()} />,
    );
    expect(
      screen.getByText(/Go back to L2 if you skipped/i),
    ).toBeTruthy();
  });
});

describe("L7GanttAndActivityFeed", () => {
  it("lists every event line that has a backing artifact", () => {
    const sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "L7",
        skipped_steps: [],
        artifacts_created: [
          { type: "lab_user", id: "beakerbot", cleanup_default: "discard" },
          { type: "lab_task", id: "edit-demo:1", cleanup_default: "discard" },
          { type: "lab_task", id: "view-demo:1", cleanup_default: "discard" },
          {
            type: "experiment",
            id: "1234:l5-share-back",
            cleanup_default: "keep",
          },
        ],
      },
    });
    render(
      <L7GanttAndActivityFeed sidecar={sidecar} setNextDisabled={vi.fn()} />,
    );
    expect(
      document.querySelectorAll("[data-l7-activity-line]").length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("shows the empty-state hint when no lab artifacts exist", () => {
    render(
      <L7GanttAndActivityFeed
        sidecar={baseSidecar()}
        setNextDisabled={vi.fn()}
      />,
    );
    expect(screen.getByText(/Nothing yet\./i)).toBeTruthy();
  });
});

describe("L9LabSearch", () => {
  it("renders BeakerBot's shared tasks in the preview results", () => {
    const sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "L9",
        skipped_steps: [],
        artifacts_created: [
          { type: "lab_user", id: "beakerbot", cleanup_default: "discard" },
          { type: "lab_task", id: "edit-demo:1", cleanup_default: "discard" },
          { type: "lab_task", id: "view-demo:1", cleanup_default: "discard" },
        ],
      },
    });
    render(<L9LabSearch sidecar={sidecar} setNextDisabled={vi.fn()} />);
    expect(
      document.querySelectorAll("[data-l9-results] li").length,
    ).toBe(2);
  });
});

describe("L10LabWrap", () => {
  it("renders the data-step-id and enables Next", () => {
    const setNextDisabled = vi.fn();
    render(<L10LabWrap setNextDisabled={setNextDisabled} />);
    expect(document.querySelector("[data-step-id='L10']")).not.toBeNull();
    expect(setNextDisabled).toHaveBeenCalledWith(false);
  });
});
