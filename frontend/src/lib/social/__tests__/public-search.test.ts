import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DirectorySearchUnavailable,
  searchResearchersPublic,
} from "@/lib/social/public-search";

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

describe("searchResearchersPublic", () => {
  it("returns [] for a too-short query without fetching", async () => {
    const f = mockFetch(200, { results: [] });
    vi.stubGlobal("fetch", f);
    expect(await searchResearchersPublic("a")).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it("throws DirectorySearchUnavailable on 404 (endpoint not live yet)", async () => {
    vi.stubGlobal("fetch", mockFetch(404, {}));
    await expect(searchResearchersPublic("sarah")).rejects.toBeInstanceOf(
      DirectorySearchUnavailable,
    );
  });

  it("throws a generic Error on other failures", async () => {
    vi.stubGlobal("fetch", mockFetch(500, {}));
    await expect(searchResearchersPublic("sarah")).rejects.toThrow(
      /directory search failed/,
    );
  });

  it("normalizes results and drops malformed rows (never surfaces email)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(200, {
        results: [
          {
            fingerprint: "abcd ef12 3456 7890",
            displayName: "Sarah Lee",
            affiliation: "UW-Madison",
            verifiedDomain: "wisc.edu",
            orcid: "0000-0001-2345-6789",
            email: "leak@example.com",
          },
          { displayName: "No Fingerprint" }, // dropped: missing fingerprint
          { fingerprint: "ffff" }, // dropped: missing displayName
        ],
      }),
    );
    const out = await searchResearchersPublic("sarah");
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      fingerprint: "abcd ef12 3456 7890",
      displayName: "Sarah Lee",
      affiliation: "UW-Madison",
      verifiedDomain: "wisc.edu",
      orcid: "0000-0001-2345-6789",
    });
    expect(out[0]).not.toHaveProperty("email");
  });

  it("tolerates a missing results array", async () => {
    vi.stubGlobal("fetch", mockFetch(200, {}));
    expect(await searchResearchersPublic("sarah")).toEqual([]);
  });
});
