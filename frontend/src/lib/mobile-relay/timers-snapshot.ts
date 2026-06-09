// Laptop timers, the laptop publisher (Phase 3 chunk 3).
//
// Seals the laptop's own running timers to each paired phone so a timer started
// on the laptop appears and counts down on the phone too. Mirrors the publisher
// half of notebooks-snapshot.ts / inventory-snapshot.ts.
//
// Only LAPTOP-origin running timers go out. The phone owns its own timers, and a
// laptop timer that gets cancelled simply drops out of running[] on the next
// publish, so the phone stops showing it (eventual consistency, like the other
// snapshots). The dismissed[] tombstone list is part of the stable wire contract
// but stays empty until chunk 4, when phone timers can be dismissed from the
// laptop and need an explicit "remove this" signal.
//
// "done" never travels: every timer carries an absolute endsAt, so each device
// flips it to done locally at the same instant.
//
// Snapshot name on the relay: "timers"
//
// No em-dashes, no emojis, no mid-sentence colons.

import { sealToRecipient } from "@/lib/sharing/encryption";
import { decodePublicKey } from "@/lib/sharing/identity/keys";
import { listDevices, publishSnapshot, type UserCaptureKeys } from "./client";
import { useLaptopTimerStore } from "@/lib/timers/laptop-timers";

// ── Types ────────────────────────────────────────────────────────────────────

/** One laptop timer as the phone needs it to display + dedupe a mirrored row. */
export interface TimerWire {
  /** Origin-prefixed id (lap_...), the dedupe + dismiss key across devices. */
  id: string;
  label: string;
  durationSec: number;
  /** Epoch ms, absolute. The phone computes the countdown from this. */
  endsAt: number;
  startedAt: number;
}

/** The full snapshot the phone decrypts. */
export interface TimersSnapshot {
  generatedAt: string;
  /** Laptop-origin running timers the phone should mirror. */
  running: TimerWire[];
  /** Timer ids the laptop dismissed (either origin). Empty until chunk 4. */
  dismissed: string[];
}

// ── Snapshot builder ─────────────────────────────────────────────────────────

export function buildTimersSnapshot(): TimersSnapshot {
  const { timers, dismissed } = useLaptopTimerStore.getState();
  const running: TimerWire[] = timers
    .filter((t) => t.origin === "laptop" && t.status === "running")
    .map((t) => ({
      id: t.id,
      label: t.label,
      durationSec: t.durationSec,
      endsAt: t.endsAt,
      startedAt: t.startedAt,
    }));
  return {
    generatedAt: new Date().toISOString(),
    running,
    // Phone-origin timers the laptop dismissed, so the phone removes its copy.
    dismissed,
  };
}

// ── Publisher ────────────────────────────────────────────────────────────────

/**
 * Build the timers snapshot once, seal a copy to each paired phone's X25519 key,
 * and publish it under the "timers" name. Mirrors publishNotebooksToAllDevices.
 * Returns how many were published vs skipped (no seal key on file).
 */
export async function publishTimersToAllDevices(
  keys: UserCaptureKeys,
): Promise<{ published: number; skipped: number }> {
  const devices = await listDevices(keys);
  if (devices.length === 0) return { published: 0, skipped: 0 };

  const snap = buildTimersSnapshot();
  const plaintext = new TextEncoder().encode(JSON.stringify(snap));

  let published = 0;
  let skipped = 0;
  for (const device of devices) {
    if (!device.x25519Pubkey) {
      skipped += 1;
      continue;
    }
    const sealed = sealToRecipient(
      plaintext,
      decodePublicKey(device.x25519Pubkey),
    );
    await publishSnapshot(keys, "timers", device.devicePubkey, sealed);
    published += 1;
  }
  return { published, skipped };
}
