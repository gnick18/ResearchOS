// Cross-boundary sharing, standalone SEQUENCE transfer adapter.
//
// The simplest tier. A sequence is self-contained, just GenBank text (the source
// of truth) plus a tiny metadata envelope, with no attachments, no lineage, and
// no per-task / per-method machinery. So unlike the experiment / method tiers
// (which reuse the heavy researchos-experiment export zip), this tier ships a
// SMALL hand-rolled JSON envelope, the same spirit as how the note tier carries
// a compact sanitized entity.
//
//   SEND     -> buildSequenceSendPayload
//     Reads one sequence (its GenBank text + the meta a recipient needs) and
//     produces a JSON envelope marked `kind: "sequence"`, carrying the verified
//     sender block read from the sender's identity sidecar (mirrors the other
//     tiers). The caller seals + relays the bytes with sendRawShare / inviteRawShare.
//
//   RECEIVE  -> importSequencePayload
//     Parses the decrypted envelope, creates a brand-new sequence in the
//     recipient's folder via sequencesApi.create (genbank + display_name +
//     seq_type), DROPS project_ids (the recipient does not have the sender's
//     projects, so the sequence lands Unfiled), then stamps the provenance
//     fields onto the new sequence's sidecar. Returns the new sequence id.
//
// ONE-CLICK IMPORT. A sequence has nothing to resolve (no project link to map,
// no method to localize), so the inbox imports it in one step, decrypt -> create
// -> stamp -> ack, with no resolution dialog. See SharedWithMeTab.
//
// ACK-AFTER-WRITE. importSequencePayload must fully write the new sequence pair
// before it resolves, the inbox acks the relay only after this promise settles,
// so a crash mid-import leaves the bundle on the relay to retry.

import { sequencesApi } from "@/lib/local-api";
import { sequenceStore } from "@/lib/sequences/sequence-store";
import { readManifestSender } from "@/lib/sharing/sender-stamp";
import type { ManifestSender } from "@/lib/export/types";
import type { SeqType, SequenceDetail } from "@/lib/types";

/**
 * The wire envelope for a shared sequence. A small JSON object (not a zip),
 * marked with a distinct `kind: "sequence"` so the inbox sniff cannot confuse it
 * with the note RO-Crate (a BagIt zip) or the experiment / method / project
 * export manifest (a researchos-* zip). `version` is for forward-compat.
 */
export interface SequenceSharePayload {
  /** The distinct kind marker the inbox sniff routes on. */
  kind: "sequence";
  /** Envelope schema version. v1 ships now. */
  version: 1;
  /** User-facing name the recipient sees (the GenBank LOCUS is the fallback). */
  display_name: string;
  /** Molecule kind, so the recipient's create does not have to re-derive it. */
  seq_type: SeqType;
  /** Whether the molecule is circular (plasmid), informational for the preview. */
  circular: boolean;
  /** The raw GenBank text, the SOURCE OF TRUTH the recipient writes to disk. */
  genbank: string;
  /**
   * The sender's verified PUBLIC identity (email + fingerprint), read from their
   * sharing-identity sidecar. Additive, omitted when the sender has not claimed an
   * identity, in which case the recipient falls back to the relay key hash.
   */
  sender?: ManifestSender;
}

/** The UTF-8 text encoder/decoder for the JSON envelope. */
const ENC = new TextEncoder();
const DEC = new TextDecoder();

/**
 * Build the payload bytes for sharing one standalone sequence. Produces the
 * small JSON envelope carrying the GenBank text, the meta the recipient needs
 * (display_name, seq_type, circular), the `kind: "sequence"` marker, and the
 * verified sender block. The caller seals + relays these bytes with sendRawShare.
 *
 * @param seq         the sequence to share, as a fully-loaded SequenceDetail
 *                    (genbank + meta). The library already loads this for the
 *                    open viewer, so the caller passes it straight through.
 * @param currentUser the folder-local user driving the share, used to read the
 *                    sender's identity sidecar for the verified-sender stamp.
 *                    Null when no user is resolved (the bundle then ships
 *                    sender-free and the recipient falls back to the hash).
 * @returns the envelope as raw UTF-8 bytes, ready for sendRawShare to seal.
 */
