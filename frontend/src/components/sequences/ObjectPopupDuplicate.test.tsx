// sequence editor master (redesign, two-zone chrome). The object popups now
// carry a Duplicate affordance next to Delete, wired to onDuplicate on the edit
// request. These tests assert that clicking Duplicate fires onDuplicate, that it
// shows only in EDIT mode (not the read-only "view" / "add" variants), and that
// the feature popup's Duplicate is gated to edit mode.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import FeatureEditorDialog, {
  type FeatureEditorRequest,
} from "./FeatureEditorDialog";
import PrimerEditorDialog, {
  type PrimerEditorRequest,
} from "./PrimerEditorDialog";

afterEach(() => cleanup());

function featureRequest(over: Partial<FeatureEditorRequest> = {}): FeatureEditorRequest {
  return {
    mode: "edit",
    seqLength: 100,
    seq: "ATGCATGCATGCATGCATGCATGCATGCATGCATGC",
    initial: {
      name: "myFeature",
      type: "misc_feature",
      strand: 1,
      start: 0,
      end: 9,
    },
    onSubmit: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
}

function primerRequest(over: Partial<PrimerEditorRequest> = {}): PrimerEditorRequest {
  return {
    featureIndex: 0,
    template: "ATGCATGCATGCATGCATGCATGCATGCATGC",
    initialName: "myPrimer",
    initialDescription: "",
    initialOligo: "ATGCATGC",
    initialPhosphorylated: false,
    onSubmit: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
}

describe("FeatureEditorDialog Duplicate", () => {
  it("fires onDuplicate when the Duplicate button is clicked (edit mode)", () => {
    const onDuplicate = vi.fn();
    render(<FeatureEditorDialog request={featureRequest({ onDuplicate })} />);
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });

  it("hides Duplicate in add mode", () => {
    render(<FeatureEditorDialog request={featureRequest({ mode: "add" })} />);
    expect(screen.queryByRole("button", { name: "Duplicate" })).toBeNull();
  });

  it("hides Duplicate in the read-only view mode", () => {
    render(<FeatureEditorDialog request={featureRequest({ mode: "view" })} />);
    expect(screen.queryByRole("button", { name: "Duplicate" })).toBeNull();
  });
});

describe("PrimerEditorDialog Duplicate", () => {
  it("fires onDuplicate when the Duplicate button is clicked (edit mode)", () => {
    const onDuplicate = vi.fn();
    render(<PrimerEditorDialog request={primerRequest({ onDuplicate })} />);
    fireEvent.click(screen.getByRole("button", { name: /Duplicate/ }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });

  it("hides Duplicate in the read-only variant", () => {
    render(<PrimerEditorDialog request={primerRequest({ readOnly: true })} />);
    expect(screen.queryByRole("button", { name: /Duplicate/ })).toBeNull();
  });
});
