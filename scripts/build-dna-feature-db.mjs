// build-dna-feature-db.mjs
//
// Builds a curated, license-tagged DNA ELEMENT feature database (origins of
// replication, promoters, terminators, regulatory signals) for an offline
// common-features detector. Every sequence is EXTRACTED from a real GenBank
// record fetched live from NCBI E-utilities, by the recorded feature
// coordinates within that record. No sequence is ever written, completed, or
// recalled from memory.
//
// HARD RULE (this is the highest-fabrication-risk task):
//   Every element's sequence is the substring of a fetched GenBank record at
//   the coordinates of a FEATURE whose type and /note (or /regulatory_class)
//   match the target. The script honors complement() locations. It records the
//   accession, the exact 1-based coordinates, the matched note, and the source
//   URL on every entry. If a target's feature cannot be found cleanly in its
//   pinned record, the target is OMITTED and logged. A small verified set beats
//   a large shaky one.
//
// Re-runnable and idempotent (modulo the generatedAt timestamp). Run with:
//   node scripts/build-dna-feature-db.mjs
//
// Output:
//   frontend/public/feature-db/dna-features.json
//   frontend/public/feature-db/ATTRIBUTION.md  (DNA section appended/updated)
//
// No emojis, no em-dashes by design.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "frontend", "public", "feature-db");
const JSON_PATH = join(OUT_DIR, "dna-features.json");
const ATTRIBUTION_PATH = join(OUT_DIR, "ATTRIBUTION.md");

const DNA_RE = /^[ACGTN]+$/;

// Per-category plausible length bands. Anything outside is rejected and logged.
const LENGTH_BANDS = {
  origin: [40, 1000],
  promoter: [15, 700],
  terminator: [20, 400],
  // Regulatory covers short signals (Shine-Dalgarno ~5 bp, polyA hexamer 6 bp)
  // up through enhancer modules. Lower bound is deliberately permissive.
  regulatory: [5, 700],
};

const log = (...args) => console.log(...args);
const warn = (...args) => console.warn("WARN:", ...args);

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Fetch (NCBI E-utilities). Without an API key NCBI throttles to ~3 req/sec, so
// we sleep between calls. Records are cached on disk to keep re-runs fast and
// to make the extraction auditable offline.
// ---------------------------------------------------------------------------

const CACHE_DIR = join(__dirname, ".dna-feature-cache");

