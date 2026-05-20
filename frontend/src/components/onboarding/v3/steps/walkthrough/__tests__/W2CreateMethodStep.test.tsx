import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

const { createMethod, writeFile } = vi.hoisted(() => ({
  createMethod: vi.fn(async (data: { name: string }) => ({
    id: 77,
    name: data.name,
    source_path: null,
    method_type: "markdown" as const,
    folder_path: null,
    parent_method_id: null,
    tags: null,
    is_public: false,
    created_by: null,
    owner: "test-user",
    shared_with: [],
  })),
  writeFile: vi.fn(async () => ({ path: "x", sha: "y" })),
}));

vi.mock("@/lib/local-api", () => ({
  filesApi: { writeFile },
  methodsApi: { create: createMethod },
}));

import W2CreateMethodStep from "../W2CreateMethodStep";

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
  createMethod.mockClear();
  writeFile.mockClear();
});

describe("W2CreateMethodStep", () => {
  it("placeholder path writes a body, creates the method, logs artifact as placeholder source", async () => {
    let sidecar = baseSidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );

    render(
      <W2CreateMethodStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/Drop in placeholder text/i));
    await user.click(screen.getByRole("button", { name: /add the sample method/i }));

    await waitFor(() => {
      expect(createMethod).toHaveBeenCalledTimes(1);
    });
    expect(writeFile).toHaveBeenCalledTimes(1);
    const writeFilePath = (writeFile.mock.calls as unknown as Array<[string]>)[0][0];
    expect(writeFilePath).toMatch(/methods\/sample-method\/sample-method\.md/);

    expect(sidecar.wizard_resume_state?.artifacts_created).toEqual([
      { type: "method", id: "77:placeholder", cleanup_default: "keep" },
    ]);
  });

  it("renders the done state when a method artifact already exists", () => {
    const sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "W2",
        skipped_steps: [],
        artifacts_created: [
          { type: "method", id: "9:placeholder", cleanup_default: "keep" },
        ],
      },
    });
    render(
      <W2CreateMethodStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={vi.fn()}
      />,
    );
    expect(screen.getByText(/Method added/i)).toBeInTheDocument();
  });

  it("user-file path imports the file and logs artifact as user-file source", async () => {
    let sidecar = baseSidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );

    render(
      <W2CreateMethodStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/I have a real method document/i));
    const file = new File(["# my real method"], "Western Blot.md", {
      type: "text/markdown",
    });
    const fileInput = document.getElementById("w2-file-input") as HTMLInputElement;
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(createMethod).toHaveBeenCalledTimes(1);
    });
    const created = (createMethod.mock.calls as unknown as Array<[{ name: string }]>)[0];
    expect(created[0].name).toBe("Western Blot");
    expect(sidecar.wizard_resume_state?.artifacts_created).toEqual([
      { type: "method", id: "77:user-file", cleanup_default: "keep" },
    ]);
  });
});
