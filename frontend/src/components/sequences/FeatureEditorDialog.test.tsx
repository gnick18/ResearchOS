// sequences bug-fix bot — unit tests for FeatureEditorDialog guard behaviors:
//   1. Save is disabled when the feature name is empty.
//   2. Save is enabled once a name is typed.
//
// Mounts the dialog in jsdom (no AppShell needed) and checks the Save button's
// disabled state via the DOM, mirroring the EnzymePickerDialog test pattern.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import FeatureEditorDialog, { type FeatureEditorRequest } from "./FeatureEditorDialog";

// LivingPopup renders a portal — point it at document.body.
vi.mock("@/components/ui/LivingPopup", () => ({
  default: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <>{children}</> : null,
}));

// Tooltip is fine as a passthrough.
vi.mock("@/components/Tooltip", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function makeRequest(overrides?: Partial<FeatureEditorRequest>): FeatureEditorRequest {
  return {
    mode: "add",
    initial: { name: "", type: "CDS", strand: 1, start: 0, end: 10 },
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    seqLength: 100,
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("FeatureEditorDialog — name guard", () => {
  it("Save button is disabled when name is empty on open", () => {
    render(<FeatureEditorDialog request={makeRequest()} />);
    const save = screen.getByRole("button", { name: /add feature/i });
    expect(save).toBeDisabled();
  });

  it("Save button becomes enabled once the user types a name", () => {
    render(<FeatureEditorDialog request={makeRequest()} />);
    const nameInput = screen.getByPlaceholderText(/feature name/i);
    fireEvent.change(nameInput, { target: { value: "GFP" } });
    const save = screen.getByRole("button", { name: /add feature/i });
    expect(save).not.toBeDisabled();
  });

  it("Save button is disabled again if the name is cleared back to empty", () => {
    render(<FeatureEditorDialog request={makeRequest({ initial: { name: "GFP", type: "CDS", strand: 1, start: 0, end: 10 }, mode: "edit" })} />);
    const nameInput = screen.getByPlaceholderText(/feature name/i);
    fireEvent.change(nameInput, { target: { value: "" } });
    const save = screen.getByRole("button", { name: /save/i });
    expect(save).toBeDisabled();
  });

  it("Save button is disabled when name is only whitespace", () => {
    render(<FeatureEditorDialog request={makeRequest()} />);
    const nameInput = screen.getByPlaceholderText(/feature name/i);
    fireEvent.change(nameInput, { target: { value: "   " } });
    const save = screen.getByRole("button", { name: /add feature/i });
    expect(save).toBeDisabled();
  });
});
