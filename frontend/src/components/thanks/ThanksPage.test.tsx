import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import ThanksPage, { type Sponsor } from "./ThanksPage";
import sponsorsData from "@/data/sponsors.json";

/**
 * Light guards for the /thanks marketing page: the seeded sponsors.json keeps
 * its declared shape, the warm empty state renders while there are no
 * sponsors, and the three GitHub Sponsors links point at the LLC account.
 */
describe("sponsors.json shape", () => {
  it("is an array", () => {
    expect(Array.isArray(sponsorsData)).toBe(true);
  });

  it("every entry has a name and a valid tier", () => {
    const valid = new Set(["bench", "lab", "institute"]);
    for (const raw of sponsorsData as Sponsor[]) {
      expect(typeof raw.name).toBe("string");
      expect(raw.name.length).toBeGreaterThan(0);
      expect(valid.has(raw.tier)).toBe(true);
    }
  });
});

describe("ThanksPage", () => {
  it("shows the warm empty state when there are no sponsors", () => {
    // The seed file is empty, so the wall should invite the first backer.
    render(<ThanksPage />);
    expect(
      screen.getByText("Be the first to back ResearchOS."),
    ).toBeInTheDocument();
  });

  it("links every tier to the ResearchOS-LLC GitHub Sponsors page", () => {
    render(<ThanksPage />);
    const links = screen
      .getAllByRole("link", { name: "Sponsor on GitHub" })
      .map((a) => a.getAttribute("href"));
    expect(links).toHaveLength(3);
    for (const href of links) {
      expect(href).toBe("https://github.com/sponsors/ResearchOS-LLC");
    }
  });
});
