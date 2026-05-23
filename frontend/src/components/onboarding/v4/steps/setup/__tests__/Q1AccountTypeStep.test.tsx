import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";

// setup-q1c lab head manager 2026-05-23: Q1AccountTypeStep now calls
// `useCurrentUser` + `discoverUsers` on mount to auto-fill "Lab" when
// the folder already contains other users. Mock both so the existing
// solo-path tests still pass without a real FileSystemProvider, and
// add a new test for the auto-detect behavior.
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: "alex" }),
}));

const discoverUsersMock = vi.fn(async () => [] as string[]);
vi.mock("@/lib/file-system/user-discovery", () => ({
  discoverUsers: () => discoverUsersMock(),
}));

import Q1AccountTypeStep from "../Q1AccountTypeStep";
import { baseSidecar } from "./baseSidecar";

describe("v4 Q1AccountTypeStep", () => {
  beforeEach(() => {
    discoverUsersMock.mockReset();
    discoverUsersMock.mockResolvedValue([]);
  });

  it("disables Next until a pick is made", () => {
    const setNextDisabled = vi.fn();
    render(
      <Q1AccountTypeStep
        sidecar={baseSidecar()}
        setNextDisabled={setNextDisabled}
        patchSidecar={vi.fn()}
      />,
    );
    expect(setNextDisabled).toHaveBeenLastCalledWith(true);
  });

  it("persists account_type=solo on first solo pick (Q2-Q6 left undefined)", async () => {
    let sidecar = baseSidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    render(
      <Q1AccountTypeStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await userEvent.setup().click(screen.getByLabelText(/Solo/i));

    expect(patchSidecar).toHaveBeenCalledTimes(1);
    // Per the 2026-05-21 fix ("Q2-Q6 fields no longer auto-default to
    // maybe"), Q1 only sets account_type. Each subsequent step's
    // patchSidecar handler adds its field on first explicit pick. This
    // keeps the radios unselected on first encounter so the user isn't
    // ambushed by a pre-selected "Maybe later".
    expect(sidecar.feature_picks).toEqual({
      account_type: "solo",
    });
  });

  it("persists account_type=lab on lab pick", async () => {
    let sidecar = baseSidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    render(
      <Q1AccountTypeStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await userEvent.setup().click(screen.getByLabelText(/^Lab/i));

    expect(sidecar.feature_picks?.account_type).toBe("lab");
  });

  // setup-q1c lab head manager 2026-05-23: when other users exist in
  // the folder, Q1 auto-fills "Lab" + shows a transparent banner.
  // discoverUsers already filters the lab pseudo-user + tombstones; we
  // additionally exclude the current user. Test wires sidecar through
  // `rerender` because the patchSidecar handler updates a local var,
  // and the banner only renders when the parent re-renders with the
  // freshly-patched sidecar (current === "lab" + autoDetected === true).
  it("auto-fills Lab + shows banner when other users exist in the folder", async () => {
    discoverUsersMock.mockResolvedValue(["alex", "morgan", "mira"]);
    let sidecar = baseSidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    const { rerender } = render(
      <Q1AccountTypeStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await waitFor(() => {
      expect(sidecar.feature_picks?.account_type).toBe("lab");
    });
    rerender(
      <Q1AccountTypeStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );
    // Banner explains the pre-selection so the user isn't surprised.
    expect(screen.getByTestId("q1-auto-detected-banner")).toBeTruthy();
  });

  it("does NOT auto-fill when the only other entries are filtered out (current user only)", async () => {
    // discoverUsers already strips the lab pseudo-user, _no_user_, and
    // tombstones. Q1 additionally filters out the current user; when
    // the only remaining entry IS the current user, the auto-detect
    // should be a no-op.
    discoverUsersMock.mockResolvedValue(["alex"]);
    let sidecar = baseSidecar();
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    render(
      <Q1AccountTypeStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    // Wait long enough for the effect to settle.
    await new Promise((r) => setTimeout(r, 20));
    expect(sidecar.feature_picks).toBeNull();
    expect(screen.queryByTestId("q1-auto-detected-banner")).toBeNull();
  });

  it("does NOT auto-fill when the sidecar already has account_type set", async () => {
    // Back-stepping into Q1 with a saved answer should NOT overwrite
    // that answer with the auto-detect. Guard with the existing
    // `current !== null` check.
    discoverUsersMock.mockResolvedValue(["alex", "morgan"]);
    let sidecar = baseSidecar({
      feature_picks: { account_type: "solo" },
    });
    const patchSidecar = vi.fn(
      async (mut: (cur: OnboardingSidecar) => OnboardingSidecar) => {
        sidecar = mut(sidecar);
      },
    );
    render(
      <Q1AccountTypeStep
        sidecar={sidecar}
        setNextDisabled={vi.fn()}
        patchSidecar={patchSidecar}
      />,
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(sidecar.feature_picks?.account_type).toBe("solo");
    expect(screen.queryByTestId("q1-auto-detected-banner")).toBeNull();
  });
});
