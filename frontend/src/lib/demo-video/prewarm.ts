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
import {
  suggestTaxa,
  listTaxonAssemblies,
  listAssemblySequences,
} from "@/lib/sequences/ncbi-datasets";
import { esearchGenes } from "@/lib/sequences/ncbi-esearch";
import { efetchGenbank } from "@/lib/sequences/ncbi-efetch";
import {
  resolveWindow,
  hitHasPlacement,
  placementFromHit,
} from "@/lib/sequences/guided-ncbi-import";

/**
 * Chemistry clip. Two slow first-touches, both warmed during the countdown:
 *  - the RDKit wasm (~2 MB) the import "compute properties" + substructure beats
 *    block on (getRdkit is an idempotent singleton, so this is just a head start);
 *  - the live network: PubChem search "caffeine" (searchCompounds q,8) -> top
 *    candidate's SDF -> literature (europePmcPapers q,200 + pubchemLinks cid).
 * The literature warm MUST match MoleculeLiterature's default maxPapers (200, the
 * size the molecule detail's Papers panel + the inline explorer fetch) call-for-
 * call, or the URL differs and the on-camera fetch misses the cache and stalls
 * (~20s for a well-studied compound). 200 here keeps the explorer instant.
 */
async function warmChemistryFor(q: string): Promise<void> {
  // Kick off the wasm immediately; don't gate the network warm on it.
  void getRdkit().catch(() => {});
  const compounds = await searchCompounds(q, 8).catch(() => []);
  const top = compounds[0];
  await Promise.allSettled([
    top ? fetchSdf(top.cid) : Promise.resolve(""),
    europePmcPapers(q, 200),
    (async () => {
      const cid = top?.cid ?? (await resolveNameToCid(q).catch(() => null));
      if (cid != null) await pubchemLinks(cid);
    })(),
  ]);
}

/** Chemistry clip (caffeine import + structure search + literature). */
function prewarmChemistry(): Promise<void> {
  return warmChemistryFor("caffeine");
}

/** Chemistry literature-explorer clip (gliotoxin import + explorer). Same shape
 *  as the caffeine warm; the explorer reads the same europePmcPapers + pubchemLinks
 *  results MoleculeLiterature fetched. */
function prewarmChemistryGliotoxin(): Promise<void> {
  return warmChemistryFor("gliotoxin");
}

/**
 * Guided NCBI import clip (the cyp51A walk). Replays the wizard's network chain
 * with the SAME high-level lib calls and the SAME arguments the clip triggers,
 * so the warmed Datasets / E-utilities URLs match exactly: organism autocomplete,
 * the first assembly's contig list, the gene search, and the gene-plus-1kb
 * windowed efetch (the on-camera highlight). All best-effort; a miss just runs
 * the live call normally. Also warms the SeqViz chunk the imported region renders
 * into. The lib GET helpers route through the demo fetch cache (see ncbi-* libs).
 */
async function prewarmSequencesNcbi(): Promise<void> {
  void import("@/vendor/seqviz").catch(() => {});
  const organism = "Aspergillus fumigatus";
  const gene = "cyp51A";
  try {
    const taxa = await suggestTaxa(organism, {});
    const taxon = taxa[0];
    await Promise.allSettled([
      // The browse path: assemblies -> the first assembly's contigs.
      taxon
        ? listTaxonAssemblies(taxon.taxId, {})
            .then((res) => {
              const first = res.assemblies[0];
              return first ? listAssemblySequences(first.accession) : undefined;
            })
            .catch(() => undefined)
        : Promise.resolve(undefined),
      // The highlight: gene-by-name search -> the windowed efetch at the 1kb
      // default flank (the clip leaves the flank untouched so this URL matches).
      esearchGenes(gene, organism)
        .then(async (hits) => {
          const placed = hits.find(hitHasPlacement);
          if (!placed) return;
          const win = resolveWindow(placementFromHit(placed), 1000);
          await efetchGenbank(placed.contigAccession, {
            window: { start: win.start, stop: win.stop },
          });
        })
        .catch(() => undefined),
    ]);
  } catch {
    // best-effort; the live wizard calls run normally on a miss
  }
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
  sequencesNcbi: prewarmSequencesNcbi,
  chemistryGliotoxin: prewarmChemistryGliotoxin,
};
