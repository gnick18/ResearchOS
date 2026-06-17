// Unit tests for the operator account-wipe resolver and table coverage.
//
// No live DATABASE_URL and no Stripe. A mock Neon tagged-template records every
// query text and the captured key value, so the tests assert (a) the email ->
// owner-key resolver, and (b) that the preview and the wipe touch exactly the
// expected set of tables keyed strictly on the resolved id. The preview path is
// covered directly (no Stripe). The wipe path's DB coverage is covered by
// driving the per-table delete list, which keeps the test off the Stripe client.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __setWipeSqlForTests,
  deptTableDeletes,
  institutionTableDeletes,
  maskCustomerId,
  ownerTableDeletes,
  previewWipe,
  resolveWipeTarget,
  type Sql,
} from "../account-wipe";

// The same peppered hash ownerKeyForEmail would produce, computed via a fixed
// pepper so the resolver test is deterministic.
import { ownerKeyForEmail } from "@/lib/billing/owner";

const PEPPER = "test-pepper-1234567890";

beforeEach(() => {
  process.env.DIRECTORY_HMAC_PEPPER = PEPPER;
  process.env.DATABASE_URL = "postgres://test/test";
});

afterEach(() => {
  __setWipeSqlForTests(null);
  vi.restoreAllMocks();
});

/**
 * A mock Neon tagged-template. It records the joined query text and the FIRST
 * captured value (the key) for every call, answers COUNT queries with a fixed 1,
 * and answers DELETE ... RETURNING with a single-row array so the row count reads
 * as 1. Other selects (the stripe customer read, the fingerprint lookup) return
 * an empty array so no Stripe path and no profile path is exercised.
 */
function makeMockSql() {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    if (/SELECT count\(\*\)/i.test(text)) {
      return Promise.resolve([{ n: 1 }]);
    }
    if (/DELETE FROM .* RETURNING/i.test(text)) {
      return Promise.resolve([{ "?column?": 1 }]);
    }
    // stripe customer read, fingerprint lookup, anything else, empty.
    return Promise.resolve([]);
  }) as unknown as Sql;
  return { sql, calls };
}

/** Pulls the distinct table name out of each recorded query, in order. */
function tablesTouched(calls: { text: string }[]): string[] {
  const out: string[] = [];
  for (const c of calls) {
    const m =
      c.text.match(/DELETE FROM (\w+)/i) ||
      c.text.match(/FROM (\w+)/i);
    if (m) out.push(m[1]);
  }
  return out;
}

describe("resolveWipeTarget", () => {
  it("hashes an email into the same owner key the billing layer uses", () => {
    const t = resolveWipeTarget({ email: "Alice@Example.COM" });
    expect(t.kind).toBe("owner");
    if (t.kind === "owner") {
      expect(t.ownerKey).toBe(ownerKeyForEmail("Alice@Example.COM"));
      expect(t.email).toBe("Alice@Example.COM");
    }
  });

  it("accepts an explicit owner key without hashing", () => {
    const t = resolveWipeTarget({ ownerKey: "deadbeef" });
    expect(t).toEqual({ kind: "owner", ownerKey: "deadbeef", email: null });
  });

  it("resolves a department id", () => {
    const t = resolveWipeTarget({ deptId: "dept-123" });
    expect(t).toEqual({ kind: "dept", deptId: "dept-123" });
  });

  it("resolves an institution id", () => {
    const t = resolveWipeTarget({ institutionId: "inst-9" });
    expect(t).toEqual({ kind: "institution", institutionId: "inst-9" });
  });

  it("throws when no target is given", () => {
    expect(() => resolveWipeTarget({})).toThrow(/no wipe target/i);
  });

  it("throws when more than one target is given", () => {
    expect(() => resolveWipeTarget({ ownerKey: "x", deptId: "y" })).toThrow(
      /more than one/i,
    );
  });
});

