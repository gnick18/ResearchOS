import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Sponsor } from "@/data/sponsors";

/**
 * SponsorStrip is invisible until a real Lab or Institute sponsor exists, and
 * it features Institute ahead of Lab. We drive it by swapping the shared
 * sponsors array via a mock of @/data/sponsors.
 */

const mockSponsors: Sponsor[] = [];

vi.mock("@/data/sponsors", () => ({
  get sponsors() {
    return mockSponsors;
  },
}));

function setSponsors(next: Sponsor[]) {
  mockSponsors.length = 0;
  mockSponsors.push(...next);
}

// Imported after the mock is registered.
let SponsorStrip: typeof import("./SponsorStrip").default;
let featuredSponsors: typeof import("./SponsorStrip").featuredSponsors;

beforeEach(async () => {
  const mod = await import("./SponsorStrip");
  SponsorStrip = mod.default;
  featuredSponsors = mod.featuredSponsors;
  setSponsors([]);
});

describe("SponsorStrip", () => {
  it("renders nothing when there are no patron or benefactor sponsors", () => {
    setSponsors([{ name: "Tiny Lab", tier: "backer" }]);
    const { container } = render(<SponsorStrip variant="welcome" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/supported by/i)).toBeNull();
  });

  it("renders a benefactor logo wrapped in a link", () => {
    setSponsors([
      { name: "Big Institute", tier: "benefactor", logo: "/big.svg", url: "https://example.org" },
    ]);
    render(<SponsorStrip variant="welcome" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://example.org");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    const logo = screen.getByAltText("Big Institute");
    expect(logo).toHaveAttribute("src", "/big.svg");
  });

  it("sorts benefactor before patron and drops backer", () => {
    setSponsors([
      { name: "A Lab", tier: "patron" },
      { name: "Bench Backer", tier: "backer" },
      { name: "Z Institute", tier: "benefactor" },
    ]);
    const ordered = featuredSponsors();
    expect(ordered.map((s) => s.name)).toEqual(["Z Institute", "A Lab"]);
  });
});
