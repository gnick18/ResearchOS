// Multi-lab P2: byte-identical-flag-off guarantee for the push-side additions.
//
// With LAB_AS_FOLDER_ENABLED off, the seven P2 mentorship / check-in source
// methods MUST return [] so the enumerator produces the exact same record set it
// did before P2 (no new types pushed to R2). This test mocks the flag to false
// (the production default) and asserts the new methods are inert even when their
// underlying stores hold records.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi } from "vitest";

// FLAG OFF: the production default. This is the byte-identical case.
vi.mock("@/lib/lab/lab-as-folder-config", () => ({
  LAB_AS_FOLDER_ENABLED: false,
}));

// Each JsonStore (incl. weekly_goals) is mocked to return a non-empty record so
// a leak past the flag gate would be visible.
vi.mock("@/lib/storage/json-store", () => {
  function MockJsonStore(
    this: { listAllForUser: ReturnType<typeof vi.fn> },
    _collectionName: string,
  ) {
    this.listAllForUser = vi.fn(() => Promise.resolve([{ id: 999 }]));
  }
  const Spyable = vi.fn(
    MockJsonStore as unknown as new (c: string) => {
      listAllForUser: ReturnType<typeof vi.fn>;
    },
  );
  return { JsonStore: Spyable };
});

vi.mock("@/lib/local-api", () => ({
  sequencesApi: { getForUser: vi.fn(() => Promise.resolve([])) },
}));
vi.mock("@/lib/phylo/api", () => ({
  phyloApi: { listForUser: vi.fn(() => Promise.resolve([])) },
}));
vi.mock("@/lib/chemistry/molecule-store", () => ({
  moleculeStore: { listMetaForUser: vi.fn(() => Promise.resolve([])) },
}));
vi.mock("@/lib/loro/datahub-sidecar-store", () => ({
  dataHubDir: vi.fn((o: string) => `users/${o}/datahub`),
  readDataHubMirror: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    // Every mentorship / check-in store would call listFiles + readJson; return
    // a record so any leak past the gate would surface as a non-empty result.
    listFiles: vi.fn(() => Promise.resolve(["leak.json"])),
    readJson: vi.fn(() => Promise.resolve({ id: "leak" })),
    listDirectories: vi.fn(() => Promise.resolve([])),
    readText: vi.fn(() => Promise.resolve(null)),
  },
}));

import { createLocalApiLabWorkSource } from "../lab-work-source-localapi";

describe("createLocalApiLabWorkSource — flag OFF is byte-identical", () => {
  it("returns [] for every P2 mentorship / check-in method when the flag is off", async () => {
    const source = createLocalApiLabWorkSource();
    expect(await source.listOneOnOnes("alex")).toEqual([]);
    expect(await source.listOneOnOneActionItems("alex")).toEqual([]);
    expect(await source.listIdps("alex")).toEqual([]);
    expect(await source.listWeeklyGoals("alex")).toEqual([]);
    expect(await source.listCheckinCompacts("alex")).toEqual([]);
    expect(await source.listCheckinOnboarding("alex")).toEqual([]);
    expect(await source.listCheckinRotations("alex")).toEqual([]);
    expect(await source.listAnnouncements("alex")).toEqual([]);
  });

  it("still serves the pre-P2 record types when the flag is off", async () => {
    // The original types are NOT gated; they keep working exactly as before.
    const source = createLocalApiLabWorkSource();
    expect(await source.listTasks("alex")).toEqual([{ id: 999 }]);
    expect(await source.listNotes("alex")).toEqual([{ id: 999 }]);
  });
});
