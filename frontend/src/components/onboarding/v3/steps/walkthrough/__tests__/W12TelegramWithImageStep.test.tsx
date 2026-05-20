import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

const {
  readPairing,
  writeFileFromBlob,
  writeJson,
  emitAttached,
  moveImageBetweenBases,
  tasksGet,
  resolveTaskResultsBase,
  getBlobUrl,
} = vi.hoisted(() => ({
  readPairing: vi.fn<(username: string) => Promise<unknown>>(async () => null),
  writeFileFromBlob: vi.fn<(path: string, blob: Blob) => Promise<void>>(
    async () => undefined,
  ),
  writeJson: vi.fn<(path: string, data: unknown) => Promise<void>>(
    async () => undefined,
  ),
  emitAttached: vi.fn(),
  moveImageBetweenBases: vi.fn<
    (fromBase: string, toBase: string, filename: string) => Promise<void>
  >(async () => undefined),
  tasksGet: vi.fn(async () => ({
    id: 88,
    name: "Tour experiment",
    project_id: 1,
    start_date: "2026-05-20",
    duration_days: 1,
    end_date: "2026-05-20",
    is_high_level: false,
    is_complete: false,
    task_type: "experiment" as const,
    method_ids: [],
    method_attachments: [],
    owner: "test-user",
    shared_with: [],
  })),
  resolveTaskResultsBase: vi.fn(async () => "users/test-user/results/task-88"),
  getBlobUrl: vi.fn(async () => "blob:fake"),
}));

vi.mock("@/lib/telegram/telegram-store", () => ({
  readPairing,
}));

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: { writeFileFromBlob, writeJson },
}));

vi.mock("@/lib/attachments/image-events", () => ({
  imageEvents: { emitAttached },
}));

vi.mock("@/lib/attachments/move-image", () => ({
  moveImageBetweenBases,
}));

vi.mock("@/lib/local-api", () => ({
  tasksApi: { get: tasksGet },
}));

vi.mock("@/lib/tasks/results-paths", () => ({
  resolveTaskResultsBase,
}));

vi.mock("@/lib/utils/blob-url-resolver", () => ({
  blobUrlResolver: { getBlobUrl },
}));

// Stub the TelegramPairingModal so we don't have to wire its full
// dependency graph (token API, encrypted backup, etc.). The stub just
// renders a button that resolves the pair callback with a fake pairing.
vi.mock("@/components/TelegramPairingModal", () => ({
  default: ({
    onClose,
  }: {
    onClose: (p: unknown | null | undefined) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onClose({
          botToken: "t",
          botUsername: "bot",
          chatId: 1,
          lastUpdateId: 0,
          pairedAt: "2026-05-20T00:00:00.000Z",
        })
      }
    >
      Stub pair button
    </button>
  ),
}));

import W12TelegramWithImageStep from "../W12TelegramWithImageStep";

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
  readPairing.mockClear();
  readPairing.mockResolvedValue(null);
  writeFileFromBlob.mockClear();
  writeJson.mockClear();
  emitAttached.mockClear();
  moveImageBetweenBases.mockClear();
  tasksGet.mockClear();
});

describe("W12TelegramWithImageStep", () => {
  it("logs telegram_link on a fresh pair and then injects a sample image into the inbox", async () => {
    let sidecar = baseSidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    const { rerender } = render(
      <W12TelegramWithImageStep
        username="test-user"
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    // Pairing probe runs; no existing pairing → user sees the pair button.
    await waitFor(() => {
      expect(readPairing).toHaveBeenCalledWith("test-user");
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /pair telegram now/i }));
    await user.click(screen.getByRole("button", { name: /stub pair button/i }));

    await waitFor(() => {
      expect(
        sidecar.wizard_resume_state?.artifacts_created.find(
          (a) => a.type === "telegram_link",
        ),
      ).toEqual({ type: "telegram_link", id: "paired", cleanup_default: "keep" });
    });

    // Re-render to push the new sidecar through; the inject effect fires.
    rerender(
      <W12TelegramWithImageStep
        username="test-user"
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await waitFor(() => {
      expect(writeFileFromBlob).toHaveBeenCalledTimes(1);
    });
    const writeCall = writeFileFromBlob.mock.calls[0];
    expect(writeCall[0]).toBe(
      "users/test-user/inbox/Images/onboarding-sample-telegram.svg",
    );
    expect(writeJson).toHaveBeenCalledWith(
      "users/test-user/inbox/Images/onboarding-sample-telegram.svg.json",
      expect.objectContaining({ tutorial_test: true, source: "telegram" }),
    );

    await waitFor(() => {
      const img = sidecar.wizard_resume_state?.artifacts_created.find(
        (a) => a.type === "telegram_image",
      );
      expect(img?.id).toBe("onboarding-sample-telegram.svg:inbox");
    });
  });

  it("attach button moves the image to the experiment results base and flips the artifact id", async () => {
    let sidecar = baseSidecar({
      wizard_resume_state: {
        current_step: "W12",
        skipped_steps: [],
        artifacts_created: [
          { type: "experiment", id: "88", cleanup_default: "keep" },
          { type: "telegram_link", id: "paired", cleanup_default: "keep" },
          {
            type: "telegram_image",
            id: "onboarding-sample-telegram.svg:inbox",
            cleanup_default: "keep",
          },
        ],
      },
    });
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    render(
      <W12TelegramWithImageStep
        username="test-user"
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    const user = userEvent.setup();
    const attachBtn = await screen.findByRole("button", {
      name: /attach to my experiment/i,
    });
    await user.click(attachBtn);

    await waitFor(() => {
      expect(moveImageBetweenBases).toHaveBeenCalledWith(
        "users/test-user/inbox",
        "users/test-user/results/task-88",
        "onboarding-sample-telegram.svg",
      );
    });

    const img = sidecar.wizard_resume_state?.artifacts_created.find(
      (a) => a.type === "telegram_image",
    );
    expect(img?.id).toBe("onboarding-sample-telegram.svg:task-88");
    expect(
      sidecar.wizard_resume_state?.artifacts_created.filter(
        (a) => a.type === "telegram_image",
      ),
    ).toHaveLength(1);
  });
});
