// Mobile DOWNLOAD path, the laptop bulk METHOD-LIBRARY publisher (offline
// method-library sync, 2026-06-13).
//
// Builds a snapshot of the WHOLE method library the current user can see (their
// own methods PLUS the lab-shared / public ones, exactly the set
// fetchAllMethodsIncludingShared returns) as FULL read-mode projections, seals
// it once per paired phone to that phone's X25519 key, and publishes it to the
// capture relay under the "library" name. The relay only ever holds the sealed
// bytes, so a phone with the matching device key is the only thing that can read
// its own snapshot. The phone caches it locally and renders read mode for any
// method offline, no signal needed at the bench.
//
// This mirrors calculators-snapshot.ts / method-snapshot.ts and reuses the SAME
// per-type projection builders (PCR / LC / compound / body) so a library method
// carries full bench detail, identical to the focused "method" snapshot. The
// difference is scope: "method" is the focused experiment's attached methods
// (with per-experiment overrides), "library" is the user's entire library (no
// overrides, the canonical source recipe).
//
// Relay key: "library" (single blob). See the chunking TODO + manifest shape at
// the bottom for libraries that would exceed the relay blob ceiling.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { fetchAllMethodsIncludingShared } from "@/lib/local-api";
import { sealToRecipient } from "@/lib/sharing/encryption";
import { decodePublicKey } from "@/lib/sharing/identity/keys";
import { listDevices, publishSnapshot, type UserCaptureKeys } from "./client";
import {
  resolveMethodType,
  buildPcrProjection,
  buildLcProjection,
  buildCompoundProjection,
  buildBody,
  type MethodProjection,
} from "./method-snapshot";
import type { Method } from "@/lib/types";

/**
 * One library method as the phone sees it. It is a FULL MethodProjection (the
 * same shape read mode renders for the focused "method" snapshot) plus a little
 * library metadata: a stable owner-namespaced `uid` for list keys + selection,
 * the `ownerLabel` for a "Shared by <owner>" line, and `isShared` so the phone
 * can badge a lab-shared method. `methodId` on the base projection is the
 * numeric record id; `uid` is what the phone keys + routes on.
 */
export interface LibraryMethodEntry extends MethodProjection {
  /** Stable, owner-namespaced id. Two members with the same numeric record id
   *  never collide on the phone (e.g. "alex:5" vs "self:5"). */
  uid: string;
  /** Owner username, for the "Shared by <owner>" line on a lab method. */
  ownerLabel: string;
  /** True when owned by another lab member (read-only, via the whole-lab share
   *  or a direct shared-in). The phone badges it. */
  isShared: boolean;
}

/** The decrypted shape the phone reads after openSealed. `version` is a stable
 *  content hash (see computeLibraryVersion) so the phone only re-saves when a
 *  method actually changed, not on every publish. */
export interface LibrarySnapshot {
  generatedAt: string;
  version: string;
  methods: LibraryMethodEntry[];
}

// ── Projection ────────────────────────────────────────────────────────────────

/**
 * Project one library method to its FULL read view. No attachment is threaded
 * (a library method carries no per-experiment override), so the per-type builder
 * reads the canonical source protocol. One method failing to project never drops
 * the whole library: we keep the name + type so the phone still lists it, just
 * without the recipe detail (same resilience as buildMethodSnapshot).
 */
async function projectLibraryMethod(
  method: Method,
  allMethods: Method[],
): Promise<LibraryMethodEntry> {
  const resolvedType = resolveMethodType(method.method_type, method.source_path);
  const owner = method.owner ?? "";
  const entry: LibraryMethodEntry = {
    methodId: method.id,
    name: method.name,
    methodType: method.method_type ?? null,
    resolvedType,
    keyParams: [],
    uid: `${owner || "self"}:${method.id}`,
    ownerLabel: owner,
    isShared: method.is_shared_with_me === true,
  };

  try {
    if (resolvedType === "pcr") {
      const { pcr, keyParams } = await buildPcrProjection(method, undefined);
      entry.pcr = pcr;
      entry.keyParams = keyParams;
    } else if (resolvedType === "lc_gradient") {
      const { lc, keyParams } = await buildLcProjection(method, undefined);
      entry.lc = lc;
      entry.keyParams = keyParams;
    } else if (resolvedType === "compound") {
      const { compound, keyParams } = await buildCompoundProjection(method, allMethods);
      entry.compound = compound;
      entry.keyParams = keyParams;
    } else {
      // markdown, pdf, plate, cell_culture, mass_spec, coding_workflow,
      // qpcr_analysis: the protocol body / source text is the common
      // denominator, same as the focused method snapshot.
      entry.body = await buildBody(method, undefined);
    }
  } catch (err) {
    console.warn(
      `[library-publisher] failed to project method ${method.id} (${resolvedType})`,
      err instanceof Error ? err.message : String(err),
    );
  }

  return entry;
}

// ── Version hash ────────────────────────────────────────────────────────────

