import { describe, expect, it } from "vitest";
import { humanizeSiteKey } from "@/lib/social/lab-site-usage-label";

describe("humanizeSiteKey", () => {
  it('maps null to "Other"', () => {
    expect(humanizeSiteKey(null)).toBe("Other");
  });

  it('maps "home" to "Home page"', () => {
    expect(humanizeSiteKey("home")).toBe("Home page");
  });

  it('maps "byo" to "Uploaded site"', () => {
    expect(humanizeSiteKey("byo")).toBe("Uploaded site");
  });

  it("passes a companion page path through unchanged", () => {
    expect(humanizeSiteKey("people")).toBe("people");
    expect(humanizeSiteKey("papers/2024")).toBe("papers/2024");
  });

  it("passes an arbitrary unknown key through unchanged", () => {
    expect(humanizeSiteKey("some-other-key")).toBe("some-other-key");
  });
});
