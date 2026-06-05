// sequence editor master. HMMER --domtblout PARSER (pure, unit-tested).
//
// On-device hmmsearch runs the user's Pfam .hmm as the HMM file against OUR
// single translated CDS protein as the sequence db, with `--domtblout` for a
// structured per-domain table. In that layout the TARGET is our protein, so the
// env coordinates are the domain span ON OUR PROTEIN, and the QUERY is the Pfam
// family. This parser turns that whitespace table into the SAME DomainHit[] the
// EBI / InterProScan flow produces, so the existing review UI and the
// domainHitToFeature mapping work unchanged.
//
// The --domtblout columns (1 row per reported domain), whitespace-separated, are:
//    0  target name          (our protein, e.g. "sp|P24941|CDK2_HUMAN")
//    1  target accession
//    2  tlen                 (our protein length)
//    3  query name           (the Pfam family short name, e.g. "Pkinase")
//    4  query accession      (the Pfam family accession, e.g. "PF00069.32")
//    5  qlen                 (the HMM length)
//    6  full-sequence E-value
//    7  full-sequence score
//    8  full-sequence bias
//    9  #   (this domain's index)
//   10  of  (domain count)
//   11  c-Evalue
//   12  i-Evalue             (this-domain independent E-value)
//   13  score                (this-domain bit score)
//   14  bias
//   15  hmm from
//   16  hmm to
//   17  ali from
//   18  ali to
//   19  env from             (1-based domain start ON OUR PROTEIN)
//   20  env to               (1-based domain end ON OUR PROTEIN)
//   21  acc
//   22+ description of target (our protein's description, NOT the family's)
//
// Pure: takes the table text, returns DomainHit[]. Comment lines (#) and short /
// malformed rows are skipped, so a format drift degrades to fewer / no hits
// rather than a throw. Voice in comments, no em-dashes, no emojis, no
// mid-sentence colons.

import type { DomainHit } from "./interproscan";

/** Strip the trailing ".NN" version suffix off a Pfam accession so the hit
 *  carries the stable "PF00069" form (matching the InterProScan path), not the
 *  release-specific "PF00069.32". */
function bareAccession(raw: string): string {
  const m = /^(PF\d{5,}|PB\d+|[A-Za-z0-9]+)\.\d+$/.exec(raw);
  return m ? m[1] : raw;
}

/** Derive the db label from an accession prefix, defaulting to "Pfam" (v1 BYO
 *  databases are Pfam-format .hmm files; a TIGRFAM/NCBIfam accession is labeled
 *  from its prefix so per-source filtering still works). */
function dbForAccession(accession: string): string {
  if (/^PF\d/i.test(accession)) return "Pfam";
  if (/^PB\d/i.test(accession)) return "Pfam-B";
  if (/^TIGR\d/i.test(accession)) return "NCBIfam";
  if (/^NF\d/i.test(accession)) return "NCBIfam";
  return "Pfam";
}

function num(token: string | undefined): number | undefined {
  if (token === undefined) return undefined;
  const n = Number(token);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse a `--domtblout` table into a flat DomainHit[]. Each non-comment row is
 * one reported domain (the same family hitting several regions yields several
 * rows, hence several hits / features). Hits are sorted by start, then end.
 *
 * Unknown / malformed input yields an empty list, never a throw. A row missing
 * the env coordinates or the family accession is skipped.
 */
export function parseDomtblout(text: string): DomainHit[] {
  const hits: DomainHit[] = [];
  const lines = (text || "").split(/\r?\n/);

  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    // Columns are whitespace-delimited; the description (col 22+) can contain
    // spaces, but every numeric column we read sits at a fixed index before it.
    const cols = line.trim().split(/\s+/);
    if (cols.length < 21) continue;

    const rawAccession = cols[4];
    const queryName = cols[3];
    // A real --domtblout row always has a query accession; HMMER prints "-" when
    // the HMM has no accession line, in which case fall back to the query name.
    const accession =
      rawAccession && rawAccession !== "-"
        ? bareAccession(rawAccession)
        : queryName && queryName !== "-"
          ? queryName
          : "";
    if (!accession) continue;

    const envFrom = num(cols[19]);
    const envTo = num(cols[20]);
    if (envFrom === undefined || envTo === undefined) continue;

    const name = queryName && queryName !== "-" ? queryName : accession;
    const evalue = num(cols[12]); // this-domain i-Evalue
    const score = num(cols[13]); // this-domain bit score

    hits.push({
      db: dbForAccession(accession),
      accession,
      name,
      // The --domtblout description column is the TARGET (our protein), not the
      // family, so we deliberately do not borrow it as the domain description.
      start: Math.min(envFrom, envTo),
      end: Math.max(envFrom, envTo),
      score,
      evalue,
    });
  }

  hits.sort((a, b) => a.start - b.start || a.end - b.end);
  return hits;
}
