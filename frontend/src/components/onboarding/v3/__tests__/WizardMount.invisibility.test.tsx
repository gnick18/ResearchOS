import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * P8 of the Onboarding v3 arc per ONBOARDING_V3_PROPOSAL.md §11.
 *
 * Layer-3 (integration) coverage of the L1/L22 existing-user
 * invisibility invariant: any pre-v4 sidecar on disk (migrated to v4
 * via normalize()) MUST NOT cause the v3 wizard to auto-mount, and the
 * fresh-folder + force-show + completed truth table at the mount-gate
 * level holds end-to-end. Layer-1 (normalize() unit tests) lives in
 * sidecar.test.ts; layer-2 (the inline gate logic) lives in
 * WizardMount.tsx itself. This file closes the integration gap that
 * was environmentally blocked during P1 (real-FSA fresh-folder vs
 * completed-sidecar mount-gate evaluation in worktrees).
 *
 * Mocking boundary: file-service + user-metadata + user-settings (the
 * I/O leaves of readOnboarding() and isFreshUserForWizard()) plus
 * next/navigation (search-param plumbing) plus the wiki-capture-mock
 * exports the OnboardingProvider consults. The real normalize() runs;
 * the real isFreshUserForWizard() runs; the real WizardMount decision
 * tree runs. OnboardingWizardV3 + WizardResumeModal are stubbed so the
 * tests assert against stable test ids rather than reaching into the
 * wizard's step bodies (which P4 is actively reshaping).
 */

const { fsState } = vi.hoisted(() => ({
  fsState: {
    files: new Map<string, unknown>(),
    connected: true,
    searchParams: new URLSearchParams(),
    isDemoOrWikiCapture: false,
    isTutorialMode: false,
    userMetadata: null as Record<string, unknown> | null,
  },
}));

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    isConnected: () => fsState.connected,
    fileExists: vi.fn(async (path: string) => fsState.files.has(path)),
    readJson: vi.fn(async (path: string) => {
      const v = fsState.files.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      fsState.files.set(path, data);
    }),
  },
}));

vi.mock("@/lib/file-system/user-metadata", () => ({
  getUserMetadata: vi.fn(async () => fsState.userMetadata),
}));

vi.mock("@/lib/settings/user-settings", () => ({
  userSettingsFileExists: vi.fn(async (username: string) =>
    fsState.files.has(`users/${username}/settings.json`),
  ),
}));

vi.mock("@/lib/file-system/wiki-capture-mock", () => ({
  isDemoOrWikiCapture: () => fsState.isDemoOrWikiCapture,
  isTutorialMode: () => fsState.isTutorialMode,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => fsState.searchParams.get(key),
  }),
}));

vi.mock("../OnboardingWizardV3", () => ({
  __esModule: true,
  default: ({ initialStep }: { initialStep: string }) => (
    <div data-testid="wizard-shell" data-initial-step={initialStep} />
  ),
}));

vi.mock("../WizardResumeModal", () => ({
  __esModule: true,
  default: () => <div data-testid="resume-modal" role="dialog" />,
}));

vi.mock("@/components/OnboardingTutorialSequencer", () => ({
  __esModule: true,
  default: () => <div data-testid="tutorial-sequencer" />,
}));

import WizardMount from "../WizardMount";
import { OnboardingProvider } from "@/lib/onboarding/orchestrator";

const USER = "alex";
const SIDECAR_PATH = `users/${USER}/_onboarding.json`;

function resetState(): void {
  fsState.files.clear();
  fsState.connected = true;
  fsState.searchParams = new URLSearchParams();
  fsState.isDemoOrWikiCapture = false;
  fsState.isTutorialMode = false;
  fsState.userMetadata = null;
}

async function waitForMountDecision(): Promise<void> {
  // WizardMount's mount-decision useEffect awaits readOnboarding +
  // isFreshUserForWizard (Promise.all over three file-service probes).
  // A microtask flush plus one macrotask is enough for the chained
  // awaits to resolve in jsdom.
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  await Promise.resolve();
}

