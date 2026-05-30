// Version Control Phase 1: VersionDiffView renders the reconstructed
// before/after markdown bodies as a colored, per-editor-tinted diff. It reuses
// diffMarkdownLines + the DiffView pattern, so these tests pin that added lines
// render green, removed lines render struck red, the editor color tints the
// changed run, and an unchanged version is surfaced honestly.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import VersionDiffView from "./VersionDiffView";

// Stub the color hook so the tint color is deterministic.
vi.mock("@/hooks/useUserColor", () => ({
  useUserColors: () => ({ primary: "#10b981", secondary: null }),
  useUserColor: () => "#10b981",
}));

describe("VersionDiffView", () => {
  it("renders added and removed runs with the editor tint", () => {
    render(
      <VersionDiffView
        before={"line one\nold line"}
        after={"line one\nnew line"}
        editor="morgan"
        editorLabel="Morgan (PI)"
      />,
    );
    // The removed run (old line) and the added run (new line) both render.
    expect(screen.getByText(/old line/)).toBeInTheDocument();
    expect(screen.getByText(/new line/)).toBeInTheDocument();
    // Both an add and a remove block exist.
    expect(screen.getByTestId("diff-add")).toBeInTheDocument();
    expect(screen.getByTestId("diff-remove")).toBeInTheDocument();
    // The changed runs carry the editor's user color as a left border (the
    // per-editor tint). jsdom normalizes the hex to rgb.
    const addBlock = screen.getByTestId("diff-add");
    expect(addBlock.style.borderLeftColor).toBe("rgb(16, 185, 129)");
  });

  it("surfaces an unchanged version honestly", () => {
    render(
      <VersionDiffView
        before={"same body"}
        after={"same body"}
        editor="mira"
        editorLabel="Mira"
      />,
    );
    expect(
      screen.getByText("No tracked content changed in this version."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("diff-add")).not.toBeInTheDocument();
    expect(screen.queryByTestId("diff-remove")).not.toBeInTheDocument();
  });
});
