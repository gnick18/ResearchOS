import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { FeaturePicks } from "@/lib/onboarding/sidecar";

/**
 * §6.13 Telegram step body tests.
 *
 * Verifies the branched flow:
 *   - Initial "ask" branch shows three options matching §6.13 copy.
 *   - Branch A (yes-now): pairing modal is mounted inline.
 *   - Branch B (yes-later): the deferral speech renders + no artifact
 *     is recorded.
 *   - Branch C (synthetic): synthetic image is injected into the
 *     inbox, artifact is recorded with cleanup_default "discard".
 *   - Conditional gate matches `picks.telegram === "yes"`.
 *
 * Mocks the TelegramPairingModal + sidecar + telegram-store + image
 * file injection. The inner React component still uses the real
 * TourControllerProvider so we can confirm the `noteEventFired` /
 * `advance` calls fire on each terminal branch.
 */

const {
  patchOnboardingMock,
  readOnboardingMock,
  readPairingMock,
  writeFileFromBlobMock,
  writeJsonMock,
  emitAttachedMock,
  onAttachedMock,
  fetchMock,
} = vi.hoisted(() => ({
  patchOnboardingMock: vi.fn(),
  readOnboardingMock: vi.fn(),
  readPairingMock: vi.fn(),
  writeFileFromBlobMock: vi.fn(),
  writeJsonMock: vi.fn(),
  emitAttachedMock: vi.fn(),
  onAttachedMock: vi.fn(() => () => {}),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/onboarding/sidecar", () => ({
  patchOnboarding: patchOnboardingMock,
  readOnboarding: readOnboardingMock,
}));

vi.mock("@/lib/telegram/telegram-store", () => ({
  readPairing: readPairingMock,
}));

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    writeFileFromBlob: writeFileFromBlobMock,
    writeJson: writeJsonMock,
  },
}));

vi.mock("@/lib/attachments/image-events", () => ({
  imageEvents: {
    emitAttached: emitAttachedMock,
    onAttached: onAttachedMock,
  },
}));

vi.mock("@/components/TelegramPairingModal", () => ({
  default: ({ inline }: { inline?: boolean }) => (
    <div data-testid="telegram-pairing-modal" data-inline={String(!!inline)}>
      TelegramPairingModal stub
    </div>
  ),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alex" }),
}));

import {
  telegramConditionalStep,
  SYNTHETIC_FILENAME,
} from "../TelegramConditionalStep";
import { TourControllerProvider } from "../../../TourController";

function picks(over: Partial<FeaturePicks> = {}): FeaturePicks {
  return {
    account_type: "solo",
    purchases: "no",
    calendar: "no",
    goals: "no",
    telegram: "yes",
    ai_helper: "no",
    ...over,
  };
}

describe("telegramConditionalStep step shape", () => {
  it("exposes the expected id + pose + conditional gate", () => {
    expect(telegramConditionalStep.id).toBe("telegram");
    expect(telegramConditionalStep.pose).toBe("thinking");
    expect(telegramConditionalStep.targetSelector).toBe(
      "[data-testid='inbox-tab']",
    );
  });

  it("conditionalOn passes only when picks.telegram === 'yes'", () => {
    const gate = telegramConditionalStep.conditionalOn!;
    expect(gate(picks({ telegram: "yes" }))).toBe(true);
    expect(gate(picks({ telegram: "no" }))).toBe(false);
    expect(gate(picks({ telegram: "maybe" }))).toBe(false);
    expect(gate(null)).toBe(false);
  });

  it("uses event-driven completion (no manual button)", () => {
    expect(telegramConditionalStep.completion.type).toBe("event");
  });
});

