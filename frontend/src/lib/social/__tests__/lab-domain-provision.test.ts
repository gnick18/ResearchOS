import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isLabDomainProvisioningEnabled,
  provisionLabDomain,
  reconcileLabDomains,
} from "../lab-domain-provision";

// A helper to stub global.fetch with a scripted Response.
function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

const TOKEN = "test-token";

describe("lab-domain-provision", () => {
  const origToken = process.env.VERCEL_API_TOKEN;

  beforeEach(() => {
    process.env.VERCEL_API_TOKEN = TOKEN;
  });
  afterEach(() => {
    if (origToken === undefined) delete process.env.VERCEL_API_TOKEN;
    else process.env.VERCEL_API_TOKEN = origToken;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is inert with no token and makes no request", async () => {
    delete process.env.VERCEL_API_TOKEN;
    expect(isLabDomainProvisioningEnabled()).toBe(false);
    const fetchFn = stubFetch(201, {});
    const r = await provisionLabDomain("smithlab");
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe("no token");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reports enabled when the token is set", () => {
    expect(isLabDomainProvisioningEnabled()).toBe(true);
  });

  it("adds the subdomain and targets the right host, url, and body", async () => {
    const fetchFn = stubFetch(201, { name: "smithlab.research-os.com" });
    const r = await provisionLabDomain("smithlab");
    expect(r).toMatchObject({
      ok: true,
      added: true,
      host: "smithlab.research-os.com",
      status: 201,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toContain("https://api.vercel.com/v10/projects/");
    expect(url).toContain("/domains?teamId=");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      name: "smithlab.research-os.com",
    });
  });

  it("treats a domain already on this project as idempotent success", async () => {
    stubFetch(409, { error: { code: "domain_already_in_use_by_project" } });
    const r = await provisionLabDomain("smithlab");
    expect(r.ok).toBe(true);
    expect(r.added).toBe(false);
    expect(r.status).toBe(409);
  });

  it("treats domain_already_exists 409 as success too", async () => {
    stubFetch(409, { error: { code: "domain_already_exists" } });
    const r = await provisionLabDomain("smithlab");
    expect(r.ok).toBe(true);
    expect(r.added).toBe(false);
    expect(r.status).toBe(409);
  });

  it("treats a 409 with an unknown error code as idempotent success (covers fakeyeast-lab case)", async () => {
    // Prod observed: a lab with a manual cert that IS on the project can return a
    // 409 with a code that does not match the two previously hard-coded strings.
    // Any 409 must now be counted as existed, not failed.
    stubFetch(409, { error: { code: "some_other_code_we_have_not_seen" } });
    const r = await provisionLabDomain("fakeyeast-lab");
    expect(r.ok).toBe(true);
    expect(r.added).toBe(false);
    expect(r.status).toBe(409);
  });

  it("treats a 409 with no parseable body as idempotent success", async () => {
    // Guard against non-JSON 409 responses from Vercel.
    const fn = vi.fn(async () => new Response("conflict", { status: 409 }));
    vi.stubGlobal("fetch", fn);
    const r = await provisionLabDomain("smithlab");
    expect(r.ok).toBe(true);
    expect(r.added).toBe(false);
    expect(r.status).toBe(409);
  });

  it("fails on a real error status and surfaces the code", async () => {
    stubFetch(403, { error: { code: "forbidden" } });
    const r = await provisionLabDomain("smithlab");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.error).toBe("forbidden");
  });

  it("fails closed on a network error without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    const r = await provisionLabDomain("smithlab");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("network");
  });

  it("rejects a malformed slug before making a request", async () => {
    const fetchFn = stubFetch(201, {});
    const r = await provisionLabDomain("Bad_Slug!");
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe("bad slug");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reconcile tallies added, existed, and failed across slugs", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const name = JSON.parse(init.body as string).name as string;
      if (name.startsWith("added")) return new Response("{}", { status: 201 });
      if (name.startsWith("existed"))
        return new Response(
          JSON.stringify({ error: { code: "domain_already_exists" } }),
          { status: 409 },
        );
      return new Response(
        JSON.stringify({ error: { code: "boom" } }),
        { status: 500 },
      );
    });
    vi.stubGlobal("fetch", fetchFn);

    const report = await reconcileLabDomains(["added-a", "existed-b", "fail-c"]);
    expect(report.scanned).toBe(3);
    expect(report.added).toBe(1);
    expect(report.existed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.failures).toEqual(["fail-c.research-os.com"]);
  });

  it("reconcile counts any 409 (unknown code) as existed, never failed", async () => {
    // Regression: fakeyeast-lab returned a 409 with an unrecognized code and was
    // previously counted as failed. The reconcile summary should now count it as
    // existed so the cron does not alert on already-provisioned labs.
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const name = JSON.parse(init.body as string).name as string;
      if (name.startsWith("new-lab")) return new Response("{}", { status: 201 });
      // Unknown 409 codes from already-provisioned labs
      return new Response(
        JSON.stringify({ error: { code: "some_internal_vercel_code" } }),
        { status: 409 },
      );
    });
    vi.stubGlobal("fetch", fetchFn);

    const report = await reconcileLabDomains(["new-lab-x", "fakeyeast-lab", "another-old-lab"]);
    expect(report.scanned).toBe(3);
    expect(report.added).toBe(1);
    expect(report.existed).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.failures).toEqual([]);
  });
});
