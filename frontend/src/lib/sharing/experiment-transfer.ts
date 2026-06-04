// Cross-boundary sharing, EXPERIMENT transfer adapter.
//
// This is the thin seam between an experiment (a Task plus everything the app
// already knows how to export, notes, results, methods, attachments, and now
// task dependencies) and the relay transport. Unlike the note adapter
// (note-transfer.ts), it does NOT build an RO-Crate bundle. The genuinely hard
// part, packing a composite experiment and re-materializing it with full
// id-remap, already exists as the local export/import feature. Cross-boundary
// experiment sharing wraps that, the payload on the wire is the existing
// `researchos-experiment` export zip (export/raw.ts via exportExperiments),
// sealed and relayed by the byte-agnostic relay client (sendRawShare /
// receiveRawShare).
//
//   SEND     -> buildExperimentSendPayload
//     Runs the existing single-task export ("raw" format) and returns the zip
//     bytes ready to seal. No new packing logic, the export path already
//     bundles the task, its notes/results markdown plus attachments, every
//     referenced method (record + protocol + body/PDF), and the task's
//     dependency records (Gap 1 fix). The caller seals + relays these bytes
//     with entityType "experiment".
//
//   RECEIVE  -> the inbox hands the decrypted bytes to the EXISTING import
//     resolution flow (parse + the project/per-method resolution UI in
//     ImportExperimentDialog, then applyImportPlan). experimentPayloadToFile
//     wraps the decrypted bytes as a File so that dialog, whose entry point is
//     a file picker, can drive them unchanged. sniffSharePayload lets the inbox
//     decide note-vs-experiment from the decrypted bytes alone, since the relay
//     is blind and never records an entity type.
//
// ACK-AFTER-WRITE. As with notes, the inbox acks the relay only AFTER the
// import resolves on disk. Nothing here touches the relay.

import JSZip from "jszip";

import { exportExperiments } from "@/lib/export/orchestrate";
import {
  readManifestSender,
  stampExperimentSender,
} from "@/lib/sharing/sender-stamp";
import type { Task } from "@/lib/types";

/**
 * Builds the payload bytes for sharing one experiment, the existing
 * researchos-experiment export zip for the task. The bytes are exactly what the
 * local "Export experiment (raw)" feature produces, so the recipient's existing
 * import pipeline can parse them with zero new format work.
 *
 * The one send-path difference from a local export, the manifest is re-stamped
 * with the sender's verified PUBLIC identity (email + fingerprint) read from
 * their sharing identity sidecar, so the recipient's inbox attributes the share
 * to a real person instead of the relay key hash (mirrors the note bundle's
 * sender block). This re-stamp is additive and SEND-ONLY, the plain local export
 * never carries it. When the sender has not claimed a sharing identity the stamp
 * is skipped and the bundle ships sender-free, the recipient falls back to the
 * hash exactly as for a pre-attribution bundle.
 *
 * @param task        the experiment to share (a single Task).
 * @param currentUser the folder-local owner, threaded into the export path so
 *                    it can read the task's notes/results/methods/attachments
 *                    and dependency records off disk, and used to read the
 *                    sender's identity sidecar for the attribution stamp.
 * @returns the export zip as raw bytes, ready for sendRawShare to seal.
 */
export async function buildExperimentSendPayload(
  task: Task,
  currentUser: string | null,
): Promise<Uint8Array> {
  // A single task always yields the native per-experiment result (the
  // {name}-raw.zip blob), never the multi-task wrapper. We pass "raw" because
  // that is the round-trippable format the import pipeline reads.
  const result = await exportExperiments([task], "raw", currentUser);
  const buf = await result.blob.arrayBuffer();
  const sender = await readManifestSender(currentUser);
  return stampExperimentSender(new Uint8Array(buf), sender);
}

/**
 * The kinds of payload the inbox can dispatch on after decrypting. "note" is
 * the RO-Crate-in-BagIt bundle (bundle.ts), "experiment" is the
 * researchos-experiment export zip (export/raw.ts), "unknown" is neither (an
 * unsupported or malformed payload the inbox should let the user decline).
 */
export type SharePayloadKind =
  | "note"
  | "experiment"
  | "method"
  | "project"
  | "sequence"
  | "unknown";