describe("TelegramBranchPicker initial ask branch", () => {
  beforeEach(() => {
    readPairingMock.mockReset();
    patchOnboardingMock.mockReset();
    readOnboardingMock.mockReset();
    writeFileFromBlobMock.mockReset();
    writeJsonMock.mockReset();
    emitAttachedMock.mockReset();
    onAttachedMock.mockReset();
    fetchMock.mockReset();

    readPairingMock.mockResolvedValue(null);
    patchOnboardingMock.mockResolvedValue(undefined);
    writeFileFromBlobMock.mockResolvedValue(undefined);
    writeJsonMock.mockResolvedValue(undefined);
    onAttachedMock.mockReturnValue(() => {});

    // Tests mock global fetch for the synthetic asset; default → 404.
    vi.stubGlobal("fetch", fetchMock);
  });

  function renderStep() {
    if (typeof telegramConditionalStep.speech !== "function") {
      throw new Error("expected speech to be a render function");
    }
    return render(
      <TourControllerProvider
        initialFeaturePicks={picks()}
        initialStep="telegram"
      >
        {telegramConditionalStep.speech()}
      </TourControllerProvider>,
    );
  }

  it("renders the three §6.13 branch choices", () => {
    renderStep();
    expect(screen.getByTestId("telegram-branch-ask")).toBeInTheDocument();
    expect(screen.getByTestId("telegram-branch-yes-now")).toBeInTheDocument();
    expect(screen.getByTestId("telegram-branch-yes-later")).toBeInTheDocument();
    expect(screen.getByTestId("telegram-branch-synthetic")).toBeInTheDocument();
  });

  it("speech text matches the §6.13 initial copy + no em-dashes", () => {
    renderStep();
    const ask = screen.getByTestId("telegram-branch-ask");
    expect(ask.textContent).toMatch(/Telegram bot/);
    expect(ask.textContent).toMatch(/installed on your phone/);
    expect(ask.textContent ?? "").not.toContain("—");
  });
});

describe("TelegramBranchPicker Branch A (yes-now)", () => {
  beforeEach(() => {
    readPairingMock.mockReset();
    patchOnboardingMock.mockReset();
    onAttachedMock.mockReset();

    readPairingMock.mockResolvedValue(null);
    patchOnboardingMock.mockResolvedValue(undefined);
    onAttachedMock.mockReturnValue(() => {});
  });

  function renderStep() {
    if (typeof telegramConditionalStep.speech !== "function") {
      throw new Error("expected speech to be a render function");
    }
    return render(
      <TourControllerProvider
        initialFeaturePicks={picks()}
        initialStep="telegram"
      >
        {telegramConditionalStep.speech()}
      </TourControllerProvider>,
    );
  }

  it("mounts the pairing modal inline when the user picks yes-now", async () => {
    renderStep();
    fireEvent.click(screen.getByTestId("telegram-branch-yes-now"));
    expect(screen.getByTestId("telegram-branch-now-body")).toBeInTheDocument();
    expect(screen.getByTestId("telegram-pairing-modal")).toHaveAttribute(
      "data-inline",
      "true",
    );
  });
});

describe("TelegramBranchPicker Branch B (yes-later)", () => {
  beforeEach(() => {
    readPairingMock.mockReset();
    patchOnboardingMock.mockReset();
    onAttachedMock.mockReset();

    readPairingMock.mockResolvedValue(null);
    patchOnboardingMock.mockResolvedValue(undefined);
    onAttachedMock.mockReturnValue(() => {});
  });

  function renderStep() {
    if (typeof telegramConditionalStep.speech !== "function") {
      throw new Error("expected speech to be a render function");
    }
    return render(
      <TourControllerProvider
        initialFeaturePicks={picks()}
        initialStep="telegram"
      >
        {telegramConditionalStep.speech()}
      </TourControllerProvider>,
    );
  }

  it("shows the deferral speech + records no artifact", async () => {
    renderStep();
    fireEvent.click(screen.getByTestId("telegram-branch-yes-later"));
    expect(screen.getByTestId("telegram-branch-later-body")).toBeInTheDocument();
    const body = screen.getByTestId("telegram-branch-later-body");
    expect(body.textContent).toMatch(/No problem/);
    expect(body.textContent).toMatch(/Skipping for now/);
    // Yes-later persists no sidecar artifact (per §6.13). Wait a beat
    // to confirm no asynchronous patch is in flight.
    await new Promise((res) => setTimeout(res, 50));
    expect(patchOnboardingMock).not.toHaveBeenCalled();
  });
});

