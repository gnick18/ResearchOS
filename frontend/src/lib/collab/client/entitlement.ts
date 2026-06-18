// External live-collab HOST entitlement, client read (Grant 2026-06-18).
//
// Asks the server whether THIS account may host/initiate external LIVE collab.
// The server reuses the Model-A produce-entitlement signal (Solo and up, or a
// free member of a paid lab). A free account reads false; it keeps one-time E2E
// copy send and can still RECEIVE a live invite, neither of which is gated here.
//
// Fails closed (returns false) on any network, auth, or parse error so a free
// account is never let through by a transient failure. The owner grant path calls
// this before minting a collab doc id, so a free account never flips a doc to
// enforced.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

/** Whether the signed-in account may host external live collaboration. */
export async function isExternalCollabHostEntitled(): Promise<boolean> {
  try {
    const res = await fetch("/api/collab/external-entitlement");
    if (!res.ok) return false;
    const data = (await res.json()) as { entitled?: boolean };
    return data.entitled === true;
  } catch {
    return false;
  }
}
