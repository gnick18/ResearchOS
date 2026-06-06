// Tests for the offline Recovery Kit, the build/parse round-trip, the tolerant
// parser, the null-rejection cases, and an end-to-end-ish proof that a kit built
// from real identity material enables real offline recovery via
// restoreFromRecoveryWords with no email and no network.

import { describe, expect, it } from "vitest";

import {
  buildRecoveryKitHtml,
  parseRecoveryKit,
  type RecoveryKitData,
} from "../recovery-kit";
import {
  createIdentityMaterial,
  restoreFromRecoveryWords,
} from "../setup";
import { type KdfParams } from "../backup";

// A minimal but structurally valid BackupBlob string (has a ciphertext field).
// Used for the pure parse/round-trip tests so they stay fast.
const SAMPLE_BLOB = JSON.stringify({
  v: 1,
  alg: "argon2id",
  t: 1,
  m: 8,
  p: 1,
  salt: "AAAA",
  nonce: "BBBB",
  ciphertext: "Q0lQSEVSVEVYVA==",
});

const SAMPLE_DATA: RecoveryKitData = {
  email: "researcher@wisc.edu",
  fingerprint: "ABCD 1234 EFGH 5678",
  backupBlob: SAMPLE_BLOB,
  createdAt: "2026-06-05T12:00:00.000Z",
};

// Fast Argon2id params for the end-to-end crypto test. Never PROD_KDF_PARAMS in
// a test, those allocate 64 MiB and take hundreds of ms.
const FAST_KDF: KdfParams = { t: 1, m: 8, p: 1, dkLen: 32 };

describe("recovery kit build/parse round-trip", () => {
  it("preserves email, fingerprint, backupBlob, and createdAt", () => {
    const html = buildRecoveryKitHtml(SAMPLE_DATA);
    const parsed = parseRecoveryKit(html);
    expect(parsed).not.toBeNull();
    expect(parsed?.email).toBe(SAMPLE_DATA.email);
    expect(parsed?.fingerprint).toBe(SAMPLE_DATA.fingerprint);
    expect(parsed?.backupBlob).toBe(SAMPLE_DATA.backupBlob);
    expect(parsed?.createdAt).toBe(SAMPLE_DATA.createdAt);
  });

  it("produces a human-readable HTML document with the identity details", () => {
    const html = buildRecoveryKitHtml(SAMPLE_DATA);
    expect(html).toContain("ResearchOS Recovery Kit");
    expect(html).toContain("researcher@wisc.edu");
    expect(html).toContain("ABCD 1234 EFGH 5678");
  });

  it("accepts a v2 key-backup envelope as the backupBlob (current format)", () => {
    const envelopeBlob = JSON.stringify({
      v: 2,
      mnemonic: JSON.parse(SAMPLE_BLOB),
    });
    const data: RecoveryKitData = { ...SAMPLE_DATA, backupBlob: envelopeBlob };
    const parsed = parseRecoveryKit(buildRecoveryKitHtml(data));
    expect(parsed).not.toBeNull();
    expect(parsed?.backupBlob).toBe(envelopeBlob);
  });

  it("tolerates a raw JSON envelope string, not just full HTML", () => {
    const html = buildRecoveryKitHtml(SAMPLE_DATA);
    // Extract the embedded JSON envelope and feed it raw.
    const match = html.match(
      /<script\b[^>]*id="researchos-recovery-kit"[^>]*>([\s\S]*?)<\/script>/i,
    );
    expect(match).not.toBeNull();
    const rawJson = (match as RegExpMatchArray)[1].trim();
    const parsed = parseRecoveryKit(rawJson);
    expect(parsed).not.toBeNull();
    expect(parsed?.email).toBe(SAMPLE_DATA.email);
    expect(parsed?.backupBlob).toBe(SAMPLE_DATA.backupBlob);
  });
});

describe("recovery kit rejection cases", () => {
  it("returns null for non-kit HTML", () => {
    expect(parseRecoveryKit("<html><body>not a kit</body></html>")).toBeNull();
  });

  it("returns null for the wrong kind", () => {
    const wrongKind = JSON.stringify({
      kind: "something-else",
      version: 1,
      email: "a@b.com",
      fingerprint: "ABCD",
      createdAt: "2026-06-05",
      backupBlob: SAMPLE_BLOB,
    });
    expect(parseRecoveryKit(wrongKind)).toBeNull();
  });

  it("returns null when backupBlob is missing", () => {
    const noBlob = JSON.stringify({
      kind: "researchos-recovery-kit",
      version: 1,
      email: "a@b.com",
      fingerprint: "ABCD",
      createdAt: "2026-06-05",
    });
    expect(parseRecoveryKit(noBlob)).toBeNull();
  });

  it("returns null when backupBlob has no ciphertext field", () => {
    const badBlob = JSON.stringify({
      kind: "researchos-recovery-kit",
      version: 1,
      email: "a@b.com",
      fingerprint: "ABCD",
      createdAt: "2026-06-05",
      backupBlob: JSON.stringify({ v: 1, alg: "argon2id" }),
    });
    expect(parseRecoveryKit(badBlob)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseRecoveryKit("{ this is not valid json")).toBeNull();
  });

  it("returns null when email is empty", () => {
    const emptyEmail = JSON.stringify({
      kind: "researchos-recovery-kit",
      version: 1,
      email: "   ",
      fingerprint: "ABCD",
      createdAt: "2026-06-05",
      backupBlob: SAMPLE_BLOB,
    });
    expect(parseRecoveryKit(emptyEmail)).toBeNull();
  });
});

describe("recovery kit never leaks the recovery words", () => {
  it("does not embed the words anywhere in the kit HTML", () => {
    // Build from real material so a real words string exists to search for.
    const material = createIdentityMaterial({ params: FAST_KDF });
    const html = buildRecoveryKitHtml({
      email: "leak-check@wisc.edu",
      fingerprint: material.fingerprint,
      backupBlob: material.backupBlob,
      createdAt: new Date().toISOString(),
    });

    // The full phrase must be absent.
    expect(html).not.toContain(material.recoveryWords);

    // No contiguous run of the words must appear either. Individual BIP39 words
    // are common English ("add", "ice", "use") and legitimately show up in the
    // kit's prose, so a per-word search would false-positive. A leak would mean a
    // multi-word RUN of the actual phrase survives, so we check that every
    // adjacent pair from the phrase is absent.
    const phraseWords = material.recoveryWords.split(/\s+/);
    for (let i = 0; i < phraseWords.length - 1; i += 1) {
      const pair = `${phraseWords[i]} ${phraseWords[i + 1]}`;
      expect(html).not.toContain(pair);
    }
  });
});

describe("recovery kit enables real offline recovery", () => {
  it("round-trips through restoreFromRecoveryWords to the same ed25519 key", () => {
    const material = createIdentityMaterial({ params: FAST_KDF });

    // Build a kit from the material's blob, then parse it straight back, exactly
    // as the offline restore UI would after a file upload.
    const html = buildRecoveryKitHtml({
      email: "offline@wisc.edu",
      fingerprint: material.fingerprint,
      backupBlob: material.backupBlob,
      createdAt: new Date().toISOString(),
    });
    const parsed = parseRecoveryKit(html);
    expect(parsed).not.toBeNull();

    // Recover from the words plus the parsed blob, no email, no network.
    const restored = restoreFromRecoveryWords(
      material.recoveryWords,
      (parsed as RecoveryKitData).backupBlob,
    );

    expect(restored.ed25519PublicKey).toBe(material.ed25519PublicKey);
    expect(restored.x25519PublicKey).toBe(material.x25519PublicKey);
  });
});
