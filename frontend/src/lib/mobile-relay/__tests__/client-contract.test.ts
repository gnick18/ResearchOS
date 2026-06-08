// Contract test: the capture-relay client's canonical signed strings and grant
// payload must be byte-identical to relay/scripts/smoke-capture.mjs (the source
// of truth the deployed worker also mirrors). The smoke builders are replicated
// here verbatim and asserted against the client's exported builders + a real
// makePairingGrant round-trip with a freshly generated key.

import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import {
  _canonical,
  makePairingGrant,
  type UserCaptureKeys,
} from "@/lib/mobile-relay/client";

// ---- Replicated verbatim from relay/scripts/smoke-capture.mjs -------------

function smokePairGrantMessage(u: string, pid: string, exp: string, url: string): string {
  return `researchos-pair-grant\nu=${u}\npid=${pid}\nexp=${exp}\nurl=${url}`;
}
function smokeReadMessage(action: string, u: string, ts: string, extra?: string): string {
  const base = `researchos-capture-${action}\nu=${u}\nts=${ts}`;
  return extra ? `${base}\n${extra}` : base;
}

const enc = new TextEncoder();
function smokeSign(message: string, secretKey: Uint8Array): string {
  return bytesToHex(ed25519.sign(enc.encode(message), secretKey));
}

// --------------------------------------------------------------------------

describe("capture-relay client contract", () => {
  it("canonical strings match the smoke contract byte-for-byte", () => {
    const u = "a".repeat(64);
    const ts = "2026-06-07T12:00:00.000Z";
    const pid = "pair-abc";
    const exp = "2026-06-07T12:05:00.000Z";
    const url = "https://relay.example.workers.dev";

    expect(_canonical.capturePairGrantMessage(u, pid, exp, url)).toBe(
      smokePairGrantMessage(u, pid, exp, url),
    );
    expect(_canonical.captureReadMessage("inbox", u, ts)).toBe(
      smokeReadMessage("inbox", u, ts),
    );
    expect(_canonical.captureReadMessage("object", u, ts, `id=cap-1`)).toBe(
      smokeReadMessage("object", u, ts, `id=cap-1`),
    );
    expect(_canonical.captureReadMessage("ack", u, ts, `ids=a,b,c`)).toBe(
      smokeReadMessage("ack", u, ts, `ids=a,b,c`),
    );
    expect(_canonical.captureReadMessage("devices", u, ts)).toBe(
      smokeReadMessage("devices", u, ts),
    );
    expect(_canonical.captureReadMessage("revoke", u, ts, `device=dev-1`)).toBe(
      smokeReadMessage("revoke", u, ts, `device=dev-1`),
    );
  });

  it("makePairingGrant produces a grant the smoke verifier accepts", () => {
    const sk = ed25519.utils.randomSecretKey();
    const pk = bytesToHex(ed25519.getPublicKey(sk));
    const keys: UserCaptureKeys = {
      ed25519PublicKeyHex: pk,
      ed25519PrivateKey: sk,
    };
    const relayUrl = "https://relay.example.workers.dev";

    const { pairingId, exp, qrPayload } = makePairingGrant(keys, relayUrl);

    // The QR string is exactly {"grant":{u,pid,exp,url},"sig"} (smoke shape).
    const parsed = JSON.parse(qrPayload) as {
      grant: { u: string; pid: string; exp: string; url: string };
      sig: string;
    };
    expect(parsed.grant.u).toBe(pk);
    expect(parsed.grant.pid).toBe(pairingId);
    expect(parsed.grant.exp).toBe(exp);
    expect(parsed.grant.url).toBe(relayUrl);

    // The signature verifies over the smoke canonical grant message, exactly
    // what the worker's handleRegister recomputes.
    const message = smokePairGrantMessage(pk, pairingId, exp, relayUrl);
    const ok = ed25519.verify(hexToBytes(parsed.sig), enc.encode(message), hexToBytes(pk));
    expect(ok).toBe(true);

    // And the smoke signer over the same fields yields the identical signature
    // (deterministic Ed25519), proving byte-equal signed bytes.
    expect(parsed.sig).toBe(smokeSign(message, sk));
  });
});
