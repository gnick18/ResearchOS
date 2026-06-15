// Reformat-method command (method phone projection reformatter, Phase 2 phone
// trigger, 2026-06-14). The phone seals this when the researcher taps "make a
// phone version" of a body-type method at the bench. The laptop's poller unseals
// it, calls the metered AI reformat endpoint (verbatim guardrail server-side),
// caches the result, republishes the method snapshot, and announces an ai-job
// status the phone polls.
//
// Command JSON shape (MUST match the laptop's openSealed consumer in poll.ts):
//   { type: "reformat-method", jobId: string, taskId: number, owner: string,
//     methodId: number, at: string }
//
// Mirrors add-variation: sealed to the USER's X25519 public key (only the laptop
// can open it), then posted with the device signature envelope via the command
// outbox (so an offline tap queues and flushes on reconnect).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { bytesToHex } from '@noble/curves/utils.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { sealToUser } from '@/lib/device-identity';
import { sendOrQueueCommand } from '@/lib/command-outbox';

export type ReformatResult = 'sent' | 'queued' | 'noop';

/**
 * A rough, honest ETA for a reformat, from the source body size. The reformat is
 * one model pass that emits roughly as much text as it reads, so we scale by the
 * body length plus a fixed warm-up, and clamp to a sane window. This only drives
 * the phone's local countdown; the laptop reports the true completion.
 */
export function estimateReformatSeconds(bodyChars: number): number {
  // ~1s of wall clock per ~700 source chars (covers prompt + roughly-equal
  // output at a typical serverless throughput), plus a few seconds of relay
  // round-trip + warm-up. Clamp so the countdown never looks absurd.
  const est = Math.ceil(bodyChars / 700) + 5;
  return Math.min(90, Math.max(6, est));
}

/**
 * Build, seal, and post a reformat-method command. `jobId` is the phone-minted
 * correlation id (also stored in the job store) so the bubble only reacts to its
 * own job's ai-job status. Returns 'sent' / 'queued' / 'noop' like add-variation.
 */
export async function postReformatMethod(
  taskId: number,
  owner: string,
  methodId: number,
  jobId: string,
  userX25519PubHex: string,
  relayUrl?: string,
): Promise<ReformatResult> {
  if (!userX25519PubHex || !jobId) return 'noop';

  const command = {
    type: 'reformat-method' as const,
    jobId,
    taskId,
    owner,
    methodId,
    at: new Date().toISOString(),
  };

  const plaintext = utf8ToBytes(JSON.stringify(command));
  let sealed: Uint8Array;
  try {
    sealed = await sealToUser(plaintext, userX25519PubHex);
  } catch {
    return 'noop';
  }

  return sendOrQueueCommand(bytesToHex(sealed), 'reformat-method', relayUrl);
}
