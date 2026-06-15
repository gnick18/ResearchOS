// AI job status channel (method phone projection reformatter, Phase 2 phone
// trigger, 2026-06-14).
//
// A LEAN status snapshot the laptop publishes so a phone that kicked off a
// metered-AI job (right now only the method reformat) can show a live "BeakerBot
// is working" bubble and, on completion, the real token count. It rides the exact
// same sealed per-device snapshot pipeline as the method snapshot, just under a
// different name ("ai-job"), so it needs no relay change (the relay stores
// snapshots generically at <u>/snap/<device>/<name>).
//
// This is deliberately tiny: the phone already estimates the ETA locally and runs
// its own countdown, so the laptop only has to announce the few real transitions
// (working -> done/error) and the final token usage. We never stream incremental
// progress here (that is a later enhancement); a single "done" with the token
// total is enough to land the bubble.
//
// No em-dashes, no emojis, no mid-sentence colons.

import { sealToRecipient } from "@/lib/sharing/encryption";
import { decodePublicKey } from "@/lib/sharing/identity/keys";
import { listDevices, publishSnapshot, type UserCaptureKeys } from "./client";

/** The lean payload the phone polls. `jobId` echoes the id the phone minted when
 *  it sent the command, so the phone only reacts to its own job. */
export interface AiJobStatus {
  /** Which kind of job. Only method reformat for now, but named so the bubble can
   *  caption other AI jobs later. */
  kind: "reformat-method";
  /** Correlation id the phone generated and sealed into the command. */
  jobId: string;
  /** Coarse lifecycle. */
  status: "working" | "done" | "error";
  /** The method this job is for, so the phone can refetch the right screen. */
  methodId: number;
  taskId: number;
  /** On done: did the reformat actually replace the body, or did the guardrail
   *  refuse it and we kept the deterministic plain steps. */
  outcome?: "reformatted" | "kept-plain";
  /** On done: total tokens the turn spent. */
  tokens?: number;
  /** On error: a short, safe reason for the phone to show. */
  errorReason?: string;
  /** ISO timestamp of this status. */
  at: string;
}

/**
 * Seal an AI job status to every paired phone and publish it under "ai-job".
 * Best-effort and lightweight; mirrors publishMethodToAllDevices. Returns how
 * many devices it reached.
 */
export async function publishAiJobStatus(
  keys: UserCaptureKeys,
  status: AiJobStatus,
): Promise<{ published: number }> {
  const devices = await listDevices(keys);
  if (devices.length === 0) return { published: 0 };

  const plaintext = new TextEncoder().encode(JSON.stringify(status));
  let published = 0;
  for (const device of devices) {
    if (!device.x25519Pubkey) continue;
    const sealed = sealToRecipient(plaintext, decodePublicKey(device.x25519Pubkey));
    await publishSnapshot(keys, "ai-job", device.devicePubkey, sealed);
    published += 1;
  }
  return { published };
}
