// edit-tools tests (ai edit-tools bot, 2026-06-14).
//
// Tests cover the four UPDATE tools that close the create-but-no-update gap:
//   - resolvers (resolveSequence / resolveMolecule / resolveNote / resolvePurchase)
//     by numeric/string id and case-insensitive name.
//   - parseOrderStatus: free-form status words -> canonical order status.
//   - each tool: describeAction preview, execute calls the right api with the
//     resolved id + new value, the navigate seam, the not-found path, and (for
//     update_purchase) the field-update vs setOrderStatus split + nothing-to-update.
//
// All tests stub editToolsDeps (the injectable seam), so no real folder or
// local-api is involved. These tools WRITE real data, so the actual rename /
// update needs Grant's :3000 pass; here we pin the wiring + the args each api
// method receives.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  editToolsDeps,
  resolveSequence,
  resolveMolecule,
  resolveNote,
  resolvePurchase,
  resolveNoteEntry,
  parseOrderStatus,
  updateSequenceTool,
  updateMoleculeTool,
  updateNoteTool,
  updatePurchaseTool,
  editNoteTool,
} from "../tools/edit-tools";
import type { SequenceRecord, Note, PurchaseItem } from "@/lib/types";
import type { MoleculeMeta } from "@/lib/chemistry/api";

const seq = (over: Partial<SequenceRecord> = {}) =>
  ({ id: 1, display_name: "pUC19", ...over }) as SequenceRecord;
const mol = (over: Partial<MoleculeMeta> = {}) =>
  ({ id: "m1", name: "aspirin", project_ids: [], ...over }) as unknown as MoleculeMeta;
const note = (over: Partial<Note> = {}) =>
  ({ id: 1, title: "Gel run", ...over }) as Note;
const buy = (over: Partial<PurchaseItem> = {}) =>
  ({ id: 1, task_id: 9, item_name: "P1000 tips", quantity: 2, order_status: "needs_ordering", vendor: "Fisher", ...over }) as PurchaseItem;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("resolvers", () => {
  it("resolveSequence by id and name", () => {
    const seqs = [seq({ id: 5, display_name: "pET28" })];
    expect(resolveSequence(seqs, 5)?.display_name).toBe("pET28");
    expect(resolveSequence(seqs, "pet28")?.id).toBe(5);
    expect(resolveSequence(seqs, "nope")).toBeNull();
  });
  it("resolveMolecule by string id and name", () => {
    const mols = [mol()];
    expect(resolveMolecule(mols, "m1")?.name).toBe("aspirin");
    expect(resolveMolecule(mols, "ASPIRIN")?.id).toBe("m1");
  });
  it("resolveNote and resolvePurchase by id and name", () => {
    expect(resolveNote([note({ id: 3 })], 3)?.title).toBe("Gel run");
    expect(resolvePurchase([buy({ id: 7 })], "p1000 tips")?.id).toBe(7);
  });
});

describe("parseOrderStatus", () => {
  it("maps received / ordered / needs-ordering phrasings", () => {
    expect(parseOrderStatus("it arrived")).toBe("received");
    expect(parseOrderStatus("received")).toBe("received");
    expect(parseOrderStatus("I placed the order")).toBe("ordered");
    expect(parseOrderStatus("still need to order")).toBe("needs_ordering");
  });
  it("returns null for a non-status string", () => {
    expect(parseOrderStatus("blue")).toBeNull();
    expect(parseOrderStatus(undefined)).toBeNull();
  });
});

describe("update_sequence / update_molecule / update_note (rename)", () => {
  it("update_sequence renames via the api and navigates", async () => {
    vi.spyOn(editToolsDeps, "listSequences").mockResolvedValue([seq({ id: 5, display_name: "old" })]);
    const rename = vi.spyOn(editToolsDeps, "renameSequence").mockResolvedValue(seq({ id: 5, display_name: "new" }));
    const nav = vi.spyOn(editToolsDeps, "navigate").mockImplementation(() => {});
    const r = (await updateSequenceTool.execute({ sequence: "old", name: "new" })) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(rename).toHaveBeenCalledWith(5, "new");
    expect(nav).toHaveBeenCalledWith("/sequences?seq=5");
  });

  it("update_molecule renames via the api (string id)", async () => {
    vi.spyOn(editToolsDeps, "listMolecules").mockResolvedValue([mol()]);
    const rename = vi.spyOn(editToolsDeps, "renameMolecule").mockResolvedValue(mol());
    vi.spyOn(editToolsDeps, "navigate").mockImplementation(() => {});
    await updateMoleculeTool.execute({ molecule: "aspirin", name: "ASA" });
    expect(rename).toHaveBeenCalledWith("m1", "ASA");
  });

  it("update_note renames via the api", async () => {
    vi.spyOn(editToolsDeps, "listNotes").mockResolvedValue([note({ id: 3, title: "old" })]);
    const rename = vi.spyOn(editToolsDeps, "renameNote").mockResolvedValue(note({ id: 3, title: "new" }));
    vi.spyOn(editToolsDeps, "navigate").mockImplementation(() => {});
    const r = (await updateNoteTool.execute({ note: 3, title: "new" })) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(rename).toHaveBeenCalledWith(3, "new");
  });

  it("errors with the user's real names when a ref misses", async () => {
    vi.spyOn(editToolsDeps, "listSequences").mockResolvedValue([seq({ display_name: "pUC19" })]);
    const r = (await updateSequenceTool.execute({ sequence: "zzz", name: "x" })) as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toContain("pUC19");
  });
});

