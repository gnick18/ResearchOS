// frontend/src/components/UserAvatar.test.tsx
//
// Renders <UserAvatar> in both modes (single-color and opt-in gradient) and
// pins the resulting `background` CSS so a future refactor can't silently
// change avatar coloring across the app. The Lab Mode coloring-by-individual
// design depends on the gradient being applied wherever an avatar shows up.

import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UserAvatar from "./UserAvatar";

// The avatar reads from useUserColors → useFileSystem; mock the FS context
// to "connected" so the inner useQuery actually fires, then have the
// metadata reader return an explicit map.
vi.mock("@/lib/file-system/file-system-context", () => ({
  useFileSystem: () => ({ isConnected: true }),
}));

vi.mock("@/lib/file-system/user-metadata", () => ({
  readAllUserMetadata: vi.fn(async () => ({
    alice: { color: "#3b82f6", created_at: "2026-01-01T00:00:00.000Z" },
    morgan: {
      color: "#10b981",
      color_secondary: "#f59e0b",
      created_at: "2026-01-01T00:00:00.000Z",
    },
  })),
  // The rainbow sentinels must be present in the mock so colors.ts (imported by
  // UserAvatar via rainbowTheme) can resolve both rainbow options.
  RAINBOW_COLOR: "rainbow",
  RAINBOW_VIVID_COLOR: "rainbow-vivid",
  RAINBOW_SENTINELS: new Set(["rainbow", "rainbow-vivid"]),
}));

function renderWithQueryClient(ui: React.ReactElement) {
  // A fresh QueryClient per test so the useUserColors useQuery() cache
  // doesn't leak its mock between cases.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

/**
 * jsdom normalizes `style.background` color values from hex into `rgb(...)`.
 * This helper converts a known hex back to the rgb(r, g, b) form so the
 * tests can assert on the value the browser actually stores.
 */
function hexToRgbString(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Reads the current `background` CSS on the avatar bubble. Used inside
 * `waitFor` so RTL re-tries the read until the useQuery() inside
 * useUserColors() has resolved and the component re-rendered with the
 * persisted color pair.
 */
function readBackground(container: HTMLElement): string {
  const bubble = container.querySelector("div");
  return (bubble as HTMLDivElement).style.background;
}

describe("UserAvatar", () => {
  it("renders a single-color user as a derived 2-stop gradient (legacy behavior)", async () => {
    const { container } = renderWithQueryClient(<UserAvatar username="alice" />);
    // The legacy `avatarGradient(#3b82f6)` derives a darker / hue-shifted
    // companion stop — exact values are an implementation detail, so we
    // only pin the shape (2-stop gradient at 135deg). The crucial
    // invariant for single-color users is that the avatar must NOT carry
    // any other user's secondary color leaking through — pin that
    // explicitly so a future regression of useUserColors (e.g. cross-user
    // cache leak) would fail this test.
    await waitFor(() => {
      const bg = readBackground(container);
      expect(bg).toMatch(/^linear-gradient\(135deg,/);
      // Alice has no opt-in secondary; morgan's #f59e0b must not bleed in.
      expect(bg).not.toContain(hexToRgbString("#f59e0b"));
    });
  });

  it("renders a user with an opt-in gradient using the two user-picked stops directly", async () => {
    const { container } = renderWithQueryClient(<UserAvatar username="morgan" />);
    // Opt-in gradients render the EXACT two hex values the user picked —
    // no hue-shifting — so collision-avoidance maps 1:1 to visual output.
    await waitFor(() => {
      const bg = readBackground(container);
      expect(bg).toContain(hexToRgbString("#10b981"));
      expect(bg).toContain(hexToRgbString("#f59e0b"));
      expect(bg).toMatch(/^linear-gradient\(135deg,/);
    });
  });

  it("honors secondaryOverride=null to force solid rendering for live previews", async () => {
    // Settings preview path: user opens the picker, clicks "Clear secondary",
    // we want the preview avatar to switch back to single-color even before
    // the disk write completes. The avatarGradient(#10b981) derivation
    // still produces a 2-stop gradient, but the user's persisted secondary
    // (#f59e0b) MUST NOT appear in it — that's the invariant we pin.
    const { container } = renderWithQueryClient(
      <UserAvatar username="morgan" colorOverride="#10b981" secondaryOverride={null} />,
    );
    await waitFor(() => {
      const bg = readBackground(container);
      expect(bg).not.toContain(hexToRgbString("#f59e0b"));
      expect(bg).toMatch(/^linear-gradient\(135deg,/);
    });
  });

  it("honors colorOverride + secondaryOverride for the Settings two-swatch preview", async () => {
    // The Settings ProfileSection passes the in-flight picks via override
    // props so the preview reacts before the save round-trip completes.
    const { container } = renderWithQueryClient(
      <UserAvatar
        username="alice"
        colorOverride="#ef4444"
        secondaryOverride="#8b5cf6"
      />,
    );
    await waitFor(() => {
      const bg = readBackground(container);
      expect(bg).toContain(hexToRgbString("#ef4444"));
      expect(bg).toContain(hexToRgbString("#8b5cf6"));
    });
  });
});
