// Unit tests for the operator account roster builder.
//
// A mock Neon tagged-template answers each roster sub-query by keyword. The tests
// assert that labs, solo users, and orgs come back shaped correctly, that a solo
// user with no name falls back to a hash prefix and never leaks an email, and
// that a lab PI is not double-listed as a solo user. A throwing sub-query is
// swallowed so the rest of the roster still returns.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { __setRosterSqlForTests, buildRoster, type Sql } from "../account-roster";

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://test/test";
});

afterEach(() => {
  __setRosterSqlForTests(null);
});

function makeMockSql(opts: { throwOn?: RegExp } = {}) {
  const sql = ((strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    if (opts.throwOn && opts.throwOn.test(text)) {
      return Promise.reject(new Error("boom"));
    }
    if (/FROM directory_labs/i.test(text)) {
      return Promise.resolve([
        {
          owner_key: "labhash1",
          name: "Smith Lab",
          pi_display_name: "Dr. Smith",
          member_count: 4,
          created_at: "2026-06-17T00:00:00Z",
          has_card: true,
        },
      ]);
    }
    if (/FROM directory_identities/i.test(text)) {
      return Promise.resolve([
        // A named solo user.
        {
          owner_key: "solohash1",
          created_at: "2026-06-16T00:00:00Z",
          account_name: "Bob Jones",
          profile_name: null,
          affiliation: "UW-Madison",
          has_card: false,
          is_paid: true,
        },
        // An anonymous solo user (no name anywhere).
        {
          owner_key: "abcdef0123456789",
          created_at: "2026-06-15T00:00:00Z",
          account_name: null,
          profile_name: null,
          affiliation: null,
          has_card: false,
          is_paid: false,
        },
        // The lab PI, must be filtered out of the solo list.
        {
          owner_key: "labhash1",
          created_at: "2026-06-14T00:00:00Z",
          account_name: "Dr. Smith",
          profile_name: null,
          affiliation: null,
          has_card: true,
          is_paid: true,
        },
      ]);
    }
    if (/FROM departments/i.test(text)) {
      return Promise.resolve([
        {
          dept_id: "dept-1",
          name: "Chemistry",
          created_at: "2026-06-13T00:00:00Z",
          members: 2,
          has_card: false,
        },
      ]);
    }
    if (/FROM institutions/i.test(text)) {
      return Promise.resolve([
        {
          institution_id: "inst-1",
          name: "Test University",
          created_at: "2026-06-12T00:00:00Z",
          members: 3,
          has_card: true,
        },
      ]);
    }
    return Promise.resolve([]);
  }) as unknown as Sql;
  return sql;
}

describe("buildRoster", () => {
  it("returns labs, solo users, and orgs in the expected shape", async () => {
    __setRosterSqlForTests(makeMockSql());
    const roster = await buildRoster();

    expect(roster.labs).toHaveLength(1);
    expect(roster.labs[0]).toMatchObject({
      ownerKey: "labhash1",
      label: "Smith Lab",
      memberCount: 4,
      hasCard: true,
    });

    // Two solo users (the lab PI is filtered out).
    expect(roster.solo).toHaveLength(2);
    const bob = roster.solo.find((s) => s.ownerKey === "solohash1");
    expect(bob?.label).toBe("Bob Jones (UW-Madison)");
    expect(bob?.plan).toBe("solo");
    expect(roster.solo.some((s) => s.ownerKey === "labhash1")).toBe(false);

    // The anonymous user falls back to a hash prefix, no email.
    const anon = roster.solo.find((s) => s.ownerKey === "abcdef0123456789");
    expect(anon?.label).toBe("abcdef0123 (no profile)");
    expect(anon?.plan).toBe("free");

    // Orgs, institutions first then departments.
    expect(roster.depts).toHaveLength(2);
    expect(roster.depts[0]).toMatchObject({ kind: "institution", id: "inst-1" });
    expect(roster.depts[1]).toMatchObject({ kind: "dept", id: "dept-1" });
  });

  it("is resilient, a failing sub-query yields an empty list not a throw", async () => {
    __setRosterSqlForTests(makeMockSql({ throwOn: /FROM departments/i }));
    const roster = await buildRoster();
    // Departments failed, but institutions and the rest still came back.
    expect(roster.depts.some((d) => d.kind === "dept")).toBe(false);
    expect(roster.depts.some((d) => d.kind === "institution")).toBe(true);
    expect(roster.labs).toHaveLength(1);
  });
});
