import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DirectoryUnavailable,
  fetchPublicInstitution,
  humanizeInstitutionSlug,
} from "@/lib/social/institution";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("humanizeInstitutionSlug", () => {
  it("title-cases hyphen/underscore slugs", () => {
    expect(humanizeInstitutionSlug("uw-madison")).toBe("Uw Madison");
    expect(humanizeInstitutionSlug("max_planck")).toBe("Max Planck");
  });
  it("tolerates empty and stray separators", () => {
    expect(humanizeInstitutionSlug("")).toBe("");
    expect(humanizeInstitutionSlug("--ox--")).toBe("Ox");
  });
  it("keeps minor words lowercase except as the first word", () => {
    expect(humanizeInstitutionSlug("university-of-wisconsin-madison")).toBe(
      "University of Wisconsin Madison",
    );
    expect(humanizeInstitutionSlug("the-university-of-the-arts")).toBe(
      "The University of the Arts",
    );
  });
});

describe("fetchPublicInstitution", () => {
  it("returns null for an empty slug without fetching", async () => {
    const f = mockFetch(200, { found: true });
    vi.stubGlobal("fetch", f);
    expect(await fetchPublicInstitution("   ")).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("throws DirectoryUnavailable on 404 (endpoint not live yet)", async () => {
    vi.stubGlobal("fetch", mockFetch(404, {}));
    await expect(fetchPublicInstitution("uw-madison")).rejects.toBeInstanceOf(
      DirectoryUnavailable,
    );
  });

  it("returns null when found is false", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { found: false }));
    expect(await fetchPublicInstitution("nowhere")).toBeNull();
  });

  it("normalizes the institution + members (drops malformed, no email)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(200, {
        found: true,
        institution: {
          name: "UW-Madison",
          domain: "wisc.edu",
          logoUrl: null,
          departments: ["Bacteriology", "", "Genetics"],
          memberCount: 2,
          members: [
            {
              fingerprint: "abcd ef12",
              displayName: "Sarah Lee",
              affiliation: "UW-Madison",
              verifiedDomain: "wisc.edu",
              orcid: "0000-0001-2345-6789",
              email: "leak@example.com",
            },
            { displayName: "No FP" },
          ],
        },
      }),
    );
    const out = await fetchPublicInstitution("UW-Madison");
    expect(out).not.toBeNull();
    expect(out!.name).toBe("UW-Madison");
    expect(out!.slug).toBe("uw-madison");
    expect(out!.departments).toEqual(["Bacteriology", "Genetics"]);
    expect(out!.members).toHaveLength(1);
    expect(out!.members[0]).not.toHaveProperty("email");
    expect(out!.memberCount).toBe(2);
  });

  it("falls back to a humanized name when none is provided", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(200, { found: true, institution: { members: [] } }),
    );
    const out = await fetchPublicInstitution("max-planck");
    expect(out!.name).toBe("Max Planck");
    expect(out!.memberCount).toBeNull();
  });
});
