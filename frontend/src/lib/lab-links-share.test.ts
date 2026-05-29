// frontend/src/lib/lab-links-share.test.ts
//
// Lab-share restore (links lab-share restore bot, 2026-05-29). Tests the
// Links page lab-wide sharing model after it was lost during the Lab Mode
// retirement (2026-05-23): links moved to a per-user store with optional
// owner / shared_with fields, but the owner stamp + the lab-wide read
// aggregation were never rebuilt.
//
// Coverage:
//   1. `create` stamps `owner` = the current user.
//   2. `create` with the "Whole lab" toggle (whole_lab: true) sets
//      `shared_with` to the edit-level "*" sentinel; "Just me"
//      (whole_lab falsy) leaves it empty.
//   3. `update` flips the visibility toggle in lockstep (whole-lab <-> []),
//      and preserves the owner.
//   4. `list` AGGREGATES across the lab and the cross-user gate is the
//      unified `canRead`:
//        - the viewer's OWN links are always returned,
//        - another member's WHOLE-LAB link IS returned,
//        - another member's PRIVATE link is NOT returned (privacy),
//        - another member's link shared explicitly with the viewer IS
//          returned,
//        - a lab_head viewer sees another member's private link (implicit
//          view-all).

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { LabLink } from "./types";
import { WHOLE_LAB_SENTINEL } from "./sharing/unified";

const memFs = new Map<string, unknown>();
let currentUserMock = "alex";

// fileService backed by an in-memory map. `listFiles(dir)` derives the
// immediate `*.json` children of `dir` from the memFs keys so the
// JsonStore's listAllForUser walks the same records `create` wrote.
vi.mock("./file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
    ensureDir: vi.fn(async () => null),
    listFiles: vi.fn(async (dir: string) => {
      const prefix = `${dir}/`;
      const names = new Set<string>();
      for (const key of memFs.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (rest.includes("/")) continue; // immediate children only
        names.add(rest);
      }
      return Array.from(names);
    }),
    listDirectories: vi.fn(async () => []),
    deleteFile: vi.fn(async (path: string) => memFs.delete(path)),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("./file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => currentUserMock),
}));

vi.mock("./file-system/user-discovery", () => ({
  discoverUsers: vi.fn(async () => ["alex", "morgan", "mira"]),
}));

// Imports must come after the mocks.
import { labLinksApi } from "./local-api";
import { clearCurrentUserCache } from "./storage/json-store";

function setCurrentUser(name: string) {
  currentUserMock = name;
  clearCurrentUserCache();
}

/** Seed a link file directly into a member's namespace (bypasses the API). */
function seedLink(owner: string, link: Partial<LabLink> & { id: number }): LabLink {
  const full: LabLink = {
    title: `${owner} link ${link.id}`,
    url: "https://example.com",
    description: null,
    category: null,
    color: null,
    preview_image_url: null,
    sort_order: 0,
    created_at: "2026-05-29T00:00:00Z",
    owner,
    shared_with: [],
    ...link,
  };
  memFs.set(`users/${owner}/lab_links/${full.id}.json`, full);
  return full;
}

function setSettings(username: string, accountType: "member" | "lab_head") {
  memFs.set(`users/${username}/settings.json`, { account_type: accountType });
}

beforeEach(() => {
  memFs.clear();
  setCurrentUser("alex");
});

describe("labLinksApi.create — owner stamp + visibility toggle", () => {
  it("stamps owner = the current user", async () => {
    const created = await labLinksApi.create({
      title: "Protocols.io",
      url: "https://protocols.io",
    });
    expect(created.owner).toBe("alex");
    // Persisted file carries the owner too.
    const onDisk = memFs.get(
      `users/alex/lab_links/${created.id}.json`,
    ) as LabLink;
    expect(onDisk.owner).toBe("alex");
  });

  it('"Just me" (whole_lab omitted / false) leaves shared_with empty', async () => {
    const privateLink = await labLinksApi.create({
      title: "private",
      url: "https://x.test",
    });
    expect(privateLink.shared_with).toEqual([]);

    const explicitlyPrivate = await labLinksApi.create({
      title: "private2",
      url: "https://y.test",
      whole_lab: false,
    });
    expect(explicitlyPrivate.shared_with).toEqual([]);
  });

  it('"Whole lab" (whole_lab: true) sets the edit-level "*" sentinel', async () => {
    const shared = await labLinksApi.create({
      title: "shared",
      url: "https://z.test",
      whole_lab: true,
    });
    expect(shared.shared_with).toEqual([
      { username: WHOLE_LAB_SENTINEL, level: "edit", permission: "edit" },
    ]);
  });
});

