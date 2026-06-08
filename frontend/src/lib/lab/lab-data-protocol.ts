// Lab data store signed-message contract (lab-tier Phase 3 chunk 1).
//
// THE CONTRACT. The client signs the UTF-8 of these exact strings with its
// Ed25519 signing key, and the relay worker re-builds the identical string and
// ed25519-verifies it against a roster pubkey. The relay keeps a byte-identical
// copy of these builders in relay/src/worker.ts (labDataPutMessage /
// labDataListMessage); if you change one, change both, or signatures stop
// verifying.
//
// The "lab-data-put" / "lab-data-list" verbs are domain-separated so a put
// signature can never be replayed as a list and vice versa.
//
// Pure string builders, no crypto, no network. The R2 object key for a record is
// `${labId}/${owner}/${recordType}/${recordId}`; labDataObjectKey builds it so
// the put canonical message and the storage key cannot drift apart.
//
// No emojis, no em-dashes, no mid-sentence colons.

/**
 * The R2 object key for one lab record. SERVER-BLIND, the value stored under it
 * is lab-key ciphertext; the key path itself is plaintext routing metadata
 * (labId + owner + recordType + recordId), which is what lets the PI enumerate
 * a member's records by prefix.
 */
export function labDataObjectKey(
  labId: string,
  owner: string,
  recordType: string,
  recordId: string,
): string {
  return `${labId}/${owner}/${recordType}/${recordId}`;
}

/**
 * Canonical PUT message, signed by a lab member or the head. ciphertextSha256 is
 * the lowercase hex sha256 of the exact ciphertext bytes being stored, so the
 * signature binds the precise blob (a tampered blob or swapped key fails
 * verification). issuedAt is the signer's millisecond epoch (replay window
 * checked by the relay).
 */
export function labDataPutMessage(params: {
  labId: string;
  owner: string;
  recordType: string;
  recordId: string;
  ciphertextSha256: string;
  issuedAt: number;
}): string {
  return [
    "lab-data-put",
    `labId=${params.labId}`,
    `owner=${params.owner}`,
    `recordType=${params.recordType}`,
    `recordId=${params.recordId}`,
    `sha256=${params.ciphertextSha256}`,
    `issuedAt=${params.issuedAt}`,
  ].join("\n");
}

/**
 * Canonical LIST message, signed by a lab member or the head. prefix is the
 * R2-list prefix under the lab (for example `<owner>` or `<owner>/<recordType>`).
 * issuedAt is the signer's millisecond epoch.
 */
export function labDataListMessage(params: {
  labId: string;
  prefix: string;
  issuedAt: number;
}): string {
  return [
    "lab-data-list",
    `labId=${params.labId}`,
    `prefix=${params.prefix}`,
    `issuedAt=${params.issuedAt}`,
  ].join("\n");
}
