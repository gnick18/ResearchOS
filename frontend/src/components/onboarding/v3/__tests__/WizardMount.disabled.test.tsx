/**
 * Onboarding v4 P11 disconnect probe. v3's auto-fire is intentionally
 * disabled in P11 (Option A: WizardMount renders null), so a fresh
 * user no longer sees the v3 wizard shell. This test pins that
 * behavior so a P9-era regression that re-enables v3's mount probe
 * fails loudly.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async () => null),
    writeJson: vi.fn(async () => {}),
    fileExists: vi.fn(async () => false),
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import WizardMount from "../WizardMount";

describe("v3 WizardMount: P11 auto-fire disconnect", () => {
  it("renders nothing for a fresh user (v3 auto-fire is disabled)", () => {
    const { container } = render(<WizardMount username="alex" />);
    expect(container.firstChild).toBeNull();
    // No v3 wizard portal in the document either.
    expect(
      document.body.querySelector("[data-wizard='v3']"),
    ).toBeNull();
  });

  it("renders nothing even when sidecar would have triggered v3 (force_show)", () => {
    // Even with wizard_force_show=true on the sidecar (which used to
    // make v3 auto-mount), the stub returns null.
    const { container } = render(<WizardMount username="alex" />);
    expect(container.firstChild).toBeNull();
  });
});
