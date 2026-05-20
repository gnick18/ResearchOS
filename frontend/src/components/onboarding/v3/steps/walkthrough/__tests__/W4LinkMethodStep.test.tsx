import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

const { addMethod } = vi.hoisted(() => ({
  addMethod: vi.fn(async () => null),
}));

vi.mock("@/lib/local-api", () => ({
  filesApi: { writeFile: vi.fn() },
  methodsApi: { create: vi.fn() },
  projectsApi: { create: vi.fn() },
  tasksApi: { addMethod, create: vi.fn(), get: vi.fn() },
}));

import W4LinkMethodStep from "../W4LinkMethodStep";

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

beforeEach(() => {
  addMethod.mockClear();
});

describe("W4LinkMethodStep", () => {
  it("decodes the method id and links it to the experiment", async () => {
    const sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "W4",
        skipped_steps: [],
        artifacts_created: [
          { type: "method", id: "33:user-file", cleanup_default: "keep" },
          { type: "experiment", id: "88", cleanup_default: "keep" },
        ],
      },
    });
    const patchSidecar = vi.fn();
    render(
      <W4LinkMethodStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /link it for me/i }));

    await waitFor(() => {
      expect(addMethod).toHaveBeenCalledWith(88, 33);
    });
  });

  it("disables the link button when prerequisites are missing", () => {
    const sidecar = baseSidecar();
    render(
      <W4LinkMethodStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /link it for me/i })).toBeDisabled();
  });
});
