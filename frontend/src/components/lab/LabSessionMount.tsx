"use client";

// LabSessionMount — fail-safe wrapper that mounts LabSignInGate for lab users
// and is a transparent pass-through for solo users.
//
// AppShell wraps its page content with this component. For solo users (no
// lab_id, flag off, or pre-load) useLabSession returns null and this component
// renders children directly with zero overhead. For lab users it wraps children
// in LabSignInGate, which presents the sign-in overlay until the session is live.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { LabSignInGate } from "@/components/lab/LabSignInGate";
import { useLabSession } from "@/hooks/useLabSession";

/**
 * Transparent wrapper: a no-op for solo users, the lab sign-in gate for lab
 * users. Mount once around the app shell's page content.
 */
export function LabSessionMount({ children }: { children: React.ReactNode }) {
  const s = useLabSession();
  if (!s) return <>{children}</>;
  return <LabSignInGate controller={s.controller}>{children}</LabSignInGate>;
}
