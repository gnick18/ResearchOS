// Cross-boundary sharing, standalone CUSTOM CALCULATOR transfer adapter.
//
// The same simplest tier as the sequence adapter. A custom calculator is
// self-contained, just its spec (inputs, steps, conditionals, outputs) plus a
// little metadata, with no attachments, no lineage, and no per-task / per-method
// machinery. So like the sequence tier it ships a SMALL hand-rolled JSON
// envelope marked with a distinct `kind: "calculator"`, NOT a zip.
//
//   SEND     -> buildCalculatorSendPayload
//     Reads one CustomCalculator (its spec + the meta a recipient needs) and
//     produces a JSON envelope marked `kind: "calculator"`, carrying the verified
//     sender block read from the sender's identity sidecar (mirrors the other
//     tiers). The caller seals + relays the bytes with sendRawShare / inviteRawShare.
//
//   RECEIVE  -> importCalculatorPayload
//     Parses the decrypted envelope and creates a brand-new calculator in the
//     recipient's folder via calculatorsApi.create. External sharing is a COPY,
//     not a live reference: the recipient OWNS their copy, so the imported
//     record's sharing is reset to "Just me" (any sharing the sender chose is
//     theirs, not the recipient's). Returns the new calculator id.
//
// ONE-CLICK IMPORT. A calculator has nothing to resolve (no project link to map,
// no method to localize), so the inbox imports it in one step, decrypt -> create
// -> ack, with no resolution dialog. See SharedWithMeTab.
//
// ACK-AFTER-WRITE. importCalculatorPayload must fully write the new calculator
// before it resolves; the inbox acks the relay only after this promise settles,
// so a crash mid-import leaves the bundle on the relay to retry.

import { calculatorsApi } from "@/lib/local-api";
import { readManifestSender } from "@/lib/sharing/sender-stamp";
import { getUserStore, type TargetContext } from "@/lib/storage/json-store";
import type { ManifestSender } from "@/lib/export/types";
import type {
  CustomCalculator,
  CustomCalculatorInput,
  CustomCalculatorStep,
  CustomCalculatorConditional,
  CustomCalculatorOutput,
} from "@/lib/types";

/**
 * The wire envelope for a shared calculator. A small JSON object (not a zip),
 * marked with a distinct `kind: "calculator"` so the inbox sniff cannot confuse
 * it with the sequence envelope (`kind: "sequence"`), the note RO-Crate (a BagIt
 * zip), or the experiment / method / project export manifest (a researchos-* zip).
 * `version` is for forward-compat.
 */
export interface CalculatorSharePayload {
  /** The distinct kind marker the inbox sniff routes on. */
  kind: "calculator";
  /** Envelope schema version. v1 ships now. */
  version: 1;
  /** User-facing name the recipient sees. */
  name: string;
  /** One-line description (may be empty). */
  description: string;
  /** Optional grouping label (e.g. "Microbiology"), informational. */
  field?: string;
  /** The spec the recipient writes verbatim into their own new record. */
  inputs: CustomCalculatorInput[];
  steps: CustomCalculatorStep[];
  conditionals: CustomCalculatorConditional[];
  outputs: CustomCalculatorOutput[];
  /**
   * The sender's verified PUBLIC identity (email + fingerprint), read from their
   * sharing-identity sidecar. Additive, omitted when the sender has not claimed
   * an identity, in which case the recipient falls back to the relay key hash.
   */
  sender?: ManifestSender;
}

/** The UTF-8 text encoder/decoder for the JSON envelope. */
const ENC = new TextEncoder();
const DEC = new TextDecoder();

/**
 * Build the payload bytes for sharing one standalone calculator. Produces the
 * small JSON envelope carrying the spec, the meta the recipient needs (name,
 * description, field), the `kind: "calculator"` marker, and the verified sender
 * block. The caller seals + relays these bytes with sendRawShare.
 *
 * @param calc        the calculator to share, fully loaded.
 * @param currentUser the folder-local user driving the share, used to read the
 *                    sender's identity sidecar for the verified-sender stamp.
 *                    Null when no user is resolved (the bundle then ships
 *                    sender-free and the recipient falls back to the hash).
 * @returns the envelope as raw UTF-8 bytes, ready for sendRawShare to seal.
 */
export async function buildCalculatorSendPayload(
  calc: CustomCalculator,
  currentUser: string | null,
): Promise<Uint8Array> {
  // Verified-sender attribution, read from the signed-in user driving the share.
  // SEND-ONLY and additive, undefined when no claimed identity (recipient falls
  // back to the relay hash, exactly as the other tiers).
  const sender = await readManifestSender(currentUser);

  const payload: CalculatorSharePayload = {
    kind: "calculator",
    version: 1,
    name: calc.name,
    description: calc.description ?? "",
    ...(calc.field ? { field: calc.field } : {}),
    inputs: calc.inputs ?? [],
    steps: calc.steps ?? [],
    conditionals: calc.conditionals ?? [],
    outputs: calc.outputs ?? [],
    ...(sender ? { sender } : {}),
  };

  return ENC.encode(JSON.stringify(payload));
}

/**
 * Parse decrypted bytes as a CalculatorSharePayload, or return null if they are
 * not a calculator envelope. Tolerant by design, any parse failure or a missing
 * / mismatched `kind` resolves to null rather than throwing, so the inbox sniff
 * and the import path never break on a malformed payload.
 */
