import { describe, it, expect, vi } from "vitest";
import {
  requestLabContent,
  loadMyContentRequests,
  approveMyContentRequest,
  type RequestLabContentDeps,
  type MemberRequestDeps,
} from "./lab-request-actions";

function ctx(accountType: string, username = "pi") {
  return {
    getViewer: vi.fn(async () => ({ username, account_type: accountType })),
    getLabId: vi.fn(async () => "lab-1"),
    getIdentity: vi.fn(() => ({
      keys: {
        signing: { privateKey: new Uint8Array([1]), publicKey: new Uint8Array([2]) },
        encryption: { privateKey: new Uint8Array([3]), publicKey: new Uint8Array([4]) },
      },
    })),
    fetchLab: vi.fn(async () => ({
      record: { members: [{ username: "pi", role: "head" }, { username: "emile", role: "member" }] },
      envelopes: [{ generation: 1 }, { generation: 2 }],
    })),
    openKey: vi.fn(() => new Uint8Array([9])),
  } as unknown as RequestLabContentDeps;
}

describe("requestLabContent (PI side)", () => {
  it("refuses a non-lab-head", async () => {
    const deps = {
      ...ctx("member", "emile"),
      postRequest: vi.fn(async () => {}),
      now: () => 1000,
      makeId: () => "id1",
    } as unknown as RequestLabContentDeps;
    const res = await requestLabContent(
      { owner: "emile", recordType: "datahub", recordId: "dh-1" },
      deps,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/lab-head role/);
    expect(deps.postRequest).not.toHaveBeenCalled();
  });

  it("posts a request with the resolved labId, member, and record", async () => {
    const postRequest = vi.fn(async () => {});
    const deps = {
      ...ctx("lab_head", "pi"),
      postRequest,
      now: () => 4242,
      makeId: () => "id-xyz",
    } as unknown as RequestLabContentDeps;
    const res = await requestLabContent(
      { owner: "emile", recordType: "datahub", recordId: "dh-1" },
      deps,
    );
    expect(res.ok).toBe(true);
    expect(postRequest).toHaveBeenCalledTimes(1);
    const arg = (postRequest.mock.calls as unknown as [Record<string, unknown>][])[0][0];
    expect(arg.labId).toBe("lab-1");
    expect(arg.member).toBe("emile");
    expect(arg.request).toMatchObject({
      id: "id-xyz",
      requester: "pi",
      recordType: "datahub",
      recordId: "dh-1",
      requestedAt: 4242,
    });
  });

  it("refuses when not bound to a lab", async () => {
    const deps = {
      ...ctx("lab_head"),
      getLabId: vi.fn(async () => undefined),
      postRequest: vi.fn(async () => {}),
      now: () => 1,
      makeId: () => "x",
    } as unknown as RequestLabContentDeps;
    const res = await requestLabContent(
      { owner: "emile", recordType: "datahub", recordId: "dh-1" },
      deps,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not bound to a lab/);
  });
});

describe("member request actions", () => {
  it("loadMyContentRequests returns the member's pending requests", async () => {
    const requests = [
      { id: "r1", requester: "pi", recordType: "datahub", recordId: "dh-1", requestedAt: 1 },
    ];
    const deps = {
      ...ctx("member", "emile"),
      listRequests: vi.fn(async () => requests),
      approveRequest: vi.fn(async () => []),
      grantStore: { load: vi.fn(async () => []), save: vi.fn(async () => {}) },
      now: () => 1000,
    } as unknown as MemberRequestDeps;
    const res = await loadMyContentRequests(deps);
    expect(res.ok).toBe(true);
    expect(res.requests).toEqual(requests);
  });

  it("approveMyContentRequest approves with the member context", async () => {
    const approveRequest = vi.fn(async () => []);
    const deps = {
      ...ctx("member", "emile"),
      listRequests: vi.fn(async () => []),
      approveRequest,
      grantStore: { load: vi.fn(async () => []), save: vi.fn(async () => {}) },
      now: () => 5000,
    } as unknown as MemberRequestDeps;
    const request = { id: "r1", requester: "pi", recordType: "datahub", recordId: "dh-1", requestedAt: 1 };
    const res = await approveMyContentRequest(request, deps);
    expect(res.ok).toBe(true);
    const arg = (approveRequest.mock.calls as unknown as [Record<string, unknown>][])[0][0];
    expect(arg.member).toBe("emile");
    expect(arg.request).toEqual(request);
    expect(arg.nowMs).toBe(5000);
  });
});
