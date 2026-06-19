// Lab identity + branding: the relay client for a lab's cosmetic profile.
//
// A lab's branding (lab name, PI title, PI display name, logo) is COSMETIC. It
// never gates access, so it lives in the LabRecordDO meta + the LAB_DATA R2
// bucket, NOT in the head-signed membership log. Reads are open (the invite page
// shows the branding to a not-yet-member); writes are head-signed via the same
// freshness-windowed Ed25519 scheme the accept-list / dismiss routes use.
//
// Mirrors the signing + relayHttpBase pattern in lab-do-client.ts /
// lab-accept-client.ts.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { COLLAB_RELAY_URL } from "@/lib/loro/config";
import { LAB_TIER_ENABLED } from "./config";

function relayHttpBase(): string {
  return COLLAB_RELAY_URL.replace(/^ws/, "http");
}

function ensureEnabled(): void {
  if (!LAB_TIER_ENABLED) {
    throw new Error("lab tier is disabled (LAB_TIER_ENABLED is false)");
  }
}

function signHex(message: string, privateKey: Uint8Array): string {
  return bytesToHex(ed25519.sign(new TextEncoder().encode(message), privateKey));
}

/** The cosmetic branding a lab exposes on its open profile read. */
export interface LabProfile {
  labName?: string;
  piTitle?: string;
  piDisplay?: string;
  hasLogo?: boolean;
}

/**
 * OPEN read of a lab's cosmetic profile. Returns null when the lab does not exist
 * (404) or on any network error, so a caller can treat "no profile" and "lab not
 * found" the same (fall back to the head username). Never throws.
 */
export async function fetchLabProfile(labId: string): Promise<LabProfile | null> {
  ensureEnabled();
  try {
    const res = await fetch(
      `${relayHttpBase()}/lab/profile/get?lab=${encodeURIComponent(labId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      labName?: string;
      piTitle?: string;
      piDisplay?: string;
      hasLogo?: boolean;
    };
    return {
      labName: j.labName || undefined,
      piTitle: j.piTitle || undefined,
      piDisplay: j.piDisplay || undefined,
      hasLogo: Boolean(j.hasLogo),
    };
  } catch {
    return null;
  }
}

/**
 * HEAD side. Updates the cosmetic branding (lab name, PI title, PI display name).
 * Signs "lab-profile\n<labId>\n<labName>\n<piTitle>\n<piDisplay>\n<issuedAt>" with
 * the head's Ed25519 key. Returns the raw Response so the caller can branch on
 * status.
 */
export async function updateLabProfile(
  labId: string,
  profile: { labName: string; piTitle: string; piDisplay: string },
  headEd25519Priv: Uint8Array,
): Promise<Response> {
  ensureEnabled();
  const issuedAt = Date.now();
  const { labName, piTitle, piDisplay } = profile;
  const signature = signHex(
    `lab-profile\n${labId}\n${labName}\n${piTitle}\n${piDisplay}\n${issuedAt}`,
    headEd25519Priv,
  );
  return fetch(
    `${relayHttpBase()}/lab/profile?lab=${encodeURIComponent(labId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labName, piTitle, piDisplay, issuedAt, signature }),
    },
  );
}

/**
 * Turns a failed head-signed lab write Response into an actionable message that
 * states the real reason, and returns the raw relay error string for logging so
 * a live test can pin down WHICH gate rejected the write. The relay bodies are
 * stable strings from requireHeadSig / the lab DO (see relay/src/worker.ts):
 *   - 404 "lab does not exist"       -> the genesis publish never landed.
 *   - 401 "stale or missing issuedAt"-> the device clock is too far off.
 *   - 401 "bad head signature"       -> this device is not the lab's head key.
 * Reads the body at most once; safe to call on any non-ok Response.
 */
export async function describeLabWriteError(
  res: Response,
): Promise<{ message: string; raw: string }> {
  let raw = "";
  try {
    const j = (await res.json()) as { error?: unknown };
    if (typeof j.error === "string") raw = j.error;
  } catch {
    // Body was not JSON (proxy error page, empty body). Fall back to the status.
  }
  let message: string;
  if (res.status === 404 || raw === "lab does not exist") {
    message =
      "Your lab is not saved on the server yet, so its details could not be updated. Reconnect your folder and try again in a moment.";
  } else if (raw === "stale or missing issuedAt") {
    message =
      "Your computer's clock is too far off, so the server rejected the change. Set the clock to update automatically, then save again.";
  } else if (raw === "bad head signature") {
    message =
      "This device is not recognized as the lab head, so it cannot change the lab details. Sign in on the device that created the lab.";
  } else {
    message = `Could not save (HTTP ${res.status}${raw ? ", " + raw : ""}).`;
  }
  return { message, raw: raw || `HTTP ${res.status}` };
}

/**
 * HEAD side. Uploads a lab logo. The raw image bytes are the POST body; the
 * content-type is the Content-Type header. The signature + issuedAt ride in the
 * query string so the body stays the raw image. Signs
 * "lab-logo\n<labId>\n<sha256hex>\n<issuedAt>" (sha256 of the bytes). Returns the
 * raw Response so the caller can branch on status.
 */
export async function uploadLabLogo(
  labId: string,
  fileBytes: Uint8Array,
  contentType: string,
  headEd25519Priv: Uint8Array,
): Promise<Response> {
  ensureEnabled();
  const issuedAt = Date.now();
  const shaHex = bytesToHex(sha256(fileBytes));
  const signature = signHex(
    `lab-logo\n${labId}\n${shaHex}\n${issuedAt}`,
    headEd25519Priv,
  );
  const qs = `lab=${encodeURIComponent(labId)}&issuedAt=${issuedAt}&sig=${signature}`;
  // Copy into a fresh ArrayBuffer so the body is a plain BodyInit (a Uint8Array
  // view's underlying buffer may be larger than the view).
  const buf = fileBytes.slice().buffer;
  return fetch(`${relayHttpBase()}/lab/logo?${qs}`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: buf,
  });
}

/**
 * The relay GET url for a lab's logo. Cache-busted with a per-call timestamp so a
 * freshly uploaded logo is not masked by a stale cache. The image element renders
 * 404 as a broken load, so callers should only render it when hasLogo is true.
 */
export function labLogoUrl(labId: string): string {
  return `${relayHttpBase()}/lab/logo?lab=${encodeURIComponent(labId)}&t=${Date.now()}`;
}
