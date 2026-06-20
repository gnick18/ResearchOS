// RTL coverage for IdentityStep (the merged handle + profile + greeting page).
// Asserts the on-mount prefill (handle, display name, greeting first name), that
// a blank handle blocks submit, that a valid submit calls the save seams exactly
// once and advances, and that the optional disclosure starts collapsed. Uses the
// test seams so no network is touched.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("@/components/BeakerBot", () => ({
  default: () => <div data-testid="mock-bot" />,
}));

// useCurrentUser reads the file-system context; the step only uses it to pick a
// folder-local username for the default preferred-name save, which we override
// with a seam here, so a light mock keeps the test provider-free.
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ currentUser: null }),
}));

import IdentityStep from "./IdentityStep";

const noPrefill = async () => ({ suggestedHandle: "", displayName: "" });
const noSessionName = async () => "";

describe("IdentityStep", () => {
  it("prefills handle, display name, and the greeting first name on mount", async () => {
    render(
      <IdentityStep
        onSubmit={vi.fn()}
        fetchPrefill={async () => ({
          suggestedHandle: "jane-doe",
          displayName: "Dr. Jane Researcher",
        })}
        fetchSessionName={noSessionName}
        saveIdentity={async () => ({ ok: true })}
        savePreferred={async () => ({ ok: true })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Your handle")).toHaveValue("jane-doe"),
    );
    expect(screen.getByLabelText("Display name")).toHaveValue(
      "Dr. Jane Researcher",
    );
    // Greeting is the honorific-stripped first name of the display name.
    expect(
      screen.getByLabelText("What do you want BeakerBot to call you?"),
    ).toHaveValue("Jane");
  });

  it("falls back to the session name for the greeting when no profile name", async () => {
    render(
      <IdentityStep
        onSubmit={vi.fn()}
        fetchPrefill={async () => ({ suggestedHandle: "x", displayName: "" })}
        fetchSessionName={async () => "Grant Nickles"}
        saveIdentity={async () => ({ ok: true })}
        savePreferred={async () => ({ ok: true })}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText("What do you want BeakerBot to call you?"),
      ).toHaveValue("Grant"),
    );
  });

  it("collapses the optional details by default", async () => {
    render(
      <IdentityStep
        onSubmit={vi.fn()}
        fetchPrefill={noPrefill}
        fetchSessionName={noSessionName}
        saveIdentity={async () => ({ ok: true })}
        savePreferred={async () => ({ ok: true })}
      />,
    );
    // The optional fields (affiliation, bio, links) are hidden until the
    // disclosure is opened.
    expect(screen.queryByLabelText("Affiliation")).not.toBeInTheDocument();
    expect(screen.getByText("More (optional)")).toBeInTheDocument();
    // Opening it reveals them.
    fireEvent.click(screen.getByText("More (optional)"));
    await waitFor(() =>
      expect(screen.getByLabelText("Affiliation")).toBeInTheDocument(),
    );
  });

  it("blocks an empty handle and does not call the save seams", async () => {
    const onSubmit = vi.fn();
    const saveIdentity = vi.fn().mockResolvedValue({ ok: true });
    const savePreferred = vi.fn().mockResolvedValue({ ok: true });
    render(
      <IdentityStep
        onSubmit={onSubmit}
        fetchPrefill={noPrefill}
        fetchSessionName={noSessionName}
        saveIdentity={saveIdentity}
        savePreferred={savePreferred}
      />,
    );
    // Button is disabled while blank; type a space then submit via the disabled
    // guard path is impossible, so we leave it blank and assert nothing fires.
    const handle = screen.getByLabelText("Your handle");
    fireEvent.change(handle, { target: { value: "  " } });
    // Click is a no-op because the button is disabled with a whitespace handle.
    fireEvent.click(screen.getByText("Save and continue"));
    await waitFor(() => expect(saveIdentity).not.toHaveBeenCalled());
    expect(savePreferred).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows an inline error when submit runs with a blank handle", async () => {
    // Drive the submit path directly past the disabled-button guard by clearing
    // a previously filled handle, so the validation message is asserted.
    const onSubmit = vi.fn();
    render(
      <IdentityStep
        onSubmit={onSubmit}
        fetchPrefill={async () => ({ suggestedHandle: "seed", displayName: "" })}
        fetchSessionName={noSessionName}
        saveIdentity={async () => ({ ok: true })}
        savePreferred={async () => ({ ok: true })}
      />,
    );
    const handle = await screen.findByLabelText("Your handle");
    await waitFor(() => expect(handle).toHaveValue("seed"));
    fireEvent.change(handle, { target: { value: "@" } });
    fireEvent.click(screen.getByText("Save and continue"));
    await waitFor(() =>
      expect(screen.getByText("Pick a handle to continue.")).toBeInTheDocument(),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("saves once and advances on a valid submit (strips a leading @)", async () => {
    const onSubmit = vi.fn();
    const saveIdentity = vi.fn().mockResolvedValue({ ok: true });
    const savePreferred = vi.fn().mockResolvedValue({ ok: true });
    render(
      <IdentityStep
        onSubmit={onSubmit}
        fetchPrefill={noPrefill}
        fetchSessionName={noSessionName}
        saveIdentity={saveIdentity}
        savePreferred={savePreferred}
      />,
    );
    fireEvent.change(screen.getByLabelText("Your handle"), {
      target: { value: "@jane" },
    });
    fireEvent.change(
      screen.getByLabelText("What do you want BeakerBot to call you?"),
      { target: { value: "Jane" } },
    );
    fireEvent.click(screen.getByText("Save and continue"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("jane"));
    expect(saveIdentity).toHaveBeenCalledTimes(1);
    expect(saveIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ handle: "jane" }),
    );
    expect(savePreferred).toHaveBeenCalledTimes(1);
    expect(savePreferred).toHaveBeenCalledWith("Jane");
  });

  it("surfaces a save error and does not advance", async () => {
    const onSubmit = vi.fn();
    render(
      <IdentityStep
        onSubmit={onSubmit}
        fetchPrefill={noPrefill}
        fetchSessionName={noSessionName}
        saveIdentity={async () => ({ ok: false, error: "Handle taken." })}
        savePreferred={async () => ({ ok: true })}
      />,
    );
    fireEvent.change(screen.getByLabelText("Your handle"), {
      target: { value: "taken" },
    });
    fireEvent.click(screen.getByText("Save and continue"));
    await waitFor(() =>
      expect(screen.getByText("Handle taken.")).toBeInTheDocument(),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