describe("resolveNoteEntry", () => {
  const entries = [
    { id: "a", title: "Day 1", date: "2026-06-10", content: "old1" },
    { id: "b", title: "Day 2", date: "2026-06-12", content: "old2" },
  ];
  it("picks the named entry", () => {
    expect(resolveNoteEntry(entries, "day 1")?.id).toBe("a");
  });
  it("picks the latest entry when no name", () => {
    expect(resolveNoteEntry(entries, undefined)?.id).toBe("b");
  });
  it("returns null for an empty list or a missing name", () => {
    expect(resolveNoteEntry([], undefined)).toBeNull();
    expect(resolveNoteEntry(entries, "Day 9")).toBeNull();
  });
});

describe("edit_note", () => {
  const noteWithEntries = (over: Partial<Note> = {}) =>
    ({
      id: 1,
      title: "Gel run",
      description: "",
      entries: [
        { id: "a", title: "Day 1", date: "2026-06-10", content: "first", created_at: "", updated_at: "" },
        { id: "b", title: "Day 2", date: "2026-06-12", content: "second", created_at: "", updated_at: "" },
      ],
      ...over,
    }) as Note;

  it("replaces the latest entry's content by default", async () => {
    vi.spyOn(editToolsDeps, "listNotes").mockResolvedValue([note({ id: 1 })]);
    vi.spyOn(editToolsDeps, "getNote").mockResolvedValue(noteWithEntries());
    const setEntry = vi.spyOn(editToolsDeps, "setNoteEntryContent").mockResolvedValue(note({ id: 1 }));
    vi.spyOn(editToolsDeps, "navigate").mockImplementation(() => {});

    const r = (await editNoteTool.execute({ note: "Gel run", content: "rewritten" })) as { ok: boolean };
    expect(r.ok).toBe(true);
    // Latest entry is "b"; replace mode passes the new content as-is.
    expect(setEntry).toHaveBeenCalledWith(1, "b", "rewritten");
  });

  it("appends to a named entry", async () => {
    vi.spyOn(editToolsDeps, "listNotes").mockResolvedValue([note({ id: 1 })]);
    vi.spyOn(editToolsDeps, "getNote").mockResolvedValue(noteWithEntries());
    const setEntry = vi.spyOn(editToolsDeps, "setNoteEntryContent").mockResolvedValue(note({ id: 1 }));
    vi.spyOn(editToolsDeps, "navigate").mockImplementation(() => {});

    await editNoteTool.execute({ note: 1, entry: "Day 1", content: "more", mode: "append" });
    expect(setEntry).toHaveBeenCalledWith(1, "a", "first\n\nmore");
  });

  it("edits the description for an entry-less note", async () => {
    vi.spyOn(editToolsDeps, "listNotes").mockResolvedValue([note({ id: 1 })]);
    vi.spyOn(editToolsDeps, "getNote").mockResolvedValue(
      ({ id: 1, title: "Bare", description: "old", entries: [] }) as unknown as Note,
    );
    const setDesc = vi.spyOn(editToolsDeps, "setNoteDescription").mockResolvedValue(note({ id: 1 }));
    vi.spyOn(editToolsDeps, "navigate").mockImplementation(() => {});

    await editNoteTool.execute({ note: 1, content: "new body" });
    expect(setDesc).toHaveBeenCalledWith(1, "new body");
  });
});

describe("update_purchase", () => {
  it("describeAction summarizes field changes + status", () => {
    const { summary } = updatePurchaseTool.describeAction!({
      purchase: "P1000 tips",
      quantity: 5,
      vendor: "VWR",
      status: "it arrived",
    });
    expect(summary).toContain('update order "P1000 tips"');
    expect(summary).toContain("quantity 5");
    expect(summary).toContain('vendor "VWR"');
    expect(summary).toContain("mark received");
  });

  it("routes field edits through update and the status through setOrderStatus", async () => {
    vi.spyOn(editToolsDeps, "listPurchases").mockResolvedValue([buy({ id: 7 })]);
    const update = vi.spyOn(editToolsDeps, "updatePurchase").mockResolvedValue(buy({ id: 7, quantity: 5 }));
    const setStatus = vi
      .spyOn(editToolsDeps, "setPurchaseStatus")
      .mockResolvedValue({ item: buy({ id: 7, quantity: 5, order_status: "received" }), notified: true });
    const nav = vi.spyOn(editToolsDeps, "navigate").mockImplementation(() => {});

    const r = (await updatePurchaseTool.execute({
      purchase: "P1000 tips",
      quantity: 5,
      status: "arrived",
    })) as { ok: boolean; orderStatus: string };

    expect(r.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(7, { quantity: 5 });
    expect(setStatus).toHaveBeenCalledWith(7, "received");
    expect(nav).toHaveBeenCalledWith("/purchases");
  });

  it("guards nothing-to-update", async () => {
    vi.spyOn(editToolsDeps, "listPurchases").mockResolvedValue([buy({ id: 7 })]);
    const update = vi.spyOn(editToolsDeps, "updatePurchase");
    const r = (await updatePurchaseTool.execute({ purchase: 7 })) as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/nothing to update/i);
    expect(update).not.toHaveBeenCalled();
  });
});