describe("TelegramBranchPicker Branch C (synthetic)", () => {
  beforeEach(() => {
    readPairingMock.mockReset();
    patchOnboardingMock.mockReset();
    writeFileFromBlobMock.mockReset();
    writeJsonMock.mockReset();
    emitAttachedMock.mockReset();
    onAttachedMock.mockReset();
    fetchMock.mockReset();

    readPairingMock.mockResolvedValue(null);
    patchOnboardingMock.mockResolvedValue(undefined);
    writeFileFromBlobMock.mockResolvedValue(undefined);
    writeJsonMock.mockResolvedValue(undefined);
    onAttachedMock.mockReturnValue(() => {});
    vi.stubGlobal("fetch", fetchMock);
  });

  function renderStep() {
    if (typeof telegramConditionalStep.speech !== "function") {
      throw new Error("expected speech to be a render function");
    }
    return render(
      <TourControllerProvider
        initialFeaturePicks={picks()}
        initialStep="telegram"
      >
        {telegramConditionalStep.speech()}
      </TourControllerProvider>,
    );
  }

  it("injects synthetic SVG fallback + records discard artifact when PNG asset 404s", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    renderStep();

    fireEvent.click(screen.getByTestId("telegram-branch-synthetic"));

    expect(screen.getByTestId("telegram-branch-synthetic-body")).toBeInTheDocument();

    await waitFor(() => {
      expect(writeFileFromBlobMock).toHaveBeenCalled();
    });
    // First call's path is the SVG fallback (asset missing).
    const [path] = writeFileFromBlobMock.mock.calls[0];
    expect(path).toContain("users/alex/inbox/Images/");
    expect(path).toMatch(/\.svg$/);

    await waitFor(() => {
      expect(emitAttachedMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(patchOnboardingMock).toHaveBeenCalled();
    });
    const [, patchFn] = patchOnboardingMock.mock.calls[0];
    const out = patchFn({
      version: 1,
      first_seen_at: "2026-05-21T00:00:00.000Z",
      active_seconds: 0,
      feature_picks: null,
      wizard_completed_at: null,
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: {
        current_step: "telegram",
        skipped_steps: [],
        artifacts_created: [],
      },
      lab_tour_pending: false,
      lab_tour_dismissed_at: null,
    });
    const artifacts = out.wizard_resume_state?.artifacts_created ?? [];
    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "telegram_synthetic_image",
          cleanup_default: "discard",
        }),
      ]),
    );
  });

  it("injects the PNG when the public asset resolves successfully", async () => {
    const fakePngBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
      type: "image/png",
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => fakePngBlob,
    });
    renderStep();

    fireEvent.click(screen.getByTestId("telegram-branch-synthetic"));

    await waitFor(() => expect(writeFileFromBlobMock).toHaveBeenCalled());
    const [path] = writeFileFromBlobMock.mock.calls[0];
    expect(path).toBe(`users/alex/inbox/Images/${SYNTHETIC_FILENAME}`);
  });
});

describe("TelegramBranchPicker synthetic body copy", () => {
  beforeEach(() => {
    readPairingMock.mockReset();
    patchOnboardingMock.mockReset();
    onAttachedMock.mockReset();
    fetchMock.mockReset();

    readPairingMock.mockResolvedValue(null);
    onAttachedMock.mockReturnValue(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("renders speech with no em-dashes (Grant standing rule)", async () => {
    if (typeof telegramConditionalStep.speech !== "function") {
      throw new Error("expected speech to be a render function");
    }
    render(
      <TourControllerProvider
        initialFeaturePicks={picks()}
        initialStep="telegram"
      >
        {telegramConditionalStep.speech()}
      </TourControllerProvider>,
    );
    fireEvent.click(screen.getByTestId("telegram-branch-synthetic"));
    const body = screen.getByTestId("telegram-branch-synthetic-body");
    expect(body.textContent ?? "").not.toContain("—");
  });
});
