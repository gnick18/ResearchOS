// Version Control Phase 0: canonicalize determinism + denylist tests.

import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonicalize";

describe("canonicalize", () => {
  it("is deterministic regardless of key insertion order", () => {
    const a = { id: 1, title: "PCR run", entries: [{ z: 1, a: 2 }] };
    const b = { entries: [{ a: 2, z: 1 }], title: "PCR run", id: 1 };
    expect(canonicalize(a)).toEqual(canonicalize(b));
  });

  it("sorts nested object keys but preserves array order", () => {
    const ordered = { steps: ["mix", "spin", "load"] };
    const reordered = { steps: ["load", "spin", "mix"] };
    // Array order is content: different order => different canonical string.
    expect(canonicalize(ordered)).not.toEqual(canonicalize(reordered));
  });

  it("excludes volatile write-stamp fields (updated_at / last_edited_*)", () => {
    const base = { id: 1, title: "note" };
    const stamped = {
      id: 1,
      title: "note",
      updated_at: "2026-05-29T00:00:00Z",
      last_edited_at: "2026-05-29T00:00:00Z",
      last_edited_by: "mira",
    };
    expect(canonicalize(stamped)).toEqual(canonicalize(base));
  });

  it("excludes *_hash and derived/index/cache fields", () => {
    const base = { id: 1, title: "note" };
    const derived = {
      id: 1,
      title: "note",
      content_hash: "abcd",
      search_index: ["note"],
      render_cache: { html: "<p>note</p>" },
    };
    expect(canonicalize(derived)).toEqual(canonicalize(base));
  });

  it("keeps owner in the tracked state (owner change is a real edit)", () => {
    const before = canonicalize({ id: 1, owner: "mira" });
    const after = canonicalize({ id: 1, owner: "alex" });
    expect(before).not.toEqual(after);
  });

  it("changing a tracked field changes the canonical string", () => {
    const before = canonicalize({ id: 1, title: "A" });
    const after = canonicalize({ id: 1, title: "B" });
    expect(before).not.toEqual(after);
  });

  it("drops undefined values for stability", () => {
    const withUndef = { id: 1, title: "A", note: undefined };
    const without = { id: 1, title: "A" };
    expect(canonicalize(withUndef)).toEqual(canonicalize(without));
  });

  it("ends with a trailing newline for clean line-oriented diffs", () => {
    expect(canonicalize({ id: 1 }).endsWith("\n")).toBe(true);
  });
});
