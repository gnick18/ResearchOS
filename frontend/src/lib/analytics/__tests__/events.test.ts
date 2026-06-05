// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factories (which are hoisted above imports) can close
// over the same mutable handles the tests poke.
const h = vi.hoisted(() => ({ track: vi.fn(), offline: false }));

vi.mock("@vercel/analytics", () => ({ track: h.track }));
vi.mock("@/lib/store", () => ({
  useAppStore: { getState: () => ({ offlineMode: h.offline }) },
}));

import {
  trackIdentityCreated,
  trackProfilePublished,
  trackShareSent,
} from "../events";

beforeEach(() => {
  h.track.mockReset();
  h.offline = false;
});

describe("trackShareSent", () => {
  it("emits share_sent with the kind + destination enum", () => {
    trackShareSent("method", "email_invite");
    expect(h.track).toHaveBeenCalledTimes(1);
    expect(h.track).toHaveBeenCalledWith("share_sent", {
      kind: "method",
      destination: "email_invite",
    });
  });

  it("does not emit when Offline Mode is on", () => {
    h.offline = true;
    trackShareSent("note", "existing_user");
    expect(h.track).not.toHaveBeenCalled();
  });
});

describe("trackProfilePublished", () => {
  it("emits only booleans, never name / institution / orcid", () => {
    trackProfilePublished({ hasOrcid: true, hasAffiliation: false });
    expect(h.track).toHaveBeenCalledWith("profile_published", {
      has_orcid: true,
      has_affiliation: false,
    });
    // Guard the privacy contract: the single property bag is booleans only.
    const props = h.track.mock.calls[0][1] as Record<string, unknown>;
    for (const value of Object.values(props)) {
      expect(typeof value).toBe("boolean");
    }
  });
});

describe("trackIdentityCreated", () => {
  it("emits a bare counter with no properties", () => {
    trackIdentityCreated();
    expect(h.track).toHaveBeenCalledWith("identity_created", undefined);
  });
});

describe("resilience", () => {
  it("swallows a track() failure so a user action never breaks", () => {
    h.track.mockImplementationOnce(() => {
      throw new Error("analytics blew up");
    });
    expect(() => trackShareSent("project", "existing_user")).not.toThrow();
  });
});
