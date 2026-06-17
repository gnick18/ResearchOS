import { describe, it, expect, vi } from "vitest";
import { readLabMembersWork, type LabScopedReadDeps } from "./lab-scoped-read";

// A minimal lab key, the bytes are irrelevant since pullRecords is mocked.
const LAB_KEY = new Uint8Array([1, 2, 3]);

function rec(recordType: string, recordId: string): {
  recordType: string;
  recordId: string;
  plaintext: Uint8Array;
} {
  return { recordType, recordId, plaintext: new Uint8Array([0]) };
}

/**
 * A working set of deps for the happy path. Roster has the head plus two
 * members, two key generations, each member pulls one record per type.
 */
function makeDeps(
  over: Partial<LabScopedReadDeps> = {},
): { deps: LabScopedReadDeps; audit: ReturnType<typeof vi.fn>; pull: ReturnType<typeof vi.fn> } {
  const pull = vi.fn(async (p: { memberOwner: string }) => [
    rec("experiment", `${p.memberOwner}-e1`),
    rec("note", `${p.memberOwner}-n1`),
  ]);
  const audit = vi.fn(async () => {});
  const deps: LabScopedReadDeps = {
    getViewer: vi.fn(async () => ({
      username: "pi",
      account_type: "lab_head",
    })) as unknown as LabScopedReadDeps["getViewer"],
    getLabId: vi.fn(async () => "lab-123"),
    getIdentity: vi.fn(() => ({
      keys: {
        signing: { privateKey: new Uint8Array([9]), publicKey: new Uint8Array([8]) },
        encryption: { privateKey: new Uint8Array([7]), publicKey: new Uint8Array([6]) },
      },
    })) as unknown as LabScopedReadDeps["getIdentity"],
    fetchLab: vi.fn(async () => ({
      record: {
        members: [
          { username: "pi", role: "head" },
          { username: "alice", role: "member" },
          { username: "bob", role: "member" },
        ],
      },
      envelopes: [
        { generation: 1 },
        { generation: 3 },
        { generation: 2 },
      ],
    })) as unknown as LabScopedReadDeps["fetchLab"],
    openKey: vi.fn(() => LAB_KEY),
    pullRecords: pull as unknown as LabScopedReadDeps["pullRecords"],
    appendAudit: audit as unknown as LabScopedReadDeps["appendAudit"],
    ...over,
  };
  return { deps, audit, pull };
}

describe("readLabMembersWork", () => {
  it("refuses a non-lab-head viewer and never touches the relay", async () => {
    const { deps, pull } = makeDeps({
      getViewer: vi.fn(async () => ({
        username: "alice",
        account_type: "solo",
      })) as unknown as LabScopedReadDeps["getViewer"],
    });
    const res = await readLabMembersWork({}, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/lab-head role/);
    expect(res.members).toEqual([]);
    expect(pull).not.toHaveBeenCalled();
  });

  it("refuses when there is no unlocked identity", async () => {
    const { deps } = makeDeps({ getIdentity: vi.fn(() => null) });
    const res = await readLabMembersWork({}, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/identity/);
  });

  it("refuses when the account is not bound to a lab", async () => {
    const { deps } = makeDeps({ getLabId: vi.fn(async () => undefined) });
    const res = await readLabMembersWork({}, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not bound to a lab/);
  });

  it("refuses when the lab has no key envelopes", async () => {
    const { deps } = makeDeps({
      fetchLab: vi.fn(async () => ({
        record: { members: [{ username: "pi", role: "head" }] },
        envelopes: [],
      })) as unknown as LabScopedReadDeps["fetchLab"],
    });
    const res = await readLabMembersWork({}, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no key envelopes/);
  });

  it("reads every member except the head, using the highest-generation key", async () => {
    const { deps, pull } = makeDeps();
    const res = await readLabMembersWork({}, deps);
    expect(res.ok).toBe(true);
    // pi is excluded, alice and bob are read.
    expect(res.members.map((m) => m.owner).sort()).toEqual(["alice", "bob"]);
    expect(pull).toHaveBeenCalledTimes(2);
    expect(pull).not.toHaveBeenCalledWith(
      expect.objectContaining({ memberOwner: "pi" }),
    );
    // The max-generation envelope (3) opened the key.
    expect(deps.openKey).toHaveBeenCalledWith(
      { generation: 3 },
      "pi",
      expect.any(Uint8Array),
    );
    // Each member returned their two records.
    expect(res.members.find((m) => m.owner === "alice")?.records).toHaveLength(2);
  });

  it("writes a read-flavored audit entry to each member's own log", async () => {
    const { deps, audit } = makeDeps();
    await readLabMembersWork({}, deps);
    expect(audit).toHaveBeenCalledTimes(2);
    const aliceCall = audit.mock.calls.find((c) => c[0] === "alice");
    expect(aliceCall).toBeTruthy();
    const entry = aliceCall![1][0];
    expect(entry).toMatchObject({
      session_id: "lab-scoped-read",
      actor: "pi",
      target_user: "alice",
      record_type: "lab-scoped-read",
      record_id: 2,
      field_path: "lab-scoped-read",
    });
    expect(entry.new_value.record_types.sort()).toEqual(["experiment", "note"]);
    // No id or timestamp, the writer fills those.
    expect(entry.id).toBeUndefined();
    expect(entry.timestamp).toBeUndefined();
  });

  it("applies the recordTypes allow-list to results and the audited count", async () => {
    const { deps, audit } = makeDeps();
    const res = await readLabMembersWork({ recordTypes: ["experiment"] }, deps);
    const alice = res.members.find((m) => m.owner === "alice");
    expect(alice?.records).toHaveLength(1);
    expect(alice?.records[0].recordType).toBe("experiment");
    const aliceAudit = audit.mock.calls.find((c) => c[0] === "alice");
    expect(aliceAudit![1][0].record_id).toBe(1);
  });

  it("isolates one member's pull failure, the rest of the lab still reads", async () => {
    const pull = vi.fn(async (p: { memberOwner: string }) => {
      if (p.memberOwner === "alice") throw new Error("relay 500");
      return [rec("note", "bob-n1")];
    });
    const { deps } = makeDeps({
      pullRecords: pull as unknown as LabScopedReadDeps["pullRecords"],
    });
    const res = await readLabMembersWork({}, deps);
    expect(res.ok).toBe(true);
    const alice = res.members.find((m) => m.owner === "alice");
    const bob = res.members.find((m) => m.owner === "bob");
    expect(alice?.error).toMatch(/relay 500/);
    expect(alice?.records).toEqual([]);
    expect(bob?.records).toHaveLength(1);
    expect(bob?.error).toBeUndefined();
  });

  it("keeps the records when the best-effort audit write fails", async () => {
    const audit = vi.fn(async () => {
      throw new Error("audit disk full");
    });
    const { deps } = makeDeps({
      appendAudit: audit as unknown as LabScopedReadDeps["appendAudit"],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await readLabMembersWork({}, deps);
    expect(res.ok).toBe(true);
    expect(res.members.find((m) => m.owner === "alice")?.records).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
