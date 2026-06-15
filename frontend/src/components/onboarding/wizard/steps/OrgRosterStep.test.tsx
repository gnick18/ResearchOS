// RTL coverage for OrgRosterStep: mint-on-demand surfaces the link, Continue
// advances, and a mint error is surfaced. Uses the mintInvite seam.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("@/components/BeakerBot", () => ({
  default: () => <div data-testid="mock-bot" />,
}));

import OrgRosterStep from "./OrgRosterStep";

describe("OrgRosterStep", () => {
  it("mints an invite link on demand and shows it", async () => {
    render(
      <OrgRosterStep
        kind="department"
        orgId="dept-1"
        onNext={vi.fn()}
        mintInvite={async () => ({
          ok: true,
          link: "https://x/dept/join#tok",
        })}
      />,
    );
    fireEvent.click(screen.getByText("Generate an invite link"));
    await waitFor(() =>
      expect(screen.getByText("https://x/dept/join#tok")).toBeInTheDocument(),
    );
  });

  it("Continue advances (skip-equivalent, roster is optional)", () => {
    const onNext = vi.fn();
    render(
      <OrgRosterStep
        kind="institution"
        orgId="inst-1"
        onNext={onNext}
        mintInvite={async () => ({ ok: true, link: "x" })}
      />,
    );
    fireEvent.click(screen.getByText("Continue"));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("surfaces a mint error", async () => {
    render(
      <OrgRosterStep
        kind="department"
        orgId="dept-1"
        onNext={vi.fn()}
        mintInvite={async () => ({ ok: false, error: "Not authorized." })}
      />,
    );
    fireEvent.click(screen.getByText("Generate an invite link"));
    await waitFor(() =>
      expect(screen.getByText("Not authorized.")).toBeInTheDocument(),
    );
  });
});
