"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * `/lab-experiments` was folded into the PI Lab Work hub (LW-1..3): the same
 * LabExperimentsPanel now mounts under `/lab-work?tab=experiments`. This thin
 * stub keeps the old route alive (and the wiki-coverage mapping valid) while
 * bouncing old bookmarks forward. Client-side `router.replace` mirrors the
 * `/experiments` and `/sponsors` redirect stubs (no server redirects or
 * next.config rewrites for client-only routes today).
 */
export default function LabExperimentsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/lab-work?tab=experiments");
  }, [router]);
  return null;
}
