import { beforeEach, describe, expect, it, vi } from "vitest";
import { savePiRecordEdit } from "../pi-record-edit";
import { readAuditEntries } from "../pi-audit";

// Hermetic file-system: writeWithAudit / readAuditEntries read+write through
// fileService, so back it with an in-memory map.
const fakeFiles: Record<string, unknown> = {};
vi.mock("../../file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => fakeFiles[path] ?? null),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      fakeFiles[path] = data;
    }),
    fileExists: vi.fn(async (path: string) => path in fakeFiles),
  },
}));

describe("savePiRecordEdit", () => {
  beforeEach(() => {
    for (const k of Object.keys(fakeFiles)) delete fakeFiles[k];
  });

  it("runs the data write and returns its result", async () => {
    const dataWrite = vi.fn(async () => ({ id: 5, item_name: "EDTA" }));
    const result = await savePiRecordEdit({
      targetOwner: "alex",
      actor: "mira",
      recordType: "purchase",
      recordId: 5,
      fieldPaths: ["item_name"],
      oldRecord: { item_name: "EDTA" },
      newRecord: { item_name: "EDTA" },
      dataWrite,
    });
    expect(dataWrite).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: 5, item_name: "EDTA" });
  });

  it("emits a field-diff audit entry per changed field, stamped lab-head-edit", async () => {
    await savePiRecordEdit({
      targetOwner: "alex",
      actor: "mira",
      recordType: "purchase",
      recordId: 5,
      fieldPaths: ["item_name", "quantity", "notes"],
      oldRecord: { item_name: "EDTA", quantity: 1, notes: null },
      newRecord: { item_name: "EDTA", quantity: 4, notes: "rush" },
      dataWrite: async () => null,
    });

    const entries = await readAuditEntries("alex");
    // item_name unchanged -> no entry; quantity + notes changed -> 2 entries.
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.session_id).toBe("lab-head-edit");
      expect(e.actor).toBe("mira");
      expect(e.target_user).toBe("alex");
      expect(e.record_type).toBe("purchase");
      expect(e.record_id).toBe(5);
    }
    const byField = Object.fromEntries(entries.map((e) => [e.field_path, e]));
    expect(byField.quantity.old_value).toBe(1);
    expect(byField.quantity.new_value).toBe(4);
    expect(byField.notes.old_value).toBe(null);
    expect(byField.notes.new_value).toBe("rush");
    expect(byField.item_name).toBeUndefined();
  });

  it("writes nothing to the audit log when no field actually changed", async () => {
    await savePiRecordEdit({
      targetOwner: "alex",
      actor: "mira",
      recordType: "purchase",
      recordId: 9,
      fieldPaths: ["item_name", "quantity"],
      oldRecord: { item_name: "Tris", quantity: 2 },
      newRecord: { item_name: "Tris", quantity: 2 },
      dataWrite: async () => null,
    });
    expect(await readAuditEntries("alex")).toEqual([]);
  });

  it("audits to the TARGET owner's log, not the actor's", async () => {
    await savePiRecordEdit({
      targetOwner: "alex",
      actor: "mira",
      recordType: "purchase",
      recordId: 1,
      fieldPaths: ["notes"],
      oldRecord: { notes: null },
      newRecord: { notes: "see me" },
      dataWrite: async () => null,
    });
    expect(await readAuditEntries("alex")).toHaveLength(1);
    expect(await readAuditEntries("mira")).toEqual([]);
  });
});
