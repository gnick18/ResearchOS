// Tests for the task markdown-surface Loro model (experiment collab chunk 1).

import { describe, it, expect } from "vitest";
import { LoroDoc } from "loro-crdt";
import {
  seedTaskDoc,
  getTaskContentText,
  setTaskContentText,
  getTaskMeta,
  TASK_CONTENT_CONTAINER,
} from "../task-doc";

describe("task-doc model", () => {
  it("round-trips markdown through a snapshot", () => {
    const md = "# Lab Notes\n\n- step 1: **2 uL** primer\n- gel at 120V";
    const snapshot = seedTaskDoc(md);

    const doc = new LoroDoc();
    doc.import(snapshot);
    expect(getTaskContentText(doc)).toBe(md);
  });

  it("seeds empty markdown to empty content", () => {
    const doc = new LoroDoc();
    doc.import(seedTaskDoc(""));
    expect(getTaskContentText(doc)).toBe("");
  });

  it("is deterministic: two seeds of the same markdown are byte-equal", () => {
    const md = "Results: band at ~500 bp, faint primer dimer.";
    const a = seedTaskDoc(md, "2026-06-06T00:00:00Z");
    const b = seedTaskDoc(md, "2026-06-06T00:00:00Z");
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("stores created_at in meta", () => {
    const doc = new LoroDoc();
    doc.import(seedTaskDoc("x", "2026-06-06T09:00:00Z"));
    expect(getTaskMeta(doc).get("created_at")).toBe("2026-06-06T09:00:00Z");
  });

  it("setTaskContentText replaces the body and is a no-op when unchanged", () => {
    const doc = new LoroDoc();
    doc.import(seedTaskDoc("old"));

    setTaskContentText(doc, "new content");
    expect(getTaskContentText(doc)).toBe("new content");

    // No-op path: setting the same text leaves it unchanged.
    setTaskContentText(doc, "new content");
    expect(getTaskContentText(doc)).toBe("new content");
  });

  it("binds the editor to the 'content' container", () => {
    // The editor's Loro sync plugin binds to this container name; lock it so a
    // rename can't silently break the wiring.
    expect(TASK_CONTENT_CONTAINER).toBe("content");
    const doc = new LoroDoc();
    doc.import(seedTaskDoc("hi"));
    expect(doc.getText(TASK_CONTENT_CONTAINER).toString()).toBe("hi");
  });
});