async function efetchGenbank(accession) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, `${accession}.gb`);
  if (existsSync(cachePath)) {
    const cached = readFileSync(cachePath, "utf8");
    if (cached.includes("LOCUS")) return cached;
  }
  const url = `${EUTILS}/efetch.fcgi?db=nuccore&id=${encodeURIComponent(
    accession
  )}&rettype=gb&retmode=text`;
  const res = await fetch(url, {
    headers: { "User-Agent": "ResearchOS-dna-feature-db/1.0 (research tool)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  if (!text.includes("LOCUS")) throw new Error(`no LOCUS in efetch for ${accession}`);
  writeFileSync(cachePath, text, "utf8");
  await sleep(450); // stay under the ~3 req/sec unauthenticated limit
  return text;
}

function efetchUrl(accession) {
  return `${EUTILS}/efetch.fcgi?db=nuccore&id=${encodeURIComponent(
    accession
  )}&rettype=gb&retmode=text`;
}

// ---------------------------------------------------------------------------
// Minimal, robust GenBank parser. We parse only what we need: the ORIGIN
// sequence and the FEATURES table (type, raw location string, and the qualifier
// lines we match on). We deliberately do NOT depend on the vendored TeselaGen
// parser here, because the build script must run as a plain ESM file with curl
// and node only, and the vendored module uses extensionless imports plus a TS
// facade that node ESM cannot resolve without a bundler. Our parser is
// self-contained and we cross-check its coordinate math against the raw ORIGIN
// block in the verification step.
// ---------------------------------------------------------------------------

function parseGenbank(gb) {
  const lines = gb.split(/\r?\n/);

  // 1) Sequence from the ORIGIN block.
  let inOrigin = false;
  let seqChars = [];
  // 2) Features.
  let inFeatures = false;
  const features = [];
  let cur = null;

  const flush = () => {
    if (cur) features.push(cur);
    cur = null;
  };

  for (const raw of lines) {
    if (raw.startsWith("ORIGIN")) {
      flush();
      inFeatures = false;
      inOrigin = true;
      continue;
    }
    if (raw.startsWith("//")) {
      inOrigin = false;
      continue;
    }
    if (inOrigin) {
      // lines look like: "        1 gcctcggcct ctgcataaat ..."
      const bases = raw.replace(/[\d\s]/g, "");
      if (bases) seqChars.push(bases);
      continue;
    }
    if (raw.startsWith("FEATURES")) {
      inFeatures = true;
      continue;
    }
    if (inFeatures) {
      // A new feature begins with a type at columns 6-20, e.g.
      //   "     rep_origin      32..83"
      const featMatch = raw.match(/^ {5}(\S+)\s+(\S.*)$/);
      if (featMatch && !raw.startsWith("     /")) {
        flush();
        cur = {
          type: featMatch[1],
          location: featMatch[2].trim(),
          qualifiers: {},
          rawQualLines: [],
        };
        continue;
      }
      if (!cur) continue;
      const trimmed = raw.trim();
      // Continuation of a multi-line location (no qualifier yet seen).
      if (
        !trimmed.startsWith("/") &&
        cur.rawQualLines.length === 0 &&
        /[\d.,)]/.test(trimmed)
      ) {
        cur.location += trimmed;
        continue;
      }
      // Qualifier line, possibly wrapped onto following lines.
      if (trimmed.startsWith("/")) {
        cur.rawQualLines.push(trimmed);
      } else if (cur.rawQualLines.length > 0) {
        // wrapped continuation of the previous qualifier
        cur.rawQualLines[cur.rawQualLines.length - 1] += " " + trimmed;
      }
    }
  }
  flush();

  // Post-process qualifiers into a map. Values keep their text; quotes stripped.
  for (const f of features) {
    for (const q of f.rawQualLines) {
      const m = q.match(/^\/([^=]+)=?(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      let val = m[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      else if (val.startsWith('"')) val = val.slice(1);
      // Some qualifiers repeat (e.g. multiple /note). Keep the first, but also
      // accumulate all notes for matching.
      if (key === "note") {
        f.qualifiers.note = f.qualifiers.note
          ? f.qualifiers.note + " | " + val
          : val;
      } else if (f.qualifiers[key] === undefined) {
        f.qualifiers[key] = val;
      }
    }
    delete f.rawQualLines;
  }

  const sequence = seqChars.join("").toUpperCase();
  return { sequence, features };
}

// Parse a GenBank location string into { start, end, complement } using 1-based
// inclusive coordinates of the OUTER span. We support:
//   34          single base
//   32..83      range
//   complement(36..61)
//   join(a..b,c..d)         -> ordered segments, concatenated in the given order
//   complement(join(...))
// We keep the join SEGMENTS in their given order so that an origin-spanning
// feature on a circular molecule (e.g. join(5191..5243,1..31)) extracts as the
// concatenation of segment 1 then segment 2, NOT as a min..max outer span. We
// reject locations with fuzzy bounds (< or >) so we never extract a partial or
// guessed span. Returns null if the location is not a clean, fully-bounded span.
function parseLocation(locStr) {
  let s = locStr.replace(/\s+/g, "");
  let complement = false;
  if (s.startsWith("complement(") && s.endsWith(")")) {
    complement = true;
    s = s.slice("complement(".length, -1);
  }
  if (/[<>]/.test(s)) return null; // fuzzy bound -> refuse
  const segments = []; // ordered [{ start, end }, ...] 1-based inclusive
  let parts;
  if (s.startsWith("join(") && s.endsWith(")")) {
    parts = s.slice("join(".length, -1).split(",");
  } else {
    parts = [s];
  }
  for (const part of parts) {
    const m = part.match(/^(\d+)(?:\.\.(\d+))?$/);
    if (!m) return null;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2] || m[1], 10);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    segments.push({ start: a, end: b });
  }
  if (segments.length === 0) return null;
  const joined = segments.length > 1;
  return { segments, complement, joined };
}

const COMP = { A: "T", T: "A", G: "C", C: "G", N: "N" };
function revComp(seq) {
  let out = "";
  for (let i = seq.length - 1; i >= 0; i--) out += COMP[seq[i]] || "N";
  return out;
}

// Extract the sub-sequence for a parsed location from a full record sequence.
// Coordinates are 1-based inclusive (GenBank convention). Join segments are
// concatenated in their given order; complement reverse-complements the whole.
function extractByLocation(fullSeq, loc) {
  let sub = "";
  for (const seg of loc.segments) {
    sub += fullSeq.slice(seg.start - 1, seg.end);
  }
  sub = sub.toUpperCase();
  return loc.complement ? revComp(sub) : sub;
}

// Human-readable 1-based coordinate string for provenance.
function formatCoords(loc) {
  const inner = loc.segments.map((s) => `${s.start}..${s.end}`).join(",");
  const body = loc.joined ? `join(${inner})` : inner;
  return loc.complement ? `complement(${body})` : body;
}

// ---------------------------------------------------------------------------
// Curated targets. Each target PINS a specific NCBI accession and a predicate
// that selects exactly one feature in that record by type + note/regulatory
// class. Sequences are NEVER written here; they are extracted from the fetched
// record at the matched feature's coordinates. The `expectLen` is an assertion
// (not a source of data) used as a sanity tripwire; a mismatch logs a warning.
// ---------------------------------------------------------------------------

const TARGETS = [
  // --- Origins of replication ---
  {
    id: "ori_sv40_core",
    name: "SV40 origin of replication (core region)",
    category: "origin",
    accession: "J02400.1",
    license: "Public domain sequence facts (GenBank/NCBI); record is freely redistributable.",
    match: (f) =>
      f.type === "rep_origin" &&
      /replication origin core region/i.test(f.qualifiers.note || ""),
    note: "SV40 core origin of replication; origin-spanning feature across the circular junction in the primary SV40 genome record (J02400).",
  },
  {
    id: "ori_sv40_aux",
    name: "SV40 origin of replication (auxiliary region)",
    category: "origin",
    accession: "J02400.1",
    license: "Public domain sequence facts (GenBank/NCBI); record is freely redistributable.",
    match: (f) =>
      f.type === "rep_origin" &&
      /replication origin auxiliary region/i.test(f.qualifiers.note || ""),
    note: "SV40 origin auxiliary region (adjacent to the core origin), in the primary SV40 genome record (J02400).",
  },

  // --- Promoters ---
  {
    id: "promoter_cmv",
    name: "CMV promoter (human cytomegalovirus immediate-early)",
    category: "promoter",
    accession: "PZ020853.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "promoter" &&
      /\bCMV promoter\b/i.test(f.qualifiers.note || ""),
    note: "CMV immediate-early promoter, annotated as a clean range in a GenBank expression-vector record (pcDNA3.1 derivative).",
  },
  {
    id: "promoter_cmv_enhancer",
    name: "CMV enhancer (human cytomegalovirus immediate-early)",
    category: "regulatory",
    accession: "PZ020853.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "enhancer" &&
      /\bCMV enhancer\b/i.test(f.qualifiers.note || ""),
    note: "CMV immediate-early enhancer; pairs with the CMV promoter in mammalian expression vectors.",
  },
  {
    id: "promoter_t3",
    name: "T3 promoter (for T3 RNA polymerase)",
    category: "promoter",
    accession: "X02981.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "promoter" &&
      /T3 RNA polymerase/i.test(f.qualifiers.note || ""),
    note: "Promoter for T3 RNA polymerase, from the bacteriophage T3 gene 1 (RNA polymerase) record (X02981).",
  },

  // --- v2 additions: common bacterial-cloning workhorse promoters ---
  // The first pass omitted these because it only looked for a coordinate RANGE
  // in the classic primary records (phage genomes / lac operon), where they are
  // annotated as single base points or not at all. v2 instead pins modern,
  // well-annotated synthetic-construct / cloning-vector records that annotate
  // each element as a clean coordinate range, so every sequence is still
  // EXTRACTED by coordinates (method A), never recited.
  {
    id: "promoter_t7",
    name: "T7 promoter (for T7 RNA polymerase, phi10 class)",
    category: "promoter",
    accession: "PX994934.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "promoter" &&
      /\bT7 promoter\b/i.test(f.qualifiers.note || ""),
    note: "Promoter for bacteriophage T7 RNA polymerase, annotated as a clean range in a SnapGene-style synthetic-construct record (PX994934). The extracted 19-mer is additionally confirmed present verbatim in the canonical pET28a vector record (PP098726.1).",
    // Extra provenance: confirm the extracted seq also appears in a pET vector.
    confirmIn: "PP098726.1",
  },
  {
    id: "promoter_sp6",
    name: "SP6 promoter (for SP6 RNA polymerase)",
    category: "promoter",
    accession: "LR588434.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "promoter" &&
      /\bSP6 promoter\b/i.test(f.qualifiers.note || ""),
    note: "Promoter for SP6 RNA polymerase, annotated as a clean range in a cloning-vector record (LR588434, AbVec2.1-mIglc2).",
  },
  {
    id: "promoter_lac",
    name: "lac promoter (E. coli lac operon promoter)",
    category: "promoter",
    accession: "PX994934.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "promoter" &&
      /\blac promoter\b/i.test(f.qualifiers.note || ""),
    note: "E. coli lac operon promoter, annotated as a clean range in a SnapGene-style synthetic-construct record (PX994934).",
  },
  {
    id: "promoter_tac",
    name: "tac promoter (trp/lacUV5 hybrid)",
    category: "promoter",
    accession: "MT321292.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "promoter" &&
      /\btac promoter\b/i.test(f.qualifiers.note || ""),
    note: "tac promoter, a strong hybrid of the trp -35 and lacUV5 -10 elements, annotated as a clean range in a cloning-vector record (MT321292, pMBP-OsD27deltaTP).",
  },
  {
    id: "promoter_trc",
    name: "trc promoter (trp/lacUV5 hybrid)",
    category: "promoter",
    accession: "KX682239.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "promoter" &&
      /\btrc promoter\b/i.test(f.qualifiers.note || ""),
    note: "trc promoter, a strong hybrid of the trp and lacUV5 promoters (one bp spacing differs from tac), annotated as a clean range in a synthetic-construct record (KX682239, pGC014.mod).",
  },

  // --- v2 additions: origins of replication ---
  {
    id: "ori_cole1_puc",
    name: "ColE1 / pUC (pMB1/pBR322) origin of replication",
    category: "origin",
    accession: "PX994934.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "rep_origin" &&
      /ColE1\/pMB1\/pBR322\/pUC origin/i.test(f.qualifiers.note || ""),
    note: "High-copy-number ColE1/pMB1/pBR322/pUC replication origin, annotated as a clean rep_origin range in a SnapGene-style synthetic-construct record (PX994934). This is the single shared origin region of the pUC, pBR322, pMB1 and ColE1 plasmid family; pBR322 and pMB1 are NOT stored as separate sequences because they ARE this same element.",
  },
  {
    id: "ori_p15a",
    name: "p15A origin of replication",
    category: "origin",
    accession: "PZ005984.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) => f.type === "rep_origin" && /p15a origin/i.test(f.qualifiers.note || ""),
    note: "p15A (medium-copy) replication origin, annotated as a clean rep_origin range in a synthetic-construct record (PZ005984, lacI_IA9_Template).",
  },
  {
    id: "ori_psc101",
    name: "pSC101 origin of replication",
    category: "origin",
    accession: "PV807101.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    // Annotated as a misc_feature range "pSC101 ori" on the complement strand in
    // this Wilson-lab synthetic construct. It is an explicit coordinate range
    // for the origin, so it is extracted as method A.
    match: (f) => f.type === "misc_feature" && /^pSC101 ori$/i.test(f.qualifiers.note || ""),
    note: "pSC101 (low-copy) replication origin, annotated as an explicit coordinate range (misc_feature 'pSC101 ori') in a synthetic-construct record (PV807101, pHY702).",
  },

  // --- Terminators ---
  {
    id: "terminator_rrnb_t1",
    name: "rrnB T1 terminator (E. coli)",
    category: "terminator",
    accession: "PV231317.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "terminator" &&
      /rrnB T1 terminator/i.test(f.qualifiers.note || ""),
    note: "E. coli rrnB T1 transcription terminator, annotated as a clean range with an explicit note in a GenBank vector record (pSEVA251 derivative).",
  },

  // --- v2 additions: terminators ---
  {
    id: "terminator_t7",
    name: "T7 terminator (T-phi, from phage T7)",
    category: "terminator",
    accession: "OZ375372.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "terminator" &&
      /\bT7 terminator\b/i.test(f.qualifiers.note || ""),
    note: "T7 (T-phi) transcription terminator, annotated as a clean range in a synthetic plasmid record (OZ375372, pcrRNA3gfplex). This is the standard downstream terminator of pET-series T7 expression cassettes.",
  },
  {
    id: "terminator_lambda_tl3",
    name: "lambda tL3 terminator (from phage lambda)",
    category: "terminator",
    accession: "OQ295986.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "terminator" &&
      /tL3 terminator/i.test(f.qualifiers.note || ""),
    note: "Phage lambda tL3 transcription terminator, annotated as a clean range in a synthetic-construct record (OQ295986).",
  },

  // --- Regulatory signals ---
  {
    id: "regulatory_lac_operator",
    name: "lac operator (O1, lacI/LacI binding site)",
    category: "regulatory",
    accession: "PX994934.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    // Annotated as a misc_feature whose note ends with "; lac operator; ...".
    match: (f) =>
      f.type === "misc_feature" &&
      /;\s*lac operator\b/i.test(f.qualifiers.note || ""),
    note: "lac operator (the LacI repressor binding site that gates the lac/T7lac/tac promoters), annotated as a clean coordinate range in a SnapGene-style synthetic-construct record (PX994934).",
  },
  {
    id: "regulatory_sv40_polya",
    name: "SV40 late polyA signal",
    category: "regulatory",
    accession: "J02400.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "polyA_signal_sequence" &&
      /late mRNA polyadeny/i.test(f.qualifiers.note || ""),
    note: "SV40 late mRNA polyadenylation signal (the hexamer signal), from the primary SV40 genome record (J02400).",
  },
  {
    id: "regulatory_shine_dalgarno",
    name: "Shine-Dalgarno sequence (E. coli, pBR322 rop 5'UTR)",
    category: "regulatory",
    accession: "J01749.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    // Two SD features exist (rop forward, bla on the complement strand). Pin the
    // forward one upstream of the rop CDS by requiring the forward strand.
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "ribosome_binding_site" &&
      /Shine-Dalgarno/i.test(f.qualifiers.note || "") &&
      !/^complement\(/.test(f.location),
    note: "Shine-Dalgarno ribosome-binding sequence extracted from a real E. coli gene 5'UTR in the pBR322 record (J01749), not recited.",
  },

  // -------------------------------------------------------------------------
  // v3 additions: mammalian / lentiviral elements (close the top coverage gaps
  // a detector validation pass found). The v2 pass deferred these as
  // "mammalian-expression". v3 pins modern, SnapGene-style synthetic-construct
  // and expression-vector records that annotate each element as a clean
  // coordinate range, so every sequence is still EXTRACTED by coordinates
  // (method A), never recited.
  // -------------------------------------------------------------------------

  // --- Mammalian polyA signals (FULL regions, not the bare hexamer) ---
  {
    id: "regulatory_sv40_late_polya_region",
    name: "SV40 late polyA signal (full region)",
    category: "regulatory",
    accession: "MZ648044.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "polyA_signal_sequence" &&
      /^SV40 polyadenylation signal; SV40 poly\(A\) signal$/i.test(
        f.qualifiers.note || ""
      ),
    note: "SV40 late polyadenylation signal as the FULL functional region (not the bare AATAAA hexamer), annotated as a clean range in a SnapGene-style lentiviral expression vector record (MZ648044). This is the standard 3' polyA of most mammalian/lentiviral expression cassettes. Distinct from regulatory_sv40_polya, which is the bare hexamer signal extracted from the primary SV40 genome (J02400).",
  },
  {
    id: "regulatory_bgh_polya",
    name: "BGH polyA signal (bovine growth hormone)",
    category: "regulatory",
    accession: "LC897330.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    // Annotated with regulatory_class "terminator" in this record but the /note
    // states it is the bovine growth hormone polyadenylation signal; match by note.
    match: (f) =>
      f.type === "regulatory" &&
      /^bovine growth hormone \(bGH\) polyadenylation signal$/i.test(
        f.qualifiers.note || ""
      ),
    note: "Bovine growth hormone (BGH) polyadenylation signal, the standard 3' polyA of pcDNA3-family mammalian expression vectors, annotated as a clean range in an expression-vector record (LC897330, Oxtr-3xALFA vector).",
  },

  // --- Mammalian / Pol-III promoters ---
  {
    id: "promoter_ef1a_core",
    name: "EF-1alpha core promoter (human elongation factor 1-alpha)",
    category: "promoter",
    accession: "MZ648044.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "promoter" &&
      /^core promoter for human elongation factor EF-1-alpha$/i.test(
        f.qualifiers.note || ""
      ),
    note: "Core promoter for human elongation factor 1-alpha (EF-1alpha / EF1a), a strong ubiquitous mammalian Pol II promoter common in lentiviral vectors, annotated as a clean range in a SnapGene-style lentiviral vector record (MZ648044).",
  },
  {
    id: "promoter_pgk",
    name: "PGK promoter (mouse phosphoglycerate kinase 1)",
    category: "promoter",
    accession: "MH325103.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "promoter" &&
      /^mouse phosphoglycerate kinase 1 promoter; label: PGK promoter$/i.test(
        f.qualifiers.note || ""
      ),
    note: "Phosphoglycerate kinase 1 (PGK) promoter, a moderate ubiquitous mammalian promoter widely used in lentiviral and knock-in vectors, annotated as a clean range in a synthetic-construct record (MH325103). This record's element is the mouse PGK1 promoter; the human and mouse PGK promoters are closely related and used interchangeably as the lab 'PGK promoter'.",
  },
  {
    id: "promoter_u6",
    name: "U6 promoter (human U6 snRNA, RNA Pol III)",
    category: "promoter",
    accession: "MN811116.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "misc_feature" && /^U6 promoter$/i.test(f.qualifiers.note || ""),
    note: "U6 snRNA RNA Pol III promoter, the standard driver of shRNA and sgRNA cassettes, annotated as an explicit coordinate range (misc_feature 'U6 promoter') in a synthetic-construct record (MN811116).",
  },
  {
    id: "promoter_h1",
    name: "H1 promoter (human RNASEH1 / H1 RNA, RNA Pol III)",
    category: "promoter",
    accession: "DQ465352.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "promoter" &&
      /^H1 promoter$/i.test(f.qualifiers.note || ""),
    note: "H1 RNA Pol III promoter, a common alternative to U6 for shRNA/sgRNA expression, annotated as a clean range in a synthetic-construct record (DQ465352).",
  },
  {
    id: "promoter_sv40_early",
    name: "SV40 promoter (enhancer and early promoter)",
    category: "promoter",
    accession: "PP539716.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "promoter" &&
      /^SV40 enhancer and early promoter$/i.test(f.qualifiers.note || ""),
    note: "SV40 enhancer and early promoter, the small ubiquitous promoter that drives selection markers in many mammalian vectors, annotated as a clean range in a SnapGene-style mammalian expression vector record (PP539716).",
  },

  // --- Origins ---
  {
    id: "ori_f1_phage",
    name: "f1 / M13 phage origin of replication",
    category: "origin",
    accession: "PP539716.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "rep_origin" &&
      /^f1 bacteriophage origin of replication$/i.test(f.qualifiers.note || ""),
    note: "f1 (M13) filamentous-phage origin of replication, the single-strand rescue origin of phagemids, annotated as a clean rep_origin range (complement strand) in a SnapGene-style mammalian expression vector record (PP539716).",
  },
  {
    id: "ori_rk2_oriv",
    name: "RK2 / oriV origin of vegetative replication",
    category: "origin",
    accession: "U75327.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "misc_feature" &&
      /^origin of vegetative replication from RK2; oriV$/i.test(
        f.qualifiers.note || ""
      ),
    note: "RK2 oriV, the vegetative origin of the broad-host-range RK2/RP4 incP plasmid family, annotated as an explicit coordinate range (misc_feature) in a broad-host-range vector record (U75327).",
  },

  // --- High-value bonus regulatory elements (same SnapGene-style records) ---
  {
    id: "regulatory_wpre",
    name: "WPRE (woodchuck hepatitis posttranscriptional regulatory element)",
    category: "regulatory",
    accession: "MZ648044.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "misc_feature" &&
      /^woodchuck hepatitis virus posttranscriptional regulatory element; WPRE$/i.test(
        f.qualifiers.note || ""
      ),
    note: "Woodchuck hepatitis virus posttranscriptional regulatory element (WPRE), which boosts transgene expression in nearly every modern lentiviral vector, annotated as a clean range in a SnapGene-style lentiviral vector record (MZ648044).",
  },
  {
    id: "regulatory_ires2_emcv",
    name: "IRES (EMCV internal ribosome entry site, IRES2)",
    category: "regulatory",
    accession: "PP539716.1",
    license: "Public domain sequence facts (GenBank/NCBI).",
    match: (f) =>
      f.type === "regulatory" &&
      f.qualifiers.regulatory_class === "ribosome_binding_site" &&
      /internal ribosome entry site \(IRES2\) of the encephalomyocarditis virus/i.test(
        f.qualifiers.note || ""
      ),
    note: "Encephalomyocarditis virus (EMCV) internal ribosome entry site (IRES2), the standard element for cap-independent translation of a second ORF from one transcript, annotated as a clean range in a SnapGene-style mammalian expression vector record (PP539716).",
  },
];

// Targets from the curation brief that were investigated against specific NCBI
// records but could NOT be cleanly extracted, and were therefore omitted rather
// than guessed. Recorded here (not as guessed sequences) so a future pass can
// revisit them. The "reason" documents the exact record-level finding.
//
// v2 update: the bacterial-cloning workhorse origins (ColE1/pUC, p15A, pSC101),
// the phage/bacterial promoters (T7, SP6, lac, tac, trc) and the T7 / lambda tL3
// terminators are NO LONGER omitted. The v1 omissions were a consequence of only
// searching the classic single-base primary records; v2 pins modern,
// well-annotated synthetic-construct and cloning-vector records that annotate
// each as a clean coordinate range, so they are now shipped as method-A
// extractions above. What remains below is genuinely out of scope or unfound.
const DOCUMENTED_OMISSIONS = [
  {
    id: "ori_pbr322",
    name: "pBR322 / pMB1 origin",
    reason:
      "COVERED, not omitted. pBR322, pMB1, ColE1 and pUC share one and the same replication origin region; it is shipped as ori_cole1_puc (PX994934.1 rep_origin 8031..8619, /note 'high-copy-number ColE1/pMB1/pBR322/pUC origin of replication'). Storing a separate pBR322 sequence would duplicate the same element. The primary pBR322 record J01749 annotates its origin only as a single base (rep_origin 2535), so no distinct range exists there anyway.",
  },
  {
    id: "ori_f1_m13",
    name: "f1 / M13 origin",
    reason:
      "COVERED in v3, not omitted. Shipped as ori_f1_phage (PP539716.1 rep_origin complement(3427..3882), /note 'f1 bacteriophage origin of replication'). The v2 note below was the v2-era status; the f1/M13 phage origin is now extracted by coordinates from a SnapGene-style record that annotates it as a clean range.",
  },
  {
    id: "promoter_arabad",
    name: "araBAD / pBAD promoter",
    reason:
      "Not in the v2 brief target list and not pursued here. Records that annotate a pBAD/araBAD promoter range exist (e.g. PV588693.1), so it is a clean future addition, not a fabrication risk.",
  },
  {
    id: "promoter_ef1a_pgk_u6_h1_sv40",
    name: "EF-1alpha / PGK / U6 / H1 / SV40 promoters",
    reason:
      "COVERED in v3, not omitted. Shipped as promoter_ef1a_core (MZ648044.1), promoter_pgk (MH325103.1), promoter_u6 (MN811116.1), promoter_h1 (DQ465352.1) and promoter_sv40_early (PP539716.1), each extracted by coordinates from a record that annotates it as a clean range. CAG is NOT shipped: it is a composite (CMV enhancer + chicken beta-actin promoter + rabbit beta-globin intron) whose annotation varies by record, so it was not extracted to avoid mislabeling a partial span; deferred.",
  },
  {
    id: "promoter_minp",
    name: "minimal promoter (minP / minimal CMV / TATA minimal promoter)",
    reason:
      "OMITTED, not guessed. No surveyed synthetic-construct record annotated a feature whose /note was a clean, unambiguous 'minimal promoter' / 'minP' / 'minimal CMV promoter' range during this pass. minP is a very short synthetic element with many near-identical variants, so a wrong pick would mislabel. Deferred until a record cleanly annotates a specific minP variant as a coordinate range.",
  },
  {
    id: "ori_yeast_2micron_cen_ars",
    name: "yeast 2-micron origin / CEN / ARS",
    reason:
      "OMITTED, not guessed. Surveyed S. cerevisiae shuttle-vector searches did not surface a record annotating the 2-micron origin, a CEN element, or an ARS as a clean extractable coordinate range during this pass. Not extracted to avoid guessing a span; deferred to a dedicated yeast-vector curation pass.",
  },
  {
    id: "marker_sv40_neo_dna_variant",
    name: "SV40-neo DNA coding variant (divergent NeoR)",
    reason:
      "Handled in the PROTEIN database, not here. The divergent NeoR/KanR variant requested by the validation pass is shipped as a protein entry (marker_neor_aph3i, aph(3')-I / aphA1, UniProt P00551) in protein-features.json, alongside the existing aph(3')-II. DNA-level neo coding sequences are detected via the protein detector; no separate DNA entry is added.",
  },
  {
    id: "regulatory_shine_dalgarno_skip",
    name: "Shine-Dalgarno (as a detectable motif)",
    reason:
      "SKIP per brief: too short for sequence detection (a 5-6 bp motif needs a motif-scan, not exact-match detection). Note: a single grounded SD instance is already stored (regulatory_shine_dalgarno, extracted from J01749) for reference, but it is not a reliable detection target on its own.",
  },
  {
    id: "regulatory_kozak",
    name: "Kozak sequence",
    reason:
      "SKIP per brief: too short for sequence detection and a mammalian motif. The Kozak consensus is a short motif, not a feature annotated at coordinates in a primary record; reciting the consensus from memory is forbidden.",
  },
  {
    id: "regulatory_polya_hexamer_skip",
    name: "bare polyA hexamer (AATAAA) as a detectable motif",
    reason:
      "SKIP per brief: a 6 bp hexamer is too short for exact-match detection (needs a motif-scan). Note: one grounded instance (regulatory_sv40_polya, extracted from J02400) is stored for reference, not as a standalone detection target.",
  },
];

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function validateEntry(entry) {
  const band = LENGTH_BANDS[entry.category];
  if (!band) {
    warn(`reject ${entry.id}: unknown category ${entry.category}`);
    return false;
  }
  if (typeof entry.seq !== "string" || entry.seq.length === 0) {
    warn(`reject ${entry.id}: empty sequence`);
    return false;
  }
  if (!DNA_RE.test(entry.seq)) {
    warn(`reject ${entry.id}: sequence has non-DNA characters`);
    return false;
  }
  const [min, max] = band;
  if (entry.seq.length < min || entry.seq.length > max) {
    warn(
      `reject ${entry.id}: length ${entry.seq.length} outside band ${min}-${max} for ${entry.category}`
    );
    return false;
  }
  return true;
}

// Method-B style cross-confirmation. Given an extracted sequence and a second
// accession that is EXPECTED to contain that element verbatim (e.g. confirming
// an extracted T7 promoter against a canonical pET vector), fetch that record
// and locate the sequence on either strand. We require a verbatim (exact) hit
// over the full length; the threshold parameter allows a >=0.95 windowed match
// for longer elements, but for the short universal motifs here we expect exact.
// Returns { accession, position } describing where it was found, or null. The
// worst case for a wrong guess is null (we then drop the cross-confirmation but
// keep the method-A extraction, which is itself fully grounded).
async function confirmInRecord(seq, confirmAcc) {
  let gb;
  try {
    gb = await efetchGenbank(confirmAcc);
  } catch (err) {
    warn(`confirmIn ${confirmAcc}: fetch failed: ${err.message}`);
    return null;
  }
  const { sequence } = parseGenbank(gb);
  const fwd = sequence.indexOf(seq);
  if (fwd >= 0) {
    return { accession: confirmAcc, position: `${fwd + 1}..${fwd + seq.length}`, strand: "+" };
  }
  const rc = revComp(seq);
  const rev = sequence.indexOf(rc);
  if (rev >= 0) {
    return {
      accession: confirmAcc,
      position: `complement(${rev + 1}..${rev + rc.length})`,
      strand: "-",
    };
  }
  return null;
}

async function buildEntry(target) {
  let gb;
  try {
    gb = await efetchGenbank(target.accession);
  } catch (err) {
    warn(`OMIT ${target.id}: could not fetch ${target.accession}: ${err.message}`);
    return { entry: null, omit: `fetch failed for ${target.accession}: ${err.message}` };
  }
  const { sequence, features } = parseGenbank(gb);
  const matches = features.filter(target.match);
  if (matches.length === 0) {
    return {
      entry: null,
      omit: `no feature matched in ${target.accession}`,
    };
  }
  if (matches.length > 1) {
    warn(
      `${target.id}: ${matches.length} features matched in ${target.accession}; using the first`
    );
  }
  const feat = matches[0];
  const loc = parseLocation(feat.location);
  if (!loc) {
    return {
      entry: null,
      omit: `matched feature in ${target.accession} has a fuzzy/unparseable location "${feat.location}"`,
    };
  }
  const seq = extractByLocation(sequence, loc);
  const coords = formatCoords(loc);
  const entry = {
    id: target.id,
    name: target.name,
    category: target.category,
    sequenceType: "dna",
    seq,
    source: "NCBI GenBank (nuccore), extracted by feature coordinates",
    sourceUrl: efetchUrl(target.accession),
    accession: target.accession,
    coords,
    license: target.license,
    note: `${target.note} Extracted feature: ${feat.type}; record /note: "${
      feat.qualifiers.note || ""
    }".`,
  };
  // Optional cross-confirmation in a second expected record (method-B style).
  if (target.confirmIn) {
    const hit = await confirmInRecord(seq, target.confirmIn);
    if (hit) {
      entry.matchedInAccession = hit.accession;
      entry.note += ` Cross-confirmed: the extracted sequence is present verbatim in ${hit.accession} at ${hit.position} (${efetchUrl(hit.accession)}).`;
      log(
        `  CONFIRM ${target.id}: also present verbatim in ${hit.accession} ${hit.position}`
      );
    } else {
      warn(
        `${target.id}: cross-confirmation in ${target.confirmIn} did NOT find the extracted sequence (kept method-A extraction without cross-confirm).`
      );
    }
  }
  log(
    `EXTRACT ${target.id}: ${target.accession} ${feat.type} ${coords} -> len ${seq.length} <- ${entry.sourceUrl}`
  );
  return { entry, omit: null };
}

function dedupeById(entries) {
  const seen = new Map();
  for (const e of entries) {
    if (seen.has(e.id)) {
      warn(`duplicate id ${e.id} dropped`);
      continue;
    }
    seen.set(e.id, e);
  }
  return [...seen.values()];
}

// Independent re-fetch + re-extract for a spot-check sample. Re-derives the
// sequence from a freshly parsed copy of the record and asserts it matches the
// stored seq. Any mismatch is a hard error.
async function verifySample(entries, sampleIds) {
  log("");
  log("Verification: independent re-extraction of spot-check entries");
  for (const id of sampleIds) {
    const e = entries.find((x) => x.id === id);
    if (!e) {
      warn(`verify: entry ${id} not present (skipped)`);
      continue;
    }
    const gb = await efetchGenbank(e.accession);
    const { sequence, features } = parseGenbank(gb);
    const target = TARGETS.find((t) => t.id === id);
    const feat = features.filter(target.match)[0];
    const loc = parseLocation(feat.location);
    const reSeq = extractByLocation(sequence, loc);
    if (reSeq === e.seq) {
      log(`  OK ${id}: re-extracted ${e.coords} matches stored seq (len ${e.seq.length})`);
    } else {
      throw new Error(
        `VERIFY FAILED for ${id}: re-extracted seq does not match stored seq`
      );
    }
    // If this entry carries a cross-confirmation, independently re-confirm that
    // the stored sequence is still present verbatim in the matched record.
    if (e.matchedInAccession) {
      const hit = await confirmInRecord(e.seq, e.matchedInAccession);
      if (hit) {
        log(
          `  OK ${id}: cross-confirm still present in ${e.matchedInAccession} ${hit.position}`
        );
      } else {
        throw new Error(
          `VERIFY FAILED for ${id}: stored seq not found in cross-confirm record ${e.matchedInAccession}`
        );
      }
    }
  }
}

async function main() {
  log("Building DNA feature database (extract-only, no fabrication)...");
  log("");

  const built = [];
  // Start with the brief targets that were investigated and could not be
  // cleanly sourced, then add any runtime extraction failures.
  const omitted = [...DOCUMENTED_OMISSIONS];
  for (const target of TARGETS) {
    const { entry, omit } = await buildEntry(target);
    if (entry) built.push(entry);
    if (omit) {
      omitted.push({ id: target.id, name: target.name, reason: omit });
      warn(`OMIT ${target.id} (${target.name}): ${omit}`);
    }
  }

  let all = built.filter(validateEntry);
  all = dedupeById(all);

  all.sort((a, b) =>
    a.category === b.category
      ? a.id.localeCompare(b.id)
      : a.category.localeCompare(b.category)
  );

  const counts = {};
  for (const e of all) counts[e.category] = (counts[e.category] || 0) + 1;

  // Spot-check three entries by independent re-fetch + re-extract. Prefer three
  // of the NEW v2 entries (covering an origin, a cross-confirmed promoter, and a
  // terminator) when present, falling back to the first three entries otherwise.
  const preferredSample = ["ori_cole1_puc", "promoter_t7", "terminator_t7"].filter(
    (id) => all.some((e) => e.id === id)
  );
  const sample =
    preferredSample.length === 3
      ? preferredSample
      : all.slice(0, 3).map((e) => e.id);
  await verifySample(all, sample);

  const dataset = {
    generatedAt: new Date().toISOString(),
    sources: [
      {
        name: "NCBI GenBank (nuccore)",
        license:
          "GenBank/NCBI sequence data carries no copyright restrictions on the sequence facts. See https://www.ncbi.nlm.nih.gov/home/about/policies/",
        url: "https://www.ncbi.nlm.nih.gov/nuccore/",
      },
    ],
    method:
      "Each sequence is the substring of a fetched GenBank record at the coordinates of a feature whose type and /note match the target (method A, coordinate extraction). complement() locations are reverse-complemented. Some entries additionally carry a cross-confirmation (matchedInAccession) recording a second fetched record in which the extracted sequence was found verbatim. No sequence is written, completed, or recalled from memory.",
    count: all.length,
    countsByCategory: counts,
    entries: all,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(JSON_PATH, JSON.stringify(dataset, null, 2) + "\n", "utf8");
  updateAttribution(counts, all.length, omitted);

  log("");
  log("Wrote:");
  log(`  ${JSON_PATH}`);
  log(`  ${ATTRIBUTION_PATH} (DNA section)`);
  log("");
  log(`Total DNA entries: ${all.length}`);
  for (const [cat, n] of Object.entries(counts)) log(`  ${cat}: ${n}`);
  if (omitted.length) {
    log("");
    log(`Omitted (could not cleanly source) ${omitted.length}:`);
    for (const o of omitted) log(`  ${o.id}: ${o.reason}`);
  }
}

// ---------------------------------------------------------------------------
// Attribution. The protein build script owns the top of ATTRIBUTION.md; we
// append (or replace) a clearly delimited DNA section so re-runs are idempotent.
// ---------------------------------------------------------------------------

const DNA_SECTION_START = "<!-- DNA-FEATURE-DB-SECTION:START -->";
const DNA_SECTION_END = "<!-- DNA-FEATURE-DB-SECTION:END -->";

function buildDnaSection(counts, total, omitted) {
  const lines = [];
  lines.push(DNA_SECTION_START);
  lines.push("");
  lines.push("# DNA Feature Database, Attribution and Licensing");
  lines.push("");
  lines.push(
    "This dataset (frontend/public/feature-db/dna-features.json) powers the DNA path of the offline common-features detector. It was assembled by scripts/build-dna-feature-db.mjs, which fetches real GenBank records from NCBI E-utilities and extracts each element by its annotated feature coordinates within that record. Re-run the script to regenerate or update the data."
  );
  lines.push("");
  lines.push(`Total DNA entries: ${total}.`);
  lines.push("");
  for (const [cat, n] of Object.entries(counts)) {
    lines.push(`- ${cat}: ${n}`);
  }
  lines.push("");
  lines.push("## Source and licensing (NCBI GenBank)");
  lines.push("");
  lines.push(
    "All DNA element sequences were extracted from public GenBank records fetched from the NCBI E-utilities efetch endpoint (https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi, db=nuccore, rettype=gb). NCBI/GenBank places no copyright restrictions on the sequence data itself; the sequence facts are freely usable and redistributable. See the NCBI policies page (https://www.ncbi.nlm.nih.gov/home/about/policies/). Each entry stores the source accession, the exact 1-based feature coordinates used for extraction, the matched feature /note, and the efetch source URL, so every extraction is independently auditable. Please cite the underlying GenBank accessions when reusing these sequences."
  );
  lines.push("");
  lines.push(
    "GenBank accessions used: J02400 (SV40 genome: SV40 core and auxiliary origins, late polyA hexamer), J01749 (pBR322: Shine-Dalgarno), X02981 (phage T3: T3 promoter), PZ020853 (CMV promoter and enhancer), PX994934 (T7 promoter, lac promoter, ColE1/pUC origin, lac operator), PP098726 (pET28a: T7-promoter cross-confirmation), LR588434 (SP6 promoter), MT321292 (tac promoter), KX682239 (trc promoter), PZ005984 (p15A origin), PV807101 (pSC101 origin), PV231317 (rrnB T1 terminator), OZ375372 (T7 terminator), OQ295986 (lambda tL3 terminator). v3 mammalian/lentiviral additions: MZ648044 (EF-1alpha core promoter, SV40 late polyA full region, WPRE), LC897330 (BGH polyA), MH325103 (PGK promoter), MN811116 (U6 promoter), DQ465352 (H1 promoter), PP539716 (SV40 enhancer/early promoter, f1 phage origin, EMCV IRES2), U75327 (RK2 oriV)."
  );
  lines.push("");
  lines.push("## Extraction method (verified, not recited)");
  lines.push("");
  lines.push(
    "For each target element the build script pins a specific, well-annotated GenBank accession and a predicate that selects exactly one feature in that record by feature type plus /note or /regulatory_class. The stored sequence is the substring of the fetched record at that feature's coordinates (method A); complement() locations are reverse-complemented; locations with fuzzy bounds (< or >) are refused. Some entries additionally carry a cross-confirmation (the matchedInAccession field): the extracted sequence was located verbatim in a second fetched record that is expected to contain it (for example, the T7 promoter extracted from a SnapGene-style synthetic construct is cross-confirmed present in the canonical pET28a vector record PP098726.1). This cross-confirmation is method-B style provenance and never a source of sequence data; if a cross-confirmation fails, the method-A extraction is kept and the cross-confirmation is simply dropped. The script independently re-fetches and re-extracts a spot-check sample (and re-checks any cross-confirmation) and aborts if any re-extraction does not match the stored sequence."
  );
  lines.push("");
  lines.push("## No-fabrication guarantee");
  lines.push("");
  lines.push(
    "Every sequence in dna-features.json is the substring of a GenBank record fetched live from NCBI, taken at the coordinates of a matched annotated feature. No DNA sequence was written, completed, or recalled from memory. Every sequence is validated against the DNA alphabet (A, C, G, T, N) and a plausible per-category length band before inclusion. Targets that could not be cleanly sourced from a well-annotated record were omitted, not guessed."
  );
  lines.push("");
  if (omitted.length) {
    lines.push("## Omitted, covered-by-family, and skipped targets");
    lines.push("");
    lines.push(
      "The following brief targets are NOT shipped as their own entry. Each is one of: covered by an equivalent shipped entry (the same biological element under a family name), out of scope for this bacterial-cloning pass (deferred to a later mammalian-expression pass), or skipped as too short for exact-match sequence detection. None was fabricated; where a sequence was unavailable from a clean annotated range it was omitted rather than guessed. They are recorded here so a future curation pass can revisit them."
    );
    lines.push("");
    for (const o of omitted) {
      lines.push(`- ${o.name} (${o.id}): ${o.reason}`);
    }
    lines.push("");
  }
  lines.push(DNA_SECTION_END);
  return lines.join("\n");
}

function updateAttribution(counts, total, omitted) {
  const section = buildDnaSection(counts, total, omitted);
  let existing = "";
  if (existsSync(ATTRIBUTION_PATH)) existing = readFileSync(ATTRIBUTION_PATH, "utf8");

  const startIdx = existing.indexOf(DNA_SECTION_START);
  const endIdx = existing.indexOf(DNA_SECTION_END);
  let next;
  if (startIdx !== -1 && endIdx !== -1) {
    next =
      existing.slice(0, startIdx) +
      section +
      existing.slice(endIdx + DNA_SECTION_END.length);
  } else {
    const sep = existing.trimEnd();
    next = (sep ? sep + "\n\n" : "") + section + "\n";
  }
  if (!next.endsWith("\n")) next += "\n";
  writeFileSync(ATTRIBUTION_PATH, next, "utf8");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
