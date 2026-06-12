// Check-ins Phase 3b (checkins-phase3b bot, 2026-06-12). See
// docs/proposals/checkins-revamp.md "Part 3, the academic layer".
//
// Coverage of the templates catalog, the mentoring compact, and the onboarding
// checklist against an in-memory file system (the one-on-one.test harness).
// Two users: pi (lab_head, the space owner) and student (the counterpart).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { canRead, type Viewer } from "../sharing/unified";

const memFs = new Map<string, unknown>();
let currentUserMock = "pi";
let discoverableUsersMock = ["pi", "student", "other"];

vi.mock("../file-system/file-service", () => ({
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
        if (rest.includes("/")) continue;
        names.add(rest);
      }
      return Array.from(names);
    }),
    listDirectories: vi.fn(async () => []),
    deleteFile: vi.fn(async (path: string) => memFs.delete(path)),
    isConnected: vi.fn(() => true),
  },
}));

vi.mock("../file-system/indexeddb-store", () => ({
  getCurrentUser: vi.fn(async () => currentUserMock),
}));

vi.mock("../file-system/user-discovery", () => ({
  discoverUsers: vi.fn(async () => discoverableUsersMock),
}));

// Imports must come after the mocks.
import {
  oneOnOnesApi,
  checkinCompactsApi,
  checkinOnboardingApi,
} from "../local-api";
import { clearCurrentUserCache } from "../storage/json-store";
import {
  CHECKIN_TEMPLATES,
  getCheckinTemplate,
  templateCadence,
} from "./templates";

function setCurrentUser(name: string) {
  currentUserMock = name;
  clearCurrentUserCache();
}

function setSettings(username: string, accountType: "member" | "lab_head") {
  memFs.set(`users/${username}/settings.json`, { account_type: accountType });
}

const viewer = (username: string, lab_head = false): Viewer => ({
  username,
  account_type: lab_head ? "lab_head" : "lab",
});

beforeEach(() => {
  memFs.clear();
  discoverableUsersMock = ["pi", "student", "other"];
  setSettings("pi", "lab_head");
  setSettings("student", "member");
  setSettings("other", "member");
  setCurrentUser("pi");
});

// ── Templates catalog ─────────────────────────────────────────────────────────

