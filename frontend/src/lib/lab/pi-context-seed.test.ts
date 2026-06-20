// Tests for PI-context seed-on-connect (Owen pilot, A7 + M5).
//
// The security-critical property: account_type "lab_head" is seeded ONLY when
// the folder has no settings of its own AND the cached labRole marks it a head
// folder AND the lab DO confirms the signed-in account is record.head over a
// verified log. A non-matching account, a real solo folder, and a brand-new
// folder with no remembered row must all seed NOTHING.
//
// confirmAccountIsHead calls the real verifyMembershipLog, so we mock that module
// to isolate the gating logic from the signing crypto. getRemote and patch are
// dependency-injected, so no network or filesystem is touched.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./lab-membership", () => ({
  verifyMembershipLog: vi.fn(() => ({ ok: true, reason: "" })),
}));

import { verifyMembershipLog } from "./lab-membership";
import {
  decideSeed,
  confirmAccountIsHead,
  validateHeadAndSeed,
  type SeedInputs,
} from "./pi-context-seed";
import type { getLabRemote } from "./lab-do-client";

type Remote = Awaited<ReturnType<typeof getLabRemote>>;

function remote(head: string): Remote {
  return {
    record: {
      labId: "lab-1",
      head: { username: head } as never,
      members: [],
      keyGeneration: 0,
      log: [],
    },
    envelopes: [],
  } as unknown as Remote;
}

beforeEach(() => {
  vi.mocked(verifyMembershipLog).mockReturnValue({ ok: true, reason: "" });
});

describe("decideSeed", () => {
  const headMeta = { labRole: "head" as const, labId: "lab-1" };

  it("flags an empty head folder for validation", () => {
    const inputs: SeedInputs = {
      currentAccountType: "member",
      hasOwnSettings: false,
      meta: headMeta,
    };
    expect(decideSeed(inputs)).toEqual({
      action: "validate-then-seed",
      labId: "lab-1",
    });
  });

  it("also seeds a class (classroom head) folder", () => {
    expect(
      decideSeed({
        currentAccountType: "member",
        hasOwnSettings: false,
        meta: { labRole: "class" as never, labId: "lab-9" },
      }),
    ).toEqual({ action: "validate-then-seed", labId: "lab-9" });
  });

  it("skips a folder that has its own settings", () => {
    expect(
      decideSeed({
        currentAccountType: "member",
        hasOwnSettings: true,
        meta: headMeta,
      }).action,
    ).toBe("skip");
  });

  it("skips when already lab_head", () => {
    expect(
      decideSeed({
        currentAccountType: "lab_head",
        hasOwnSettings: false,
        meta: headMeta,
      }).action,
    ).toBe("skip");
  });

  it("skips a brand-new folder with no remembered meta (banner is its escape)", () => {
    expect(
      decideSeed({
        currentAccountType: "member",
        hasOwnSettings: false,
        meta: null,
      }).action,
    ).toBe("skip");
  });

  it("skips a real solo folder", () => {
    expect(
      decideSeed({
        currentAccountType: "member",
        hasOwnSettings: false,
        meta: { labRole: "solo", labId: undefined },
      }).action,
    ).toBe("skip");
  });

  it("skips a member folder", () => {
    expect(
      decideSeed({
        currentAccountType: "member",
        hasOwnSettings: false,
        meta: { labRole: "member", labId: "lab-2" },
      }).action,
    ).toBe("skip");
  });

  it("skips a head meta with no cached labId", () => {
    expect(
      decideSeed({
        currentAccountType: "member",
        hasOwnSettings: false,
        meta: { labRole: "head", labId: undefined },
      }).action,
    ).toBe("skip");
  });
});

describe("confirmAccountIsHead", () => {
  it("true when the account is record.head over a verified log", async () => {
    const getRemote = vi.fn().mockResolvedValue(remote("manny"));
    expect(await confirmAccountIsHead("lab-1", "manny", getRemote)).toBe(true);
  });

  it("false when the account is not the head", async () => {
    const getRemote = vi.fn().mockResolvedValue(remote("manny"));
    expect(await confirmAccountIsHead("lab-1", "intruder", getRemote)).toBe(
      false,
    );
  });

  it("false when the lab does not exist", async () => {
    const getRemote = vi.fn().mockResolvedValue(null);
    expect(await confirmAccountIsHead("lab-1", "manny", getRemote)).toBe(false);
  });

  it("false when the membership log fails verification (tamper)", async () => {
    vi.mocked(verifyMembershipLog).mockReturnValue({
      ok: false,
      reason: "bad sig",
    });
    const getRemote = vi.fn().mockResolvedValue(remote("manny"));
    expect(await confirmAccountIsHead("lab-1", "manny", getRemote)).toBe(false);
  });

  it("false (fail-safe) when the relay read throws", async () => {
    const getRemote = vi.fn().mockRejectedValue(new Error("relay down"));
    expect(await confirmAccountIsHead("lab-1", "manny", getRemote)).toBe(false);
  });
});

describe("validateHeadAndSeed", () => {
  it("seeds lab_head + lab_id on a confirmed head match", async () => {
    const patch = vi.fn().mockResolvedValue({});
    const getRemote = vi.fn().mockResolvedValue(remote("manny"));
    const result = await validateHeadAndSeed({
      username: "manny",
      inputs: {
        currentAccountType: "member",
        hasOwnSettings: false,
        meta: { labRole: "head", labId: "lab-1" },
      },
      getRemote,
      patch,
    });
    expect(result).toEqual({ seeded: true, labId: "lab-1" });
    expect(patch).toHaveBeenCalledWith("manny", {
      account_type: "lab_head",
      lab_id: "lab-1",
    });
  });

  it("does NOT seed when the signed-in account is not the head", async () => {
    const patch = vi.fn().mockResolvedValue({});
    const getRemote = vi.fn().mockResolvedValue(remote("manny"));
    const result = await validateHeadAndSeed({
      username: "intruder",
      inputs: {
        currentAccountType: "member",
        hasOwnSettings: false,
        meta: { labRole: "head", labId: "lab-1" },
      },
      getRemote,
      patch,
    });
    expect(result.seeded).toBe(false);
    expect(patch).not.toHaveBeenCalled();
  });

  it("does nothing for a real solo folder (no DO read, no write)", async () => {
    const patch = vi.fn().mockResolvedValue({});
    const getRemote = vi.fn();
    const result = await validateHeadAndSeed({
      username: "solo-user",
      inputs: {
        currentAccountType: "member",
        hasOwnSettings: false,
        meta: { labRole: "solo", labId: undefined },
      },
      getRemote,
      patch,
    });
    expect(result.seeded).toBe(false);
    expect(getRemote).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("does nothing for a brand-new folder with no remembered meta", async () => {
    const patch = vi.fn().mockResolvedValue({});
    const getRemote = vi.fn();
    const result = await validateHeadAndSeed({
      username: "new-user",
      inputs: {
        currentAccountType: "member",
        hasOwnSettings: false,
        meta: null,
      },
      getRemote,
      patch,
    });
    expect(result.seeded).toBe(false);
    expect(getRemote).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});
