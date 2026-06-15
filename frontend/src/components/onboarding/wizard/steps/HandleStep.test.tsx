// RTL coverage for HandleStep: prefill, required validation, claim success, and
// claim error. Uses the test seams (claimHandle / fetchSuggestion) so no network
// is touched.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("@/components/BeakerBot", () => ({
  default: () => <div data-testid="mock-bot" />,
}));

import HandleStep from "./HandleStep";

describe("HandleStep", () => {
  it("prefills the suggested handle", async () => {
    render(
      <HandleStep
        onClaimed={vi.fn()}
        fetchSuggestion={async () => "jane-doe"}
        claimHandle={async () => ({ ok: true })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Your handle")).toHaveValue("jane-doe"),
    );
  });

  it("blocks an empty handle and shows a validation message", async () => {
    const onClaimed = vi.fn();
    render(
      <HandleStep
        onClaimed={onClaimed}
        fetchSuggestion={async () => ""}
        claimHandle={async () => ({ ok: true })}
      />,
    );
    // Button is disabled while empty, so type a space then clear to force submit path
    const input = screen.getByLabelText("Your handle");
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByText("Pick a handle to continue.")).toBeInTheDocument(),
    );
    expect(onClaimed).not.toHaveBeenCalled();
  });

  it("claims and advances on success (strips a leading @)", async () => {
    const onClaimed = vi.fn();
    const claimHandle = vi.fn().mockResolvedValue({ ok: true });
    render(
      <HandleStep
        onClaimed={onClaimed}
        fetchSuggestion={async () => ""}
        claimHandle={claimHandle}
      />,
    );
    fireEvent.change(screen.getByLabelText("Your handle"), {
      target: { value: "@jane" },
    });
    fireEvent.click(screen.getByText("Claim handle and continue"));
    await waitFor(() => expect(onClaimed).toHaveBeenCalledWith("jane"));
    expect(claimHandle).toHaveBeenCalledWith("jane");
  });

  it("surfaces a claim error and does not advance", async () => {
    const onClaimed = vi.fn();
    render(
      <HandleStep
        onClaimed={onClaimed}
        fetchSuggestion={async () => ""}
        claimHandle={async () => ({ ok: false, error: "Handle taken." })}
      />,
    );
    fireEvent.change(screen.getByLabelText("Your handle"), {
      target: { value: "taken" },
    });
    fireEvent.click(screen.getByText("Claim handle and continue"));
    await waitFor(() =>
      expect(screen.getByText("Handle taken.")).toBeInTheDocument(),
    );
    expect(onClaimed).not.toHaveBeenCalled();
  });
});
