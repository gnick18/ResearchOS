import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

const { ensureUserFolderStructure, setUserMetadataField, getUserMetadata } =
  vi.hoisted(() => ({
    ensureUserFolderStructure: vi.fn(async () => true),
    setUserMetadataField: vi.fn(async () => ({
      color: "#0ea5e9",
      created_at: "2026-05-20T00:00:00.000Z",
      is_tutorial: true,
    })),
    getUserMetadata: vi.fn(async () => null),
  }));

vi.mock("@/lib/file-system/user-discovery", () => ({
  ensureUserFolderStructure,
}));
vi.mock("@/lib/file-system/user-metadata", () => ({
  setUserMetadataField,
  getUserMetadata,
}));

import L2SpawnFakeBeakerBot from "../L2SpawnFakeBeakerBot";

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
  ensureUserFolderStructure.mockClear();
  setUserMetadataField.mockClear();
  getUserMetadata.mockClear();
});

describe("L2SpawnFakeBeakerBot", () => {
  it("spawns the BeakerBot user with is_tutorial=true and registers both lab artifacts", async () => {
    let sidecar = baseSidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );

    render(
      <L2SpawnFakeBeakerBot
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await userEvent.setup().click(
      screen.getByRole("button", { name: /Add BeakerBot to the lab/i }),
    );

    await waitFor(() => {
      expect(ensureUserFolderStructure).toHaveBeenCalledWith("beakerbot");
    });
    // First metadata call: is_tutorial=true (the tutorial marker)
    expect(setUserMetadataField).toHaveBeenNthCalledWith(
      1,
      "beakerbot",
      "is_tutorial",
      true,
    );
    // Second metadata call: pin the avatar color to the mascot's sky tone
    expect(setUserMetadataField).toHaveBeenNthCalledWith(
      2,
      "beakerbot",
      "color",
      "#0ea5e9",
    );

    // Both artifacts registered: lab_user + lab_task (edit-demo)
    expect(sidecar.wizard_resume_state).not.toBeNull();
    const artifacts = sidecar.wizard_resume_state!.artifacts_created;
    const labUser = artifacts.find((a) => a.type === "lab_user");
    const labTask = artifacts.find(
      (a) => a.type === "lab_task" && a.id.startsWith("edit-demo:"),
    );
    expect(labUser).toMatchObject({
      type: "lab_user",
      id: "beakerbot",
      cleanup_default: "discard",
    });
    expect(labTask).toMatchObject({
      type: "lab_task",
      cleanup_default: "discard",
    });
  });

  it("idempotent on re-render with an existing lab_user artifact (no duplicate spawn)", async () => {
    const sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "L2",
        skipped_steps: [],
        artifacts_created: [
          { type: "lab_user", id: "beakerbot", cleanup_default: "discard" },
        ],
      },
    });

    render(
      <L2SpawnFakeBeakerBot
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );

    // The "Add" button should not be present; the confirmation strip is.
    expect(
      screen.queryByRole("button", { name: /Add BeakerBot to the lab/i }),
    ).toBeNull();
    expect(screen.getByText(/BeakerBot joined the lab/i)).toBeTruthy();
    expect(ensureUserFolderStructure).not.toHaveBeenCalled();
  });
});
