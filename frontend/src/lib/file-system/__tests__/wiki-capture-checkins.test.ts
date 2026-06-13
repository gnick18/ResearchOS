/**
 * wiki-capture-checkins.test.ts
 *
 * End-to-end proof that the demo fixture seeds a fully populated Check-ins
 * org chart. This is the loader-wiring gate for the check-in surfaces: it
 * installs the REAL wiki-capture fixture (buildWikiFixtures -> in-memory
 * fileService) and then calls the SAME read APIs the check-in pages call,
 * asserting the seeded spaces, agenda items, group task board, rotation, IDPs,
 * compact, and onboarding checklists come back with the right shapes.
 *
 * If the fixture ever writes a wrong shape (a missing members array, a bad
 * shared_with, an IDP that leaks an unshared section or the values reflection,
 * a compact/onboarding/rotation the read APIs cannot find), this fails. That is
 * the point: it is the shape gate the fixture cannot be hand-verified without.
 *
 * No em-dashes, no emojis, no mid-sentence colons.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";

// The real wiki-capture fixture is installed (so the seeded check-in records
// come from buildWikiFixtures, not hand-built mocks). The ONLY thing we mock is
// `getCurrentUser`, because in node-test mode there is no demo-tab sessionStorage
// for `storeCurrentUser` to round-trip through, so the current-user-dependent
// read APIs would otherwise resolve to `_no_user_`. We drive a mutable variable
// and clear the json-store cache between switches (the same lever the app uses).
let currentUserMock = "alex";
vi.mock("@/lib/file-system/indexeddb-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/file-system/indexeddb-store")>();
  return {
    ...actual,
    getCurrentUser: vi.fn(async () => currentUserMock),
  };
});

// installWikiCaptureFixture fetches some demo PNGs / markdown over the network;
// stub fetch so those best-effort fetches resolve to 404 (the static fixtures we
// assert on are seeded synchronously from buildWikiFixtures, not fetched).
beforeAll(() => {
  if (typeof globalThis.fetch !== "function") {
    globalThis.fetch = (async () =>
      new Response(null, { status: 404 })) as typeof fetch;
  }
});

// The mira -> alex space (kept from the legacy fixture; weekly goals back-link
// to it). The compact is seeded on this space.
const MIRA_ALEX = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
// The new spaces added by the demo-checkins expansion.
const ALEX_SAM = "b8c9d0e1-f2a3-4b4c-9d5e-6f7081920a3c";
const ALEX_THEO = "c9d0e1f2-a3b4-4c5d-9e6f-708192030b4d";
const ALEX_REMY = "c2d3e4f5-a6b7-4c8d-9e0a-1b2c3d4e5f60";
const NIA_IVY = "d0e1f2a3-b4c5-4d6e-9f70-8192030415c5";
const GROUP_SYNC = "e1f2a3b4-c5d6-4e7f-a081-92030415263d";

async function setCurrentUser(name: string) {
  currentUserMock = name;
  const { clearCurrentUserCache } = await import("@/lib/storage/json-store");
  clearCurrentUserCache();
}

describe("demo fixture: Check-ins org chart is populated", () => {
  beforeAll(async () => {
    const { installWikiCaptureFixture } = await import(
      "@/lib/file-system/wiki-capture-mock"
    );
    // Install once (the mock is idempotent / single-install) signed in as alex,
    // the default demo user. Individual tests switch the current user as needed.
    await installWikiCaptureFixture({ signIn: true, fixtureUser: "alex" });
  });

  it("seeds the eight-member roster so all three new users are discoverable", async () => {
    const { discoverUsers } = await import(
      "@/lib/file-system/user-discovery"
    );
    const users = await discoverUsers();
    for (const u of ["alex", "morgan", "mira", "sam", "remy", "nia", "theo", "ivy"]) {
      expect(users).toContain(u);
    }
  });

  it("alex sees the right mentor-edge grouping (mentor mira; mentees sam/remy/theo; the group)", async () => {
    await setCurrentUser("alex");
    const { labApi } = await import("@/lib/local-api");
    const spaces = await labApi.getOneOnOnes();

    const byId = new Map(spaces.map((s) => [s.id, s]));

    // Mentored-by-mira: the legacy mira -> alex pair, with alex as a member and
    // mira as the mentor.
    const miraAlex = byId.get(MIRA_ALEX);
    expect(miraAlex).toBeTruthy();
    expect(miraAlex!.members).toContain("alex");
    expect(miraAlex!.mentor).toBe("mira");

    // Alex mentors sam, remy, theo (alex is the mentor on each).
    for (const [id, mentee] of [
      [ALEX_SAM, "sam"],
      [ALEX_REMY, "remy"],
      [ALEX_THEO, "theo"],
    ] as const) {
      const sp = byId.get(id);
      expect(sp, `space ${id} should be visible to alex`).toBeTruthy();
      expect(sp!.mentor).toBe("alex");
      expect(sp!.members).toContain(mentee);
      expect(sp!.kind).toBe("pair");
    }

    // The FakeYeast project sync group is visible and is a group with alex in it.
    const group = byId.get(GROUP_SYNC);
    expect(group).toBeTruthy();
    expect(group!.kind).toBe("group");
    expect(group!.members).toEqual(
      expect.arrayContaining(["mira", "alex", "nia", "morgan", "sam"]),
    );

    // The nia -> ivy space is a skip-level relationship alex is NOT a member of,
    // so it must NOT appear in alex's list.
    expect(byId.has(NIA_IVY)).toBe(false);
  });

  it("agenda action items load for alex's spaces (mixed done/not-done, assignees + due dates)", async () => {
    await setCurrentUser("alex");
    const { labApi } = await import("@/lib/local-api");

    const samItems = await labApi.getOneOnOneActionItems(ALEX_SAM);
    expect(samItems.length).toBeGreaterThanOrEqual(3);
    expect(samItems.some((i) => i.is_done)).toBe(true);
    expect(samItems.some((i) => !i.is_done)).toBe(true);
    // At least one item drives the Task board via assignee + due_date.
    expect(
      samItems.some((i) => i.assignee !== null && i.due_date !== null),
    ).toBe(true);

    const theoItems = await labApi.getOneOnOneActionItems(ALEX_THEO);
    expect(theoItems.length).toBeGreaterThanOrEqual(2);
  });

  it("the GROUP task board spans multiple assignees plus an unassigned shared band", async () => {
    await setCurrentUser("mira");
    const { labApi } = await import("@/lib/local-api");
    const items = await labApi.getOneOnOneActionItems(GROUP_SYNC);
    expect(items.length).toBeGreaterThanOrEqual(6);

    const assignees = new Set(
      items.map((i) => i.assignee).filter((a): a is string => a !== null),
    );
    // Multiple member bands render only when several distinct assignees exist.
    expect(assignees.size).toBeGreaterThanOrEqual(4);
    for (const who of ["alex", "nia", "morgan", "sam"]) {
      expect(assignees.has(who)).toBe(true);
    }
    // A Shared band needs at least one unassigned item.
    expect(items.some((i) => i.assignee === null)).toBe(true);
    // At least one dated item.
    expect(items.some((i) => i.due_date !== null)).toBe(true);
  });

  it("the group rotation loads with presenter order and a current index", async () => {
    await setCurrentUser("mira");
    const { checkinRotationsApi } = await import("@/lib/local-api");
    const rotation = await checkinRotationsApi.getForSpace(GROUP_SYNC);
    expect(rotation).toBeTruthy();
    expect(rotation!.space_id).toBe(GROUP_SYNC);
    expect(rotation!.tracks.length).toBeGreaterThanOrEqual(2);
    for (const track of rotation!.tracks) {
      expect(track.order.length).toBeGreaterThan(0);
      expect(track.current_index).toBeGreaterThanOrEqual(0);
      expect(track.current_index).toBeLessThan(track.order.length);
    }
  });

  it("alex owns an IDP and reads every section (owner sees values reflection if present)", async () => {
    await setCurrentUser("alex");
    const { idpsApi } = await import("@/lib/local-api");
    const idp = await idpsApi.getForMember("alex");
    expect(idp).toBeTruthy();
    expect(idp!.owner).toBe("alex");
    // The owner read returns real content in the shared and unshared sections.
    expect(Object.keys(idp!.self_assessment.ratings).length).toBeGreaterThan(0);
    expect(idp!.goals.length).toBeGreaterThan(0);
  });

  it("as mira (mentor) the IDP read sees ONLY shared sections and never the values reflection", async () => {
    await setCurrentUser("mira");
    const { idpsApi } = await import("@/lib/local-api");
    const idp = await idpsApi.getForMember("alex");
    expect(idp).toBeTruthy();
    // values_reflection is always stripped for a non-owner.
    expect(idp!.values_reflection ?? null).toBeNull();

    // Sections the trainee did NOT share are blanked. alex shares
    // self_assessment + career_exploration + goals + action_plan in the fixture,
    // but at minimum any section with shared_sections=false must be empty.
    const shared = idp!.shared_sections;
    if (!shared.self_assessment) {
      expect(
        Object.keys(idp!.self_assessment.ratings).length,
      ).toBe(0);
    }
    if (!shared.goals) {
      expect(idp!.goals.length).toBe(0);
    }
  });

  it("the mira -> alex space carries a compact the read API returns (rows + an ack)", async () => {
    await setCurrentUser("mira");
    const { checkinCompactsApi } = await import("@/lib/local-api");
    const compact = await checkinCompactsApi.getForSpace(MIRA_ALEX);
    expect(compact).toBeTruthy();
    expect(compact!.space_id).toBe(MIRA_ALEX);
    expect(compact!.rows.length).toBeGreaterThanOrEqual(3);
    // One row acknowledged by both members, demonstrating the "Acknowledged by
    // both" state.
    const ackUsers = new Set(compact!.acknowledged.map((a) => a.username));
    expect(ackUsers.has("mira")).toBe(true);
    expect(ackUsers.has("alex")).toBe(true);
    // At least one row left blank (not yet agreed).
    expect(compact!.rows.some((r) => r.value === "")).toBe(true);
  });

  it("onboarding checklists load on the undergrad spaces with some items done", async () => {
    await setCurrentUser("alex");
    const { checkinOnboardingApi } = await import("@/lib/local-api");

    const remyOnb = await checkinOnboardingApi.getForSpace(ALEX_REMY);
    expect(remyOnb).toBeTruthy();
    expect(remyOnb!.items.length).toBe(5);
    expect(remyOnb!.items.some((i) => i.done)).toBe(true);
    // A done item carries done_by + done_at provenance.
    const doneItem = remyOnb!.items.find((i) => i.done);
    expect(doneItem!.done_by).toBeTruthy();
    expect(doneItem!.done_at).toBeTruthy();

    const theoOnb = await checkinOnboardingApi.getForSpace(ALEX_THEO);
    expect(theoOnb).toBeTruthy();
    expect(theoOnb!.items.length).toBe(5);

    await setCurrentUser("nia");
    const ivyOnb = await checkinOnboardingApi.getForSpace(NIA_IVY);
    expect(ivyOnb).toBeTruthy();
    expect(ivyOnb!.items.length).toBe(5);
    expect(ivyOnb!.items.some((i) => i.done)).toBe(true);
  });

  it("as mira (lab head) the IDP status path reports on-file for trainees who have one", async () => {
    await setCurrentUser("mira");
    const { idpsApi } = await import("@/lib/local-api");
    for (const trainee of ["alex", "nia", "remy", "theo", "ivy"]) {
      const status = await idpsApi.getStatusForMember(trainee);
      expect(status.exists, `${trainee} should have an IDP on file`).toBe(true);
      expect(status.updated_at).toBeTruthy();
    }
  });
});
