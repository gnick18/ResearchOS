"use client";

// Lab identity + branding Phase 3: the ambient member-screen lab logo.
//
// For a signed-in user who belongs to a lab (has a lab_id in settings) AND whose
// lab has uploaded a logo, this renders a small lab mark in the app header brand
// area, so a member always feels they are inside their lab. It is non-distracting
// (a 20px square with a tooltip showing the lab name) and renders NOTHING when the
// user is not in a lab or the lab has no logo, so it never shifts the layout or
// clutters the header for solo users.
//
// The logo + name come from the relay's open profile read (cosmetic, server-blind
// of the lab key). Best-effort: a fetch failure simply renders nothing.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useEffect, useState } from "react";
import Tooltip from "@/components/Tooltip";
import { LAB_TIER_ENABLED } from "@/lib/lab/config";
import { useLabSession } from "@/hooks/useLabSession";
import { fetchLabProfile, labLogoUrl } from "@/lib/lab/lab-profile-client";

export default function LabHeaderLogo() {
  const session = useLabSession();
  const labId =
    session && !session.loading ? session.labId : null;

  const [labName, setLabName] = useState<string>("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!LAB_TIER_ENABLED || !labId) {
      // Clear the logo immediately when the user leaves a lab / signs out. This
      // is a synchronous sign-out/solo transition with no I/O, mirroring the
      // documented reset in useLabSession.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLogoUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const profile = await fetchLabProfile(labId);
        if (cancelled || !profile || !profile.hasLogo) return;
        setLabName(profile.labName ?? "Your lab");
        // Resolve the cache-busted url once per labId so the header logo is not
        // re-fetched on every render.
        setLogoUrl(labLogoUrl(labId));
      } catch {
        // Best-effort; render nothing on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [labId]);

  if (!logoUrl) return null;

  return (
    <Tooltip label={labName || "Your lab"}>
      <span
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded"
        data-testid="lab-header-logo"
        aria-label={labName || "Your lab"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={labName || "Your lab"}
          className="h-full w-full object-contain"
          // If the logo 404s (e.g. a stale hasLogo), hide the broken image so the
          // header stays clean.
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      </span>
    </Tooltip>
  );
}
