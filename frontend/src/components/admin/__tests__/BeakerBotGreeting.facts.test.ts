import { describe, expect, it } from "vitest";

import { buildGreetingFacts } from "../BeakerBotGreeting";

const baseMetrics = {
  directory: {
    totalIdentities: 47,
    totalProfiles: 31,
    orcidLinks: 22,
    signupsByMonth: [
      { month: "2026-05", count: 18 },
      { month: "2026-06", count: 15 },
    ],
    profilesByDomain: [
      { domain: "wisc.edu", count: 12 },
      { domain: "harvard.edu", count: 5 },
    ],
  },
  relay: { pendingShares: 8, totalEverSent: 63 },
  capacity: {
    neon: { usedBytes: 0.21 * 1024 ** 3, limitBytes: 0.5 * 1024 ** 3 },
    resend: { sentLast30Days: 214 },
  },
};

describe("buildGreetingFacts", () => {
  it("opens with a returning greeting and leads with the new-since-last-visit delta", () => {
    const facts = buildGreetingFacts(baseMetrics, {
      delta: 3,
      daysSince: 2,
      returning: true,
    });
    expect(facts[0]).toBe("Welcome back!");
    expect(facts[1]).toBe("3 new researchers joined in the last 2 days.");
  });

  it("uses 'since yesterday' for a one-day gap and singular wording for a single new researcher", () => {
    const facts = buildGreetingFacts(baseMetrics, {
      delta: 1,
      daysSince: 1,
      returning: true,
    });
    expect(facts[1]).toBe("1 new researcher joined since yesterday.");
  });

  it("greets a first-time visitor without a delta line", () => {
    const facts = buildGreetingFacts(baseMetrics, {
      delta: null,
      daysSince: null,
      returning: false,
    });
    expect(facts[0]).toBe("Hi there!");
    expect(facts.some((f) => f.includes("joined"))).toBe(false);
  });

  it("notes a calm stretch when a returning visitor has zero new sign-ups", () => {
    const facts = buildGreetingFacts(baseMetrics, {
      delta: 0,
      daysSince: 4,
      returning: true,
    });
    expect(facts).toContain("No new sign-ups since your last visit. Calm seas.");
  });

  it("includes standing facts for totals, profiles, ORCID, relay, capacity", () => {
    const facts = buildGreetingFacts(baseMetrics, {
      delta: null,
      daysSince: null,
      returning: false,
    });
    expect(facts).toContain("We are up to 47 registered researchers.");
    expect(facts).toContain("31 public profiles across 2 institutions.");
    expect(facts).toContain("22 researchers have linked an ORCID.");
    expect(facts).toContain(
      "63 shares have been delivered through the relay.",
    );
    expect(facts.some((f) => f.includes("database is only"))).toBe(true);
    expect(facts).toContain("214 emails went out in the last 30 days.");
  });

  it("falls back to an all-quiet line on an empty deployment", () => {
    const empty = {
      directory: {
        totalIdentities: 0,
        totalProfiles: 0,
        orcidLinks: 0,
        signupsByMonth: [],
        profilesByDomain: [],
      },
      relay: { pendingShares: 0, totalEverSent: 0 },
    };
    const facts = buildGreetingFacts(empty, {
      delta: null,
      daysSince: null,
      returning: false,
    });
    expect(facts).toEqual([
      "Hi there!",
      "All quiet so far. The first researchers will show up here.",
    ]);
  });
});
