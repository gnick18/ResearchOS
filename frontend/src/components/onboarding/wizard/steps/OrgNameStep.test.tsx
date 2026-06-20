// RTL coverage for OrgNameStep: required-name validation, create success, error
// surfacing, and that the removed affiliation field is absent. Uses the createOrg
// seam so no network is touched.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("@/components/BeakerBot", () => ({
  default: () => <div data-testid="mock-bot" />,
}));

import OrgNameStep from "./OrgNameStep";

describe("OrgNameStep", () => {
  it("requires a name", async () => {
    const onCreated = vi.fn();
    render(
      <OrgNameStep
        kind="department"
        onCreated={onCreated}
        createOrg={async () => ({ ok: true, orgId: "x" })}
      />,
    );
    const input = screen.getByLabelText("Department name");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(
        screen.getByText("Give your department a name to continue."),
      ).toBeInTheDocument(),
    );
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("creates and advances with the new org id", async () => {
    const onCreated = vi.fn();
    const createOrg = vi.fn().mockResolvedValue({ ok: true, orgId: "dept-123" });
    render(
      <OrgNameStep kind="department" onCreated={onCreated} createOrg={createOrg} />,
    );
    fireEvent.change(screen.getByLabelText("Department name"), {
      target: { value: "Biochem" },
    });
    fireEvent.click(screen.getByText("Create and continue"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("dept-123"));
    expect(createOrg).toHaveBeenCalledWith("Biochem");
  });

  it("surfaces a create error and does not advance", async () => {
    const onCreated = vi.fn();
    render(
      <OrgNameStep
        kind="institution"
        onCreated={onCreated}
        createOrg={async () => ({ ok: false, error: "Already exists." })}
      />,
    );
    fireEvent.change(screen.getByLabelText("Institution name"), {
      target: { value: "State U" },
    });
    fireEvent.click(screen.getByText("Create and continue"));
    await waitFor(() =>
      expect(screen.getByText("Already exists.")).toBeInTheDocument(),
    );
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("does not ask for the affiliation here (the parent-link step owns it)", () => {
    // The free-text affiliation field was removed as redundant with the
    // OrgParentLinkStep and was never persisted. The name step asks for the org
    // name only, for either kind.
    const { rerender } = render(
      <OrgNameStep
        kind="department"
        onCreated={vi.fn()}
        createOrg={async () => ({ ok: true, orgId: "x" })}
      />,
    );
    expect(
      screen.queryByLabelText("Institution affiliation (optional)"),
    ).not.toBeInTheDocument();
    rerender(
      <OrgNameStep
        kind="institution"
        onCreated={vi.fn()}
        createOrg={async () => ({ ok: true, orgId: "x" })}
      />,
    );
    expect(
      screen.queryByLabelText("Institution affiliation (optional)"),
    ).not.toBeInTheDocument();
  });
});
