import { describe, it, expect, vi } from "vitest";

// In-memory fileService so the actors map round-trips with no real disk.
vi.mock("@/lib/file-system/file-service", () => {
  const store = new Map<string, unknown>();
  return {
    fileService: {
      readJson: vi.fn(async (path: string) => store.get(path) ?? null),
      writeJson: vi.fn(async (path: string, data: unknown) => {
        store.set(path, data);
      }),
      ensureDir: vi.fn(async () => {}),
    },
  };
});

import { recordActor, readActors, actorsPath } from "../actors";

describe("actors map", () => {
  it("uses the hidden .researchos path", () => {
    expect(actorsPath("mira")).toBe("users/mira/.researchos/actors.json");
  });

  it("records and reads back an actor", async () => {
    await recordActor("mira", BigInt(12345), "mira");
    const map = await readActors("mira");
    expect(map["12345"]).toEqual({ username: "mira" });
  });

  it("merges a second peer without clobbering the first", async () => {
    await recordActor("alex", BigInt(111), "alex");
    await recordActor("alex", BigInt(222), "alex-device-2");
    const map = await readActors("alex");
    expect(map["111"]).toEqual({ username: "alex" });
    expect(map["222"]).toEqual({ username: "alex-device-2" });
  });

  it("returns an empty map when the file is missing", async () => {
    const map = await readActors("nobody-here");
    expect(map).toEqual({});
  });
});
