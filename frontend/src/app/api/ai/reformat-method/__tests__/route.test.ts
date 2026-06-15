import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pins for POST /api/ai/reformat-method. The route holds the inference key
// server-side, asks the model to restructure a method body into clean markdown,
// and then enforces the verbatim guardrail: an output that invents or changes any
// value is REFUSED (ok:false) so the caller falls back to the deterministic
// parse. The provider call is mocked, so no network and no real key are involved.
//
// Mock auth so importing the route does not pull next-auth into the graph.
vi.mock("@/lib/sharing/auth", () => ({ auth: vi.fn(async () => null) }));

const ORIGINAL_ENV = { ...process.env };

const SOURCE =
  "Resuspend the pellet in 250 uL of buffer P1. Add 250 uL P2, incubate 5 min. Spin at 13000 rpm for 10 min, elute in 30 uL water.";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/ai/reformat-method", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A fake non-streaming OpenAI-compatible completion carrying `content`. */
function mockProvider(content: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 100, completion_tokens: 80 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
}

async function loadRoute() {
  vi.resetModules();
  return await import("../route");
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.AI_API_KEY;
  delete process.env.AI_BILLING_ENABLED;
  delete process.env.AI_PROXY_BASE_URL;
  delete process.env.AI_MODEL;
  delete process.env.AI_REFORMAT_MODEL;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/ai/reformat-method", () => {
  it("returns a clear 500 when AI_API_KEY is missing", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ body: SOURCE }));
    expect(res.status).toBe(500);
    const data = (await res.json()) as { error: string };
    expect(data.error).toMatch(/AI_API_KEY/);
  });

  it("rejects an empty body", async () => {
    process.env.AI_API_KEY = "test-key-should-not-leak";
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ body: "   " }));
    expect(res.status).toBe(400);
  });

  it("returns ok:true with the tidied markdown for a faithful reformat", async () => {
    process.env.AI_API_KEY = "test-key-should-not-leak";
    // Faithful reformat: structure only, every word drawn from the source.
    const faithful =
      "1. Resuspend the pellet in 250 uL of buffer P1.\n2. Add 250 uL P2, incubate 5 min.\n3. Spin at 13000 rpm for 10 min, elute in 30 uL water.";
    mockProvider(faithful);
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ body: SOURCE }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; reformatted: string };
    expect(data.ok).toBe(true);
    expect(data.reformatted).toContain("250 uL P2");
    // the key must never appear in the response
    expect(JSON.stringify(data)).not.toContain("test-key-should-not-leak");
  });

  it("REFUSES (ok:false) when the model changes a value", async () => {
    process.env.AI_API_KEY = "test-key-should-not-leak";
    const tampered =
      "1. Resuspend the pellet in 250 uL of buffer P1.\n2. Add 250 uL P2, incubate 5 min.\n3. Spin at 99000 rpm for 10 min, elute in 30 uL water.";
    mockProvider(tampered);
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ body: SOURCE }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      ok: boolean;
      reason: string;
      invented_numerics: string[];
    };
    expect(data.ok).toBe(false);
    expect(data.reason).toBe("validation_failed");
    expect(data.invented_numerics).toContain("99000");
  });

  it("strips a wrapping code fence the model adds", async () => {
    process.env.AI_API_KEY = "test-key-should-not-leak";
    const fenced =
      "```markdown\n1. Resuspend the pellet in 250 uL of buffer P1. Add 250 uL P2, incubate 5 min. Spin at 13000 rpm for 10 min, elute in 30 uL water.\n```";
    mockProvider(fenced);
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ body: SOURCE }));
    const data = (await res.json()) as { ok: boolean; reformatted: string };
    expect(data.ok).toBe(true);
    expect(data.reformatted.startsWith("```")).toBe(false);
  });
});
