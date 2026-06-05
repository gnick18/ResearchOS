// sequences launcher bot — covers the calm "workbench overview" shown in the
// /sequences right pane when no sequence is open:
//   - renders the four "actions you can take now" cards (New / Assemble /
//     Align / Import)
//   - clicking "New sequence" fires the onNew prop (handlers come from the page)
//   - renders the informational "available when you open a sequence" hints

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import SequencesLauncher from "./SequencesLauncher";

afterEach(() => cleanup());

function noop() {}

describe("SequencesLauncher", () => {
  it("renders the action cards", () => {
    render(
      <SequencesLauncher
        onNew={noop}
        onAssemble={noop}
        onAlign={noop}
        onImport={noop}
      />,
    );
    expect(
      screen.getByRole("button", { name: /New sequence/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Assemble a construct/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Align two sequences/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Import files/i }),
    ).toBeInTheDocument();
  });

  it("calls onNew when the New sequence card is clicked", () => {
    const onNew = vi.fn();
    render(
      <SequencesLauncher
        onNew={onNew}
        onAssemble={noop}
        onAlign={noop}
        onImport={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /New sequence/i }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("renders the informational editor-tool hints", () => {
    render(
      <SequencesLauncher
        onNew={noop}
        onAssemble={noop}
        onAlign={noop}
        onImport={noop}
      />,
    );
    // The hints are NOT buttons (informational only).
    expect(screen.getByText(/Design primers/i)).toBeInTheDocument();
    expect(screen.getByText(/Find restriction sites/i)).toBeInTheDocument();
    expect(screen.getByText(/Annotate protein domains/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Design primers/i }),
    ).toBeNull();
  });
});
