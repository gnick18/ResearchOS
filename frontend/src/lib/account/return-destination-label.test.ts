import { describe, it, expect } from "vitest";
import { returnDestinationLabel } from "@/lib/account/return-destination-label";

describe("returnDestinationLabel", () => {
  it("maps root to ResearchOS", () => {
    expect(returnDestinationLabel("/")).toBe("ResearchOS");
  });

  it("maps known routes to friendly names", () => {
    expect(returnDestinationLabel("/datahub")).toBe("Data Hub");
  });

  it("strips a query string before mapping", () => {
    expect(returnDestinationLabel("/datahub?x=1")).toBe("Data Hub");
  });

  it("falls back to ResearchOS for unknown routes", () => {
    expect(returnDestinationLabel("/totally-unknown")).toBe("ResearchOS");
  });

  it("falls back to ResearchOS for null", () => {
    expect(returnDestinationLabel(null)).toBe("ResearchOS");
  });
});
