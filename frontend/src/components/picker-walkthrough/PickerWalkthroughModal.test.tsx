// Component-level RTL coverage for the opt-in walkthrough modal.
//
// The modal is a controlled component (parent owns `open` + `onClose`) so
// the tests drive it through a tiny harness that wires those props to local
// state. Core behaviors:
//
//   1. Initially closed: nothing rendered when open=false.
//   2. Open -> render: the dialog appears with the welcome beat.
//   3. Skip / completion -> close: both paths invoke onClose, modal
//      unmounts cleanly.
//   4. The rewritten 5-beat flow walks welcome -> where-work-lives ->
//      data-flow -> why-cheap-private -> folder-choice (+ cloud-provider).
//
// The data-flow beat hosts the reusable DataFlowExplainer; we assert the
// explainer mounts inside that beat.

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

/** Advance from the welcome beat to the folder-choice beat (beats 1-4). */
function advanceToFolderChoice() {
  fireEvent.click(screen.getByTestId("picker-walkthrough-welcome-next"));
  fireEvent.click(
    screen.getByTestId("picker-walkthrough-where-work-lives-next")
  );
  fireEvent.click(screen.getByTestId("picker-walkthrough-data-flow-next"));
  fireEvent.click(
    screen.getByTestId("picker-walkthrough-why-cheap-private-next")
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
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByTestId("harness-open"));

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

  it("walks all 5 beats and closes on the cloud-provider CTA", () => {
    const onClose = vi.fn();
    render(<PickerWalkthroughModal open={true} onClose={onClose} />);

    // Beat 1: welcome -> Next
    fireEvent.click(screen.getByTestId("picker-walkthrough-welcome-next"));
    expect(
      screen.getByTestId("picker-walkthrough-beat-where-work-lives")
    ).toBeInTheDocument();

    // Beat 2: where-work-lives -> Got it, next
    fireEvent.click(
      screen.getByTestId("picker-walkthrough-where-work-lives-next")
    );
    expect(
      screen.getByTestId("picker-walkthrough-beat-data-flow")
    ).toBeInTheDocument();

    // Beat 3: the data-flow beat hosts the reusable explainer.
    expect(
      screen.getByTestId("picker-walkthrough-data-flow-explainer")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("picker-walkthrough-data-flow-next"));
    expect(
      screen.getByTestId("picker-walkthrough-beat-why-cheap-private")
    ).toBeInTheDocument();

    // Beat 4: why-cheap-private -> Set up my folder
    fireEvent.click(
      screen.getByTestId("picker-walkthrough-why-cheap-private-next")
    );
    expect(
      screen.getByTestId("picker-walkthrough-beat-folder-choice")
    ).toBeInTheDocument();

    // Beat 5: pick "cloud" -> Continue (Continue is gated until a choice is
    // selected; we select cloud to reach the cloud-provider sub-beat).
    fireEvent.click(
      screen.getByTestId("picker-walkthrough-folder-choice-cloud")
    );
    fireEvent.click(
      screen.getByTestId("picker-walkthrough-folder-choice-continue")
    );
    expect(
      screen.getByTestId("picker-walkthrough-beat-cloud-provider")
    ).toBeInTheDocument();

    // Cloud-provider CTA -> onClose fires.
    fireEvent.click(
      screen.getByTestId("picker-walkthrough-cloud-provider-continue")
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from the folder-choice beat when the user picks local", () => {
    const onClose = vi.fn();
    render(<PickerWalkthroughModal open={true} onClose={onClose} />);

    advanceToFolderChoice();
    fireEvent.click(
      screen.getByTestId("picker-walkthrough-folder-choice-local")
    );
    fireEvent.click(
      screen.getByTestId("picker-walkthrough-folder-choice-continue")
    );

    expect(onClose).toHaveBeenCalledTimes(1);
    // The cloud-provider sub-beat was never reached.
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
      screen.getByTestId("picker-walkthrough-beat-where-work-lives")
    ).toBeInTheDocument();

    // Skip closes the modal AND resets state in the same handler.
    fireEvent.click(screen.getByTestId("picker-walkthrough-skip"));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByTestId("reopen"));
    // Should be back at the welcome beat, not where-work-lives.
    expect(
      screen.getByTestId("picker-walkthrough-beat-welcome")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("picker-walkthrough-beat-where-work-lives")
    ).toBeNull();
  });
});
