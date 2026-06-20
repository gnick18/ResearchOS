// Regression test for the onboarding-tutor MOUNT gating (2026-06-19).
//
// The tutor shipped broken once: TourHost was only rendered in the /dev harness,
// so a real fresh lab head saw the wizard but never the tutor. The mount now lives
// in lib/providers.tsx (asserted by the structural guard at the bottom), and this
// suite locks the gating decision TourHost makes once mounted, so it can never
// silently regress to "never active for a real new account" again:
//   - fresh account + gate says run + no prior run -> ACTIVE (renders the tutor)
//   - returning user (not fresh)                   -> inert (null)
//   - flag off (gate returns false even if fresh)  -> inert (null)
//   - a saved in-flight run (progress)             -> ACTIVE regardless of freshness
//
// The pure flag/fresh/done decision itself is covered in tour-gate.test.ts; here we
// cover TourHost's WIRING of that decision plus the resume override, with the heavy
// tutor UI stubbed so the test asserts only "renders vs null".
//
// No em-dashes, no emojis, no mid-sentence colons.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";

// Stub the heavy tutor UI: the test only needs to know whether TourHost renders it
// (active) or null (inert).
vi.mock("./OnboardingTutor", () => ({
  default: () => <div data-testid="onboarding-tutor" />,
}));
vi.mock("@/hooks/useIsLabHead", () => ({ useIsLabHead: () => false }));
vi.mock("@/lib/onboarding/is-fresh-user", () => ({
  isFreshUserForWizard: vi.fn(),
}));
vi.mock("@/lib/onboarding/tour-gate", async (orig) => ({
  ...(await orig<typeof import("@/lib/onboarding/tour-gate")>()),
  shouldRunOnboardingTutor: vi.fn(),
  isForceLiveTourArmed: () => false,
}));
vi.mock("@/lib/onboarding/tour-progress", async (orig) => ({
  ...(await orig<typeof import("@/lib/onboarding/tour-progress")>()),
  readTourProgress: vi.fn(),
  stateFromProgress: vi.fn(() => undefined),
}));

import TourHost from "./TourHost";
import { isFreshUserForWizard } from "@/lib/onboarding/is-fresh-user";
import { shouldRunOnboardingTutor } from "@/lib/onboarding/tour-gate";
import { readTourProgress } from "@/lib/onboarding/tour-progress";

const isFresh = vi.mocked(isFreshUserForWizard);
const gateRun = vi.mocked(shouldRunOnboardingTutor);
const progress = vi.mocked(readTourProgress);

beforeEach(() => {
  isFresh.mockReset();
  gateRun.mockReset();
  progress.mockReset();
  progress.mockReturnValue(null); // default: no saved run
});
afterEach(() => cleanup());

async function settle() {
  // Flush the async freshness check + the gating effect that follows it.
  await waitFor(() => expect(isFresh).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("TourHost mount gating (the /dev-only regression guard)", () => {
  it("renders the tutor for a fresh lab head when the gate says run", async () => {
    isFresh.mockResolvedValue(true);
    gateRun.mockReturnValue(true);
    render(<TourHost username="alex" />);
    expect(await screen.findByTestId("onboarding-tutor")).toBeInTheDocument();
  });

  it("stays inert (null) for a returning user", async () => {
    isFresh.mockResolvedValue(false);
    gateRun.mockReturnValue(false);
    render(<TourHost username="alex" />);
    await settle();
    expect(screen.queryByTestId("onboarding-tutor")).toBeNull();
  });

  it("stays inert (null) when the flag is off, even for a fresh account", async () => {
    // Flag off is modeled by the gate returning false despite a fresh account.
    isFresh.mockResolvedValue(true);
    gateRun.mockReturnValue(false);
    render(<TourHost username="alex" />);
    await settle();
    expect(screen.queryByTestId("onboarding-tutor")).toBeNull();
  });

  it("resumes (active) from a saved in-flight run regardless of freshness", async () => {
    // A persisted progress reopens the run even for a no-longer-fresh account and
    // even when the gate would otherwise say no, so a reconnect never strands a
    // half-finished walkthrough.
    isFresh.mockResolvedValue(false);
    gateRun.mockReturnValue(false);
    progress.mockReturnValue({ phase: "playing" } as unknown as ReturnType<
      typeof readTourProgress
    >);
    render(<TourHost username="alex" />);
    expect(await screen.findByTestId("onboarding-tutor")).toBeInTheDocument();
  });
});

describe("TourHost is mounted in the real app flow (NOT /dev-only)", () => {
  // The original bug: TourHost was rendered only in the /dev harness, so it never
  // fired for a real account. Assert the mount lives in providers.tsx so it cannot
  // silently regress to dev-only again.
  it("lib/providers.tsx imports and renders <TourHost>", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const providers = readFileSync(
      join(here, "../../../lib/providers.tsx"),
      "utf8",
    );
    expect(providers).toMatch(
      /import\s+TourHost\s+from\s+["']@\/components\/onboarding\/tutor\/TourHost["']/,
    );
    expect(providers).toMatch(/<TourHost\b/);
  });

  it("plays the deep demos inline (no /demo warp), so the tour never navigates away", () => {
    // No-warp redesign (2026-06-19): the deep demos render as a centered preloaded
    // page popup in place, NOT a hard-reload into /demo. So OnboardingTutor must
    // not hand off to the host warp on "Start the tour" (it dispatches beginReel),
    // and the deep_demo beat must render the contained ShowcaseStage, never the
    // real-page LiveCursorLayer. This locks the tour to the in-place popup.
    const here = dirname(fileURLToPath(import.meta.url));
    const tutor = readFileSync(join(here, "./OnboardingTutor.tsx"), "utf8");
    expect(tutor).not.toMatch(/onBeginShow\s*\(/); // never triggers the warp
    expect(tutor).not.toMatch(/<LiveCursorLayer\b/); // no real-page overlay
    expect(tutor).toMatch(/<ShowcaseStage\b/); // deep demos use the contained stage
  });

  it("TourHost never re-enters /demo on resume (the prod demo-trap fix)", () => {
    // The prod trap (2026-06-19): TourHost kept the pre-redesign resume path that
    // hard-reloaded a persisted `playing` run into /demo on every boot, so a
    // signed-in user with a real folder got warped into the demo sample lab and
    // could not get back out (Reconnect bounced through /demo). The no-warp tutor
    // plays inline, so TourHost must NOT begin a demo session or hand the tutor the
    // warp props. endTourDemoSession (the one-way EXIT rescue for users already
    // stuck in demo) is still allowed. Lock both so the trap can never come back.
    const here = dirname(fileURLToPath(import.meta.url));
    const host = readFileSync(join(here, "./TourHost.tsx"), "utf8");
    expect(host).not.toMatch(/beginTourDemoSession/); // never enters demo on resume
    expect(host).not.toMatch(/onBeginShow=/); // no warp handoff to the tutor
  });
});
