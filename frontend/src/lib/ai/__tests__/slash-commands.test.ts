// Tests for the BeakerBot slash-command registry and the composer @/ parsing
// helpers (ai at-mentions bot, 2026-06-13).

import { describe, it, expect, beforeEach } from "vitest";
import {
  SLASH_COMMANDS,
  parseSlashQuery,
  filterSlashCommands,
} from "@/lib/ai/slash-commands";
import {
  useConversationStore,
  resetConversationModule,
  type AttachedRef,
} from "@/lib/ai/conversation-store";

describe("slash-command registry", () => {
  it("ships the six curated commands", () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    expect(names).toEqual([
      "summarize",
      "plot",
      "cite",
      "digest",
      "setup",
      "draft",
    ]);
  });

  it("every command has a non-empty prefill ending in a space", () => {
    for (const c of SLASH_COMMANDS) {
      expect(c.prefill.length).toBeGreaterThan(0);
      expect(c.prefill.endsWith(" ")).toBe(true);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });
});

describe("parseSlashQuery", () => {
  it("opens on a leading slash and returns the typed query", () => {
    expect(parseSlashQuery("/")).toBe("");
    expect(parseSlashQuery("/sum")).toBe("sum");
    expect(parseSlashQuery("/PLOT")).toBe("plot");
  });

  it("closes once a space is typed or when not leading", () => {
    expect(parseSlashQuery("/summarize ")).toBeNull();
    expect(parseSlashQuery("hi /plot")).toBeNull();
    expect(parseSlashQuery("plot")).toBeNull();
    expect(parseSlashQuery("")).toBeNull();
  });
});

describe("filterSlashCommands", () => {
  it("returns all commands for an empty query", () => {
    expect(filterSlashCommands("")).toHaveLength(SLASH_COMMANDS.length);
  });

  it("ranks prefix matches and finds substrings", () => {
    const sum = filterSlashCommands("sum");
    expect(sum[0].name).toBe("summarize");
    // "i" appears in cite and digest as a substring.
    const i = filterSlashCommands("i");
    expect(i.map((c) => c.name)).toEqual(
      expect.arrayContaining(["cite", "digest"]),
    );
  });

  it("returns nothing for an unknown token", () => {
    expect(filterSlashCommands("zzz")).toHaveLength(0);
  });
});

describe("attachedRefs store behavior (chip staging)", () => {
  beforeEach(() => {
    resetConversationModule();
  });

  const ref = (id: string): AttachedRef => ({
    type: "note",
    id,
    name: `note ${id}`,
    deepLink: `/x/${id}`,
  });

  it("adds a ref and dedupes by id", () => {
    const s = useConversationStore.getState();
    s.addAttachedRef(ref("a"));
    s.addAttachedRef(ref("a"));
    s.addAttachedRef(ref("b"));
    expect(useConversationStore.getState().attachedRefs.map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("removes a ref by id", () => {
    const s = useConversationStore.getState();
    s.addAttachedRef(ref("a"));
    s.addAttachedRef(ref("b"));
    s.removeAttachedRef("a");
    expect(useConversationStore.getState().attachedRefs.map((r) => r.id)).toEqual([
      "b",
    ]);
  });

  it("clears all refs", () => {
    const s = useConversationStore.getState();
    s.addAttachedRef(ref("a"));
    s.clearAttachedRefs();
    expect(useConversationStore.getState().attachedRefs).toEqual([]);
  });
});
