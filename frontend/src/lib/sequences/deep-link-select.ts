// sequence editor master. Pure helper for the /sequences deep-link resolver.
//
// Given the current `?seq=` / `?collection=` params and the loaded sequences,
// decide what selection the page should adopt. Pure + SSR-safe (no window), so
// the resolver effect on the page stays a thin wrapper and the logic is tested
// in isolation.
//
// Voice. No em-dashes, no mid-sentence colons.

export interface DeepLinkSelection {
  /** The sequence id to select, when `?seq=` named a real, loaded sequence. */
  selectId?: number;
  /** The collection to switch to, when `?collection=` named one. A project id
   *  is a string; "unfiled" / "all" pass through as themselves. */
  selectCollection?: string;
}

/**
 * Resolve the deep-link params against the loaded sequence ids. `seqParam` /
 * `collectionParam` are the raw string params (or null). `sequenceIds` is the
 * set of currently-loaded ids so a `?seq=` pointing at a missing / not-yet-loaded
 * sequence is ignored (no phantom selection). The collection param is accepted
 * as-is. the page validates it against its own project list when it applies it.
 */
export function resolveDeepLinkSelection(
  seqParam: string | null | undefined,
  collectionParam: string | null | undefined,
  sequenceIds: ReadonlyArray<number>,
): DeepLinkSelection {
  const out: DeepLinkSelection = {};

  if (seqParam != null && seqParam.length > 0) {
    const id = Number.parseInt(seqParam, 10);
    if (Number.isFinite(id) && sequenceIds.includes(id)) {
      out.selectId = id;
    }
  }

  if (collectionParam != null && collectionParam.length > 0) {
    out.selectCollection = collectionParam;
  }

  return out;
}
