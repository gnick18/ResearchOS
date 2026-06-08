// Cross-boundary sharing, verified-sender attribution for the export-zip tiers.
//
// Notes embed the sender's verified identity inside the sealed RO-Crate bundle
// (BundleSender, bundle.ts), so the recipient's inbox attributes a received note
// to a real person instead of the relay key hash. Experiment / method / project
// shares ride the export-zip payload (researchos-experiment / researchos-project),
// which the PLAIN local export builds with no sender block. This module closes
// that gap WITHOUT touching the local export path, it re-stamps an already-built
// bundle's manifest with the sender's PUBLIC identity, read from their sharing
// identity sidecar.
//
// SEND PATH ONLY. The local "Export experiment / project" feature never calls
// this, so a locally exported bundle stays sender-free and the import pipeline
// reads it unchanged (the manifest field is additive + optional). The three
// sharing transfer wrappers call this after building their bundle, so the
// embedded sender exists only on bundles that travel the relay.
//
// GRACEFUL when the sender has not claimed a sharing identity, readSharingIdentity
// returns null, this returns the bundle bytes untouched, and the recipient falls
// back to the relay hash exactly as for a pre-attribution bundle.

import JSZip from "jszip";

import type {
  ManifestSender,
  RawManifest,
} from "@/lib/export/types";
import {
  PROJECT_MANIFEST_FILE,
  type ProjectBundleManifest,
} from "@/lib/export/project-bundle";
import { readSharingIdentity } from "@/lib/sharing/identity/sidecar";

/**
 * Read the sender's PUBLIC verified identity (email + fingerprint) from their
 * sharing-identity sidecar, shaped for embedding in a share manifest. Returns
 * null when the user has not claimed a sharing identity (the bundle then ships
 * sender-free and the recipient falls back to the relay hash).
 *
 * @param currentUser the folder-local username whose sidecar to read. Pass the
 *                    sender (the signed-in user driving the share). Null when no
 *                    user is resolved, in which case there is no identity to read.
 */
export async function readManifestSender(
  currentUser: string | null,
): Promise<ManifestSender | undefined> {
  if (!currentUser) return undefined;
  const identity = await readSharingIdentity(currentUser);
  // A LOCAL-ONLY identity has no email (it was never published to the directory),
  // so it cannot stamp a verified-sender block. Ship sender-free in that case and
  // let the recipient fall back to the relay hash, the same graceful path as a
  // user who never set up sharing at all.
  if (!identity || !identity.email) return undefined;
  return { email: identity.email, fingerprint: identity.fingerprint };
}

/**
 * Re-stamp a freshly built `researchos-experiment` bundle's manifest with the
 * verified `sender` block. Mirrors method-transfer's stampMethodKind, rewrites
 * the one manifest entry and leaves every other zip entry byte-for-byte intact,
 * so the existing import pipeline reads the bundle unchanged. A no-op (returns
 * the original bytes) when there is no sender, so a sender without a claimed
 * identity ships a valid pre-attribution bundle.
 *
 * @param bytes  the experiment/method export zip from buildRawZip / exportExperiments.
 * @param sender the verified sender block, or undefined to leave the bundle as is.
 */
export async function stampExperimentSender(
  bytes: Uint8Array,
  sender: ManifestSender | undefined,
): Promise<Uint8Array> {
  if (!sender) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file("_export-manifest.json");
  // Never lose the bundle over a missing marker (buildRawZip always writes it),
  // ship the unstamped bytes and let the recipient fall back to the relay hash.
  if (!entry) return bytes;

  const raw = await entry.async("string");
  let manifest: RawManifest;
  try {
    manifest = JSON.parse(raw) as RawManifest;
  } catch {
    // Malformed manifest: ship the bundle unstamped rather than aborting the
    // whole send (the recipient falls back to the relay hash), honoring this
    // function's graceful-degradation contract.
    return bytes;
  }
  manifest.sender = sender;
  zip.file("_export-manifest.json", JSON.stringify(manifest, null, 2));

  // Preserve deterministic entry mtimes from the manifest's exported_at so the
  // re-stamp does not perturb the bundle's date stamps (raw.ts stamps every
  // entry with the export date).
  const exportDate = manifest.exported_at
    ? new Date(manifest.exported_at)
    : null;
  if (exportDate && !Number.isNaN(exportDate.getTime())) {
    for (const e of Object.values(zip.files)) {
      e.date = exportDate;
    }
  }
  return zip.generateAsync({ type: "uint8array" });
}

/**
 * Read the embedded verified-sender block from a decrypted export-zip payload
 * (experiment, method, or project), for the inbox to attribute the share. Reads
 * `_export-manifest.json` (experiment / method) first, then the project
 * manifest, returning the first `sender` it finds. Returns undefined for a
 * pre-attribution bundle (no sender), a local export, or unreadable bytes, in
 * which case the inbox falls back to the relay key hash.
 *
 * Tolerant by design, any parse failure resolves to undefined rather than
 * throwing, so a malformed manifest never breaks the receive flow (the
 * downstream importer surfaces its own parse error).
 */
export async function readManifestSenderFromPayload(
  bytes: Uint8Array,
): Promise<ManifestSender | undefined> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return undefined;
  }

  const expEntry = zip.file("_export-manifest.json");
  if (expEntry) {
    try {
      const manifest = JSON.parse(await expEntry.async("string")) as RawManifest;
      if (isManifestSender(manifest.sender)) return manifest.sender;
    } catch {
      // fall through, treat as no sender
    }
  }

  const projEntry = zip.file(PROJECT_MANIFEST_FILE);
  if (projEntry) {
    try {
      const manifest = JSON.parse(
        await projEntry.async("string"),
      ) as ProjectBundleManifest;
      if (isManifestSender(manifest.sender)) return manifest.sender;
    } catch {
      // fall through, treat as no sender
    }
  }

  return undefined;
}

/** Narrow an unknown manifest `sender` to a usable ManifestSender (a non-empty
 *  email string, which is what the badge attributes on). Guards against an
 *  older/malformed bundle that carries a partial block. */
function isManifestSender(value: unknown): value is ManifestSender {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { email?: unknown }).email === "string" &&
    (value as { email: string }).email.trim().length > 0
  );
}

/**
 * Re-stamp a freshly built `researchos-project` bundle's manifest with the
 * verified `sender` block. The project sibling of stampExperimentSender, rewrites
 * only `_project-manifest.json` and leaves the nested per-experiment bundles
 * untouched. A no-op when there is no sender.
 *
 * @param bytes  the project bundle from buildProjectBundle.
 * @param sender the verified sender block, or undefined to leave the bundle as is.
 */
export async function stampProjectSender(
  bytes: Uint8Array,
  sender: ManifestSender | undefined,
): Promise<Uint8Array> {
  if (!sender) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file(PROJECT_MANIFEST_FILE);
  if (!entry) return bytes;

  const raw = await entry.async("string");
  let manifest: ProjectBundleManifest;
  try {
    manifest = JSON.parse(raw) as ProjectBundleManifest;
  } catch {
    // Malformed manifest: ship the bundle unstamped rather than aborting the
    // whole send, honoring this function's graceful-degradation contract.
    return bytes;
  }
  manifest.sender = sender;
  zip.file(PROJECT_MANIFEST_FILE, JSON.stringify(manifest, null, 2));

  const exportDate = manifest.exported_at
    ? new Date(manifest.exported_at)
    : null;
  if (exportDate && !Number.isNaN(exportDate.getTime())) {
    for (const e of Object.values(zip.files)) {
      e.date = exportDate;
    }
  }
  return zip.generateAsync({ type: "uint8array" });
}
