// Tests for the /network BeakerBot integration tools (network-tools bot, 2026-06-19).
//
// find_collaborators and share_with_researcher are exercised through mock deps
// so no real fetch, crypto, or navigation side-effects fire in tests.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the navigation bridge and references so importing network-tools does not
// pull the full client-component graph into the test runner.
vi.mock("@/components/ai/navigation-bridge", () => ({
  requestNavigation: vi.fn(),
}));
vi.mock("@/lib/references", () => ({
  objectDeepLink: (_type: string, id: string) => `/${_type}s/${id}`,
}));

import {
  findCollaboratorsTool,
  shareWithResearcherTool,
  networkToolsDeps,
  type CollaboratorResult,
  type NetworkToolsDeps,
} from "../network-tools";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(
  overrides: Partial<CollaboratorResult> = {},
): CollaboratorResult {
  return {
    fingerprint: "a".repeat(40),
    name: "Alice Lee",
    institution: "Stanford University",
    verifiedDomain: "stanford.edu",
    orcid: "0000-0002-1234-5678",
    ...overrides,
  };
}

/** Build a mock NetworkToolsDeps for share_with_researcher tests. */
function makeDeps(
  overrides: Partial<NetworkToolsDeps> = {},
): NetworkToolsDeps {
  return {
    searchPublicProfiles: vi.fn().mockResolvedValue({ ok: true, profiles: [] }),
    checkSendEntitlement: vi.fn().mockResolvedValue(true),
    navigate: vi.fn(),
    ...overrides,
  };
}

/** Override the module-level deps for a test and restore after. */
function withDeps(deps: NetworkToolsDeps, fn: () => Promise<void>): Promise<void> {
  const original = { ...networkToolsDeps };
  Object.assign(networkToolsDeps, deps);
  return fn().finally(() => Object.assign(networkToolsDeps, original));
}

// ---------------------------------------------------------------------------
// find_collaborators
// ---------------------------------------------------------------------------

