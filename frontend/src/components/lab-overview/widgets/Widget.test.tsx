// Lab overview PI tooltips (Chip B, lab overview PI tooltips manager,
// 2026-05-25): pin the help-badge wiring on the widget frame.
//
// Cases:
//   - When `helpText` is provided, the frame renders the "?" badge
//     button (aria-label = "What is the {title} widget?") in the
//     header, alongside the title.
//   - When `helpText` is omitted, no badge button renders — the
//     non-help-text widgets (none today, but the contract must hold so
//     a future opt-out path stays clean) keep the original header
//     shape.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
  },
}));

vi.mock("@/lib/file-system/user-metadata", () => ({
  getUserMetadata: vi.fn(async () => null),
}));

// Mock the current-user hook used by `useFirstPaintHint`. Returning a
// null user is the cleanest path: the hook then short-circuits before
// any sidecar read, so the badge renders without an auto-open — the
// case we care about for the rendering contract.
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: null }),
}));

import Widget from "./Widget";

beforeEach(() => {
  memFs.clear();
});

describe("Widget — tile-header help-badge", () => {
  it("renders the help badge when helpText is provided", () => {
    render(
      <Widget
        id="announcements"
        title="Announcements"
        isEditing={false}
        surface="canvas"
        helpText="Lab-wide bulletin board for the PI."
      >
        <div>body</div>
      </Widget>,
    );

    // The badge button exposes its purpose via aria-label. We assert
    // on the label rather than the SVG so a future icon swap doesn't
    // break the test.
    const badge = screen.getByRole("button", {
      name: /what is the announcements widget/i,
    });
    expect(badge).toBeInTheDocument();
  });

  it("omits the help badge when helpText is undefined", () => {
    render(
      <Widget
        id="some-widget"
        title="Some widget"
        isEditing={false}
        surface="canvas"
      >
        <div>body</div>
      </Widget>,
    );

    // No badge button at all — the header should not silently render a
    // question-mark affordance with no copy attached.
    const badge = screen.queryByRole("button", {
      name: /what is the some widget widget/i,
    });
    expect(badge).toBeNull();
  });
});
