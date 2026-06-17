// Account-over-folder merge, PI resolution, and lift idempotency (pure logic).

import { describe, it, expect } from "vitest";
import type { CalendarFeed } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/settings/user-settings";
import type { AccountScopedSettings } from "../account-settings-crypto";
import {
  accountBlobsEqual,
  liftFolderIntoAccount,
  mergeAccountOverFolder,
  resolveIsLabHead,
} from "../account-settings";

function folder(accountType: "member" | "lab_head") {
  return { ...DEFAULT_SETTINGS, account_type: accountType };
}

function icsFeed(id: number, overrides: Partial<CalendarFeed> = {}): CalendarFeed {
  return {
    id,
    provider: "google",
    kind: "ics",
    label: `feed ${id}`,
    icsUrl: `https://example.com/${id}.ics`,
    color: "#3b82f6",
    enabled: true,
    lastSyncAt: null,
    ...overrides,
  };
}

describe("mergeAccountOverFolder", () => {
  it("returns the folder settings unchanged when there is no account blob", () => {
    const f = folder("member");
    expect(mergeAccountOverFolder(f, null)).toBe(f);
  });

  it("ELEVATES a member folder to lab_head when the account capability says so", () => {
    const merged = mergeAccountOverFolder(folder("member"), { labHead: true });
    expect(merged.account_type).toBe("lab_head");
  });

  it("does not demote a folder lab_head when the account flag is absent/false", () => {
    expect(mergeAccountOverFolder(folder("lab_head"), {}).account_type).toBe(
      "lab_head",
    );
    expect(
      mergeAccountOverFolder(folder("lab_head"), { labHead: false }).account_type,
    ).toBe("lab_head");
  });

  it("leaves a member folder a member when the account flag is unset", () => {
    expect(mergeAccountOverFolder(folder("member"), {}).account_type).toBe(
      "member",
    );
  });

  it("never mutates the inputs", () => {
    const f = folder("member");
    const a: AccountScopedSettings = { labHead: true };
    mergeAccountOverFolder(f, a);
    expect(f.account_type).toBe("member");
    expect(a).toEqual({ labHead: true });
  });
});

describe("resolveIsLabHead", () => {
  it("is true when the folder marks lab_head", () => {
    expect(resolveIsLabHead("lab_head", undefined)).toBe(true);
  });

  it("is true when the account capability is set, even with no folder marker", () => {
    // This is the Owen case: a new empty folder lacks the marker.
    expect(resolveIsLabHead(undefined, true)).toBe(true);
    expect(resolveIsLabHead("member", true)).toBe(true);
  });

  it("is false when neither says lab head", () => {
    expect(resolveIsLabHead("member", false)).toBe(false);
    expect(resolveIsLabHead(undefined, undefined)).toBe(false);
  });
});

describe("liftFolderIntoAccount", () => {
  it("seeds calendar feeds and the lab-head capability from a fresh (null) account", () => {
    const next = liftFolderIntoAccount(null, [icsFeed(1), icsFeed(2)], "lab_head");
    expect(next.labHead).toBe(true);
    expect(next.calendarFeeds).toHaveLength(2);
    expect(next.calendarFeeds?.[0]).toMatchObject({
      id: 1,
      icsUrl: "https://example.com/1.ics",
      enabled: true,
    });
  });

  it("only lifts ICS feeds with a URL", () => {
    const next = liftFolderIntoAccount(
      null,
      [icsFeed(1), icsFeed(2, { icsUrl: null })],
      "member",
    );
    expect(next.calendarFeeds).toHaveLength(1);
    expect(next.calendarFeeds?.[0].id).toBe(1);
  });

  it("is IDEMPOTENT: a second lift over an existing account does not overwrite feeds", () => {
    const first = liftFolderIntoAccount(null, [icsFeed(1)], "member");
    const second = liftFolderIntoAccount(first, [icsFeed(2), icsFeed(3)], "member");
    // The account's existing single feed wins; the folder's new feeds are NOT
    // merged in (the account choice is authoritative once populated).
    expect(second.calendarFeeds).toHaveLength(1);
    expect(second.calendarFeeds?.[0].id).toBe(1);
  });

  it("treats an existing EMPTY feed array as a deliberate choice and does not re-seed", () => {
    const existing: AccountScopedSettings = { calendarFeeds: [] };
    const next = liftFolderIntoAccount(existing, [icsFeed(9)], "member");
    expect(next.calendarFeeds).toEqual([]);
  });

  it("does NOT lock the account into an empty list when the folder had no feeds", () => {
    // A folder with no feeds must not set calendarFeeds, so a later folder with
    // feeds can still seed it.
    const next = liftFolderIntoAccount(null, [], "member");
    expect(next.calendarFeeds).toBeUndefined();
  });

  it("seeds the lab-head capability when the folder marks lab_head", () => {
    expect(liftFolderIntoAccount(null, [], "lab_head").labHead).toBe(true);
  });

  it("never DOWNGRADES an existing account lab_head from a folder without the marker (the Owen guard)", () => {
    const existing: AccountScopedSettings = { labHead: true };
    const next = liftFolderIntoAccount(existing, [], "member");
    expect(next.labHead).toBe(true);
  });

  it("leaves labHead unset when neither the account nor the folder marks it", () => {
    expect(liftFolderIntoAccount(null, [], "member").labHead).toBeUndefined();
  });
});

describe("accountBlobsEqual", () => {
  it("treats null and {} as equal (no redundant write)", () => {
    expect(accountBlobsEqual(null, {})).toBe(true);
  });

  it("detects a real change", () => {
    expect(accountBlobsEqual({ labHead: true }, { labHead: false })).toBe(false);
    expect(accountBlobsEqual(null, { labHead: true })).toBe(false);
  });
});
