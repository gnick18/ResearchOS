// Version Control Phase 0: sha256 of a canonical state string.
//
// Uses Web Crypto `crypto.subtle.digest`, the same primitive the codebase
// already uses for hashing (see local-api.ts sha1Hex). Available in both the
// browser and the Node test runtime (globalThis.crypto.subtle).

/** sha256 of a UTF-8 string, lowercase hex. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