/**
 * Stable content hash over the projected library. The phone compares this
 * `version` against its cached version and only re-saves when it differs. The
 * laptop keeps the last published hash in a module var and skips the seal +
 * upload entirely when nothing changed (see TodaySnapshotPublisher), so the
 * normal cadence is cheap.
 *
 * The hash is computed over the FULL projected content (sorted by uid), so it
 * is identical when nothing changed and changes only when a method's name,
 * type, or recipe changes. It is deterministic (no timestamps, no random
 * nonce). lowercase hex SHA-256.
 */
async function computeLibraryVersion(methods: LibraryMethodEntry[]): Promise<string> {
  // Sort by uid so member ordering / fetch order never perturbs the hash.
  const sorted = [...methods].sort((a, b) => a.uid.localeCompare(b.uid));
  // Hash the projected content WITHOUT generatedAt (which changes every build).
  // Each entry's full projection (recipe + key params + body) is included, so a
  // recipe edit flips the hash even when the name is unchanged.
  const canonical = sorted.map((m) => ({
    uid: m.uid,
    name: m.name,
    methodType: m.methodType,
    resolvedType: m.resolvedType,
    isShared: m.isShared,
    keyParams: m.keyParams,
    pcr: m.pcr ?? null,
    lc: m.lc ?? null,
    compound: m.compound ?? null,
    body: m.body ?? null,
  }));
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const copy = bytes.slice();
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Snapshot builder ───────────────────────────────────────────────────────

/**
 * Read every method the current user can see and build the full library
 * snapshot. The `version` is a stable content hash (see computeLibraryVersion),
 * so the caller can skip a re-publish when it has not changed.
 */
export async function buildLibrarySnapshot(): Promise<LibrarySnapshot> {
  const allMethods = await fetchAllMethodsIncludingShared().catch(() => [] as Method[]);

  const methods: LibraryMethodEntry[] = [];
  for (const method of allMethods) {
    methods.push(await projectLibraryMethod(method, allMethods));
  }

  const version = await computeLibraryVersion(methods);

  return {
    generatedAt: new Date().toISOString(),
    version,
    methods,
  };
}

// ── Publisher ─────────────────────────────────────────────────────────────────

/**
 * Build the library snapshot once, seal a copy to each paired phone's X25519
 * key, and publish it to the relay under the "library" name. Mirrors
 * publishCalculatorsToAllDevices / publishMethodToAllDevices exactly.
 *
 * Returns how many devices it published to vs skipped (no seal key on file),
 * plus the snapshot `version` so the caller can record the last published hash
 * and skip the next publish when nothing changed.
 *
 * SIZE NOTE. This publishes a SINGLE "library" blob. A very large library could
 * exceed the relay blob ceiling (~1 MB sealed). Chunking is left as a TODO; see
 * the manifest shape below. For the typical lab library (tens to low hundreds of
 * methods) a single blob is well under the ceiling.
 */
export async function publishLibraryToAllDevices(
  keys: UserCaptureKeys,
): Promise<{ published: number; skipped: number; version: string }> {
  const snap = await buildLibrarySnapshot();
  return publishLibrarySnapshot(keys, snap);
}

/**
 * Seal + publish a PREBUILT library snapshot to each paired phone. Split from
 * publishLibraryToAllDevices so the caller (TodaySnapshotPublisher) can build
 * the snapshot once, compare its content hash against the last published hash,
 * and skip the seal + upload entirely when nothing changed. The hash gate keeps
 * the normal cadence cheap (the build is the only cost when unchanged; the
 * per-device seal + network upload is skipped).
 */
export async function publishLibrarySnapshot(
  keys: UserCaptureKeys,
  snap: LibrarySnapshot,
): Promise<{ published: number; skipped: number; version: string }> {
  const devices = await listDevices(keys);
  if (devices.length === 0) return { published: 0, skipped: 0, version: snap.version };

  const plaintext = new TextEncoder().encode(JSON.stringify(snap));

  // TODO(chunking): when `plaintext` (sealed) would exceed ~1 MB, split
  // snap.methods into N chunks published as "library-0", "library-1", ... and a
  // small manifest under "library-index":
  //   { version: string, count: number, chunkSizes?: number[] }
  // The phone reads "library-index" first, then fetches each "library-<i>" and
  // concatenates the methods. A single "library" blob (this path) and a chunked
  // "library-index" + "library-<i>" set are mutually exclusive per publish.

  let published = 0;
  let skipped = 0;
  for (const device of devices) {
    if (!device.x25519Pubkey) {
      console.info(
        `[library-publisher] skip device ${device.devicePubkey.slice(0, 12)}... (no x25519 seal key)`,
      );
      skipped += 1;
      continue;
    }
    const sealed = sealToRecipient(
      plaintext,
      decodePublicKey(device.x25519Pubkey),
    );
    await publishSnapshot(keys, "library", device.devicePubkey, sealed);
    published += 1;
  }
  return { published, skipped, version: snap.version };
}
