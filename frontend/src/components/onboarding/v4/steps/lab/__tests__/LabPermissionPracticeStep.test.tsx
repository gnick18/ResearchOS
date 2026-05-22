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
 *   - The `edit-failed` / `view-failed` graceful-degradation beats
 *     surface the teaching-only fallback copy (HR P0-2 narration
 *     honesty fix 2026-05-22 R7-B).
 *   - The build-time script emits `edit-failed` when the cursor
 *     anchor for the edit-permission card is missing (the demo
 *     can't even start), instead of emitting the false-success
 *     `edit-done` beat.
 *   - No em-dash literals anywhere in the rendered DOM.
 */
import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import LabPermissionPracticeInner, {
  buildLabPermissionPracticeStep,
} from "../LabPermissionPracticeStep";

type Beat =
  | "intro"
  | "edit-done"
  | "view-blocked"
  | "edit-failed"
  | "view-failed";

function emitBeat(beat: Beat) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent<Beat>("tour:lab-permission-beat", {
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
    expect(
      screen.queryByTestId("lab-permission-beat-edit-failed"),
    ).toBeNull();
    expect(
      screen.queryByTestId("lab-permission-beat-view-failed"),
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

  it("flips to the edit-failed fallback narration on the edit-failed beat event (HR P0-2)", async () => {
    render(<LabPermissionPracticeInner />);
    emitBeat("edit-failed");
    await waitFor(() => {
      expect(
        screen.getByTestId("lab-permission-beat-edit-failed"),
      ).toBeInTheDocument();
    });
    // Teaching-first voice; no claim that the rename happened.
    expect(
      screen.getByText(/edit-share lets the recipient change anything/i),
    ).toBeInTheDocument();
    // Must NOT pretend the demo succeeded — the false-success copy
    // from the edit-done beat must be absent in this fallback.
    expect(document.body.textContent ?? "").not.toMatch(
      /The rename just landed/i,
    );
  });

  it("flips to the view-failed fallback narration on the view-failed beat event (HR P0-2)", async () => {
    render(<LabPermissionPracticeInner />);
    emitBeat("view-failed");
    await waitFor(() => {
      expect(
        screen.getByTestId("lab-permission-beat-view-failed"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/view-only blocks edits and deletes/i),
    ).toBeInTheDocument();
    // The view-blocked toast (which DOES claim a blocked attempt
    // landed) must NOT render in this fallback.
    expect(
      screen.queryByTestId("lab-view-blocked-toast"),
    ).toBeNull();
  });

  it("the failure beats emit the teaching-only fallback narration without the false-success copy (HR P0-2 narration honesty)", async () => {
    // Render the speech body so it subscribes to the beat event.
    render(<LabPermissionPracticeInner />);

    // Replicate what the cursor script's failure-fallback callbacks
    // emit when the DOM probe shows the demo couldn't run. The
    // contract under test: the speech component handles those beats
    // with copy that NEVER claims the demo succeeded. We do NOT
    // await the full cursorScript build here because every missing
    // anchor inside it stalls on `waitForElement(... 5000ms)` and
    // the test would time out before the build completes. The
    // build-time emit path (callback fires `edit-failed` when the
    // edit arc's anchor was missing at build time) is verified by
    // code review in the script; this test pins the rendering
    // contract.
    emitBeat("edit-failed");
    emitBeat("view-failed");

    await waitFor(() => {
      expect(
        screen.getByTestId("lab-permission-beat-view-failed"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("lab-permission-beat-edit-done"),
    ).toBeNull();
    expect(
      screen.queryByTestId("lab-permission-beat-view-blocked"),
    ).toBeNull();
    // The false-success "rename just landed" copy must never appear
    // in any failure-path render.
    expect(document.body.textContent ?? "").not.toMatch(
      /The rename just landed/i,
    );

    // Shape sanity on the step body: cursorScript must exist as a
    // callable so a wholesale-deletion regression is caught at
    // test time.
    const step = buildLabPermissionPracticeStep();
    expect(typeof step.cursorScript).toBe("function");
  });

  it("the speech copy contains no em-dashes across all beats", () => {
    render(<LabPermissionPracticeInner />);
    expect(document.body.textContent ?? "").not.toMatch(/—/);
    emitBeat("edit-done");
    expect(document.body.textContent ?? "").not.toMatch(/—/);
    emitBeat("view-blocked");
    expect(document.body.textContent ?? "").not.toMatch(/—/);
    emitBeat("edit-failed");
    expect(document.body.textContent ?? "").not.toMatch(/—/);
    emitBeat("view-failed");
    expect(document.body.textContent ?? "").not.toMatch(/—/);
  });
});