export function parseCalculatorPayload(
  bytes: Uint8Array,
): CalculatorSharePayload | null {
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
    (parsed as { kind?: unknown }).kind !== "calculator"
  ) {
    return null;
  }
  const p = parsed as Partial<CalculatorSharePayload>;
  // An outputs array is the minimum a runnable calculator needs; reject a
  // payload that carries none (mirrors the sequence parser's genbank gate).
  if (!Array.isArray(p.outputs) || p.outputs.length === 0) return null;
  return {
    kind: "calculator",
    version: 1,
    name:
      typeof p.name === "string" && p.name ? p.name : "Shared calculator",
    description: typeof p.description === "string" ? p.description : "",
    ...(typeof p.field === "string" && p.field ? { field: p.field } : {}),
    inputs: Array.isArray(p.inputs) ? p.inputs : [],
    steps: Array.isArray(p.steps) ? p.steps : [],
    conditionals: Array.isArray(p.conditionals) ? p.conditionals : [],
    outputs: p.outputs,
    ...(p.sender && typeof p.sender === "object" ? { sender: p.sender } : {}),
  };
}

/** Read the verified sender block from a decrypted calculator envelope, for the
 *  inbox to attribute the share. Undefined on a pre-attribution envelope or any
 *  non-calculator / malformed bytes (the inbox falls back to the relay hash). */
export function readCalculatorPayloadSender(
  bytes: Uint8Array,
): ManifestSender | undefined {
  const payload = parseCalculatorPayload(bytes);
  if (!payload?.sender) return undefined;
  const email = (payload.sender as { email?: unknown }).email;
  if (typeof email !== "string" || email.trim().length === 0) return undefined;
  return payload.sender;
}

/**
 * Thrown when the decrypted bytes are not a readable calculator envelope. Typed
 * so the inbox / accept caller can distinguish a bad payload from a transient
 * disk failure (and NEVER ack the relay on a bad payload).
 */
export class InvalidCalculatorPayloadError extends Error {
  constructor() {
    super("Decrypted bytes are not a readable calculator envelope.");
    this.name = "InvalidCalculatorPayloadError";
  }
}

/**
 * MATERIALIZE. Import a decrypted calculator envelope into the recipient's
 * folder as a brand-new calculator. Returns the new local calculator id.
 *
 * External sharing is a COPY, not a live reference: the new record is owned by
 * the recipient and its sharing is reset to "Just me" (shared_with: []), so the
 * sender's sharing choice never leaks into the recipient's folder. The promise
 * resolves only once the record is on disk, which is what lets the inbox ack the
 * relay (ACK-AFTER-WRITE).
 *
 * @param bytes the decrypted envelope bytes.
 * @returns the new calculator id.
 */
export async function importCalculatorPayload(
  bytes: Uint8Array,
): Promise<{ calculatorId: number }> {
  const payload = parseCalculatorPayload(bytes);
  if (!payload) throw new InvalidCalculatorPayloadError();

  const created = await calculatorsApi.create({
    name: payload.name,
    description: payload.description,
    ...(payload.field ? { field: payload.field } : {}),
    inputs: payload.inputs,
    steps: payload.steps,
    conditionals: payload.conditionals,
    outputs: payload.outputs,
    // A copy is owner-only on arrival; the recipient owns it and can re-share.
    shared_with: [],
  });
  if (!created) {
    throw new Error("Could not create the imported calculator on disk.");
  }

  return { calculatorId: created.id };
}

// ── Destination-scoped materialize (cross-folder, Strategy A) ──────────────────

/**
 * MATERIALIZE INTO A DESTINATION FOLDER. The cross-folder twin of
 * importCalculatorPayload. Writes a brand-new calculator into a SECOND folder
 * via an injected FileService + an EXPLICIT destination username, instead of the
 * module singleton + the current user.
 *
 * The calculator store is a JsonStore, so we route through createForUser(record,
 * destUsername, ctx): the id is allocated from the DESTINATION folder's own
 * _counters.json (never collides with a source-folder id) and the record lands
 * under users/<destUsername>/calculators/<newId>.json. A copy is owner-only on
 * arrival (shared_with reset to "Just me"), mirroring the relay import.
 *
 * ACK-AFTER-WRITE parity: the returned promise resolves only once the record is
 * on disk in the destination.
 */
export async function materializeCalculatorToDestination(
  bytes: Uint8Array,
  dest: TargetContext,
): Promise<{ calculatorId: number }> {
  const payload = parseCalculatorPayload(bytes);
  if (!payload) throw new InvalidCalculatorPayloadError();

  const now = new Date().toISOString();
  const store = getUserStore<CustomCalculator>("calculators");
  const record: Omit<CustomCalculator, "id"> = {
    name: payload.name,
    description: payload.description,
    ...(payload.field ? { field: payload.field } : {}),
    inputs: payload.inputs,
    steps: payload.steps,
    conditionals: payload.conditionals,
    outputs: payload.outputs,
    // A copy is owner-only on arrival; the destination user owns it.
    shared_with: [],
    created_at: now,
    updated_at: now,
  };
  const created = await store.createForUser(record, dest.username, dest);
  return { calculatorId: created.id };
}
