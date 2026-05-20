import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  FeaturePicks,
  OnboardingSidecar,
} from "@/lib/onboarding/sidecar";
import W14AiHelperStep from "../W14AiHelperStep";

const PROMPT_BY_SIZE: Record<string, string> = {
  "full.md": "FULL prompt body",
  "lean.md": "LEAN prompt body",
  "minimal.md": "MINIMAL prompt body",
};

beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [key, body] of Object.entries(PROMPT_BY_SIZE)) {
      if (url.endsWith(`/${key}`)) {
        return new Response(body, { status: 200 });
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
});

function buildSidecar(aiHelper: FeaturePicks["ai_helper"]): OnboardingSidecar {
  return {
    version: 4,
    first_seen_at: "2026-05-20T00:00:00.000Z",
    active_seconds: 0,
    feature_picks: {
      account_type: "solo",
      purchases: "no",
      calendar: "no",
      goals: "no",
      telegram: "no",
      ai_helper: aiHelper,
    },
    wizard_completed_at: null,
    wizard_skipped_at: null,
    wizard_force_show: false,
    wizard_resume_state: null,
    lab_tour_pending: false,
    lab_tour_dismissed_at: null,
  };
}

describe("W14AiHelperStep", () => {
  it("fetches the full prompt and reads it back from the clipboard after Copy fires", async () => {
    const user = userEvent.setup();

    render(
      <W14AiHelperStep
        sidecar={buildSidecar("full")}
        setNextDisabled={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /copy full prompt/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /copy full prompt/i }));

    // userEvent.setup installs its own jsdom clipboard impl; assert the
    // text actually reached it (verifies the full fetch → copy path) and
    // that the user-visible toast confirms the size we copied.
    await waitFor(async () => {
      const onClipboard = await navigator.clipboard.readText();
      expect(onClipboard).toBe("FULL prompt body");
    });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/Copied! \(Full prompt\)/);
    });
  });

  it("maps schema 'medium' to the 'lean.md' prompt asset", async () => {
    render(
      <W14AiHelperStep
        sidecar={buildSidecar("medium")}
        setNextDisabled={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/ai-helper/lean.md",
        expect.objectContaining({ cache: "no-store" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /copy medium prompt/i })).toBeInTheDocument();
    });
  });

  it("enables Next from mount", () => {
    const setNextDisabled = vi.fn();
    render(
      <W14AiHelperStep
        sidecar={buildSidecar("minimal")}
        setNextDisabled={setNextDisabled}
      />,
    );
    expect(setNextDisabled).toHaveBeenLastCalledWith(false);
  });
});
