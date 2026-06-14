// Method-check command (companion, 2026-06-13). When the researcher ticks
// reagents off a method's checklist at the bench, the phone syncs the gathered
// state to the laptop so the experiment's ATTACHED method shows what has been
// gathered (it never touches the raw library method, only this experiment's
// attachment, same scope as variation_notes / body_override).
//
// Design: LAST-WRITE-WINS. The phone sends the FULL gathered map every time, so
// the laptop just overwrites the attachment's gathered field. That is naturally
// idempotent (a retry or duplicate carries the same state), so it needs no
// dedup ledger, and it rides the same offline outbox as variation notes, so
// gathered state survives offline and syncs on reconnect for free.
//
// Command JSON shape (MUST match the laptop poll.ts consumer):
//   { type: "method-check", taskId, owner, methodId?, checks: Record<string,
//     boolean>, gatheredCount, total, at }
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { bytesToHex } from '@noble/curves/utils.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { sealToUser } from '@/lib/device-identity';
import { sendOrQueueCommand } from '@/lib/command-outbox';
import type { CheckMap } from '@/lib/method-checks';

export type MethodCheckResult = 'sent' | 'queued' | 'noop';

/**
 * Seal and send the current gathered checklist state for one attached method.
 * `checks` is the full `${stepIndex}:${checkIndex}` -> ticked map; `total` is
 * how many checks the method has so the laptop can show "N of M gathered"
 * without re-parsing. Returns 'sent' | 'queued' | 'noop' the same way
 * postAddVariation does.
 */
export async function postMethodChecks(
  taskId: number,
  owner: string,
  userX25519PubHex: string,
  checks: CheckMap,
  total: number,
  methodId?: number,
  relayUrl?: string,
): Promise<MethodCheckResult> {
  if (!userX25519PubHex) return 'noop';

  const gatheredCount = Object.values(checks).filter(Boolean).length;
  const command: {
    type: 'method-check';
    taskId: number;
    owner: string;
    checks: CheckMap;
    gatheredCount: number;
    total: number;
    at: string;
    methodId?: number;
  } = {
    type: 'method-check',
    taskId,
    owner,
    checks,
    gatheredCount,
    total,
    at: new Date().toISOString(),
  };
  if (typeof methodId === 'number') command.methodId = methodId;

  let sealed: Uint8Array;
  try {
    sealed = await sealToUser(utf8ToBytes(JSON.stringify(command)), userX25519PubHex);
  } catch {
    return 'noop';
  }

  return sendOrQueueCommand(bytesToHex(sealed), 'method-check', relayUrl);
}
