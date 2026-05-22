/**
 * Onboarding v4 P7: lab-permission-practice step body tests.
 *
 * R2 rebuild (HR 2026-05-22): the inline paper-doll practice card is
 * gone. The cursor drives a real interaction against the BeakerBot-
 * shared Workbench cards; the speech bubble narration is driven by a
 * `tour:lab-permission-beat` custom-event channel so the cursor script
 * can hand the speech component fresh copy at the right moments.
 *
 * Coverage:
 *   - Initial render shows the intro beat copy.
 *   - The `edit-done` beat event flips the narration to the
 *     post-rename copy.
 *   - The `view-blocked` beat event surfaces the blocked-toast row.
 *   - No em-dash literals anywhere in the rendered DOM.
 */
import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import LabPermissionPracticeInner from "../LabPermissionPracticeStep";

function emitBeat(beat: "intro" | "edit-done" | "view-blocked") {
  act(() => {
    window.dispatchEvent(
      new CustomEvent<typeof beat>("tour:lab-permission-beat", {
        detail: beat,
      }),
    );
  });
}

describe("LabPermissionPracticeStep (v4 P7 R2)", () => {
  it("renders the intro beat by default", () => {
    render(<LabPermissionPracticeInner />);
    expect(
      screen.getByText(/Two flavors of share/i),
    ).toBeInTheDocument();
    // The intro beat does NOT show the per-beat data-testids.
    expect(
      screen.queryByTestId("lab-permission-beat-edit-done"),
    ).toBeNull();
    expect(
      screen.queryByTestId("lab-permission-beat-view-blocked"),
    ).toBeNull();
  });

  it("flips to the edit-done narration on the edit-done beat event", async () => {
    render(<LabPermissionPracticeInner />);
    emitBeat("edit-done");
    await waitFor(() => {
      expect(
        screen.getByTestId("lab-permission-beat-edit-done"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Edit access lets you change anything/i),
    ).toBeInTheDocument();
  });

  it("flips to the view-blocked narration on the view-blocked beat event", async () => {
    render(<LabPermissionPracticeInner />);
    emitBeat("view-blocked");
    await waitFor(() => {
      expect(
        screen.getByTestId("lab-permission-beat-view-blocked"),
      ).toBeInTheDocument();
    });
    // The blocked-toast is a child of the view-blocked block. Verify it
    // mounts with the owner-aware explanation rather than the prior
    // "View-only locks the task" framing.
    const toast = screen.getByTestId("lab-view-blocked-toast");
    expect(toast).toBeInTheDocument();
    expect(toast.textContent).toMatch(/Only the owner/i);
    expect(toast.textContent).toMatch(/BeakerBot/);
  });

  it("the speech copy contains no em-dashes across all beats", () => {
    render(<LabPermissionPracticeInner />);
    expect(document.body.textContent ?? "").not.toMatch(/—/);
    emitBeat("edit-done");
    expect(document.body.textContent ?? "").not.toMatch(/—/);
    emitBeat("view-blocked");
    expect(document.body.textContent ?? "").not.toMatch(/—/);
  });
});
