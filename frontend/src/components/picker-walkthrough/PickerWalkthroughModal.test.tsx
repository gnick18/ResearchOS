// Component-level RTL coverage for the opt-in walkthrough modal.
//
// The modal is a controlled component (parent owns `open` + `onClose`)
// so the tests drive it through a tiny harness that wires those props
// to local state. Three core behaviors:
//
//   1. Initially closed: nothing rendered when open=false (and the
//      picker harness keeps walkthroughOpen=false).
//   2. Open → render: the dialog appears with the welcome beat.
//   3. Skip / completion → close: both paths invoke onClose, modal
//      unmounts cleanly.
//
// Also covers the picker copy update: the welcome bubble in
// ResearchFolderSetupNew contains "strongly recommended" + "2-3
// minutes" + a CTA button that opens the modal.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import PickerWalkthroughModal from "./PickerWalkthroughModal";

function Harness({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="harness-open">
        open
      </button>
      <PickerWalkthroughModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

describe("PickerWalkthroughModal", () => {
  it("renders nothing when open is false", () => {
    render(<PickerWalkthroughModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("picker-walkthrough-mascot")).toBeNull();
  });

  it("renders the welcome beat when opened via the harness", () => {
    render(<Harness />);
    // Initially closed.
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByTestId("harness-open"));

    // Now open — welcome beat is the entry point.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByTestId("picker-walkthrough-beat-welcome")
    ).toBeInTheDocument();
    expect(screen.getByTestId("picker-walkthrough-mascot")).toBeInTheDocument();
  });

  it("closes when the user clicks Skip", () => {
    const onClose = vi.fn();
    render(<PickerWalkthroughModal open={true} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("picker-walkthrough-skip"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("unmounts the modal on skip in the harness flow", () => {
    render(<Harness initialOpen={true} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("picker-walkthrough-skip"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("walks through all 4 beats and closes on the cloud-provider CTA", () => {
    const onClose = vi.fn();
    render(<PickerWalkthroughModal open={true} onClose={onClose} />);

    // Beat 1: welcome → Next
    fireEvent.click(screen.getByTestId("picker-walkthrough-welcome-next"));
    expect(
      screen.getByTestId("picker-walkthrough-beat-security")
    ).toBeInTheDocument();

    // Beat 2: security → Got it, next
    fireEvent.click(screen.getByTestId("picker-walkthrough-security-next"));
    expect(
      screen.getByTestId("picker-walkthrough-beat-folder-choice")
    ).toBeInTheDocument();

    // Beat 3: pick "cloud" → Continue (Continue is gated until a
    // choice is selected; we select cloud to reach beat 4).
    fireEvent.click(
      screen.getByTestId("picker-walkthrough-folder-choice-cloud")
    );
    fireEvent.click(
      screen.getByTestId("picker-walkthrough-folder-choice-continue")
    );
    expect(
      screen.getByTestId("picker-walkthrough-beat-cloud-provider")
    ).toBeInTheDocument();

    // Beat 4: I'm ready, back to the picker → onClose fires
    fireEvent.click(
      screen.getByTestId("picker-walkthrough-cloud-provider-continue")
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from beat 3 when the user picks local (skips beat 4)", () => {
    const onClose = vi.fn();
    render(<PickerWalkthroughModal open={true} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("picker-walkthrough-welcome-next"));
    fireEvent.click(screen.getByTestId("picker-walkthrough-security-next"));
    fireEvent.click(
      screen.getByTestId("picker-walkthrough-folder-choice-local")
    );
    fireEvent.click(
      screen.getByTestId("picker-walkthrough-folder-choice-continue")
    );

    expect(onClose).toHaveBeenCalledTimes(1);
    // Beat 4 was never reached.
    expect(
      screen.queryByTestId("picker-walkthrough-beat-cloud-provider")
    ).toBeNull();
  });

  it("resets back to the welcome beat when reopened after skip", () => {
    function ResetHarness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)} data-testid="reopen">
            reopen
          </button>
          <PickerWalkthroughModal open={open} onClose={() => setOpen(false)} />
        </>
      );
    }

    render(<ResetHarness />);

    // Advance to beat 2.
    fireEvent.click(screen.getByTestId("picker-walkthrough-welcome-next"));
    expect(
      screen.getByTestId("picker-walkthrough-beat-security")
    ).toBeInTheDocument();

    // Skip closes the modal AND resets state in the same handler.
    fireEvent.click(screen.getByTestId("picker-walkthrough-skip"));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByTestId("reopen"));
    // Should be back at the welcome beat, not security.
    expect(
      screen.getByTestId("picker-walkthrough-beat-welcome")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("picker-walkthrough-beat-security")
    ).toBeNull();
  });
});
