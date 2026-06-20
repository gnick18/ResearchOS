"use client";

// useActiveLabName — the active lab's cosmetic name, for display on PI surfaces.
//
// The lab name is NOT carried in any local lab data the PI pages already load
// (the materialized roster and the lab-data queries are both name-free), and the
// cached folder-switcher labName is only written by the member/class JOIN flow,
// so a research-lab head's own folder usually has none. The one reliable source
// is the relay's open, server-blind lab profile (the same cosmetic read
// LabHeaderLogo uses for the header logo), so we read it there and cache it under
// the labId.
//
// Returns null while the read is in flight, when the user is not in a lab, or
// when the read fails, so callers fall back to a generic heading and never block
// on it. Display-only and best-effort.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useQuery } from "@tanstack/react-query";
import { useLabSession } from "@/hooks/useLabSession";
import { fetchLabProfile } from "@/lib/lab/lab-profile-client";

export function useActiveLabName(): string | null {
  const session = useLabSession();
  const labId = session && !session.loading ? session.labId : null;

  const { data } = useQuery({
    queryKey: ["lab", "profile-name", labId],
    queryFn: () => fetchLabProfile(labId as string),
    enabled: Boolean(labId),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  return data?.labName?.trim() || null;
}
