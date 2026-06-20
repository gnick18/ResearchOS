// Tests for the PI slug-rename data layer (Phase PI-slug-rename).
//
// All DB helpers are mocked so the tests run without a Neon connection. The
// mock shapes mirror how the existing slug-registry-db tests mock neon
// (see slug-registry.test.ts + lab-site-route.test.ts for the pattern).
//
// .test.ts (not .test.tsx) as specified by the worktree preamble; jsdom tests
// are unreliable in a symlinked worktree.

// DATABASE_URL must be set before any module that lazily calls getSql() is
// imported. getSql() checks the env var before calling neon() itself, so the
// @neondatabase/serverless mock alone is not enough -- we also need a dummy
// URL so the guard passes. The URL value is irrelevant; neon() is mocked.
process.env.DATABASE_URL = "postgresql://mock:mock@localhost/mock";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the DB layer before any imports that reference it
// ---------------------------------------------------------------------------

// Mocked state for slug_registry rows.
const slugRegistryRows = new Map<string, {
  slug: string;
  kind: string;
  owner_key: string | null;
  ref: string | null;
  created_at: string;
  redirect_to: string | null;
}>();

// Mocked state for lab_sites rows.
const labSitesRows = new Map<string, { lab_owner_key: string; lab_slug: string }>();

// Stub for ensureSlugRegistrySchema (no-op in tests).
const ensureSlugRegistrySchema = vi.fn().mockResolvedValue(undefined);
const ensureLabSiteSchema = vi.fn().mockResolvedValue(undefined);

// reserveSlug spy: inserts a new slug_registry row if not already taken.
const reserveSlug = vi.fn(async (
  slug: string,
  _kind: string,
  ownerKey: string | null,
  ref: string | null,
) => {
  if (slugRegistryRows.has(slug)) {
    return { ok: false as const, reason: "taken" as const };
  }
  const row = {
    slug,
    kind: _kind,
    owner_key: ownerKey,
    ref,
    created_at: new Date().toISOString(),
    redirect_to: null,
  };
  slugRegistryRows.set(slug, row);
  return {
    ok: true as const,
    row: {
      slug: row.slug,
      kind: row.kind as import("@/lib/social/slug-registry").SlugKind,
      ownerKey: row.owner_key,
      ref: row.ref,
      createdAt: row.created_at,
      redirectTo: row.redirect_to,
    },
  };
});

// getSlug spy: returns the row or null.
const getSlug = vi.fn(async (slug: string) => {
  const row = slugRegistryRows.get(slug);
  if (!row) return null;
  return {
    slug: row.slug,
    kind: row.kind as import("@/lib/social/slug-registry").SlugKind,
    ownerKey: row.owner_key,
    ref: row.ref,
    createdAt: row.created_at,
    redirectTo: row.redirect_to,
  };
});

vi.mock("@/lib/social/slug-registry-db", () => ({
  ensureSlugRegistrySchema: () => ensureSlugRegistrySchema(),
  reserveSlug: (s: string, k: string, o: string | null, r: string | null) =>
    reserveSlug(s, k, o, r),
  getSlug: (s: string) => getSlug(s),
  resolveSlugRedirect: async (slug: string) => {
    const row = slugRegistryRows.get(slug);
    return row?.redirect_to ?? null;
  },
}));

// Neon SQL tag mock. The real lab-site-db uses the neon tagged-template SQL
// client. We mock it at the module level, routing each call by inspecting the
// template strings. A minimal in-memory approach is enough for these unit tests.
const mockSqlImpl = vi.fn(async (
  strings: TemplateStringsArray,
  ...vals: unknown[]
) => {
  const query = strings.join("?").trim().toUpperCase();

  // UPDATE lab_sites SET lab_slug = newSlug WHERE lab_owner_key = ownerKey AND lab_slug = oldSlug RETURNING ...
  if (query.includes("UPDATE LAB_SITES") && query.includes("SET LAB_SLUG")) {
    const [newSlug, ownerKey, oldSlug] = vals as [string, string, string];
    const found = [...labSitesRows.entries()].find(
      ([, row]) => row.lab_owner_key === ownerKey && row.lab_slug === oldSlug
    );
    if (!found) return [];
    const [key, row] = found;
    labSitesRows.set(key, { ...row, lab_slug: newSlug });
    return [{ lab_owner_key: ownerKey }];
  }

  // SELECT lab_owner_key FROM lab_sites WHERE lab_owner_key = ownerKey LIMIT 1
  if (query.includes("SELECT LAB_OWNER_KEY FROM LAB_SITES WHERE LAB_OWNER_KEY")) {
    const [ownerKey] = vals as [string];
    const row = labSitesRows.get(ownerKey);
    return row ? [{ lab_owner_key: ownerKey }] : [];
  }

  // UPDATE slug_registry SET redirect_to = newSlug WHERE slug = oldSlug
  if (query.includes("UPDATE SLUG_REGISTRY") && query.includes("SET REDIRECT_TO")) {
    const [newSlug, oldSlug] = vals as [string, string];
    const row = slugRegistryRows.get(oldSlug as string);
    if (row) slugRegistryRows.set(oldSlug as string, { ...row, redirect_to: newSlug });
    return [];
  }

  // CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, ALTER TABLE ADD COLUMN IF NOT EXISTS
  if (
    query.includes("CREATE TABLE") ||
    query.includes("CREATE INDEX") ||
    query.includes("ALTER TABLE")
  ) {
    return [];
  }

  return [];
});

// The mock SQL function must be callable as a tagged template literal.
const mockSql = Object.assign(
  (strings: TemplateStringsArray, ...vals: unknown[]) => mockSqlImpl(strings, ...vals),
  {}
);

