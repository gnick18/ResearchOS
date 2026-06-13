/**
 * Unified Share entry point (2026-06-04). Tests pin the consolidation
 * contract, NOT the underlying mechanisms (those have their own tests):
 *
 *   1. Per-entity tab logic — note / experiment / method / project show BOTH
 *      the "In your lab" and "Outside your lab" tabs; a sequence shows ONLY the
 *      "Outside your lab" tab (sequences have no lab-ACL model).
 *   2. Solo / no-lab user — the lab tab is still rendered (an explained empty
 *      state, not a hidden tab) and the dialog defaults to the Outside tab.
 *
 * The note shared_with persistence + is_shared back-compat contract is pinned
 * in the sibling test `note-acl-persistence.test.tsx` (it needs the REAL
 * ShareDialogAdapter, which this file mocks away).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type {
  Note,
  Task,
  Method,
  Project,
  SequenceDetail,
} from "@/lib/types";

// ── Mocks ────────────────────────────────────────────────────────────────
// The unified dialog imports the lab-roster hooks (to detect solo users) and
// the five reused body components. We stub the bodies to lightweight markers so
// the test asserts the SHELL (tabs + per-kind dispatch), not the inner flows.

const hookMocks = vi.hoisted(() => ({
  labProfileMap: { current: {} as Record<string, unknown> },
}));

vi.mock("@/hooks/useLabUserProfiles", () => ({
  useLabUserProfileMap: () => hookMocks.labProfileMap.current,
}));
vi.mock("@/hooks/useArchivedUsers", () => ({
  useArchivedUsers: () => new Set<string>(),
}));
// External-collab is gated through the ONE capability (capabilities bot). These
// tab tests do not exercise the ExternalCollabSection, so default it off,
// matching the prior flags-off behavior, without a FileSystemProvider.
vi.mock("@/hooks/useAccountCapabilities", () => ({
  useAccountCapabilities: () => ({ canCollabExternally: false }),
}));

vi.mock("../ShareDialogAdapter", () => ({
  default: () => <div data-testid="lab-tab-body">lab</div>,
}));
vi.mock("../SendOutsideDialog", () => ({
  default: () => <div data-testid="outside-note">outside-note</div>,
}));
vi.mock("../ExperimentSendOutsideDialog", () => ({
  default: () => <div data-testid="outside-experiment">outside-experiment</div>,
}));
vi.mock("../MethodSendOutsideDialog", () => ({
  default: () => <div data-testid="outside-method">outside-method</div>,
}));
vi.mock("../ProjectSendOutsideDialog", () => ({
  default: () => <div data-testid="outside-project">outside-project</div>,
}));
vi.mock("../SequenceSendOutsideDialog", () => ({
  default: () => <div data-testid="outside-sequence">outside-sequence</div>,
}));

import UnifiedShareDialog, { type ShareTarget } from "../UnifiedShareDialog";

// ── Fixtures ──────────────────────────────────────────────────────────────

const note = { id: 1, title: "My note", shared_with: [] } as unknown as Note;
const task = { id: 2, name: "My experiment", shared_with: [] } as unknown as Task;
const method = { id: 3, name: "My method", shared_with: [] } as unknown as Method;
const project = { id: 4, name: "My project", shared_with: [] } as unknown as Project;
const sequence = {
  id: 5,
  display_name: "My sequence",
} as unknown as SequenceDetail;

function tabLabels(): string[] {
  return screen
    .queryAllByRole("tab")
    .map((el) => el.textContent?.trim() ?? "");
}

beforeEach(() => {
  // Default: a non-solo lab (one other active member besides the owner).
  hookMocks.labProfileMap.current = { alex: {}, maria: {} };
});

// ── Per-entity tab logic ───────────────────────────────────────────────────

describe("UnifiedShareDialog per-entity tabs", () => {
  const both: Array<{ name: string; target: ShareTarget }> = [
    { name: "note", target: { kind: "note", note, owner: "alex" } },
    {
      name: "experiment",
      target: { kind: "experiment", task, owner: "alex" },
    },
    { name: "method", target: { kind: "method", method, owner: "alex" } },
    { name: "project", target: { kind: "project", project, owner: "alex" } },
  ];

  for (const { name, target } of both) {
    it(`shows BOTH tabs for a ${name}`, () => {
      render(
        <UnifiedShareDialog isOpen target={target} onClose={() => {}} />,
      );
      expect(tabLabels()).toEqual(["In your lab", "Outside your lab"]);
    });
  }

  it("shows ONLY the Outside tab for a sequence (no lab-ACL model)", () => {
    render(
      <UnifiedShareDialog
        isOpen
        target={{ kind: "sequence", sequence, owner: "alex" }}
        onClose={() => {}}
      />,
    );
    // No clickable tab strip — the lab tab is absent for sequences.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    // The outside body renders, the lab body does not.
    expect(screen.getByTestId("outside-sequence")).toBeTruthy();
    expect(screen.queryByTestId("lab-tab-body")).toBeNull();
  });

  it("defaults a non-solo note to the In-your-lab tab", () => {
    render(
      <UnifiedShareDialog
        isOpen
        target={{ kind: "note", note, owner: "alex" }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("lab-tab-body")).toBeTruthy();
    expect(screen.queryByTestId("outside-note")).toBeNull();
  });
});

// ── Solo / no-lab user ───────────────────────────────────────────────────────

describe("UnifiedShareDialog solo user", () => {
  it("keeps the lab tab but defaults to Outside when the roster is empty", () => {
    // Only the owner is in the lab roster -> solo.
    hookMocks.labProfileMap.current = { alex: {} };
    render(
      <UnifiedShareDialog
        isOpen
        target={{ kind: "note", note, owner: "alex" }}
        onClose={() => {}}
      />,
    );
    // Lab tab still present (explained empty state, not hidden).
    expect(tabLabels()).toEqual(["In your lab", "Outside your lab"]);
    // ...but the dialog opens on the Outside tab.
    expect(screen.getByTestId("outside-note")).toBeTruthy();
    expect(screen.queryByTestId("lab-tab-body")).toBeNull();
  });
});

