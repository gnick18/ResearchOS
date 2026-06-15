// Cloud-accounts Phase 2: the device-key-v2 flag.
//
// Gates the Phase 2 device-credential UI (Chunk 2A folderless cross-device key
// restore). The at-rest hardening in device-vault.ts (Chunk 2C) is SAFE to ship
// regardless of this flag and is not gated by it; only the new "Unlock your data
// on this device" account-home card is gated here, so the current flow is
// untouched until a deployment opts in.
//
// DEFAULT-OFF: unlike the Phase 1 account-first flag, this stays dark until
// explicitly enabled, because it surfaces a brand-new restore flow. Set
// NEXT_PUBLIC_DEVICE_KEY_V2=1 (or "true") to turn it on. NEXT_PUBLIC so the
// check runs client-side in the account home.
//
// No emojis, no em-dashes, no mid-sentence colons.

export function isDeviceKeyV2Enabled(): boolean {
  const v = process.env.NEXT_PUBLIC_DEVICE_KEY_V2;
  // Off unless explicitly enabled.
  return v === "1" || v === "true";
}
