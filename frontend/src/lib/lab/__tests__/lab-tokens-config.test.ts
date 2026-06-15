import { describe, it, expect, afterEach } from "vitest";
import { isLabTokensV2Enabled } from "@/lib/lab/lab-tokens-config";
import { generateInviteToken } from "@/lib/invites/invite-tokens";
import { decodeInviteFragment, mintLabInvite } from "@/lib/lab/lab-invite";

// The lab/join page must tell a Phase-4B unified server token (a bare 64-hex
// string) apart from a Phase-8b signed-invite payload (base64url JSON), so the
// existing signed-invite flow stays untouched while the token flow is added.
const BARE_TOKEN_RE = /^[0-9a-f]{64}$/;

describe("lab tokens v2 flag", () => {
  const original = process.env.NEXT_PUBLIC_LAB_TOKENS_V2;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_LAB_TOKENS_V2;
    else process.env.NEXT_PUBLIC_LAB_TOKENS_V2 = original;
  });

  it("defaults OFF when the env var is unset", () => {
    delete process.env.NEXT_PUBLIC_LAB_TOKENS_V2;
    expect(isLabTokensV2Enabled()).toBe(false);
  });

  it("is on only for explicit 1 / true", () => {
    process.env.NEXT_PUBLIC_LAB_TOKENS_V2 = "1";
    expect(isLabTokensV2Enabled()).toBe(true);
    process.env.NEXT_PUBLIC_LAB_TOKENS_V2 = "true";
    expect(isLabTokensV2Enabled()).toBe(true);
    process.env.NEXT_PUBLIC_LAB_TOKENS_V2 = "0";
    expect(isLabTokensV2Enabled()).toBe(false);
    process.env.NEXT_PUBLIC_LAB_TOKENS_V2 = "yes";
    expect(isLabTokensV2Enabled()).toBe(false);
  });
});

describe("token vs signed-invite fragment discrimination", () => {
  it("a unified token is a bare 64-hex string", () => {
    expect(generateInviteToken()).toMatch(BARE_TOKEN_RE);
  });

  it("a signed invite fragment is NOT a bare token (stays on the old flow)", () => {
    const priv = new Uint8Array(32).fill(7);
    // mintLabInvite needs a real-ish key only to produce a payload; the encoded
    // fragment is base64url JSON, which never matches the bare-token regex.
    const invite = mintLabInvite({
      labId: "lab-1",
      headUsername: "pi",
      headEd25519Pub: "ab".repeat(32),
      headX25519Pub: "cd".repeat(32),
      headEd25519Priv: priv,
      expiresAt: Date.now() + 1000,
      nonce: "ef".repeat(32),
    });
    const fragment = btoa(JSON.stringify(invite))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(fragment).not.toMatch(BARE_TOKEN_RE);
    // And it still decodes as a signed invite, so the old path keeps working.
    expect(decodeInviteFragment(fragment)).not.toBeNull();
  });

  it("a bare token does NOT decode as a signed invite", () => {
    expect(decodeInviteFragment(generateInviteToken())).toBeNull();
  });
});
