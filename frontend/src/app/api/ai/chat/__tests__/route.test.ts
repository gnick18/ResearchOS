import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pins for the local dev proxy at /api/ai/chat. The proxy holds the inference key
// server-side, forwards the per-turn context to the provider's OpenAI-compatible
// endpoint with stream: true, and proxies the SSE body back. These tests assert:
//   - the missing-key path returns a clear 500 without crashing;
//   - a configured key forwards to the env-configured endpoint with a Bearer
//     auth header and stream: true, and streams the upstream body back;
//   - the key value is never returned to the client (no leak).
// The provider call is mocked, so no network and no real key are involved.

const ORIGINAL_ENV = { ...process.env };

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  // Re-import per test so the route reads the current process.env.
  vi.resetModules();
  return await import("../route");
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.AI_API_KEY;
  delete process.env.AI_PROXY_BASE_URL;
  delete process.env.AI_MODEL;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/ai/chat", () => {
  it("returns a clear 500 telling the dev to add the key when AI_API_KEY is missing", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] }));
    expect(res.status).toBe(500);
    const data = (await res.json()) as { error: string };
    expect(data.error).toMatch(/AI_API_KEY/);
    expect(data.error).toMatch(/\.env\.local/);
  });

  it("rejects a request with no messages", async () => {
    process.env.AI_API_KEY = "test-key-should-not-leak";
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ messages: [] }));
    expect(res.status).toBe(400);
  });

  it("forwards to the configured endpoint with a Bearer header and streams the body back", async () => {
    process.env.AI_API_KEY = "test-key-should-not-leak";
    process.env.AI_PROXY_BASE_URL = "https://example.test/v1";
    process.env.AI_MODEL = "test-model";

    // A fake streamed upstream response.
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
          ),
        );
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n"));
        controller.close();
      },
    });

    const fetchMock = vi.fn(async () =>
      new Response(upstreamBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({ messages: [{ role: "user", content: "hello" }] }),
    );

    expect(res.status).toBe(200);

    // It called the env-configured endpoint exactly once.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://example.test/v1/chat/completions");

    // An Authorization header is present (Bearer scheme). We assert PRESENCE and
    // scheme without surfacing the secret value beyond what the test set.
    const headers = init.headers as Record<string, string>;
    const auth = headers.authorization ?? headers.Authorization;
    expect(auth).toBeDefined();
    expect(auth).toMatch(/^Bearer /);

    // The forwarded body requests streaming against the configured model.
    const sent = JSON.parse(init.body as string) as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(sent.model).toBe("test-model");
    expect(sent.stream).toBe(true);
    expect(sent.messages).toEqual([{ role: "user", content: "hello" }]);

    // The response streams the upstream body straight back.
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const text = await res.text();
    expect(text).toContain('"content":"hi"');
    expect(text).toContain("[DONE]");

    // The key never appears in the response sent to the client.
    expect(text).not.toContain("test-key-should-not-leak");
    expect(res.headers.get("authorization")).toBeNull();
  });

  it("returns 502 without leaking detail when the upstream call throws", async () => {
    process.env.AI_API_KEY = "test-key-should-not-leak";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom test-key-should-not-leak");
      }),
    );
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({ messages: [{ role: "user", content: "hi" }] }),
    );
    expect(res.status).toBe(502);
    const data = (await res.json()) as { error: string };
    expect(data.error).not.toContain("test-key-should-not-leak");
  });
});
