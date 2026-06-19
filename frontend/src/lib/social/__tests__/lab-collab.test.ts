// Unit tests for the lab-to-recipient resolution helpers (Phase 2).
//
// These functions are pure (no IO, no Next.js) so they run in vitest
// without any infrastructure. They verify:
//   - resolveLabRecipient: demo slug -> PI recipient, unknown slug -> null
//   - buildLabShareDeepLink: encodes slug in the ?share= param
//   - buildPiProfileDeepLink: builds the /u/<handle> URL
//   - buildRequestDataDeepLink: adds ?compose=request
//   - labMemberToRecipient: maps a member + fingerprint to ShareRecipient

import { describe, expect, it } from "vitest";

import {
  resolveLabRecipient,
  buildLabShareDeepLink,
  buildPiProfileDeepLink,
  buildRequestDataDeepLink,
  labMemberToRecipient,
} from "@/lib/social/lab-collab";
import {
  DEMO_LAB_SLUG,
  DEMO_LAB_PI,
  DEMO_KEY_FINGERPRINT,
} from "@/lib/social/demo-lab";

// ---------------------------------------------------------------------------
// resolveLabRecipient
// ---------------------------------------------------------------------------

describe("resolveLabRecipient", () => {
  it("resolves the demo lab slug to the PI", () => {
    const r = resolveLabRecipient(DEMO_LAB_SLUG);
    expect(r).not.toBeNull();
    expect(r?.displayName).toBe(DEMO_LAB_PI.name);
    expect(r?.handle).toBe(DEMO_LAB_PI.handle);
    expect(r?.fingerprint).toBe(DEMO_KEY_FINGERPRINT);
    expect(r?.hasPublishedKey).toBe(true);
  });

  it("returns null for an unknown slug", () => {
    expect(resolveLabRecipient("some-random-lab")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(resolveLabRecipient("")).toBeNull();
  });

  it("is case-insensitive for the demo slug (via isDemoLabSlug)", () => {
    // normalizeSlug lowercases, so the uppercase variant also resolves.
    const r = resolveLabRecipient(DEMO_LAB_SLUG.toUpperCase());
    expect(r).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// labMemberToRecipient
// ---------------------------------------------------------------------------

describe("labMemberToRecipient", () => {
  it("maps a member to a ShareRecipient with the correct shape", () => {
    const member = { handle: "mira", name: "Dr. Mira Castellanos", role: "PI" };
    const fp = "ab12 cd34 ef56";
    const r = labMemberToRecipient(member, fp);
    expect(r.displayName).toBe(member.name);
    expect(r.handle).toBe(member.handle);
    expect(r.fingerprint).toBe(fp);
    expect(r.hasPublishedKey).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildLabShareDeepLink
// ---------------------------------------------------------------------------

describe("buildLabShareDeepLink", () => {
  it("builds the ?share= deep link with a standard slug", () => {
    const url = buildLabShareDeepLink("https://research-os.app", "fakeyeast-lab");
    expect(url).toBe("https://research-os.app/network?share=fakeyeast-lab");
  });

  it("URL-encodes a slug that contains special characters", () => {
    const url = buildLabShareDeepLink("https://research-os.app", "lab with spaces");
    expect(url).toBe("https://research-os.app/network?share=lab%20with%20spaces");
  });

  it("strips a trailing slash from the app origin", () => {
    const url = buildLabShareDeepLink("https://research-os.app/", "demo-lab");
    expect(url).toBe("https://research-os.app/network?share=demo-lab");
  });
});

// ---------------------------------------------------------------------------
// buildPiProfileDeepLink
// ---------------------------------------------------------------------------

describe("buildPiProfileDeepLink", () => {
  it("builds the /u/<handle> profile URL", () => {
    const url = buildPiProfileDeepLink("https://research-os.app", "mira");
    expect(url).toBe("https://research-os.app/u/mira");
  });

  it("URL-encodes the handle", () => {
    const url = buildPiProfileDeepLink("https://research-os.app", "dr mira");
    expect(url).toBe("https://research-os.app/u/dr%20mira");
  });
});

// ---------------------------------------------------------------------------
// buildRequestDataDeepLink
// ---------------------------------------------------------------------------

describe("buildRequestDataDeepLink", () => {
  it("builds the /u/<handle>?compose=request URL", () => {
    const url = buildRequestDataDeepLink("https://research-os.app", "mira");
    expect(url).toBe("https://research-os.app/u/mira?compose=request");
  });

  it("strips a trailing slash from the origin", () => {
    const url = buildRequestDataDeepLink("https://research-os.app/", "mira");
    expect(url).toBe("https://research-os.app/u/mira?compose=request");
  });
});
