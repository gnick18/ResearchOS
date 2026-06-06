// Cross-boundary sharing, WebAuthn passkey glue (PRF extension).
// Passkey identity unlock, chunk 3 (enrollment + unlock browser glue).
//
// This is the ONLY module that calls navigator.credentials. It uses WebAuthn
// purely as a local key-wrapping primitive, NOT as a server authentication. We
// never send the assertion to a server and never verify it server-side. The only
// thing we take from the ceremony is the PRF output, a deterministic per-credential
// secret keyed to our fixed salt, which passkey.ts turns into the wrapping key for
// the identity private bundle. Security comes from that PRF output being required
// to unwrap the directory blob, the assertion signature plays no role here.
//
// Browser support, Chrome and Edge (the only browsers ResearchOS supports, the
// File System Access requirement already excludes the rest) implement the prf
// extension. We still feature-detect and surface a typed error so callers degrade
// to the recovery-code path instead of breaking.
//
// See docs/proposals/PASSKEY_IDENTITY_UNLOCK.md.

// A fixed, public PRF salt. Public is fine, the security is the authenticator-held
// credential, not salt secrecy. Stable forever, changing it orphans every passkey.
// 32 bytes derived from the ASCII of "researchos/sharing/passkey-prf/salt/v1".
const PRF_SALT = new TextEncoder().encode(
  "researchos/sharing/passkey-prf/salt/v1",
);

const RP_NAME = "ResearchOS";

/** Raised when this browser cannot do passkeys at all. */
export class PasskeyUnsupportedError extends Error {
  constructor() {
    super("Passkeys are not supported in this browser");
    this.name = "PasskeyUnsupportedError";
  }
}

/** Raised when the authenticator completed but returned no PRF output. */
export class PasskeyPrfUnavailableError extends Error {
  constructor() {
    super("This passkey did not return a PRF secret");
    this.name = "PasskeyPrfUnavailableError";
  }
}

/** Raised when the user dismissed or cancelled the passkey prompt. */
export class PasskeyCancelledError extends Error {
  constructor() {
    super("The passkey prompt was cancelled");
    this.name = "PasskeyCancelledError";
  }
}

/**
 * Whether this browser exposes the WebAuthn API at all. PRF support itself cannot
 * be probed synchronously, so callers must still handle PasskeyPrfUnavailableError
 * from an actual ceremony.
 */
export function isPasskeySupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.credentials
  );
}

/**
 * The relying-party id the passkey is bound to. WebAuthn requires this to be a
 * registrable suffix of the page origin, so we use the current hostname. In
 * production that is research-os.app (the canonical domain), and in development
 * it is localhost. A passkey enrolled under one hostname does not resolve under
 * another, which is why production must serve from the canonical domain.
 */
export function getRpId(): string {
  return typeof window !== "undefined" ? window.location.hostname : "localhost";
}

// base64url helpers for the credential id, which we persist as a string and feed
// back into allowCredentials on unlock.
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function randomChallenge(): Uint8Array {
  const c = new Uint8Array(32);
  crypto.getRandomValues(c);
  return c;
}

// WebAuthn fields want a BufferSource backed by a concrete ArrayBuffer. The DOM
// lib in current TS rejects a generic Uint8Array<ArrayBufferLike>, so we hand it
// a fresh ArrayBuffer copy of the bytes.
function toBuffer(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

// The DOM lib types do not yet describe the prf extension, so we narrow through a
// small local shape rather than scatter `any`. These match the WebAuthn L3 prf
// extension exactly.
type PrfExtensionInput = { prf: { eval: { first: BufferSource } } };
interface PrfExtensionOutput {
  prf?: { results?: { first?: ArrayBuffer | undefined } };
}

function readPrfOutput(credential: PublicKeyCredential): Uint8Array | null {
  const results = credential.getClientExtensionResults() as PrfExtensionOutput;
  const first = results.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}

function isCancellation(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotAllowedError";
}

export interface EnrollPasskeyParams {
  /** Stable opaque handle for this identity (the raw Ed25519 public key bytes). */
  userId: Uint8Array;
  /** The email or label shown in the platform passkey sheet. */
  userName: string;
  /** A friendly display name shown in the sheet. */
  userDisplayName: string;
}

export interface EnrolledPasskey {
  /** base64url credential id, stored in the sidecar for later unlock. */
  credentialId: string;
  /** The PRF secret, fed to passkey.ts to wrap the private bundle. */
  prfOutput: Uint8Array;
}

/**
 * Creates a passkey and returns its PRF output. Some authenticators do not return
 * the PRF result on create, so when it is missing we immediately run a get() to
 * read it, which is transparent to the user on platform authenticators.
 */
export async function enrollPasskey(
  params: EnrollPasskeyParams,
): Promise<EnrolledPasskey> {
  if (!isPasskeySupported()) throw new PasskeyUnsupportedError();

  const creationOptions: PublicKeyCredentialCreationOptions = {
    challenge: toBuffer(randomChallenge()),
    rp: { id: getRpId(), name: RP_NAME },
    user: {
      id: toBuffer(params.userId),
      name: params.userName,
      displayName: params.userDisplayName,
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 }, // ES256
      { type: "public-key", alg: -257 }, // RS256
    ],
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
    timeout: 120_000,
    extensions: { prf: { eval: { first: PRF_SALT } } } as PrfExtensionInput,
  };

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: creationOptions,
    })) as PublicKeyCredential | null;
  } catch (err) {
    if (isCancellation(err)) throw new PasskeyCancelledError();
    throw err;
  }
  if (!credential) throw new PasskeyCancelledError();

  const credentialId = bytesToBase64Url(new Uint8Array(credential.rawId));

  // Prefer the PRF output the create ceremony returned. When the platform omits
  // it (common), read it with a follow-up assertion against the new credential.
  const fromCreate = readPrfOutput(credential);
  if (fromCreate) return { credentialId, prfOutput: fromCreate };

  const prfOutput = await getPasskeyPrf(credentialId);
  return { credentialId, prfOutput };
}

/**
 * Runs an assertion against an existing passkey and returns its PRF output. Used
 * to unlock on a device that already (or newly) holds the credential. Throws
 * PasskeyPrfUnavailableError if the authenticator returns no PRF result, and
 * PasskeyCancelledError if the user dismisses the prompt.
 */
export async function getPasskeyPrf(credentialId: string): Promise<Uint8Array> {
  if (!isPasskeySupported()) throw new PasskeyUnsupportedError();

  const requestOptions: PublicKeyCredentialRequestOptions = {
    challenge: toBuffer(randomChallenge()),
    rpId: getRpId(),
    allowCredentials: [
      { type: "public-key", id: toBuffer(base64UrlToBytes(credentialId)) },
    ],
    userVerification: "preferred",
    timeout: 120_000,
    extensions: { prf: { eval: { first: PRF_SALT } } } as PrfExtensionInput,
  };

  let assertion: PublicKeyCredential | null;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: requestOptions,
    })) as PublicKeyCredential | null;
  } catch (err) {
    if (isCancellation(err)) throw new PasskeyCancelledError();
    throw err;
  }
  if (!assertion) throw new PasskeyCancelledError();

  const prfOutput = readPrfOutput(assertion);
  if (!prfOutput) throw new PasskeyPrfUnavailableError();
  return prfOutput;
}
