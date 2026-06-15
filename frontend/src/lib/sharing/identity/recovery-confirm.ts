// Cloud-accounts Phase 2, Chunk 2B: the folderless "I saved my recovery words"
// stamp.
//
// The folder-based path stamps recoveryConfirmedAt on the data-folder sidecar
// (confirmRecoveryInSidecar). A folderless account has no sidecar, so that stamp
// has nowhere to live. We keep the LIGHTEST correct option: a per-device
// localStorage flag keyed to the identity fingerprint.
//
// Why localStorage and not a Neon column:
//   - The stamp answers "did this person acknowledge saving their words on THIS
//     device". That is inherently a device-local UX fact (the kit is shown once
//     per device), so a per-device marker is the right granularity, and it needs
//     no schema migration or extra round-trip.
//   - It NEVER gates provisioning. Provisioning succeeds the moment the directory
//     accepts the bind; this flag only suppresses re-showing the "save your
//     words" nudge after the user clicks "I saved these".
//
// Keyed by the Ed25519 fingerprint so two identities on one device do not collide
// and a re-provision under a new key starts unconfirmed. No secret material is
// ever stored here, only an ISO timestamp.
//
// SSR / no-localStorage degrade to "not confirmed" and never throw.
//
// No emojis, no em-dashes, no mid-sentence colons.

const PREFIX = "researchos.recovery-confirmed.";

function keyFor(fingerprint: string): string {
  return `${PREFIX}${fingerprint}`;
}

function store(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    // Access can throw in some privacy modes.
    return null;
  }
}

/**
 * Records that the user confirmed saving the recovery words for the identity with
 * this fingerprint, on this device. Best-effort no-op when storage is
 * unavailable; the at-rest key, not this flag, is what carries the identity.
 */
export function markRecoveryConfirmed(fingerprint: string): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(keyFor(fingerprint), new Date().toISOString());
  } catch {
    // Quota or privacy mode; the flag is purely a UX nicety.
  }
}

/** The ISO timestamp the user confirmed, or null when never confirmed here. */
export function getRecoveryConfirmedAt(fingerprint: string): string | null {
  const s = store();
  if (!s) return null;
  try {
    return s.getItem(keyFor(fingerprint));
  } catch {
    return null;
  }
}

/** Whether the user has confirmed saving the words for this identity on this device. */
export function isRecoveryConfirmed(fingerprint: string): boolean {
  return getRecoveryConfirmedAt(fingerprint) !== null;
}