beforeEach(() => {
  resetState();
});

afterEach(() => {
  cleanup();
});

describe("WizardMount existing-user invisibility (L1/L22 integration)", () => {
  it("v1 sidecar on disk: normalize migrates to v4 with feature_picks=null AND wizard_force_show=false, mount decision is HIDDEN", async () => {
    fsState.files.set(SIDECAR_PATH, {
      version: 1,
      first_seen_at: "2026-05-14T10:00:00.000Z",
      active_seconds: 100,
      last_tip_at: 50,
      tips: {},
      tips_off: false,
      shown_count: 0,
    });

    render(<WizardMount username={USER} />);
    await waitForMountDecision();

    expect(screen.queryByTestId("wizard-shell")).toBeNull();
    expect(screen.queryByTestId("resume-modal")).toBeNull();
  });

  it("v2 sidecar on disk (mode=suggestions, no wizard fields): mount decision is HIDDEN", async () => {
    fsState.files.set(SIDECAR_PATH, {
      version: 2,
      first_seen_at: "2026-05-14T10:00:00.000Z",
      active_seconds: 800,
      last_tip_at: 400,
      tips: {},
      tips_off: false,
      shown_count: 1,
      mode: "suggestions",
    });

    render(<WizardMount username={USER} />);
    await waitForMountDecision();

    expect(screen.queryByTestId("wizard-shell")).toBeNull();
  });

  it("v3 sidecar with v3 taxonomy (use_cases populated): taxonomy stripped on read, mount decision is HIDDEN (no re-tutorial)", async () => {
    fsState.files.set(SIDECAR_PATH, {
      version: 3,
      first_seen_at: "2026-05-14T10:00:00.000Z",
      active_seconds: 1200,
      last_tip_at: 600,
      tips: {},
      tips_off: false,
      shown_count: 3,
      mode: "tutorial",
      use_cases: ["phd-experiments"],
      other_use_case: null,
      telegram_decision: null,
      calendar_decision: null,
      ai_helper_decision: null,
      wizard_completed_at: null,
      wizard_skipped_at: null,
      wizard_force_show: false,
    });

    render(<WizardMount username={USER} />);
    await waitForMountDecision();

    expect(screen.queryByTestId("wizard-shell")).toBeNull();
  });

  it("v3 sidecar with wizard_completed_at set: completed v2 wizard graduate does NOT see v3", async () => {
    fsState.files.set(SIDECAR_PATH, {
      version: 3,
      first_seen_at: "2026-05-14T10:00:00.000Z",
      active_seconds: 4242,
      last_tip_at: 1200,
      tips: {},
      tips_off: false,
      shown_count: 5,
      mode: "tutorial",
      use_cases: ["postdoc"],
      wizard_completed_at: "2026-05-20T12:00:00.000Z",
      wizard_skipped_at: null,
      wizard_force_show: false,
    });

    render(<WizardMount username={USER} />);
    await waitForMountDecision();

    expect(screen.queryByTestId("wizard-shell")).toBeNull();
  });

  it("v3 sidecar with wizard_skipped_at set: previously-skipped v2 user does NOT see v3", async () => {
    fsState.files.set(SIDECAR_PATH, {
      version: 3,
      first_seen_at: "2026-05-14T10:00:00.000Z",
      active_seconds: 100,
      last_tip_at: 0,
      tips: {},
      tips_off: false,
      shown_count: 0,
      mode: null,
      use_cases: null,
      wizard_completed_at: null,
      wizard_skipped_at: "2026-05-18T14:00:00.000Z",
      wizard_force_show: false,
    });

    render(<WizardMount username={USER} />);
    await waitForMountDecision();

    expect(screen.queryByTestId("wizard-shell")).toBeNull();
  });

  it("v3 sidecar with wizard_force_show=true on disk: normalize forces it back to false (L1/L22 lock), mount decision is HIDDEN", async () => {
    fsState.files.set(SIDECAR_PATH, {
      version: 3,
      first_seen_at: "2026-05-14T10:00:00.000Z",
      active_seconds: 200,
      last_tip_at: 100,
      tips: {},
      tips_off: false,
      shown_count: 1,
      mode: null,
      use_cases: null,
      wizard_completed_at: null,
      wizard_skipped_at: null,
      wizard_force_show: true,
    });

    render(<WizardMount username={USER} />);
    await waitForMountDecision();

    expect(screen.queryByTestId("wizard-shell")).toBeNull();
  });
});

