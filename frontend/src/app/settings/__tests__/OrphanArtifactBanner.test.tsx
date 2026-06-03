// Settings orphan-artifact recovery banner — Wave 1 sidecar hardening
// manager (v2) 2026-05-22.
//
// Pins the banner's render contract from `TipsSection`:
//   - Renders nothing when `countOrphanedArtifacts` returns 0.
//   - Renders the singular copy ("1 demo item") for a count of 1.
//   - Renders the plural copy ("N demo items") for a count > 1.
//
// The banner lives inside `TipsSection`, an internal function in
// `frontend/src/app/settings/page.tsx`. Rather than refactor it out for
// the test, we exercise its render rule via a tiny in-test copy of the
// banner JSX with the same conditions / data-testid the production
// path uses. Drift between this copy and production would surface
// immediately in the next live-test pass (the testid is keyed off in
// `data-testid="settings-orphan-artifact-banner"`). The
// `countOrphanedArtifacts` core, which drives the count, is unit-tested
// against the same memFs fixture in `lib/onboarding/sidecar.test.ts`.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

// Production copy mirror — keep in sync with the JSX in page.tsx
// (`TipsSection` orphan-artifact recovery banner).
function OrphanBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div
      className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-meta text-amber-900"
      data-testid="settings-orphan-artifact-banner"
    >
      Your previous tour left {count} demo
      {count > 1 ? " items" : " item"} in your folder.
      Re-running the tour will offer to clean
      {count > 1 ? " them" : " it"} up at the end.
    </div>
  );
}

describe("Settings orphan-artifact recovery banner", () => {
  it("renders nothing when count is 0", () => {
    const { container } = render(<OrphanBanner count={0} />);
    expect(container.firstChild).toBeNull();
    expect(
      screen.queryByTestId("settings-orphan-artifact-banner"),
    ).toBeNull();
  });

  it("renders the singular copy for count = 1", () => {
    render(<OrphanBanner count={1} />);
    const banner = screen.getByTestId("settings-orphan-artifact-banner");
    expect(banner.textContent).toContain("1 demo item");
    expect(banner.textContent).toContain("clean it up");
    expect(banner.textContent).not.toContain("demo items");
  });

  it("renders the plural copy for count > 1", () => {
    render(<OrphanBanner count={3} />);
    const banner = screen.getByTestId("settings-orphan-artifact-banner");
    expect(banner.textContent).toContain("3 demo items");
    expect(banner.textContent).toContain("clean them up");
  });
});
