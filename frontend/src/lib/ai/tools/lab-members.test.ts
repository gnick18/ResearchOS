import { describe, it, expect, vi, beforeEach } from "vitest";
import { labMembersDeps, listLabMembersTool } from "./lab-members";

beforeEach(() => vi.restoreAllMocks());

describe("list_lab_members", () => {
  it("is a read-only tool", () => {
    expect(listLabMembersTool.action).toBeFalsy();
    expect(listLabMembersTool.previewable).toBeFalsy();
  });

  it("returns the member usernames and the current user", async () => {
    vi.spyOn(labMembersDeps, "listMembers").mockResolvedValue({
      users: ["grant", "kritika", "alex"],
      current_user: "grant",
    });
    const out = (await listLabMembersTool.execute({})) as {
      ok: boolean;
      members: string[];
      currentUser: string;
      count: number;
    };
    expect(out.ok).toBe(true);
    expect(out.members).toEqual(["grant", "kritika", "alex"]);
    expect(out.currentUser).toBe("grant");
    expect(out.count).toBe(3);
  });

  it("fails cleanly when the roster cannot be read", async () => {
    vi.spyOn(labMembersDeps, "listMembers").mockRejectedValue(new Error("no folder"));
    const out = (await listLabMembersTool.execute({})) as { ok: boolean };
    expect(out.ok).toBe(false);
  });
});
