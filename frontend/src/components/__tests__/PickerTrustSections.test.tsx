// frontend/src/components/__tests__/PickerTrustSections.test.tsx
//
// Contract pins for <PickerTrustSections />. The component is the inline
// replacement for the retired pre-onboarding modal's 4-beat takeover:
// three default-collapsed strips that sit under the folder-picker cards
// and host the salvaged Security, FolderChoice, and CloudProvider copy.
//
// Pinned behavior:
//   - All three strips render on mount, each with its toggle button.
//   - Each strip is collapsed on first paint (no body in the DOM).
//   - Clicking a toggle expands its own body without touching the others.
//   - Clicking an expanded toggle collapses it again.
//   - The cloud-setup strip surfaces the five provider tiles wired to
//     the `/wiki/shared-lab-accounts/<slug>` links.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import PickerTrustSections from "../PickerTrustSections";

describe("<PickerTrustSections />", () => {
  it("renders all three collapsible strips collapsed on mount", () => {
    render(<PickerTrustSections />);

    expect(screen.getByTestId("picker-trust-security")).toBeInTheDocument();
    expect(
      screen.getByTestId("picker-trust-local-vs-cloud"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("picker-trust-cloud-setup"),
    ).toBeInTheDocument();

    // No body panels yet — strips start closed.
    expect(
      screen.queryByTestId("picker-trust-security-body"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("picker-trust-local-vs-cloud-body"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("picker-trust-cloud-setup-body"),
    ).not.toBeInTheDocument();

    // aria-expanded reflects the collapsed state.
    expect(
      screen.getByTestId("picker-trust-security-toggle"),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("expands the security strip on toggle click and shows the three trust claims", () => {
    render(<PickerTrustSections />);
    const toggle = screen.getByTestId("picker-trust-security-toggle");
    fireEvent.click(toggle);

    expect(
      screen.getByTestId("picker-trust-security-body"),
    ).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Nothing uploads\./)).toBeInTheDocument();
    expect(screen.getByText(/We cannot see your data\./)).toBeInTheDocument();
    expect(
      screen.getByText(/No analytics on your research\./),
    ).toBeInTheDocument();
  });

  it("expands the local-vs-cloud strip on toggle click", () => {
    render(<PickerTrustSections />);
    const toggle = screen.getByTestId("picker-trust-local-vs-cloud-toggle");
    fireEvent.click(toggle);

    expect(
      screen.getByTestId("picker-trust-local-vs-cloud-body"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Local folder\./)).toBeInTheDocument();
    expect(screen.getByText(/Cloud-synced folder\./)).toBeInTheDocument();
  });

  it("expands the cloud-setup strip and exposes all five provider tiles linking to the wiki", () => {
    render(<PickerTrustSections />);
    fireEvent.click(screen.getByTestId("picker-trust-cloud-setup-toggle"));

    expect(
      screen.getByTestId("picker-trust-cloud-setup-body"),
    ).toBeInTheDocument();

    const providers: ReadonlyArray<[string, string]> = [
      ["box", "/wiki/shared-lab-accounts/box"],
      ["dropbox", "/wiki/shared-lab-accounts/dropbox"],
      ["google-drive", "/wiki/shared-lab-accounts/google-drive"],
      ["icloud-drive", "/wiki/shared-lab-accounts/icloud"],
      ["onedrive", "/wiki/shared-lab-accounts/onedrive"],
    ];
    for (const [slug, href] of providers) {
      const tile = screen.getByTestId(`picker-trust-provider-${slug}`);
      expect(tile).toBeInTheDocument();
      expect(tile).toHaveAttribute("href", href);
      // External links open in a new tab so the user keeps the picker
      // open behind them.
      expect(tile).toHaveAttribute("target", "_blank");
      expect(tile).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("toggles a single strip independently of the others", () => {
    render(<PickerTrustSections />);

    fireEvent.click(screen.getByTestId("picker-trust-security-toggle"));
    expect(
      screen.getByTestId("picker-trust-security-body"),
    ).toBeInTheDocument();
    // Other strips remain collapsed.
    expect(
      screen.queryByTestId("picker-trust-local-vs-cloud-body"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("picker-trust-cloud-setup-body"),
    ).not.toBeInTheDocument();

    // Click again to collapse.
    fireEvent.click(screen.getByTestId("picker-trust-security-toggle"));
    expect(
      screen.queryByTestId("picker-trust-security-body"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("picker-trust-security-toggle"),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