/**
 * Sniffs decrypted payload bytes to decide which importer the inbox should use.
 * The relay is blind and stores no entity type, so the only source of truth is
 * the decrypted content itself. The payload kinds are zips, but their marker
 * files are disjoint and unambiguous,
 *   - experiment: a top-level `_export-manifest.json` (export/raw.ts) WITHOUT a
 *                 `kind: "method"` field.
 *   - method:     the SAME `_export-manifest.json` envelope, marked
 *                 `kind: "method"` (method-transfer.ts). A standalone method
 *                 reuses the experiment envelope so the unchanged importer can
 *                 read it, so the only way to tell it from an experiment is this
 *                 one manifest field.
 *   - note:       a BagIt bag, `<uuid>/bagit.txt` + `<uuid>/data/
 *                 ro-crate-metadata.json` (bundle.ts), no `_export-manifest.json`.
 *   - sequence:   a small PLAIN JSON envelope `{ kind: "sequence", ... }`
 *                 (sequence-transfer.ts), NOT a zip. Detected up front by a cheap
 *                 JSON probe so it is never confused with the zip-based kinds.
 * Returns "unknown" if the bytes are not a zip or carry neither marker.
 */
export async function sniffSharePayload(
  bytes: Uint8Array,
): Promise<SharePayloadKind> {
  // A sequence share is a small plain-JSON envelope, not a zip. Probe it FIRST,
  // cheaply, so a sequence is never run through the (failing) JSZip path. We do
  // a minimal in-line decode + parse here rather than importing the sequence
  // module to avoid pulling its local-api dependency into this transport seam.
  if (looksLikeSequenceEnvelope(bytes)) return "sequence";

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return "unknown";
  }

  // A project bundle (export/project-bundle.ts) writes `_project-manifest.json`
  // at the zip root, disjoint from the experiment/method marker
  // (`_export-manifest.json`) and the note BagIt markers. Check it first, a
  // project bundle nests per-experiment bundles but never carries a TOP-LEVEL
  // `_export-manifest.json`, so this branch is unambiguous.
  if (zip.file("_project-manifest.json")) {
    return "project";
  }

  // The experiment export (and the method bundle, which reuses the same
  // envelope) writes _export-manifest.json at the zip root. Read it to
  // distinguish a method bundle (kind: "method") from an experiment bundle (no
  // kind). A malformed / unreadable manifest still resolves to "experiment" so
  // the existing importer surfaces its own parse error, the pre-method behavior.
  const manifestEntry = zip.file("_export-manifest.json");
  if (manifestEntry) {
    try {
      const parsed = JSON.parse(await manifestEntry.async("string")) as {
        kind?: unknown;
      };
      if (parsed && parsed.kind === "method") return "method";
    } catch {
      // fall through to "experiment"
    }
    return "experiment";
  }

  // A note bundle is a BagIt bag, look for the RO-Crate metadata or bagit.txt
  // under the single top-level bag directory. Match on the path suffix so we
  // do not have to know the (uuid) directory name.
  let looksLikeNote = false;
  zip.forEach((relativePath) => {
    if (
      relativePath.endsWith("/data/ro-crate-metadata.json") ||
      relativePath.endsWith("/bagit.txt")
    ) {
      looksLikeNote = true;
    }
  });
  if (looksLikeNote) return "note";

  return "unknown";
}

/**
 * Wraps decrypted experiment-export bytes as a File so the existing
 * ImportExperimentDialog (whose entry point is a file picker reading a
 * .zip File) can drive them through the unchanged parse + resolve + apply
 * pipeline. The name is cosmetic, the importer reads the manifest inside.
 */
export function experimentPayloadToFile(
  bytes: Uint8Array,
  baseName = "shared-experiment",
): File {
  // Copy into a fresh ArrayBuffer-backed view so the Blob part is a plain
  // ArrayBuffer (a SharedArrayBuffer-backed view is not a valid BlobPart).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], `${baseName}-raw.zip`, { type: "application/zip" });
}

/**
 * Cheap, allocation-light probe for a sequence envelope (sequence-transfer.ts).
 * A zip starts with the local-file-header magic "PK" (0x50 0x4B), so any zip
 * fails this and falls through to the zip path. A sequence envelope is a small
 * UTF-8 JSON object whose first non-whitespace byte is "{". We decode and JSON-
 * parse only when that cheap byte check passes, and confirm `kind === "sequence"`.
 * Tolerant, any failure resolves to false (the bytes fall through to the zip path
 * and ultimately "unknown" if they are neither).
 */
function looksLikeSequenceEnvelope(bytes: Uint8Array): boolean {
  // Skip leading ASCII whitespace, then require the first real byte to be "{".
  let i = 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) {
    i++;
  }
  if (i >= bytes.length || bytes[i] !== 0x7b /* { */) return false;
  try {
    const text = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text) as { kind?: unknown };
    return !!parsed && parsed.kind === "sequence";
  } catch {
    return false;
  }
}