describe("WizardMount fresh-user + escape-hatch (§11 positive cases)", () => {
  it("no sidecar + no settings + no user metadata: fresh-folder probe true, wizard MOUNTS at intro", async () => {
    // No files in memFs, no metadata. isFreshUserForWizard returns true.
    render(<WizardMount username={USER} />);
    await waitForMountDecision();

    const shell = await screen.findByTestId("wizard-shell");
    expect(shell).toHaveAttribute("data-initial-step", "intro");
  });

  it("v4 sidecar with feature_picks=null AND wizard_force_show=true (Settings Re-run escape hatch): wizard MOUNTS", async () => {
    fsState.files.set(SIDECAR_PATH, {
      version: 4,
      first_seen_at: "2026-05-14T08:00:00.000Z",
      active_seconds: 4242,
      feature_picks: null,
      wizard_completed_at: null,
      wizard_skipped_at: null,
      wizard_force_show: true,
      wizard_resume_state: null,
      lab_tour_pending: false,
      lab_tour_dismissed_at: null,
    });

    render(<WizardMount username={USER} />);
    await waitForMountDecision();

    const shell = await screen.findByTestId("wizard-shell");
    expect(shell).toHaveAttribute("data-initial-step", "intro");
  });

  it("v4 sidecar with populated feature_picks AND wizard_completed_at set: completed v3 user stays quiet", async () => {
    fsState.files.set(SIDECAR_PATH, {
      version: 4,
      first_seen_at: "2026-05-14T08:00:00.000Z",
      active_seconds: 4242,
      feature_picks: {
        account_type: "lab",
        lab_storage: "google_drive",
        purchases: "yes",
        calendar: "yes",
        goals: "maybe",
        telegram: "no",
        ai_helper: "full",
      },
      wizard_completed_at: "2026-05-20T12:00:00.000Z",
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: null,
      lab_tour_pending: false,
      lab_tour_dismissed_at: null,
    });

    render(<WizardMount username={USER} />);
    await waitForMountDecision();

    expect(screen.queryByTestId("wizard-shell")).toBeNull();
  });

  it("no sidecar BUT settings.json exists: not a fresh user, wizard stays hidden", async () => {
    // Existing user pattern: a returning v1/v2 user whose onboarding
    // sidecar was hand-deleted but whose settings.json is still on
    // disk. The fresh-folder probe must catch this so we never re-fire
    // the wizard for them.
    fsState.files.set(`users/${USER}/settings.json`, { theme: "dark" });

    render(<WizardMount username={USER} />);
    await waitForMountDecision();

    expect(screen.queryByTestId("wizard-shell")).toBeNull();
  });

  it("no sidecar BUT user-metadata entry exists: not a fresh user, wizard stays hidden", async () => {
    fsState.userMetadata = { color: "#123456", role: "owner" };

    render(<WizardMount username={USER} />);
    await waitForMountDecision();

    expect(screen.queryByTestId("wizard-shell")).toBeNull();
  });
});

