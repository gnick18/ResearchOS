import { describe, it, expect, vi, beforeEach } from "vitest";

// The guard + rate limiter are mocked so the route's own logic (token
// validation + the GENERIC, content-free payload) is what is under test, not the
// env/KV plumbing. isSharingEnabled is flipped per-test.
let sharingEnabled = true;
const limit = vi.fn();
vi.mock("@/lib/sharing/directory/guard", () => ({
  isSharingEnabled: () => sharingEnabled,
  extractClientIp: () => "1.2.3.4",
  json: (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
}));
vi.mock("@/lib/sharing/directory/ratelimit", () => ({
  getInviteLimiter: () => ({ limit: (...a: unknown[]) => limit(...a) }),
}));

import { POST } from "@/app/api/send-push/route";

function req(body: unknown): Request {
  return new Request("https://app/api/send-push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/send-push", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sharingEnabled = true;
    limit.mockReset().mockResolvedValue({ success: true });
    fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("404s when sharing (and thus push infra) is disabled", async () => {
    sharingEnabled = false;
    const res = await POST(req({ tokens: ["ExponentPushToken[a]"] }));
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("429s when rate limited", async () => {
    limit.mockResolvedValue({ success: false });
    const res = await POST(req({ tokens: ["ExponentPushToken[a]"] }));
    expect(res.status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends ONLY a generic body and the coarse category, never content", async () => {
    const res = await POST(
      req({ tokens: ["ExponentPushToken[abc]"], category: "shared" }),
    );
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    const messages = JSON.parse((init as RequestInit).body as string);
    expect(messages).toHaveLength(1);
    const m = messages[0];
    expect(m.to).toBe("ExponentPushToken[abc]");
    expect(m.title).toBe("ResearchOS");
    // The body is a fixed generic string, not anything derived from a payload.
    expect(m.body).toBe("Something new was shared with you");
    // The only data is the snapshot kind + the coarse category. No item name,
    // no notification text, no ids.
    expect(m.data).toEqual({ kind: "notifications", category: "shared" });
  });

  it("falls back to the generic default body for an unknown category", async () => {
    await POST(req({ tokens: ["ExponentPushToken[abc]"], category: "nope" }));
    const messages = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(messages[0].body).toBe("New activity in your lab");
  });

  it("drops malformed tokens and dedups, then sends to the valid ones", async () => {
    await POST(
      req({
        tokens: [
          "ExponentPushToken[a]",
          "ExponentPushToken[a]", // duplicate
          "not-a-token",
          "javascript:alert(1)",
          123,
          "ExpoPushToken[b]", // the other accepted prefix
        ],
      }),
    );
    const messages = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(messages.map((m: { to: string }) => m.to)).toEqual([
      "ExponentPushToken[a]",
      "ExpoPushToken[b]",
    ]);
  });

  it("acks quietly without calling Expo when no valid token is present", async () => {
    const res = await POST(req({ tokens: ["not-a-token"] }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; sent: number };
    expect(json).toEqual({ ok: true, sent: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
