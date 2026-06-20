// Unit tests for releaseReservedSlug (unstage lane).
//
// Pins the SAFETY rules that keep a live lab's address from being freed:
//   - releases when the reservation is owned by the caller and unbound.
//   - refuses "bound" when a lab_sites row exists for the slug.
//   - refuses "bound" when the slug carries a rename redirect_to.
//   - refuses "not-owner" when the reservation belongs to another key.
//   - "not-found" when there is no reservation.
//
// No live Neon: @neondatabase/serverless is mocked, and lab-site-db is mocked so
// the lab_sites binding check is flipped per test (its getSiteBySlug is loaded via
// a dynamic import inside releaseReservedSlug).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { beforeEach, describe, expect, it, vi } from "vitest";

let nextRows: unknown[] = [];
const queryFn = vi.fn(async () => nextRows);

vi.mock("@neondatabase/serverless", () => ({
  neon: () => queryFn,
}));

// The lab_sites binding check (dynamic import inside releaseReservedSlug).
let siteResult: unknown = null;
vi.mock("@/lib/social/lab-site-db", () => ({
  getSiteBySlug: async () => siteResult,
}));

process.env.DATABASE_URL = "postgres://test";

const { releaseReservedSlug } = await import("../slug-registry-db");

beforeEach(() => {
  nextRows = [];
  siteResult = null;
  queryFn.mockClear();
});

describe("releaseReservedSlug", () => {
  it("releases an owned, unbound reservation", async () => {
    nextRows = [{ owner_key: "me", redirect_to: null }];
    siteResult = null;
    const r = await releaseReservedSlug("test-slug", "me");
    expect(r).toEqual({ ok: true });
  });

  it("refuses not-found when there is no reservation", async () => {
    nextRows = [];
    const r = await releaseReservedSlug("ghost-slug", "me");
    expect(r).toEqual({ ok: false, reason: "not-found" });
  });

  it("refuses not-owner when another key owns the reservation", async () => {
    nextRows = [{ owner_key: "someone-else", redirect_to: null }];
    const r = await releaseReservedSlug("test-slug", "me");
    expect(r).toEqual({ ok: false, reason: "not-owner" });
  });

  it("refuses bound when the slug carries a rename redirect", async () => {
    nextRows = [{ owner_key: "me", redirect_to: "new-slug" }];
    const r = await releaseReservedSlug("old-slug", "me");
    expect(r).toEqual({ ok: false, reason: "bound" });
  });

  it("refuses bound when a lab_sites row exists for the slug", async () => {
    nextRows = [{ owner_key: "me", redirect_to: null }];
    siteResult = { slug: "test-slug", ownerKey: "me" };
    const r = await releaseReservedSlug("test-slug", "me");
    expect(r).toEqual({ ok: false, reason: "bound" });
  });

  it("is a no-op not-found for empty inputs", async () => {
    expect(await releaseReservedSlug("", "me")).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await releaseReservedSlug("slug", "")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});
