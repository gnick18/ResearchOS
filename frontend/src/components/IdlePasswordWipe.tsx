"use client";

// Vestigial. This used to drive a 15-minute idle wipe of the in-memory account
// password cache that the encrypted-backup recovery flow relied on. Identity
// model phase 1 (2026-06-05) re-keyed that backup off the on-device keypair and
// deleted the password cache entirely, so there is nothing to wipe. Kept as a
// no-op (still mounted by AppShell) to avoid churning the shell and its tests;
// safe to delete outright in a later cleanup.

export default function IdlePasswordWipe() {
  return null;
}
