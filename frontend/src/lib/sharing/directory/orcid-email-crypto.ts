// ORCID-login email-capture, server-side symmetric crypto (section 18.7).
//
// ORCID OpenID Connect never returns an email (the sub claim is the 16-digit
// ORCID iD, see lib/sharing/auth.ts). ResearchOS keys every account on a
// plaintext email (ownerKeyForEmail, the billing owner, the directory hash), so
// an ORCID sign-in must capture and verify an email, then bind it to the ORCID
// iD so future ORCID logins resolve it transparently. The peppered email_hash is
// not reversible (that is the whole point of the directory pepper), so a SECOND
// representation is needed that the server CAN read back, the email encrypted at
// rest under a server secret.
//
// This module is the encrypt/decrypt half. AES-256-GCM via node:crypto, the key
// is the SHA-256 of ORCID_EMAIL_ENC_KEY (so any sufficiently long passphrase
// yields a 32-byte key), a fresh random 12-byte IV per encryption, and the GCM
// auth tag is stored so a tampered ciphertext fails to decrypt rather than
// returning garbage. The plaintext email is NEVER logged. The serialized form is
// "v1.<ivHex>.<tagHex>.<ctHex>" so the version, IV, and tag travel with the
// ciphertext in a single text column.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** The serialized-form version tag, so the format can evolve without ambiguity. */
const VERSION = "v1";

/** AES-256-GCM uses a 96-bit (12-byte) IV, the standard recommended nonce size. */
const IV_BYTES = 12;

/**
 * Derives the 32-byte AES key from the ORCID_EMAIL_ENC_KEY env secret. The key
 * is read lazily (never at module load) so a build or tsc pass needs no secret.
 * SHA-256 of the passphrase gives a fixed 32-byte key from an arbitrary-length
 * secret, so the operator can set any sufficiently long random string. Throws a
 * clear error when unset, so a misconfigured deployment fails loudly at request
 * time rather than silently encrypting under an empty key.
 */
function getKey(): Buffer {
  const secret = process.env.ORCID_EMAIL_ENC_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      "ORCID_EMAIL_ENC_KEY is not set (or is too short). The ORCID email binding cannot be encrypted without it.",
    );
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

/**
 * Encrypts a plaintext email to the serialized "v1.<ivHex>.<tagHex>.<ctHex>"
 * form. A fresh random IV per call means encrypting the same email twice yields
 * different ciphertexts (no equality oracle on the stored column). The plaintext
 * is never logged. The caller passes the already-canonicalized email so the
 * stored value matches the hash computed alongside it.
 */
export function encryptOrcidEmail(plaintextEmail: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([
    cipher.update(plaintextEmail, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("hex"),
    tag.toString("hex"),
    ct.toString("hex"),
  ].join(".");
}

/**
 * Decrypts a serialized ORCID email blob back to the plaintext email, or null
 * when the blob is malformed, the version is unknown, or the GCM auth tag does
 * not verify (a tampered or key-mismatched ciphertext). Returning null rather
 * than throwing lets the resolution path treat an unreadable binding the same as
 * a missing one, so the user simply re-captures rather than hitting a 500. The
 * plaintext is never logged.
 */
export function decryptOrcidEmail(serialized: string): string | null {
  const parts = serialized.split(".");
  if (parts.length !== 4) return null;
  const [version, ivHex, tagHex, ctHex] = parts;
  if (version !== VERSION) return null;
  try {
    const key = getKey();
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const ct = Buffer.from(ctHex, "hex");
    if (iv.length !== IV_BYTES || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  } catch {
    // A bad key, a tampered tag, or any decode error all collapse to "cannot
    // read", so the caller falls back to re-capture instead of surfacing a 500.
    return null;
  }
}
