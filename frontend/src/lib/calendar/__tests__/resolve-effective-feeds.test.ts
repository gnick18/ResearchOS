// Account-over-folder calendar feed resolution (the Owen case): account feeds
// follow the user across folders and take precedence; folder-only feeds still
// show; flag-off / no-account passes the folder list through unchanged.

import { describe, it, expect } from "vitest";
import type { CalendarFeed } from "@/lib/types";
import {
  type AccountFeedRecord,
  resolveEffectiveFeeds,
} from "../external-feeds-store";

function folderFeed(id: number, url: string): CalendarFeed {
  return {
    id,
    provider: "google",
    kind: "ics",
    label: `folder ${id}`,
    icsUrl: url,
    color: "#10b981",
    enabled: true,
    lastSyncAt: null,
  };
}

function accountFeed(id: number, url: string): AccountFeedRecord {
  return {
    id,
    provider: "google",
    label: `account ${id}`,
    icsUrl: url,
    color: "#3b82f6",
    enabled: true,
  };
}

describe("resolveEffectiveFeeds", () => {
  it("returns the folder feeds unchanged when the account has no feeds (flag-off parity)", () => {
    const folder = [folderFeed(1, "https://a.ics")];
    expect(resolveEffectiveFeeds(folder, null)).toBe(folder);
    expect(resolveEffectiveFeeds(folder, [])).toBe(folder);
    expect(resolveEffectiveFeeds(folder, undefined)).toBe(folder);
  });

  it("uses the account feeds (the Owen case): they FOLLOW the user to a new folder", () => {
    // A brand-new folder has no feeds, but the account carries Owen's calendar.
    const effective = resolveEffectiveFeeds([], [accountFeed(7, "https://owen.ics")]);
    expect(effective).toHaveLength(1);
    expect(effective[0].icsUrl).toBe("https://owen.ics");
    expect(effective[0].kind).toBe("ics");
  });

  it("account feeds WIN on a URL collision, folder-only feeds are appended", () => {
    const folder = [
      folderFeed(1, "https://shared.ics"), // collides with account
      folderFeed(2, "https://folder-only.ics"), // unique to this folder
    ];
    const account = [accountFeed(9, "https://shared.ics")];
    const effective = resolveEffectiveFeeds(folder, account);
    // The shared URL appears once (the account record), plus the folder-only one.
    expect(effective.map((f) => f.icsUrl).sort()).toEqual([
      "https://folder-only.ics",
      "https://shared.ics",
    ]);
    const shared = effective.find((f) => f.icsUrl === "https://shared.ics");
    expect(shared?.label).toBe("account 9"); // account record won
  });
});
