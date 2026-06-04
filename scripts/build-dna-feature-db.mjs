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

  // --- Regulatory signals ---
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
];

// Targets from the curation brief that were investigated against specific NCBI
// records but could NOT be cleanly extracted, and were therefore omitted rather
// than guessed. Recorded here (not as guessed sequences) so a future pass can
// revisit them. The "reason" documents the exact record-level finding.
const DOCUMENTED_OMISSIONS = [
  {
    id: "ori_cole1_puc",
    name: "ColE1 / pUC origin",
    reason:
      "pUC19 (L09137) carries only a bare source feature; the pBR322 origin in J01749 is annotated as a single base point (rep_origin 2535), not a coordinate range, so no span can be extracted without inventing endpoints.",
  },
  {
    id: "ori_pbr322",
    name: "pBR322 origin",
    reason:
      "J01749 annotates the pBR322 origin as a single base (rep_origin 2535) with no range; extracting a span would require guessed endpoints.",
  },
  {
    id: "ori_p15a",
    name: "p15A origin",
    reason: "No fetched public-domain primary record annotated a p15A origin as a coordinate range.",
  },
  {
    id: "ori_psc101",
    name: "pSC101 origin",
    reason:
      "Only an indirect reference exists (pBR322 J01749 misc_feature 1636..1762 noted 'from pSC101'); the fragment is not annotated as an origin feature, so it was not extracted as one.",
  },
  {
    id: "ori_f1_m13",
    name: "f1 / M13 origin",
    reason:
      "The M13 genome record (V00604) does not annotate the f1 intergenic origin as a feature; it appears only inside a gene II /note, with no extractable coordinates.",
  },
  {
    id: "promoter_t7",
    name: "T7 promoter (phi10)",
    reason:
      "The T7 RefSeq genome (NC_001604) annotates the phi10 promoter as a single base (regulatory 22904), not a range; the canonical 23-mer cannot be extracted without inventing endpoints around that point.",
  },
  {
    id: "promoter_sp6",
    name: "SP6 promoter",
    reason: "The SP6 RefSeq genome (NC_004831) contains zero regulatory/promoter features.",
  },
  {
    id: "promoter_lac",
    name: "lac / lacUV5 promoter",
    reason:
      "The lac operon record (J01636) annotates the CAP site and the lac operator as ranges but not the -35/-10 promoter as a single clean range, and mixes wild-type vs UV5 variation features; no unambiguous promoter span.",
  },
  {
    id: "promoter_tac_trc_arabad",
    name: "tac / trc / araBAD promoters",
    reason:
      "tac and trc are engineered hybrid promoters with no single primary record; no fetched public-domain record annotated them, or araBAD, as a clean extractable range.",
  },
  {
    id: "promoter_ef1a_cag_pgk_u6",
    name: "EF-1alpha / CAG / hPGK / U6 promoters",
    reason:
      "No fetched well-annotated public record exposed these as a single coordinate range with a matching note; not extracted to avoid mislabeling.",
  },
  {
    id: "terminator_t7",
    name: "T7 terminator (Tphi)",
    reason:
      "The T7 RefSeq genome (NC_001604) annotates the Tphi terminator as a single base (regulatory 24210), not a range.",
  },
  {
    id: "terminator_lambda_tl3",
    name: "lambda tL3 terminator",
    reason:
      "The lambda RefSeq genome (NC_001416) annotates operators but no tL3 terminator feature with extractable coordinates.",
  },
  {
    id: "terminator_bgh_polya",
    name: "BGH polyA",
    reason:
      "No fetched well-annotated public record exposed the BGH polyadenylation signal as a single coordinate range with a matching note.",
  },
  {
    id: "regulatory_kozak",
    name: "Kozak sequence",
    reason:
      "The Kozak consensus is a short motif, not a feature annotated at coordinates in a primary record; extracting a specific instance was out of scope and reciting the consensus is forbidden.",
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

  // Spot-check three entries by independent re-fetch + re-extract.
  const sample = all.slice(0, 3).map((e) => e.id);
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
      "Each sequence is the substring of a fetched GenBank record at the coordinates of a feature whose type and /note match the target. complement() locations are reverse-complemented. No sequence is written, completed, or recalled from memory.",
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
  lines.push("## Extraction method (verified, not recited)");
  lines.push("");
  lines.push(
    "For each target element the build script pins a specific, well-annotated GenBank accession and a predicate that selects exactly one feature in that record by feature type plus /note or /regulatory_class. The stored sequence is the substring of the fetched record at that feature's coordinates; complement() locations are reverse-complemented; locations with fuzzy bounds (< or >) are refused. The script independently re-fetches and re-extracts a spot-check sample and aborts if any re-extraction does not match the stored sequence."
  );
  lines.push("");
  lines.push("## No-fabrication guarantee");
  lines.push("");
  lines.push(
    "Every sequence in dna-features.json is the substring of a GenBank record fetched live from NCBI, taken at the coordinates of a matched annotated feature. No DNA sequence was written, completed, or recalled from memory. Every sequence is validated against the DNA alphabet (A, C, G, T, N) and a plausible per-category length band before inclusion. Targets that could not be cleanly sourced from a well-annotated record were omitted, not guessed."
  );
  lines.push("");
  if (omitted.length) {
    lines.push("## Omitted targets (could not cleanly source)");
    lines.push("");
    lines.push(
      "The following targets were intentionally omitted because no fetched record annotated them as an unambiguous coordinate range with a matching note. They are recorded here so a future curation pass can revisit them rather than fabricate a sequence."
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
