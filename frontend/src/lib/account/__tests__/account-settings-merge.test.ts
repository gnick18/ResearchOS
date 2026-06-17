// Account-over-folder merge, PI resolution, and lift idempotency (pure logic).

import { describe, it, expect } from "vitest";
import type { CalendarFeed } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/settings/user-settings";
import type { AccountScopedSettings } from "../account-settings-crypto";
import {
  accountBlobsEqual,
  folderHasLiftableSettings,
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

// ---------------------------------------------------------------------------
// Phase 2: broadened account-wide preference merge + lift, and the popup-trigger
// condition (folderHasLiftableSettings).
// ---------------------------------------------------------------------------

describe("mergeAccountOverFolder (Phase 2 preferences)", () => {
  it("ELEVATES appearance + formatting preferences when the account carries them", () => {
    const merged = mergeAccountOverFolder(folder("member"), {
      animationType: "none",
      beakerBotAnimations: false,
      coloredHeader: false,
      dateFormat: "YMD",
      timeFormat: "24h",
      professionalMode: true,
      displayName: "Dr. Owen",
    });
    expect(merged.animationType).toBe("none");
    expect(merged.beakerBotAnimations).toBe(false);
    expect(merged.coloredHeader).toBe(false);
    expect(merged.dateFormat).toBe("YMD");
    expect(merged.timeFormat).toBe("24h");
    expect(merged.professionalMode).toBe(true);
    expect(merged.displayName).toBe("Dr. Owen");
  });

  it("leaves a folder preference intact when the account blob omits that field", () => {
    const f = { ...folder("member"), dateFormat: "DMY" as const };
    const merged = mergeAccountOverFolder(f, { timeFormat: "24h" });
    // dateFormat was not on the account blob, so the folder value survives.
    expect(merged.dateFormat).toBe("DMY");
    expect(merged.timeFormat).toBe("24h");
  });

  it("applies account NAV defaults only when the folder did NOT set its own", () => {
    const f = { ...folder("member"), defaultLandingTab: "/", visibleTabs: ["/"] };
    const account: AccountScopedSettings = {
      defaultLandingTab: "/calendar",
      visibleTabs: ["/", "/calendar", "/methods"],
    };
    // Folder is still at default for landing, but explicitly set visibleTabs.
    const merged = mergeAccountOverFolder(f, account, {
      defaultLandingTab: true,
      visibleTabs: false,
    });
    expect(merged.defaultLandingTab).toBe("/calendar"); // account default applied
    expect(merged.visibleTabs).toEqual(["/"]); // folder override wins
  });

  it("never lifts research data or the sharing graph (only preference fields are touched)", () => {
    const f = folder("member");
    const merged = mergeAccountOverFolder(f, { theme: "dark", labHead: true });
    // theme is not a UserSettings field; the merge must not invent one.
    expect("theme" in merged).toBe(false);
  });
});

describe("liftFolderIntoAccount (Phase 2 preferences)", () => {
  it("lifts the broadened preference set from a fresh account", () => {
    const next = liftFolderIntoAccount(null, [], "member", {
      theme: "dark",
      animationType: "rock",
      dateFormat: "MDY",
      displayName: "Owen",
      defaultLandingTab: "/calendar",
      visibleTabs: ["/", "/calendar"],
    });
    expect(next.theme).toBe("dark");
    expect(next.animationType).toBe("rock");
    expect(next.dateFormat).toBe("MDY");
    expect(next.displayName).toBe("Owen");
    expect(next.defaultLandingTab).toBe("/calendar");
    expect(next.visibleTabs).toEqual(["/", "/calendar"]);
  });

  it("is IDEMPOTENT for preferences: an existing account value is not overwritten", () => {
    const existing: AccountScopedSettings = { theme: "light", dateFormat: "DMY" };
    const next = liftFolderIntoAccount(existing, [], "member", {
      theme: "dark",
      dateFormat: "YMD",
      timeFormat: "24h",
    });
    // Existing account choices win; only the new (timeFormat) field is seeded.
    expect(next.theme).toBe("light");
    expect(next.dateFormat).toBe("DMY");
    expect(next.timeFormat).toBe("24h");
  });

  it("structurally copies lifted arrays so a later folder mutation cannot reach the blob", () => {
    const tabs = ["/", "/calendar"];
    const next = liftFolderIntoAccount(null, [], "member", { visibleTabs: tabs });
    tabs.push("/methods");
    expect(next.visibleTabs).toEqual(["/", "/calendar"]);
  });
});

describe("folderHasLiftableSettings (the popup trigger)", () => {
  it("is TRUE when the folder has feeds the empty account lacks (the Owen case)", () => {
    expect(folderHasLiftableSettings(null, [icsFeed(1)], "member", {})).toBe(true);
  });

  it("is FALSE when the folder has ONLY a cosmetic preference (no feeds, not a lab head)", () => {
    // A fresh/near-empty folder still carries default prefs in settings.json.
    // Prefs alone must NOT trigger the popup (the Owen misfire), they only ride
    // along when the popup fires for a substantive reason.
    expect(
      folderHasLiftableSettings(null, [], "member", { theme: "dark" }),
    ).toBe(false);
  });

  it("is TRUE when the folder marks a lab head the account has not recorded", () => {
    expect(folderHasLiftableSettings(null, [], "lab_head", {})).toBe(true);
  });

  it("is FALSE for a lab head once the account already records the capability", () => {
    expect(
      folderHasLiftableSettings({ labHead: true }, [], "lab_head", {}),
    ).toBe(false);
  });

  it("is FALSE when the account already has everything the folder offers", () => {
    const account: AccountScopedSettings = {
      calendarFeeds: [
        {
          id: 1,
          provider: "google",
          label: "feed 1",
          icsUrl: "https://example.com/1.ics",
          color: "#3b82f6",
          enabled: true,
        },
      ],
      theme: "dark",
    };
    expect(
      folderHasLiftableSettings(account, [icsFeed(1)], "member", {
        theme: "light",
      }),
    ).toBe(false);
  });

  it("is FALSE when the folder has nothing liftable and the account is empty", () => {
    expect(folderHasLiftableSettings(null, [], "member", {})).toBe(false);
  });
});
