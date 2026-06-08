"use client";

// LabSessionMount — fail-safe wrapper that mounts LabSignInGate for lab users
// and is a transparent pass-through for solo users.
//
// AppShell wraps its page content with this component. For solo users (no
// lab_id, flag off, or pre-load) useLabSession returns null and this component
// renders children directly with zero overhead. For lab users it wraps children
// in LabSignInGate, which presents the sign-in overlay until the session is live.
//
// During the brief window while user settings are being read (useLabSession
// returns { loading: true }), children are blocked so the gate always appears
// in front of page content rather than after a flash.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { LabSignInGate } from "@/components/lab/LabSignInGate";
import { useLabSession } from "@/hooks/useLabSession";

/**
 * Transparent wrapper: a no-op for solo users, the lab sign-in gate for lab
 * users. Blocks children during the brief settings-read so the OAuth gate is
 * always in front of page content.
 */
export function LabSessionMount({ children }: { children: React.ReactNode }) {
  const s = useLabSession();
  // Settings still loading: block children so the gate appears before any
  // home page content is visible.
  if (s?.loading) return null;
  if (!s) return <>{children}</>;
  return <LabSignInGate controller={s.controller}>{children}</LabSignInGate>;
}
