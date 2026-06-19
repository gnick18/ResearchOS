// Lab identity + branding: unit tests for the cosmetic profile relay client.
//
// The relay LabRecordDO lives in workerd; here we mock fetch and pin the parts
// that MUST be byte-exact with the DO: the head-signed message formats for the
// profile update + the logo upload, the open profile read shape, and the cache-
// busted logo url. The lab tier flag is forced on via a module mock so the
// ensureEnabled gate does not short-circuit the calls.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

// Force the lab tier on so ensureEnabled() does not throw, and pin the relay
// origin so the asserted urls are deterministic.
vi.mock("./config", () => ({ LAB_TIER_ENABLED: true }));
vi.mock("@/lib/loro/config", () => ({ COLLAB_RELAY_URL: "wss://relay.test" }));

import {
  fetchLabProfile,
  updateLabProfile,
  uploadLabLogo,
  labLogoUrl,
  describeLabWriteError,
} from "./lab-profile-client";

function headKeys() {
  const priv = ed25519.utils.randomSecretKey();
  const pub = ed25519.getPublicKey(priv);
  return { priv, pub };
}

function verify(sigHex: string, message: string, pubHex: string): boolean {
  return ed25519.verify(
    hexToBytes(sigHex),
    new TextEncoder().encode(message),
    hexToBytes(pubHex),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fetchLabProfile", () => {
  it("returns the normalized profile on a 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            labName: "Fungal Interactions Lab",
            piTitle: "Dr.",
            piDisplay: "Emile Gluck-Thaler",
            hasLogo: true,
          }),
          { status: 200 },
        ),
      ),
    );
    const p = await fetchLabProfile("lab-1");
    expect(p).toEqual({
      labName: "Fungal Interactions Lab",
      piTitle: "Dr.",
      piDisplay: "Emile Gluck-Thaler",
      hasLogo: true,
    });
  });

  it("coerces empty strings to undefined and missing hasLogo to false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ labName: "", piTitle: "", piDisplay: "" }), {
          status: 200,
        }),
      ),
    );
    const p = await fetchLabProfile("lab-1");
    expect(p).toEqual({
      labName: undefined,
      piTitle: undefined,
      piDisplay: undefined,
      hasLogo: false,
    });
  });

  it("returns null on a 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
    expect(await fetchLabProfile("nope")).toBeNull();
  });

  it("returns null on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await fetchLabProfile("lab-1")).toBeNull();
  });
});

describe("updateLabProfile", () => {
  it("posts a head signature over the exact lab-profile message", async () => {
    const { priv, pub } = headKeys();
    let captured: { url: string; body: string } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        captured = { url, body: init.body as string };
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    const profile = {
      labName: "Fungal Interactions Lab",
      piTitle: "Dr.",
      piDisplay: "Emile Gluck-Thaler",
    };
    const res = await updateLabProfile("lab-1", profile, priv);
    expect(res.ok).toBe(true);
    expect(captured).not.toBeNull();
    const sent = JSON.parse(captured!.body) as {
      labName: string;
      piTitle: string;
      piDisplay: string;
      issuedAt: number;
      signature: string;
    };
    expect(captured!.url).toContain("/lab/profile?lab=lab-1");
    expect(sent.labName).toBe(profile.labName);
    const expectedMsg = `lab-profile\nlab-1\n${profile.labName}\n${profile.piTitle}\n${profile.piDisplay}\n${sent.issuedAt}`;
    expect(verify(sent.signature, expectedMsg, bytesToHex(pub))).toBe(true);
  });
});

describe("uploadLabLogo", () => {
  it("signs the sha256 of the bytes and carries sig + issuedAt in the query", async () => {
    const { priv, pub } = headKeys();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    let capturedUrl = "";
    let capturedCt = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedCt = (init.headers as Record<string, string>)["Content-Type"];
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    const res = await uploadLabLogo("lab-1", bytes, "image/png", priv);
    expect(res.ok).toBe(true);
    expect(capturedCt).toBe("image/png");
    const u = new URL(capturedUrl);
    expect(u.pathname).toBe("/lab/logo");
    expect(u.searchParams.get("lab")).toBe("lab-1");
    const issuedAt = Number(u.searchParams.get("issuedAt"));
    const sig = u.searchParams.get("sig") ?? "";
    const shaHex = bytesToHex(sha256(bytes));
    const expectedMsg = `lab-logo\nlab-1\n${shaHex}\n${issuedAt}`;
    expect(verify(sig, expectedMsg, bytesToHex(pub))).toBe(true);
  });
});

describe("labLogoUrl", () => {
  it("points at the relay logo GET and is cache-busted", () => {
    const url = labLogoUrl("lab-1");
    expect(url).toContain("https://relay.test/lab/logo?lab=lab-1");
    expect(url).toMatch(/[?&]t=\d+/);
  });
});

describe("updateLabProfile key continuity", () => {
  // Regression for the live-demo "Settings will not save the lab name" report:
  // the relay verifies the profile write against the head_pubkey it stored at
  // lab create. So a save signed by the SAME head key must verify, and a save
  // signed by ANY OTHER key must NOT, which is exactly the relay's
  // "bad head signature" rejection. This pins that contract client-side.
  it("verifies under the head key but not under a different key", async () => {
    const head = headKeys();
    const stranger = headKeys();
    let body = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        body = init.body as string;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    await updateLabProfile(
      "lab-1",
      { labName: "Lab", piTitle: "Dr.", piDisplay: "PI" },
      head.priv,
    );
    const sent = JSON.parse(body) as { issuedAt: number; signature: string };
    const msg = `lab-profile\nlab-1\nLab\nDr.\nPI\n${sent.issuedAt}`;
    expect(verify(sent.signature, msg, bytesToHex(head.pub))).toBe(true);
    expect(verify(sent.signature, msg, bytesToHex(stranger.pub))).toBe(false);
  });

  it("stamps a fresh issuedAt inside the relay replay window", async () => {
    const before = Date.now();
    let body = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        body = init.body as string;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    await updateLabProfile(
      "lab-1",
      { labName: "Lab", piTitle: "", piDisplay: "" },
      headKeys().priv,
    );
    const sent = JSON.parse(body) as { issuedAt: number };
    expect(sent.issuedAt).toBeGreaterThanOrEqual(before);
    expect(sent.issuedAt).toBeLessThanOrEqual(Date.now());
  });
});

describe("describeLabWriteError", () => {
  it("maps a 404 to the not-published-yet message", async () => {
    const res = new Response(JSON.stringify({ error: "lab does not exist" }), {
      status: 404,
    });
    const { message, raw } = await describeLabWriteError(res);
    expect(raw).toBe("lab does not exist");
    expect(message).toContain("not saved on the server yet");
  });

  it("maps a stale issuedAt 401 to the clock message", async () => {
    const res = new Response(
      JSON.stringify({ error: "stale or missing issuedAt" }),
      { status: 401 },
    );
    const { message, raw } = await describeLabWriteError(res);
    expect(raw).toBe("stale or missing issuedAt");
    expect(message).toContain("clock");
  });

  it("maps a bad head signature 401 to the wrong-device message", async () => {
    const res = new Response(JSON.stringify({ error: "bad head signature" }), {
      status: 401,
    });
    const { message } = await describeLabWriteError(res);
    expect(message).toContain("not recognized as the lab head");
  });

  it("falls back to the status when the body is not JSON", async () => {
    const res = new Response("<html>502</html>", { status: 502 });
    const { message, raw } = await describeLabWriteError(res);
    expect(raw).toBe("HTTP 502");
    expect(message).toContain("502");
  });
});
