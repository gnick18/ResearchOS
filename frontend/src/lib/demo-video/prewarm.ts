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

/**
 * Chemistry clip: PubChem search "caffeine" (searchCompounds q,8) -> import the
 * top candidate's SDF -> literature (europePmcPapers q,6 + pubchemLinks cid).
 * Mirrors PubChemImportDialog + MoleculeLiterature (maxPapers=6) call-for-call.
 */
async function prewarmChemistry(): Promise<void> {
  const q = "caffeine";
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

/** clipId -> prewarm. Only clips with a slow live network beat need one. */
export const DEMO_PREWARM: Record<string, () => Promise<void>> = {
  chemistry: prewarmChemistry,
};