describe("checkin templates catalog", () => {
  it("ships the six approved seed templates in gallery order", () => {
    expect(CHECKIN_TEMPLATES.map((t) => t.id)).toEqual([
      "undergrad",
      "grad",
      "postdoc",
      "staff",
      "thesis-committee",
      "onboarding",
    ]);
  });

  it("every template has a name, description, kind, cadence, and agenda seeds", () => {
    for (const t of CHECKIN_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(["pair", "group"]).toContain(t.kind);
      expect(["week", "2weeks", "month"]).toContain(t.suggested_cadence);
      expect(t.agenda_seeds.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("getCheckinTemplate resolves by id and templateCadence maps the hint", () => {
    const grad = getCheckinTemplate("grad");
    expect(grad?.suggested_cadence).toBe("week");
    expect(templateCadence(grad!)).toEqual({ every: "week" });
    expect(getCheckinTemplate("nope")).toBeUndefined();
  });

  it("the template picker seeds agenda items as undone, unassigned action items", async () => {
    // Mirrors what the dialog does: create the space with the template cadence,
    // then add one agenda item per seed.
    const tpl = getCheckinTemplate("grad")!;
    const space = await oneOnOnesApi.create({
      members: ["pi", "student"],
      mentor: "pi",
      cadence: templateCadence(tpl),
    });
    expect(space.cadence).toEqual({ every: "week" });

    for (const seed of tpl.agenda_seeds) {
      await oneOnOnesApi.addActionItem({ oneOnOneId: space.id, text: seed });
    }

    const items = await oneOnOnesApi.list().then(() => null); // touch list (no-op)
    void items;
    // Read the action items back from the owner's folder.
    const dir = `users/pi/one_on_one_action_items`;
    const seeded = Array.from(memFs.entries())
      .filter(([k]) => k.startsWith(`${dir}/`))
      .map(([, v]) => v as { text: string; is_done: boolean; assignee?: string | null });
    expect(seeded.map((s) => s.text).sort()).toEqual(
      [...tpl.agenda_seeds].sort(),
    );
    for (const s of seeded) {
      expect(s.is_done).toBe(false);
      expect(s.assignee ?? null).toBeNull();
    }
  });
});

// ── Mentoring compact ─────────────────────────────────────────────────────────

describe("checkinCompactsApi", () => {
  async function freshSpace() {
    setCurrentUser("pi");
    return oneOnOnesApi.create({ members: ["pi", "student"], mentor: "pi" });
  }

  it("seeds the standard rows, owns to the space owner, shares with both at edit", async () => {
    const space = await freshSpace();
    const compact = await checkinCompactsApi.createForSpace(space.id);

    expect(compact.space_id).toBe(space.id);
    expect(compact.owner).toBe("pi");
    expect(compact.rows.length).toBeGreaterThanOrEqual(4);
    expect(compact.rows.every((r) => r.value === "")).toBe(true);
    expect(compact.acknowledged).toEqual([]);
    expect(compact.shared_with).toEqual([
      { username: "pi", level: "edit" },
      { username: "student", level: "edit" },
    ]);
    // Both members read it; an outsider cannot.
    expect(canRead(compact, viewer("pi", true))).toBe(true);
    expect(canRead(compact, viewer("student"))).toBe(true);
    expect(canRead(compact, viewer("other"))).toBe(false);

    // Lives in the owner's folder.
    expect(memFs.get(`users/pi/checkin_compacts/${compact.id}.json`)).toBeTruthy();
  });

  it("createForSpace is idempotent (no second compact for the same space)", async () => {
    const space = await freshSpace();
    const a = await checkinCompactsApi.createForSpace(space.id);
    const b = await checkinCompactsApi.createForSpace(space.id);
    expect(b.id).toBe(a.id);
    const fetched = await checkinCompactsApi.getForSpace(space.id);
    expect(fetched?.id).toBe(a.id);
  });

  it("acknowledge appends the current user once (idempotent) and reaches both", async () => {
    const space = await freshSpace();
    const compact = await checkinCompactsApi.createForSpace(space.id);

    // pi acknowledges, twice -> a single entry.
    setCurrentUser("pi");
    await checkinCompactsApi.acknowledge(compact.id, "pi");
    const afterPi = await checkinCompactsApi.acknowledge(compact.id, "pi");
    expect(afterPi?.acknowledged.map((a) => a.username)).toEqual(["pi"]);

    // student acknowledges -> both acknowledged.
    setCurrentUser("student");
    const afterStudent = await checkinCompactsApi.acknowledge(compact.id, "pi");
    expect(afterStudent?.acknowledged.map((a) => a.username).sort()).toEqual([
      "pi",
      "student",
    ]);
  });

  it("editing the rows clears prior acknowledgements (re-agree the revision)", async () => {
    const space = await freshSpace();
    const compact = await checkinCompactsApi.createForSpace(space.id);
    await checkinCompactsApi.acknowledge(compact.id, "pi");

    const newRows = compact.rows.map((r, i) =>
      i === 0 ? { ...r, value: "Core 10 to 4." } : r,
    );
    const updated = await checkinCompactsApi.updateRows(
      compact.id,
      newRows,
      "pi",
    );
    expect(updated?.rows[0].value).toBe("Core 10 to 4.");
    expect(updated?.acknowledged).toEqual([]);
  });
});

// ── Onboarding checklist ──────────────────────────────────────────────────────

describe("checkinOnboardingApi", () => {
  async function freshSpace() {
    setCurrentUser("pi");
    return oneOnOnesApi.create({ members: ["pi", "student"], mentor: "pi" });
  }

  it("seeds the standard items, all undone, owner = space owner, shared at edit", async () => {
    const space = await freshSpace();
    const onb = await checkinOnboardingApi.createForSpace(space.id);

    expect(onb.space_id).toBe(space.id);
    expect(onb.owner).toBe("pi");
    expect(onb.items.length).toBeGreaterThanOrEqual(4);
    expect(onb.items.every((i) => i.done === false)).toBe(true);
    expect(onb.shared_with).toEqual([
      { username: "pi", level: "edit" },
      { username: "student", level: "edit" },
    ]);
    expect(canRead(onb, viewer("student"))).toBe(true);
    expect(canRead(onb, viewer("other"))).toBe(false);
  });

  it("createForSpace is idempotent", async () => {
    const space = await freshSpace();
    const a = await checkinOnboardingApi.createForSpace(space.id);
    const b = await checkinOnboardingApi.createForSpace(space.id);
    expect(b.id).toBe(a.id);
  });

  it("toggleItem flips done and stamps done_by/done_at, any member may", async () => {
    const space = await freshSpace();
    const onb = await checkinOnboardingApi.createForSpace(space.id);
    const first = onb.items[0];

    // student (a non-owner member) checks it off.
    setCurrentUser("student");
    const checked = await checkinOnboardingApi.toggleItem(
      onb.id,
      first.id,
      "pi",
    );
    const checkedItem = checked?.items.find((i) => i.id === first.id);
    expect(checkedItem?.done).toBe(true);
    expect(checkedItem?.done_by).toBe("student");
    expect(checkedItem?.done_at).toBeTypeOf("string");

    // toggling again clears it.
    const unchecked = await checkinOnboardingApi.toggleItem(
      onb.id,
      first.id,
      "pi",
    );
    const uncheckedItem = unchecked?.items.find((i) => i.id === first.id);
    expect(uncheckedItem?.done).toBe(false);
    expect(uncheckedItem?.done_by).toBeNull();
    expect(uncheckedItem?.done_at).toBeNull();
  });
});