describe("OnboardingProvider fixture-mode gate precedence (master 4-state truth table)", () => {
  it("?wikiCapture=1 alone (no wizard-preview): fixture mode HIDES the wizard even on a fresh folder", async () => {
    fsState.isDemoOrWikiCapture = true;
    fsState.isTutorialMode = false;
    fsState.searchParams = new URLSearchParams();

    render(
      <OnboardingProvider currentUser={USER}>
        <div data-testid="children" />
      </OnboardingProvider>,
    );
    await waitForMountDecision();

    expect(screen.getByTestId("children")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-shell")).toBeNull();
    expect(screen.queryByTestId("tutorial-sequencer")).toBeNull();
  });

  it("?wikiCapture=1 + ?wizard-preview=1: wiki-manager screenshot path, wizard MOUNTS on fixtures (master-locked precedence)", async () => {
    fsState.isDemoOrWikiCapture = true;
    fsState.isTutorialMode = false;
    fsState.searchParams = new URLSearchParams("wizard-preview=1");

    render(
      <OnboardingProvider currentUser={USER}>
        <div data-testid="children" />
      </OnboardingProvider>,
    );
    await waitForMountDecision();

    expect(screen.getByTestId("children")).toBeInTheDocument();
    const shell = await screen.findByTestId("wizard-shell");
    expect(shell).toHaveAttribute("data-initial-step", "intro");
  });

  it("?wizard-preview=1 alone (real account, no fixture): wizard MOUNTS regardless of sidecar completion state", async () => {
    // The dev-preview hook must NOT consult wizard_completed_at; the
    // whole point is to preview the wizard against an existing
    // account.
    fsState.searchParams = new URLSearchParams("wizard-preview=1");
    fsState.files.set(SIDECAR_PATH, {
      version: 4,
      first_seen_at: "2026-05-14T08:00:00.000Z",
      active_seconds: 0,
      feature_picks: {
        account_type: "solo",
        purchases: "no",
        calendar: "no",
        goals: "no",
        telegram: "no",
        ai_helper: "no",
      },
      wizard_completed_at: "2026-05-20T12:00:00.000Z",
      wizard_skipped_at: null,
      wizard_force_show: false,
      wizard_resume_state: null,
      lab_tour_pending: false,
      lab_tour_dismissed_at: null,
    });

    render(
      <OnboardingProvider currentUser={USER}>
        <div data-testid="children" />
      </OnboardingProvider>,
    );
    await waitForMountDecision();

    const shell = await screen.findByTestId("wizard-shell");
    expect(shell).toHaveAttribute("data-initial-step", "intro");
  });

  it("neither flag, currentUser=null: provider renders children only (upstream short-circuit)", async () => {
    render(
      <OnboardingProvider currentUser={null}>
        <div data-testid="children" />
      </OnboardingProvider>,
    );
    await waitForMountDecision();

    expect(screen.getByTestId("children")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-shell")).toBeNull();
    expect(screen.queryByTestId("tutorial-sequencer")).toBeNull();
  });

  it("currentUser='lab' sentinel: provider renders children only (Lab Mode never mounts the wizard)", async () => {
    // QA persona 05 (2026-05-20): the "STEP 1 OF 17 / Welcome" wizard
    // popped on /lab during an enter→exit→enter cycle and blocked the
    // Exit Lab Mode button. Lab Mode is a read-only cross-user view,
    // not a real account — user-setup UI does not belong here.
    render(
      <OnboardingProvider currentUser="lab">
        <div data-testid="children" />
      </OnboardingProvider>,
    );
    await waitForMountDecision();

    expect(screen.getByTestId("children")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-shell")).toBeNull();
    expect(screen.queryByTestId("tutorial-sequencer")).toBeNull();
  });

  it("currentUser='Lab' sentinel (case-insensitive): provider renders children only", async () => {
    render(
      <OnboardingProvider currentUser="Lab">
        <div data-testid="children" />
      </OnboardingProvider>,
    );
    await waitForMountDecision();

    expect(screen.getByTestId("children")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-shell")).toBeNull();
  });
});
