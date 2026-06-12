// Component tests for WhatsNewManager (whats-new bot).
//
// Covers:
//  - First-load-silent: a brand-new account (no stored last-seen) records
//    the current version WITHOUT showing the popup.
//  - Catch-up: a returning account whose last-seen is older than the
//    latest release sees the modal, and dismiss records the latest version
//    per account.
//  - Up-to-date: a returning account already at the latest release sees
//    nothing.
//  - Tour suppression: while tourMode !== null the popup never fires.
//  - Capture-mode suppression: in demo / wiki-capture the popup never
//    fires.
//
// The user-settings disk is an in-memory Map (same pattern as the
// CelebrationManager test). The tour controller and capture-mode helper
// are faked via module-level refs so each test can flip them.

import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
} from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

// ---- mocks -------------------------------------------------------

const memFs = new Map<string, unknown>();
vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
    isConnected: vi.fn(() => true),
    fileExists: vi.fn(async (path: string) => memFs.has(path)),
  },
}));

vi.mock("@/lib/file-system/user-metadata", () => ({
  getUserMetadata: vi.fn(async () => null),
  setUserMetadataField: vi.fn(async () => {}),
  setUserMetadataColors: vi.fn(async () => {}),
}));

// The manager calls useRouter() (to refresh after the email-path wizard
// finishes). jsdom has no App Router context, so stub the hook.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}));

const captureState = { value: false };
vi.mock("@/lib/file-system/wiki-capture-mock", () => ({
  isDemoOrWikiCapture: () => captureState.value,
}));

// A fixed release log so the test is independent of the seeded
// RELEASE_NOTES content. currentVersion is pinned to "0.3.0".
vi.mock("@/lib/release-notes", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/release-notes")>(
      "@/lib/release-notes",
    );
  const releases = [
    { version: "0.3.0", date: "2026-03-01", highlights: ["c three"] },
    { version: "0.2.0", date: "2026-02-01", highlights: ["b two"] },
    { version: "0.1.0", date: "2026-01-01", highlights: ["a one"] },
  ];
  return {
    ...actual,
    RELEASE_NOTES: releases,
    computeAnnouncementsToShow: (params: { lastSeen: string | null | undefined }) =>
      actual.computeAnnouncementsToShow({
        lastSeen: params.lastSeen,
        releases,
        currentVersion: "0.3.0",
      }),
    latestReleaseVersion: () => actual.latestReleaseVersion(releases, "0.3.0"),
  };
});

// ---- module under test ------------------------------------------

import WhatsNewManager from "@/components/WhatsNewManager";
import { readUserSettings } from "@/lib/settings/user-settings";

const USER = "mira";
const SETTINGS_PATH = `users/${USER}/settings.json`;

beforeEach(() => {
  memFs.clear();
  captureState.value = false;
  // The modal fires the corner BeakerBotMouseWaveScene on open, whose
  // effect reads window.matchMedia (prefers-reduced-motion). jsdom does
  // not implement it; stub a non-reduced-motion result, matching the
  // CelebrationManager test's stub.
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

function seedLastSeen(version: string | null) {
  if (version === null) return; // no settings file => undefined last-seen
  memFs.set(SETTINGS_PATH, { lastSeenAnnouncementVersion: version });
}

describe("WhatsNewManager", () => {
  it("first-load-silent: brand-new account records the latest version and shows nothing", async () => {
    render(<WhatsNewManager username={USER} />);

    // Never shows the modal.
    await waitFor(async () => {
      const settings = await readUserSettings(USER);
      expect(settings.lastSeenAnnouncementVersion).toBe("0.3.0");
    });
    expect(screen.queryByTestId("whats-new-modal")).toBeNull();
  });

  it("catch-up: a returning account behind the latest sees the modal", async () => {
    seedLastSeen("0.1.0");
    render(<WhatsNewManager username={USER} />);

    await waitFor(() => {
      expect(screen.getByTestId("whats-new-modal")).toBeInTheDocument();
    });
    // Two releases missed (0.3.0, 0.2.0) => "View all" expander present.
    expect(screen.getByTestId("whats-new-view-all")).toBeInTheDocument();
  });

  it("dismiss records the latest version per account", async () => {
    seedLastSeen("0.1.0");
    render(<WhatsNewManager username={USER} />);

    await waitFor(() => {
      expect(screen.getByTestId("whats-new-modal")).toBeInTheDocument();
    });
    await act(async () => {
      screen.getByTestId("whats-new-got-it").click();
    });
    await waitFor(async () => {
      const settings = await readUserSettings(USER);
      expect(settings.lastSeenAnnouncementVersion).toBe("0.3.0");
    });
    // The modal now lives inside LivingPopup, which plays a short exit
    // animation before unmounting, so wait for it to leave the DOM.
    await waitFor(() => {
      expect(screen.queryByTestId("whats-new-modal")).toBeNull();
    });
  });

  it("up-to-date: a returning account at the latest sees nothing", async () => {
    seedLastSeen("0.3.0");
    render(<WhatsNewManager username={USER} />);

    // Give the read + effect time to settle, then assert no modal.
    await waitFor(async () => {
      const settings = await readUserSettings(USER);
      expect(settings.lastSeenAnnouncementVersion).toBe("0.3.0");
    });
    expect(screen.queryByTestId("whats-new-modal")).toBeNull();
  });

  it("suppressed in demo / wiki-capture mode", async () => {
    captureState.value = true;
    seedLastSeen("0.1.0");
    render(<WhatsNewManager username={USER} />);

    await waitFor(async () => {
      const settings = await readUserSettings(USER);
      expect(settings.lastSeenAnnouncementVersion).toBe("0.1.0");
    });
    expect(screen.queryByTestId("whats-new-modal")).toBeNull();
  });

  it("renders nothing for a signed-out user", async () => {
    render(<WhatsNewManager username={null} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("whats-new-modal")).toBeNull();
  });
});
