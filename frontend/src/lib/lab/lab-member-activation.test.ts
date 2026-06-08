// Lab tier Phase 8e: tests for member activation.
//
// The security-critical property: lab_id is written ONLY when the head has
// approved (member in the roster AND their sealed lab-key copy opens). Every
// not-yet-approved path must write nothing.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./lab-do-client", () => ({ getLabRemote: vi.fn() }));
vi.mock("./lab-key", () => ({ openLabKeyCopy: vi.fn() }));
vi.mock("@/lib/settings/user-settings", () => ({ patchUserSettings: vi.fn() }));

import { getLabRemote } from "./lab-do-client";
import { openLabKeyCopy } from "./lab-key";
import { patchUserSettings } from "@/lib/settings/user-settings";
import { checkAndEnterLab } from "./lab-member-activation";

const identity = {
  keys: {
    encryption: { privateKey: new Uint8Array(32).fill(1), publicKey: new Uint8Array(32).fill(2) },
    signing: { privateKey: new Uint8Array(64).fill(3), publicKey: new Uint8Array(32).fill(4) },
  },
  deviceSalt: new Uint8Array(16).fill(5),
} as unknown as Parameters<typeof checkAndEnterLab>[0]["identity"];

function remote(members: string[], head = "Manny", envelopes = [{ generation: 0, copies: [] }]) {
  return {
    record: {
      labId: "lab-1",
      head: { username: head, x25519PublicKey: "", ed25519PublicKey: "", role: "head" },
      members: members.map((u) => ({ username: u, x25519PublicKey: "", ed25519PublicKey: "", role: "member" })),
      keyGeneration: 0,
      log: [],
    },
    envelopes,
  };
}

const args = { labId: "lab-1", username: "rosa", identity };

beforeEach(() => vi.clearAllMocks());

describe("checkAndEnterLab", () => {
  it("entered:true + writes lab_id when in roster AND the sealed copy opens", async () => {
    vi.mocked(getLabRemote).mockResolvedValueOnce(remote(["rosa"]) as never);
    vi.mocked(openLabKeyCopy).mockReturnValueOnce(new Uint8Array(32));
    const r = await checkAndEnterLab(args);
    expect(r).toEqual({ entered: true, labId: "lab-1" });
    expect(patchUserSettings).toHaveBeenCalledWith("rosa", { lab_id: "lab-1" });
  });

  it("activates the head too (inRoster via head username)", async () => {
    vi.mocked(getLabRemote).mockResolvedValueOnce(remote([], "rosa") as never);
    vi.mocked(openLabKeyCopy).mockReturnValueOnce(new Uint8Array(32));
    const r = await checkAndEnterLab(args);
    expect(r.entered).toBe(true);
  });

  it("pending + writes NOTHING when not in the roster yet", async () => {
    vi.mocked(getLabRemote).mockResolvedValueOnce(remote(["someone-else"]) as never);
    const r = await checkAndEnterLab(args);
    expect(r).toMatchObject({ entered: false, reason: "pending" });
    expect(patchUserSettings).not.toHaveBeenCalled();
    expect(openLabKeyCopy).not.toHaveBeenCalled();
  });

  it("pending + writes NOTHING when in roster but the sealed copy will not open", async () => {
    vi.mocked(getLabRemote).mockResolvedValueOnce(remote(["rosa"]) as never);
    vi.mocked(openLabKeyCopy).mockImplementationOnce(() => {
      throw new Error("no sealed copy");
    });
    const r = await checkAndEnterLab(args);
    expect(r).toMatchObject({ entered: false, reason: "pending" });
    expect(patchUserSettings).not.toHaveBeenCalled();
  });

  it("pending when in roster but there are no envelopes", async () => {
    vi.mocked(getLabRemote).mockResolvedValueOnce(remote(["rosa"], "Manny", []) as never);
    const r = await checkAndEnterLab(args);
    expect(r).toMatchObject({ entered: false, reason: "pending" });
    expect(patchUserSettings).not.toHaveBeenCalled();
  });

  it("not-found + writes nothing when the lab does not exist", async () => {
    vi.mocked(getLabRemote).mockResolvedValueOnce(null);
    const r = await checkAndEnterLab(args);
    expect(r).toMatchObject({ entered: false, reason: "not-found" });
    expect(patchUserSettings).not.toHaveBeenCalled();
  });

  it("error + writes nothing when the relay read throws", async () => {
    vi.mocked(getLabRemote).mockRejectedValueOnce(new Error("network"));
    const r = await checkAndEnterLab(args);
    expect(r).toMatchObject({ entered: false, reason: "error" });
    expect(patchUserSettings).not.toHaveBeenCalled();
  });
});
