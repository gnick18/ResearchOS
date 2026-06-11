// Mobile DOWNLOAD path, the laptop custom-calculator publisher (Phase 3 of the
// Custom Calculator Builder, 2026-06-10).
//
// Builds a small snapshot of the calculators the current user can see (their
// own custom calculators PLUS the lab-shared ones surfaced via the whole-lab
// "*" share, exactly the set fetchAllCalculatorsIncludingShared returns) and
// seals it, once per paired phone, to that phone's X25519 key before publishing
// it to the capture relay under the "calculators" name. The relay only ever
// holds the sealed bytes, so a phone with the matching device key is the only
// thing that can read its own snapshot. The phone runs the SAME ported engine
// (mobile/lib/calculators/custom.ts) over the synced spec, so a calculator the
// researcher built on the laptop computes identically at the bench.
//
// This mirrors inventory-snapshot.ts / notebooks-snapshot.ts exactly and is
// wired into the SAME auto-publish pass (TodaySnapshotPublisher), so it syncs
// automatically whenever a phone is paired, no extra button. The whole file is
// a no-op when CALC_BUILDER_ENABLED is off (the builder is dark), so a phone
// never receives a calculators snapshot until the feature is live.
//
// Read mode only on the phone: the builder stays on the laptop, the phone just
// runs the synced calculators (same rationale as the read-mode method viewer).
//
// No em-dashes, no emojis, no mid-sentence colons.

import { fetchAllCalculatorsIncludingShared } from "@/lib/local-api";
import { CALC_BUILDER_ENABLED } from "@/lib/calculators/builder-config";
import { sealToRecipient } from "@/lib/sharing/encryption";
import { decodePublicKey } from "@/lib/sharing/identity/keys";
import { listDevices, publishSnapshot, type UserCaptureKeys } from "./client";
import type {
  CustomCalculatorInput,
  CustomCalculatorStep,
  CustomCalculatorConditional,
  CustomCalculatorOutput,
} from "@/lib/types";

/** One calculator as it appears on the phone. This is the runnable spec (the
 *  inputs / steps / conditionals / outputs the ported engine evaluates) plus a
 *  little display metadata. The `ownerLabel` + `isShared` let the phone badge a
 *  lab-shared calculator the same way the laptop does. */
export interface SnapshotCalculator {
  /** Stable id for list keys + selection. Namespaced by owner so two members
   *  with the same numeric record id never collide on the phone. */
  uid: string;
  id: number;
  name: string;
  description: string;
  field?: string;
  inputs: CustomCalculatorInput[];
  steps: CustomCalculatorStep[];
  conditionals: CustomCalculatorConditional[];
  outputs: CustomCalculatorOutput[];
  /** The owner username, used for the "Shared by <owner>" line on a lab calc. */
  ownerLabel: string;
  /** True when this calculator is owned by another lab member (read-only,
   *  surfaced via the whole-lab share). The phone badges it. */
  isShared: boolean;
}

/** The decrypted shape the phone reads after openSealed. */
export interface CalculatorsSnapshot {
  generatedAt: string;
  calculators: SnapshotCalculator[];
}

/** Reads the calculators the current user can see and builds the snapshot.
 *  Returns an empty list (rather than throwing) when the builder is off, so the
 *  publisher below stays a clean no-op. */
export async function buildCalculatorsSnapshot(): Promise<CalculatorsSnapshot> {
  if (!CALC_BUILDER_ENABLED) {
    return { generatedAt: new Date().toISOString(), calculators: [] };
  }

  const calcs = await fetchAllCalculatorsIncludingShared();

  const calculators: SnapshotCalculator[] = calcs.map((c) => {
    const owner = c.owner ?? "";
    const isShared = c.is_shared_with_me === true;
    return {
      uid: `${owner || "self"}:${c.id}`,
      id: c.id,
      name: c.name,
      description: c.description,
      ...(c.field ? { field: c.field } : {}),
      inputs: c.inputs,
      steps: c.steps,
      conditionals: c.conditionals,
      outputs: c.outputs,
      ownerLabel: owner,
      isShared,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    calculators,
  };
}

/**
 * Build the calculators snapshot once, seal a copy to each paired phone's
 * X25519 key, and publish it to the relay under the "calculators" name.
 * Mirrors publishInventoryToAllDevices exactly. A no-op (0/0) when the builder
 * flag is off, so this never publishes until the feature ships.
 * Returns how many were published vs skipped (no seal key on file).
 */
export async function publishCalculatorsToAllDevices(
  keys: UserCaptureKeys,
): Promise<{ published: number; skipped: number }> {
  if (!CALC_BUILDER_ENABLED) return { published: 0, skipped: 0 };

  const devices = await listDevices(keys);
  if (devices.length === 0) return { published: 0, skipped: 0 };

  const snap = await buildCalculatorsSnapshot();
  const plaintext = new TextEncoder().encode(JSON.stringify(snap));

  let published = 0;
  let skipped = 0;
  for (const device of devices) {
    if (!device.x25519Pubkey) {
      console.info(
        `[calculators-publisher] skip device ${device.devicePubkey.slice(0, 12)}... (no x25519 seal key)`,
      );
      skipped += 1;
      continue;
    }
    const sealed = sealToRecipient(
      plaintext,
      decodePublicKey(device.x25519Pubkey),
    );
    await publishSnapshot(keys, "calculators", device.devicePubkey, sealed);
    published += 1;
  }
  return { published, skipped };
}