describe("find_collaborators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns mapped profiles on a successful search", async () => {
    await withDeps(
      makeDeps({
        searchPublicProfiles: vi.fn().mockResolvedValue({
          ok: true,
          profiles: [makeProfile()],
        }),
      }),
      async () => {
        const res = (await findCollaboratorsTool.execute({
          query: "alice",
        })) as Record<string, unknown>;
        expect(res.ok).toBe(true);
        const profiles = res.profiles as CollaboratorResult[];
        expect(profiles).toHaveLength(1);
        expect(profiles[0].name).toBe("Alice Lee");
        expect(profiles[0].fingerprint).toBe("a".repeat(40));
        // Email must never be present.
        expect(Object.keys(profiles[0])).not.toContain("email");
      },
    );
  });

  it("returns empty array when no results match", async () => {
    await withDeps(
      makeDeps({
        searchPublicProfiles: vi.fn().mockResolvedValue({
          ok: true,
          profiles: [],
        }),
      }),
      async () => {
        const res = (await findCollaboratorsTool.execute({
          query: "zzznomatch",
        })) as Record<string, unknown>;
        expect(res.ok).toBe(true);
        expect(res.profiles).toEqual([]);
      },
    );
  });

  it("returns error result on endpoint error, not thrown", async () => {
    await withDeps(
      makeDeps({
        searchPublicProfiles: vi.fn().mockResolvedValue({
          ok: false,
          profiles: [],
          status: "search_failed",
        }),
      }),
      async () => {
        const res = (await findCollaboratorsTool.execute({
          query: "alice",
        })) as Record<string, unknown>;
        expect(res.ok).toBe(false);
        expect(typeof res.error).toBe("string");
        expect(res.profiles).toEqual([]);
      },
    );
  });

  it("degrades gracefully when the endpoint throws (network error)", async () => {
    await withDeps(
      makeDeps({
        searchPublicProfiles: vi.fn().mockResolvedValue({
          ok: false,
          profiles: [],
          status: "network_error",
        }),
      }),
      async () => {
        const res = (await findCollaboratorsTool.execute({
          query: "alice",
        })) as Record<string, unknown>;
        expect(res.ok).toBe(false);
        expect(Array.isArray(res.profiles)).toBe(true);
        expect(res.profiles).toHaveLength(0);
      },
    );
  });

  it("returns ok with directory_unavailable note when directory is dark", async () => {
    await withDeps(
      makeDeps({
        searchPublicProfiles: vi.fn().mockResolvedValue({
          ok: true,
          profiles: [],
          status: "directory_unavailable",
        }),
      }),
      async () => {
        const res = (await findCollaboratorsTool.execute({
          query: "alice",
        })) as Record<string, unknown>;
        expect(res.ok).toBe(true);
        expect(res.profiles).toEqual([]);
        expect(typeof res.note).toBe("string");
      },
    );
  });

  it("rejects a query shorter than 2 characters", async () => {
    const res = (await findCollaboratorsTool.execute({
      query: "a",
    })) as Record<string, unknown>;
    expect(res.ok).toBe(false);
    expect(typeof res.error).toBe("string");
  });

  it("forwards the institution filter to the search function", async () => {
    const searchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, profiles: [] });
    await withDeps(
      makeDeps({ searchPublicProfiles: searchFn }),
      async () => {
        await findCollaboratorsTool.execute({
          query: "alice",
          institution: "MIT",
        });
        expect(searchFn).toHaveBeenCalledWith("alice", "MIT", expect.any(Number));
      },
    );
  });

  it("respects the limit parameter (caps at 20)", async () => {
    const searchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, profiles: [] });
    await withDeps(
      makeDeps({ searchPublicProfiles: searchFn }),
      async () => {
        await findCollaboratorsTool.execute({ query: "alice", limit: 50 });
        // The second argument is institution (undefined), third is limit capped at 20.
        const calledLimit = searchFn.mock.calls[0][2] as number;
        expect(calledLimit).toBe(20);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// share_with_researcher
// ---------------------------------------------------------------------------

describe("share_with_researcher", () => {
  const VALID_FINGERPRINT = "b".repeat(40);
  const VALID_EMAIL = "bob@example.com";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a preview from describeAction before execute fires", () => {
    const desc = shareWithResearcherTool.describeAction?.({
      recipient: VALID_FINGERPRINT,
      objectType: "note",
      objectId: "42",
      message: "Hey Bob, check this out",
    });
    expect(typeof desc?.summary).toBe("string");
    expect(desc?.summary).toContain("note");
    expect(desc?.summary).toContain("42");
  });

  it("never auto-sends: does NOT call navigate before user approves (isDestructive false)", () => {
    // isDestructive must return false (this is a non-destructive send action).
    const isDestructive = shareWithResearcherTool.isDestructive?.({
      recipient: VALID_FINGERPRINT,
      objectType: "note",
      objectId: "42",
    });
    expect(isDestructive).toBe(false);
  });

  it("returns entitlement-blocked result when user is not entitled, does not navigate", async () => {
    const navigateFn = vi.fn();
    await withDeps(
      makeDeps({
        checkSendEntitlement: vi.fn().mockResolvedValue(false),
        navigate: navigateFn,
      }),
      async () => {
        const res = (await shareWithResearcherTool.execute({
          recipient: VALID_FINGERPRINT,
          objectType: "note",
          objectId: "42",
        })) as Record<string, unknown>;
        expect(res.ok).toBe(false);
        expect(res.entitlementBlocked).toBe(true);
        expect(typeof res.error).toBe("string");
        expect((res.error as string).toLowerCase()).toContain("paid");
        // Must never navigate when the gate blocks.
        expect(navigateFn).not.toHaveBeenCalled();
      },
    );
  });

  it("navigates on the confirmed path and returns instruction, NOT the actual send", async () => {
    const navigateFn = vi.fn();
    await withDeps(
      makeDeps({ navigate: navigateFn }),
      async () => {
        const res = (await shareWithResearcherTool.execute({
          recipient: VALID_FINGERPRINT,
          objectType: "note",
          objectId: "42",
        })) as Record<string, unknown>;
        expect(res.ok).toBe(true);
        // Navigation fires (the actual send is left to the UI dialog).
        expect(navigateFn).toHaveBeenCalledTimes(1);
        const navPath = navigateFn.mock.calls[0][0] as string;
        expect(navPath).toContain("42");
        // Result carries an instruction for the user, not a "sent" confirmation.
        expect(typeof res.instruction).toBe("string");
        // There is no "bundleId" (that belongs to sendShare, never called here).
        expect(res.bundleId).toBeUndefined();
      },
    );
  });

  it("accepts an email recipient from the user", async () => {
    const navigateFn = vi.fn();
    await withDeps(
      makeDeps({ navigate: navigateFn }),
      async () => {
        const res = (await shareWithResearcherTool.execute({
          recipient: VALID_EMAIL,
          objectType: "method",
          objectId: "7",
        })) as Record<string, unknown>;
        expect(res.ok).toBe(true);
        expect(navigateFn).toHaveBeenCalledTimes(1);
        const recipientField = res.recipient as Record<string, unknown>;
        expect(recipientField.email).toBe(VALID_EMAIL);
      },
    );
  });

  it("rejects a recipient that is neither a fingerprint nor an email", async () => {
    const navigateFn = vi.fn();
    await withDeps(
      makeDeps({ navigate: navigateFn }),
      async () => {
        const res = (await shareWithResearcherTool.execute({
          recipient: "just-a-name",
          objectType: "note",
          objectId: "42",
        })) as Record<string, unknown>;
        expect(res.ok).toBe(false);
        expect(typeof res.error).toBe("string");
        expect(navigateFn).not.toHaveBeenCalled();
      },
    );
  });

  it("rejects an unsupported objectType", async () => {
    await withDeps(
      makeDeps(),
      async () => {
        const res = (await shareWithResearcherTool.execute({
          recipient: VALID_FINGERPRINT,
          objectType: "datahub",
          objectId: "5",
        })) as Record<string, unknown>;
        expect(res.ok).toBe(false);
        expect(typeof res.error).toBe("string");
      },
    );
  });

  it("rejects when objectId is missing", async () => {
    await withDeps(
      makeDeps(),
      async () => {
        const res = (await shareWithResearcherTool.execute({
          recipient: VALID_FINGERPRINT,
          objectType: "note",
          objectId: "",
        })) as Record<string, unknown>;
        expect(res.ok).toBe(false);
      },
    );
  });

  it("includes the message in the instruction on the confirmed path", async () => {
    await withDeps(
      makeDeps(),
      async () => {
        const res = (await shareWithResearcherTool.execute({
          recipient: VALID_FINGERPRINT,
          objectType: "method",
          objectId: "99",
          message: "Check out this protocol",
        })) as Record<string, unknown>;
        expect(res.ok).toBe(true);
        expect((res.instruction as string)).toContain("Check out this protocol");
      },
    );
  });

  it("calls checkSendEntitlement exactly once per execute", async () => {
    const entitlementFn = vi.fn().mockResolvedValue(true);
    await withDeps(
      makeDeps({ checkSendEntitlement: entitlementFn }),
      async () => {
        await shareWithResearcherTool.execute({
          recipient: VALID_FINGERPRINT,
          objectType: "note",
          objectId: "1",
        });
        expect(entitlementFn).toHaveBeenCalledTimes(1);
      },
    );
  });

  it("describeAction works with an email recipient", () => {
    const desc = shareWithResearcherTool.describeAction?.({
      recipient: VALID_EMAIL,
      objectType: "sequence",
      objectId: "3",
    });
    expect(desc?.summary).toContain("bob@example.com");
    expect(desc?.summary).toContain("sequence");
  });

  it("result for a fingerprint recipient carries fingerprint, not email", async () => {
    await withDeps(
      makeDeps(),
      async () => {
        const res = (await shareWithResearcherTool.execute({
          recipient: VALID_FINGERPRINT,
          objectType: "experiment",
          objectId: "10",
        })) as Record<string, unknown>;
        expect(res.ok).toBe(true);
        const recipientField = res.recipient as Record<string, unknown>;
        expect(recipientField.fingerprint).toBe(VALID_FINGERPRINT);
        expect(recipientField.email).toBeUndefined();
      },
    );
  });
});