describe("owner table coverage", () => {
  const EXPECTED_OWNER_TABLES = [
    "cloud_balance",
    "cloud_usage_ledger",
    "ai_balances",
    "ai_ledger",
    "billing_subscriptions",
    "billing_grants",
    "billing_lab_members",
    "dept_members",
    "directory_identities",
    "directory_key_history",
    "directory_orcid_links",
    "directory_profiles",
    "directory_labs",
    "directory_lab_requests",
    "relay_inbox",
    "relay_invite",
    "collab_doc_sizes",
    "collab_owner_writes",
    "lab_hosted_assets",
    "lab_site_pages",
    "lab_sites",
    "lab_byo_sites",
    "lab_byo_github",
    "account_profiles",
    "slug_registry",
  ];

  it("covers every owner-keyed table (without an email, beta_testers is skipped)", () => {
    const deletes = ownerTableDeletes("OWNERKEY", null);
    const tables = deletes.map((d) => d.table);
    expect(tables).toEqual(EXPECTED_OWNER_TABLES);
    expect(tables).not.toContain("beta_testers");
  });

  it("adds beta_testers only when the plaintext email is known", () => {
    const deletes = ownerTableDeletes("OWNERKEY", "alice@example.com");
    expect(deletes.map((d) => d.table)).toContain("beta_testers");
  });

  it("each owner delete keys strictly on the owner key", async () => {
    const { sql, calls } = makeMockSql();
    const deletes = ownerTableDeletes("OWNERKEY", "alice@example.com");
    for (const d of deletes) {
      await d.run(sql);
    }
    // Every recorded DELETE must reference the owner key or the canonical email.
    const deleteCalls = calls.filter((c) => /DELETE FROM/i.test(c.text));
    expect(deleteCalls.length).toBeGreaterThan(0);
    for (const c of deleteCalls) {
      const referencesKey =
        c.values.includes("OWNERKEY") || c.values.includes("alice@example.com");
      expect(referencesKey).toBe(true);
    }
  });
});

describe("dept and institution org coverage", () => {
  it("a department wipe covers its rows and ends with the departments row", () => {
    const tables = deptTableDeletes("dept-1").map((d) => d.table);
    expect(tables).toEqual([
      "dept_members",
      "dept_usage_snapshots",
      "institution_members",
      "org_billing",
      "slug_registry",
      "departments",
    ]);
  });

  it("an institution wipe covers its rows and ends with the institutions row", () => {
    const tables = institutionTableDeletes("inst-1").map((d) => d.table);
    expect(tables).toEqual([
      "institution_members",
      "institution_usage_snapshots",
      "org_billing",
      "slug_registry",
      "institutions",
    ]);
  });
});

describe("previewWipe (dry run)", () => {
  it("returns a per-table count for an owner and never issues a DELETE", async () => {
    const { sql, calls } = makeMockSql();
    __setWipeSqlForTests(sql);

    const preview = await previewWipe({
      kind: "owner",
      ownerKey: "OWNERKEY",
      email: "alice@example.com",
    });

    // No DELETE in a dry run.
    expect(calls.some((c) => /DELETE FROM/i.test(c.text))).toBe(false);

    // Every owner table plus beta_testers reports a count.
    const tablesInPreview = preview.perTable.map((t) => t.table);
    expect(tablesInPreview).toContain("cloud_balance");
    expect(tablesInPreview).toContain("directory_identities");
    expect(tablesInPreview).toContain("relay_inbox");
    expect(tablesInPreview).toContain("beta_testers");

    // The mock answers every count with 1, so the total equals the table count.
    expect(preview.total).toBe(preview.perTable.length);
    expect(preview.target).toEqual({ kind: "owner", id: "OWNERKEY" });
  });

  it("counts a department org without deleting", async () => {
    const { sql, calls } = makeMockSql();
    __setWipeSqlForTests(sql);

    const preview = await previewWipe({ kind: "dept", deptId: "dept-1" });

    expect(calls.some((c) => /DELETE FROM/i.test(c.text))).toBe(false);
    const counted = tablesTouched(calls);
    expect(counted).toContain("departments");
    expect(counted).toContain("dept_members");
    expect(preview.target).toEqual({ kind: "dept", id: "dept-1" });
  });
});

describe("maskCustomerId", () => {
  it("keeps the prefix and last four", () => {
    expect(maskCustomerId("cus_ABCDEFGHIJ")).toBe("cus_...GHIJ");
  });
  it("leaves a short id alone", () => {
    expect(maskCustomerId("cus_12")).toBe("cus_12");
  });
});
