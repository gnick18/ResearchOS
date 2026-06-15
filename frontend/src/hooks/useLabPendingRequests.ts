"use client";

// useLabPendingRequests (lab-pending-requests-ux, 2026-06-14): the canonical
// "how many people are waiting for the PI to let them into the lab" hook.
//
// It powers the awareness UX a dogfooding PI needs: a count badge + attention
// dot on the Members setting, the Settings rail, and the app-level avatar menu,
// so the head sees a pending request WITHOUT opening Settings and clicking a
// manual button. It folds the two distinct queues LabMembershipPanel tracks
// into one count:
//   1. invite-link accepts  (loadPendingAccepts, head-signed),
//   2. directory join requests (GET /api/directory/labs/request).
//
// It is INERT for everyone who is not a PI. The query only runs when ALL of:
//   - LAB_TIER_ENABLED, AND
//   - the active user is a lab head (useIsLabHead true), AND
//   - that user has a lab_id (a live lab session), AND
//   - the session identity is unlocked (the head can read accepts at all).
// When any condition fails the count is 0 and nothing fetches, so a member, a
// solo user, or a signed-out visitor never polls.
//
// Tolerant by design: either source erroring is treated as zero for that
// source, never thrown to the UI. React Query dedupes by the shared key, so
// the three call sites (settings page, rail, avatar menu) share one fetch.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useIsLabHead } from "@/hooks/useIsLabHead";
import { useLabSession } from "@/hooks/useLabSession";
import { LAB_TIER_ENABLED } from "@/lib/lab/config";
import { getSessionIdentity } from "@/lib/sharing/identity/session-key";
import { loadPendingAccepts } from "@/lib/lab/lab-head-membership";
import type { StoredLabAccept } from "@/lib/lab/lab-accept-client";

/** A directory "request to join" row, as returned by the request endpoint. */
export interface DirJoinRequest {
  labId: string;
  requesterEmailHash: string;
  requesterPubkey: string;
  requesterName: string;
  status: string;
  createdAt: string;
}

/**
 * The shared React Query key for the pending-requests poll. Exported so a caller
 * can invalidate it right after an approve or add, which clears the badges
 * without waiting for the next poll. Includes the lab id so two labs in one
 * session do not share a cache entry.
 */
export const LAB_PENDING_REQUESTS_QUERY_KEY = ["lab", "pending-requests"] as const;

export function labPendingRequestsKey(labId: string) {
  return [...LAB_PENDING_REQUESTS_QUERY_KEY, labId] as const;
}

/** How often to re-poll while the head has the app open. */
const REFETCH_INTERVAL_MS = 30_000;

export interface LabPendingRequests {
  /** accepts.length + dirRequests.length. Zero whenever the hook is inert. */
  count: number;
  accepts: StoredLabAccept[];
  dirRequests: DirJoinRequest[];
  /** Force an immediate re-poll (the refresh glyph). No-op when inert. */
  refetch: () => void;
  isLoading: boolean;
}

const EMPTY_ACCEPTS: StoredLabAccept[] = [];
const EMPTY_DIR: DirJoinRequest[] = [];

/** Best-effort accepts read. Any failure counts as zero, never throws. */
async function safeLoadAccepts(
  labId: string,
): Promise<StoredLabAccept[]> {
  const identity = getSessionIdentity();
  if (!identity) return EMPTY_ACCEPTS;
  try {
    return await loadPendingAccepts(labId, identity);
  } catch {
    return EMPTY_ACCEPTS;
  }
}

/** Best-effort directory requests read. Any failure counts as zero. */
async function safeLoadDirRequests(
  labId: string,
): Promise<DirJoinRequest[]> {
  try {
    const res = await fetch(
      `/api/directory/labs/request?labId=${encodeURIComponent(labId)}`,
      { credentials: "include" },
    );
    if (!res.ok) return EMPTY_DIR;
    const j = (await res.json()) as { requests?: DirJoinRequest[] };
    return j.requests ?? EMPTY_DIR;
  } catch {
    return EMPTY_DIR;
  }
}

/**
 * Returns the combined pending-request count plus the two underlying lists.
 * Disabled (count 0, no fetch) for anyone who is not an unlocked lab head with
 * a live lab session.
 */
export function useLabPendingRequests(): LabPendingRequests {
  const { currentUser } = useCurrentUser();
  const isLabHead = useIsLabHead(currentUser);
  const session = useLabSession();
  const labId = session && !session.loading ? session.labId : null;

  // The identity-unlocked check is a render-time read of module state, not a
  // hook, so it is safe to call here. When locked, the query stays disabled.
  const identityUnlocked = getSessionIdentity() !== null;

  const enabled =
    LAB_TIER_ENABLED && isLabHead === true && !!labId && identityUnlocked;

  const query = useQuery({
    queryKey: enabled
      ? labPendingRequestsKey(labId as string)
      : [...LAB_PENDING_REQUESTS_QUERY_KEY, "disabled"],
    enabled,
    queryFn: async (): Promise<{
      accepts: StoredLabAccept[];
      dirRequests: DirJoinRequest[];
    }> => {
      const id = labId as string;
      const [accepts, dirRequests] = await Promise.all([
        safeLoadAccepts(id),
        safeLoadDirRequests(id),
      ]);
      return { accepts, dirRequests };
    },
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const accepts = query.data?.accepts ?? EMPTY_ACCEPTS;
  const dirRequests = query.data?.dirRequests ?? EMPTY_DIR;
  const count = enabled ? accepts.length + dirRequests.length : 0;

  return {
    count,
    accepts,
    dirRequests,
    refetch: () => {
      if (enabled) void query.refetch();
    },
    isLoading: enabled && query.isLoading,
  };
}