export async function buildSequenceSendPayload(
  seq: SequenceDetail,
  currentUser: string | null,
): Promise<Uint8Array> {
  // Verified-sender attribution, read from the signed-in user driving the share.
  // SEND-ONLY and additive, undefined when no claimed identity (recipient falls
  // back to the relay hash, exactly as the other tiers).
  const sender = await readManifestSender(currentUser);

  const payload: SequenceSharePayload = {
    kind: "sequence",
    version: 1,
    display_name: seq.display_name,
    seq_type: seq.seq_type,
    circular: seq.circular,
    genbank: seq.genbank,
    ...(sender ? { sender } : {}),
  };

  return ENC.encode(JSON.stringify(payload));
}

/**
 * Parse decrypted bytes as a SequenceSharePayload, or return null if they are not
 * a sequence envelope. Tolerant by design, any parse failure or a missing /
 * mismatched `kind` resolves to null rather than throwing, so the inbox sniff and
 * the import path never break on a malformed payload.
 */
export function parseSequencePayload(
  bytes: Uint8Array,
): SequenceSharePayload | null {
  let text: string;
  try {
    text = DEC.decode(bytes);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { kind?: unknown }).kind !== "sequence"
  ) {
    return null;
  }
  const p = parsed as Partial<SequenceSharePayload>;
  if (typeof p.genbank !== "string" || p.genbank.length === 0) return null;
  return {
    kind: "sequence",
    version: 1,
    display_name:
      typeof p.display_name === "string" && p.display_name
        ? p.display_name
        : "Shared sequence",
    seq_type: (p.seq_type as SeqType) ?? "dna",
    circular: p.circular === true,
    genbank: p.genbank,
    ...(p.sender && typeof p.sender === "object" ? { sender: p.sender } : {}),
  };
}

/** Read the verified sender block from a decrypted sequence envelope, for the
 *  inbox to attribute the share. Undefined on a pre-attribution envelope or any
 *  non-sequence / malformed bytes (the inbox falls back to the relay hash). */
export function readSequencePayloadSender(
  bytes: Uint8Array,
): ManifestSender | undefined {
  const payload = parseSequencePayload(bytes);
  if (!payload?.sender) return undefined;
  const email = (payload.sender as { email?: unknown }).email;
  if (typeof email !== "string" || email.trim().length === 0) return undefined;
  return payload.sender;
}

/**
 * Thrown when the decrypted bytes are not a readable sequence envelope. Typed so
 * the inbox / accept caller can distinguish a bad payload from a transient disk
 * failure (and NEVER ack the relay on a bad payload).
 */
export class InvalidSequencePayloadError extends Error {
  constructor() {
    super("Decrypted bytes are not a readable sequence envelope.");
    this.name = "InvalidSequencePayloadError";
  }
}

/**
 * MATERIALIZE. Import a decrypted sequence envelope into the recipient's folder
 * as a brand-new sequence, then stamp the provenance fields on its sidecar.
 * Returns the new local sequence id.
 *
 * Drops project_ids entirely, the recipient does not have the sender's projects,
 * so the sequence imports as Unfiled (the recipient can file it afterward). The
 * promise resolves only once both files are on disk and the provenance is
 * stamped, which is what lets the inbox ack the relay (ACK-AFTER-WRITE).
 *
 * @param bytes       the decrypted envelope bytes.
 * @param opts        the recipient (currentUser) plus the verified sender
 *                    attribution to stamp (email + fingerprint, both may be a
 *                    relay-hash fallback for a pre-attribution bundle).
 * @returns the new sequence id.
 */
export async function importSequencePayload(
  bytes: Uint8Array,
  opts: {
    currentUser: string;
    senderEmail: string;
    senderFingerprint: string;
  },
): Promise<{ sequenceId: number }> {
  const payload = parseSequencePayload(bytes);
  if (!payload) throw new InvalidSequencePayloadError();

  // Create the sequence in the recipient's folder. project_ids is intentionally
  // omitted, the sender's project ids are meaningless here, so it lands Unfiled.
  // seq_type is carried so create does not have to re-derive it from the parse.
  const created = await sequencesApi.create({
    display_name: payload.display_name,
    genbank: payload.genbank,
    seq_type: payload.seq_type,
  });
  if (!created) {
    throw new Error("Could not create the imported sequence on disk.");
  }

  // Stamp the cross-boundary provenance on the new sidecar (the create path does
  // not carry it, mirroring the note tier). Write to the recipient's own store.
  await sequenceStore.updateMeta(
    created.id,
    {
      received_from: opts.senderEmail,
      received_from_fingerprint: opts.senderFingerprint,
      received_at: new Date().toISOString(),
    },
    opts.currentUser,
  );

  return { sequenceId: created.id };
}
