// Multi-lab P3: materializeLabRoster unit tests.
//
// Covers:
//   - presence scaffold + settings.json (display + PI badge) written for every
//     co-member from the relay roster, display name sourced from the directory
//     profile.
//   - colors materialized into _user_metadata.json for co-members, with NO
//     overwrite of an existing local color entry (residency: the viewer's own
//     color, and any cached co-member color, is preserved).
//   - the VIEWER's own settings.json + own color entry are NEVER written.
//   - head role -> account_type "lab_head" (PI badge), member -> "member".
//   - a member with no published profile leaves displayName null (consumer falls
//     back to the username).
//
// All effects are injected; no real OPFS or directory network is touched.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";
import {
  materializeLabRoster,
  _roleToAccountTypeForTest,
  type RosterFileIO,
  type ProfileFetcher,
} from "../lab-roster-materialize";
import type { LabMember, LabRecord } from "../lab-membership";
import type { PublishedProfile } from "../../sharing/profile";

// A throwaway but VALID-length ed25519 pubkey hex (32 bytes) so fingerprint
// derivation does not throw. The exact value is irrelevant to these tests; the
// profile fetcher is injected and keyed on whatever fingerprint we compute.
function pubkey(seed: number): string {
  return Array.from({ length: 32 }, (_, i) =>
    ((seed + i) % 256).toString(16).padStart(2, "0"),
  ).join("");
}

function member(
  username: string,
  role: LabMember["role"],
  seed: number,
): LabMember {
  return {
    username,
    x25519PublicKey: pubkey(seed + 100),
    ed25519PublicKey: pubkey(seed),
    role,
  };
}

function recordWith(head: LabMember, members: LabMember[]): LabRecord {
  return {
    labId: "lab1",
    head,
    members,
    keyGeneration: 1,
    log: [],
  };
}

function fakeIO(seed?: Record<string, unknown>): {
  io: RosterFileIO;
  writes: Array<{ path: string; text: string }>;
  dirs: string[];
} {
  const store = new Map<string, unknown>(Object.entries(seed ?? {}));
  const writes: Array<{ path: string; text: string }> = [];
  const dirs: string[] = [];
  const io: RosterFileIO = {
    ensureDir: vi.fn(async (path: string) => {
      dirs.push(path);
    }),
    writeText: vi.fn(async (path: string, text: string) => {
      writes.push({ path, text });
      // Reflect writes back into the store so a read-modify-write within one run
      // (the _user_metadata.json single-write) is consistent.
      try {
        store.set(path, JSON.parse(text));
      } catch {
        store.set(path, text);
      }
    }),
    readJson: (async (path: string) => {
      return store.has(path) ? store.get(path) : null;
    }) as RosterFileIO["readJson"],
  };
  return { io, writes, dirs };
}

function profile(displayName: string): PublishedProfile {
  return {
    displayName,
    affiliation: null,
    orcid: null,
    pinnedWorks: [],
    hiddenWorks: [],
    fingerprint: "x",
    affiliationDomain: null,
  };
}

describe("materializeLabRoster — role -> account_type", () => {
  it("maps head to lab_head (PI badge) and member to member", () => {
    expect(_roleToAccountTypeForTest("head")).toBe("lab_head");
    expect(_roleToAccountTypeForTest("member")).toBe("member");
  });
});

describe("materializeLabRoster — co-member identity", () => {
  it("writes presence + settings (display + PI badge) for every co-member", async () => {
    const head = member("pi", "head", 1);
    const m1 = member("alex", "member", 2);
    const m2 = member("sam", "member", 3);
    const { io, writes, dirs } = fakeIO();

    // The viewer is alex; pi + sam are co-members.
    const fetchProfile: ProfileFetcher = vi.fn(async () => profile("Dr. PI"));
    const result = await materializeLabRoster(
      recordWith(head, [head, m1, m2]),
      "alex",
      { fileIO: io, fetchProfile },
    );

    // Presence scaffold for the two co-members, NOT the viewer.
    expect(dirs).toContain("users/pi");
    expect(dirs).toContain("users/sam");
    expect(dirs).not.toContain("users/alex");
    expect(result.presenceWritten.sort()).toEqual(["pi", "sam"]);

    // settings.json for the head carries account_type lab_head (PI badge) and the
    // directory display name.
    const piSettings = writes.find((w) => w.path === "users/pi/settings.json");
    expect(piSettings).toBeTruthy();
    const piParsed = JSON.parse(piSettings!.text);
    expect(piParsed.account_type).toBe("lab_head");
    expect(piParsed.displayName).toBe("Dr. PI");

    const samSettings = writes.find((w) => w.path === "users/sam/settings.json");
    expect(JSON.parse(samSettings!.text).account_type).toBe("member");

    // The viewer's own settings.json is NEVER written.
    expect(writes.find((w) => w.path === "users/alex/settings.json")).toBeUndefined();
  });

  it("leaves displayName null when a member has no published profile", async () => {
    const head = member("pi", "head", 1);
    const m1 = member("alex", "member", 2);
    const { io, writes } = fakeIO();
    const fetchProfile: ProfileFetcher = vi.fn(async () => null);

    await materializeLabRoster(recordWith(head, [head, m1]), "alex", {
      fileIO: io,
      fetchProfile,
    });

    const piSettings = writes.find((w) => w.path === "users/pi/settings.json");
    expect(JSON.parse(piSettings!.text).displayName).toBeNull();
  });
});

describe("materializeLabRoster — colors / residency", () => {
  it("adds a color for each co-member but never overwrites an existing entry", async () => {
    const head = member("pi", "head", 1);
    const alex = member("alex", "member", 2);
    const sam = member("sam", "member", 3);

    // Seed: the viewer (alex) already has a CHOSEN color, and pi has a cached one.
    const seed = {
      "users/_user_metadata.json": {
        users: {
          alex: { color: "#123456", created_at: "old" },
          pi: { color: "#abcdef", created_at: "old" },
        },
      },
    };
    const { io, writes } = fakeIO(seed);
    const fetchProfile: ProfileFetcher = vi.fn(async () => profile("X"));

    const result = await materializeLabRoster(
      recordWith(head, [head, alex, sam]),
      "alex",
      { fileIO: io, fetchProfile },
    );

    // Only sam was missing a color, so only sam is added.
    expect(result.metadataAdded).toEqual(["sam"]);

    const metaWrite = writes.find(
      (w) => w.path === "users/_user_metadata.json",
    );
    const meta = JSON.parse(metaWrite!.text);
    // Existing colors preserved verbatim (viewer's own + pi's cached).
    expect(meta.users.alex.color).toBe("#123456");
    expect(meta.users.pi.color).toBe("#abcdef");
    // sam got a fresh palette color.
    expect(typeof meta.users.sam.color).toBe("string");
    expect(meta.users.sam.color.startsWith("#")).toBe(true);
  });

  it("does not write the metadata file at all when every member already has a color", async () => {
    const head = member("pi", "head", 1);
    const alex = member("alex", "member", 2);
    const seed = {
      "users/_user_metadata.json": {
        users: {
          alex: { color: "#111111", created_at: "old" },
          pi: { color: "#222222", created_at: "old" },
        },
      },
    };
    const { io, writes } = fakeIO(seed);
    const fetchProfile: ProfileFetcher = vi.fn(async () => profile("X"));

    const result = await materializeLabRoster(
      recordWith(head, [head, alex]),
      "alex",
      { fileIO: io, fetchProfile },
    );

    expect(result.metadataAdded).toEqual([]);
    expect(
      writes.find((w) => w.path === "users/_user_metadata.json"),
    ).toBeUndefined();
  });
});