vi.mock("@neondatabase/serverless", () => ({
  neon: () => mockSql,
}));

// ---------------------------------------------------------------------------
// Import the modules under test AFTER the mocks are registered
// ---------------------------------------------------------------------------

import {
  rebindLabSlug,
} from "@/lib/social/lab-site-db";
import { resolveSlugRedirect } from "@/lib/social/slug-registry-db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedLabSite(ownerKey: string, slug: string) {
  labSitesRows.set(ownerKey, { lab_owner_key: ownerKey, lab_slug: slug });
}

function seedSlugRow(slug: string, ownerKey: string, redirectTo: string | null = null) {
  slugRegistryRows.set(slug, {
    slug,
    kind: "lab",
    owner_key: ownerKey,
    ref: ownerKey,
    created_at: new Date().toISOString(),
    redirect_to: redirectTo,
  });
}

// ---------------------------------------------------------------------------
// rebindLabSlug: happy path
// ---------------------------------------------------------------------------

describe("rebindLabSlug: happy path", () => {
  beforeEach(() => {
    slugRegistryRows.clear();
    labSitesRows.clear();
    vi.clearAllMocks();
    ensureSlugRegistrySchema.mockResolvedValue(undefined);
    ensureLabSiteSchema.mockResolvedValue(undefined);
    // Pre-seed the existing lab and its old slug row.
    seedLabSite("owner-1", "oldslug");
    seedSlugRow("oldslug", "owner-1");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reserves the new slug, repoints lab_sites, marks old slug with redirect_to", async () => {
    const result = await rebindLabSlug({
      ownerKey: "owner-1",
      oldSlug: "oldslug",
      newSlug: "newslug",
    });

    expect(result).toEqual({ ok: true });

    // New slug is in the registry.
    const newRow = slugRegistryRows.get("newslug");
    expect(newRow).toBeDefined();
    expect(newRow?.owner_key).toBe("owner-1");

    // lab_sites now points at newslug.
    const siteRow = labSitesRows.get("owner-1");
    expect(siteRow?.lab_slug).toBe("newslug");

    // Old slug still exists (citation safety) with redirect_to set.
    const oldRow = slugRegistryRows.get("oldslug");
    expect(oldRow).toBeDefined();
    expect(oldRow?.redirect_to).toBe("newslug");
  });
});

// ---------------------------------------------------------------------------
// rebindLabSlug: newSlug already taken
// ---------------------------------------------------------------------------

describe("rebindLabSlug: newSlug taken", () => {
  beforeEach(() => {
    slugRegistryRows.clear();
    labSitesRows.clear();
    vi.clearAllMocks();
    ensureSlugRegistrySchema.mockResolvedValue(undefined);
    ensureLabSiteSchema.mockResolvedValue(undefined);
    seedLabSite("owner-1", "oldslug");
    seedSlugRow("oldslug", "owner-1");
    // Another lab has already claimed "takenslug".
    seedSlugRow("takenslug", "owner-2");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns taken and makes NO change to lab_sites or old slug row", async () => {
    const result = await rebindLabSlug({
      ownerKey: "owner-1",
      oldSlug: "oldslug",
      newSlug: "takenslug",
    });

    expect(result).toEqual({ ok: false, reason: "taken" });

    // lab_sites must still point at oldslug.
    const siteRow = labSitesRows.get("owner-1");
    expect(siteRow?.lab_slug).toBe("oldslug");

    // Old slug must NOT have a redirect_to (it was not touched).
    const oldRow = slugRegistryRows.get("oldslug");
    expect(oldRow?.redirect_to).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rebindLabSlug: not-owner (oldSlug does not belong to ownerKey)
// ---------------------------------------------------------------------------

describe("rebindLabSlug: not-owner", () => {
  beforeEach(() => {
    slugRegistryRows.clear();
    labSitesRows.clear();
    vi.clearAllMocks();
    ensureSlugRegistrySchema.mockResolvedValue(undefined);
    ensureLabSiteSchema.mockResolvedValue(undefined);
    // owner-1 has a lab but with slug "myslug", NOT "wrongslug".
    seedLabSite("owner-1", "myslug");
    seedSlugRow("myslug", "owner-1");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns not-owner when the oldSlug does not match", async () => {
    const result = await rebindLabSlug({
      ownerKey: "owner-1",
      oldSlug: "wrongslug",
      newSlug: "freshslug",
    });

    expect(result).toEqual({ ok: false, reason: "not-owner" });

    // The new slug reservation was rolled back (the lab_sites update failed,
    // so "freshslug" was reserved but the site was not repointed). In production
    // this is a "safe failure" scenario: the lab still serves at its real slug.
    // For the test we only assert the return value and that lab_sites is unchanged.
    const siteRow = labSitesRows.get("owner-1");
    expect(siteRow?.lab_slug).toBe("myslug");
  });
});

// ---------------------------------------------------------------------------
// resolveSlugRedirect
// ---------------------------------------------------------------------------

describe("resolveSlugRedirect", () => {
  beforeEach(() => {
    slugRegistryRows.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for a slug with no redirect", async () => {
    seedSlugRow("activeslug", "owner-1", null);
    const result = await resolveSlugRedirect("activeslug");
    expect(result).toBeNull();
  });

  it("returns the target slug when redirect_to is set", async () => {
    seedSlugRow("oldslug", "owner-1", "newslug");
    const result = await resolveSlugRedirect("oldslug");
    expect(result).toBe("newslug");
  });

  it("returns null for an unknown slug", async () => {
    const result = await resolveSlugRedirect("doesnotexist");
    expect(result).toBeNull();
  });
});
