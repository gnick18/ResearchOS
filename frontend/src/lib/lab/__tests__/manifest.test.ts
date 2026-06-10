// Tests for the retention manifest pure helpers (LAB_ARCHIVE_CONTINUITY.md).

import { describe, it, expect } from "vitest";
import { sha256Hex, buildManifest } from "../manifest";

const enc = (s: string) => new TextEncoder().encode(s);

describe("sha256Hex", () => {
  it("matches known SHA-256 vectors", async () => {
    expect(await sha256Hex(enc(""))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await sha256Hex(enc("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("buildManifest", () => {
  it("sorts entries by path and counts bytes", async () => {
    const m = await buildManifest([
      { path: "b.txt", bytes: enc("abc") },
      { path: "a.txt", bytes: enc("") },
    ]);
    expect(m.entries.map((e) => e.path)).toEqual(["a.txt", "b.txt"]);
    expect(m.fileCount).toBe(2);
    expect(m.totalBytes).toBe(3);
    expect(m.entries[1].sha256).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is order-independent for the combined hash (deterministic)", async () => {
    const a = await buildManifest([
      { path: "x", bytes: enc("1") },
      { path: "y", bytes: enc("2") },
    ]);
    const b = await buildManifest([
      { path: "y", bytes: enc("2") },
      { path: "x", bytes: enc("1") },
    ]);
    expect(a.combined).toBe(b.combined);
  });

  it("changes the combined hash when a file's content changes", async () => {
    const a = await buildManifest([{ path: "x", bytes: enc("1") }]);
    const b = await buildManifest([{ path: "x", bytes: enc("2") }]);
    expect(a.combined).not.toBe(b.combined);
  });
});