describe("labLinksApi.update — visibility toggle + owner preservation", () => {
  it("flips a private link to whole-lab and back", async () => {
    const created = await labLinksApi.create({
      title: "toggle me",
      url: "https://t.test",
    });
    expect(created.shared_with).toEqual([]);

    const shared = await labLinksApi.update(created.id, { whole_lab: true });
    expect(shared?.shared_with).toEqual([
      { username: WHOLE_LAB_SENTINEL, level: "edit", permission: "edit" },
    ]);
    expect(shared?.owner).toBe("alex");

    const reprivatized = await labLinksApi.update(created.id, {
      whole_lab: false,
    });
    expect(reprivatized?.shared_with).toEqual([]);
    expect(reprivatized?.owner).toBe("alex");
  });

  it("leaves shared_with untouched when whole_lab is omitted", async () => {
    const created = await labLinksApi.create({
      title: "keep sharing",
      url: "https://k.test",
      whole_lab: true,
    });
    const renamed = await labLinksApi.update(created.id, { title: "renamed" });
    expect(renamed?.title).toBe("renamed");
    expect(renamed?.shared_with).toEqual([
      { username: WHOLE_LAB_SENTINEL, level: "edit", permission: "edit" },
    ]);
  });

  it("back-fills owner on a pre-stamp (legacy) link without reassigning a set owner", async () => {
    // Legacy link in alex's folder with NO owner field.
    seedLink("alex", { id: 99, owner: undefined as unknown as string });
    const updated = await labLinksApi.update(99, { title: "legacy" });
    expect(updated?.owner).toBe("alex");

    // A link that already has an owner is never reassigned, even if a
    // different user runs the update.
    seedLink("morgan", { id: 7, owner: "morgan" });
    setCurrentUser("alex");
    const morganLink = await labLinksApi.update(7, { title: "x" });
    // update() targets the CURRENT user's namespace, so this is a no-op
    // miss for alex — but the seeded morgan record keeps its owner.
    expect(morganLink).toBeNull();
    expect(
      (memFs.get("users/morgan/lab_links/7.json") as LabLink).owner,
    ).toBe("morgan");
  });
});

describe("labLinksApi.list — lab-wide aggregation gated by canRead", () => {
  it("returns the viewer's own links plus other members' whole-lab links, but NOT their private links", async () => {
    // alex (viewer, member) owns one link.
    seedLink("alex", { id: 1, title: "alex own", owner: "alex" });
    // morgan shares one whole-lab, keeps one private.
    seedLink("morgan", {
      id: 1,
      title: "morgan shared",
      owner: "morgan",
      shared_with: [{ username: WHOLE_LAB_SENTINEL, level: "edit" }],
    });
    seedLink("morgan", {
      id: 2,
      title: "morgan private",
      owner: "morgan",
      shared_with: [],
    });
    // mira shares explicitly with alex.
    seedLink("mira", {
      id: 1,
      title: "mira -> alex",
      owner: "mira",
      shared_with: [{ username: "alex", level: "read" }],
    });
    // mira also has a link shared only with morgan — alex must NOT see it.
    seedLink("mira", {
      id: 2,
      title: "mira -> morgan only",
      owner: "mira",
      shared_with: [{ username: "morgan", level: "edit" }],
    });
    setSettings("alex", "member");

    const links = await labLinksApi.list();
    const titles = links.map((l) => l.title).sort();
    expect(titles).toEqual(["alex own", "mira -> alex", "morgan shared"]);

    // Privacy assertions: the two records alex is not entitled to must be
    // absent.
    expect(titles).not.toContain("morgan private");
    expect(titles).not.toContain("mira -> morgan only");

    // Owner is carried through so the UI can badge shared-in cards.
    const shared = links.find((l) => l.title === "morgan shared");
    expect(shared?.owner).toBe("morgan");
  });

  it("a lab_head viewer sees other members' private links (implicit view-all)", async () => {
    seedLink("morgan", {
      id: 5,
      title: "morgan private",
      owner: "morgan",
      shared_with: [],
    });
    setCurrentUser("alex");
    setSettings("alex", "lab_head");

    const links = await labLinksApi.list();
    expect(links.map((l) => l.title)).toContain("morgan private");
  });

  it("a private link from another member is NEVER returned to a plain member viewer", async () => {
    seedLink("morgan", {
      id: 8,
      title: "secret",
      owner: "morgan",
      shared_with: [],
    });
    setCurrentUser("alex");
    setSettings("alex", "member");

    const links = await labLinksApi.list();
    expect(links.map((l) => l.title)).not.toContain("secret");
    // alex owns nothing here, so the list is empty.
    expect(links).toHaveLength(0);
  });
});
