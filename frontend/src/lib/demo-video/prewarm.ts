/**
 * Per-clip network "movie magic": while the 5s countdown plays on the recording
 * surface, fire the exact browser-direct API calls a clip is about to make, so
 * they land in the demo fetch cache (see lib/chemistry/fetch-cache) and the live
 * search feels instant on camera instead of stalling on a 2-4s round trip.
 *
 * Each prewarm calls the SAME high-level functions the components call, with the
 * SAME arguments, so the warmed URLs match exactly. All best-effort: a prewarm
 * failure just means the real call runs normally (no worse than before).
 */
import {
  searchCompounds,
  fetchSdf,
  resolveNameToCid,
} from "@/lib/chemistry/pubchem";
import { europePmcPapers, pubchemLinks } from "@/lib/chemistry/literature";
import { getRdkit } from "@/lib/chemistry/rdkit";

/**
 * Chemistry clip. Two slow first-touches, both warmed during the countdown:
 *  - the RDKit wasm (~2 MB) the import "compute properties" + substructure beats
 *    block on (getRdkit is an idempotent singleton, so this is just a head start);
 *  - the live network: PubChem search "caffeine" (searchCompounds q,8) -> top
 *    candidate's SDF -> literature (europePmcPapers q,6 + pubchemLinks cid).
 * The network half mirrors PubChemImportDialog + MoleculeLiterature (maxPapers=6)
 * call-for-call so the warmed URLs match exactly.
 */
async function prewarmChemistry(): Promise<void> {
  const q = "caffeine";
  // Kick off the wasm immediately; don't gate the network warm on it.
  void getRdkit().catch(() => {});
  const compounds = await searchCompounds(q, 8).catch(() => []);
  const top = compounds[0];
  await Promise.allSettled([
    top ? fetchSdf(top.cid) : Promise.resolve(""),
    europePmcPapers(q, 6),
    (async () => {
      const cid = top?.cid ?? (await resolveNameToCid(q).catch(() => null));
      if (cid != null) await pubchemLinks(cid);
    })(),
  ]);
}

/**
 * Sequences clip. The SeqViz viewer is a dynamic() chunk only preloaded on idle
 * once the sequences PAGE is mounted; the clip navigates there as its first beat,
 * so warming the chunk from the demo surface during the countdown means the
 * plasmid renders the moment pEGFP-N1 is opened, with no chunk-fetch hitch.
 */
async function prewarmSequences(): Promise<void> {
  await import("@/vendor/seqviz").catch(() => {});
}

/** clipId -> prewarm. Only clips with a slow first-touch (network / wasm / chunk). */
export const DEMO_PREWARM: Record<string, () => Promise<void>> = {
  chemistry: prewarmChemistry,
  sequences: prewarmSequences,
};
