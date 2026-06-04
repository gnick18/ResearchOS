// build-feature-db.mjs
//
// Builds a curated, license-tagged PROTEIN FEATURE DATABASE for an offline
// common-features detector. It fetches real amino-acid sequences from cleanly
// licensed public APIs (FPbase, UniProt) and combines them with a small set of
// cited canonical epitope-tag constants.
//
// HARD RULE: every sequence in the output either comes from a live HTTP fetch
// against the named APIs (with the exact source URL stored alongside it), or is
// one of the cited canonical tag constants defined verbatim below. No sequence
// is ever invented, completed, or recalled from memory.
//
// Re-runnable and idempotent. Run with:
//   node scripts/build-feature-db.mjs
//
// Output:
//   frontend/public/feature-db/protein-features.json
//   frontend/public/feature-db/ATTRIBUTION.md
//
// No emojis, no em-dashes by design.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "frontend", "public", "feature-db");
const JSON_PATH = join(OUT_DIR, "protein-features.json");
const ATTRIBUTION_PATH = join(OUT_DIR, "ATTRIBUTION.md");

// Amino-acid alphabet (standard 20 plus B, X, Z and the rare U/O selenocysteine
// and pyrrolysine codes that UniProt may emit).
const AA_RE = /^[ACDEFGHIKLMNPQRSTVWYBXZUO]+$/;

// Per-category plausible length bands. Anything outside is rejected and logged.
// Note the fluorescent_protein upper bound allows tandem-dimer FPs such as
// tdTomato, which are roughly twice the length of a single barrel.
const LENGTH_BANDS = {
  fluorescent_protein: [180, 520],
  resistance_marker: [80, 950],
  fusion_tag: [80, 700],
  epitope_tag: [4, 40],
};

const log = (...args) => console.log(...args);
const warn = (...args) => console.warn("WARN:", ...args);

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function httpGet(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "ResearchOS-feature-db/1.0 (research tool)" },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.text();
}

// Validate one assembled entry. Returns true if it passes, otherwise logs and
// returns false. Never mutates a sequence beyond uppercasing and trimming
// whitespace that the source may have included.
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
  if (!AA_RE.test(entry.seq)) {
    warn(`reject ${entry.id}: sequence has non amino-acid characters`);
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

// ---------------------------------------------------------------------------
// A. Fluorescent proteins from FPbase
// ---------------------------------------------------------------------------

const FP_NAMES = [
  "EGFP", "sfGFP", "GFP", "mNeonGreen", "mEmerald", "EYFP", "mVenus",
  "mCitrine", "mCerulean3", "mTurquoise2", "ECFP", "mCherry", "mScarlet-I",
  "mRuby3", "mKate2", "tdTomato", "dTomato", "mOrange", "mTagBFP2", "EBFP2",
  "iRFP713",
];

// Some common lab names differ from the canonical FPbase record name. Map the
// requested common name to the exact FPbase name we should query with
// name__iexact. This only changes which existing FPbase record we fetch; it
// never invents a sequence.
const FP_NAME_ALIASES = {
  sfGFP: "Superfolder GFP",
  GFP: "avGFP",
};

async function fetchFluorescentProteins() {
  const out = [];
  for (const name of FP_NAMES) {
    const queryName = FP_NAME_ALIASES[name] || name;
    const url = `https://www.fpbase.org/api/proteins/?name__iexact=${encodeURIComponent(
      queryName
    )}&format=json`;
    try {
      const body = await httpGet(url);
      const arr = JSON.parse(body);
      if (!Array.isArray(arr) || arr.length === 0) {
        warn(`FPbase: no record for ${name} (omitted)`);
        continue;
      }
      const rec = arr[0];
      const rawSeq = rec.seq;
      if (!rawSeq || typeof rawSeq !== "string") {
        warn(`FPbase: ${name} has no seq field (omitted)`);
        continue;
      }
      const seq = rawSeq.replace(/\s+/g, "").toUpperCase();
      const id = `fp_${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
      const accession = rec.uuid ? `FPbase:${rec.uuid}` : undefined;
      const canonical = rec.name || queryName;
      const entry = {
        id,
        // Display the common lab name; note the FPbase canonical name when it
        // differs from what we requested.
        name:
          canonical.toLowerCase() === name.toLowerCase()
            ? canonical
            : `${name} (FPbase: ${canonical})`,
        category: "fluorescent_protein",
        sequenceType: "protein",
        seq,
        source: "FPbase",
        sourceUrl: url,
        license: "FPbase (sequence data is copyright-free, attribution requested)",
        accession,
      };
      log(`FPbase OK  ${name} <- ${url} (len ${seq.length})`);
      out.push(entry);
    } catch (err) {
      warn(`FPbase: fetch failed for ${name} (omitted): ${err.message}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// B/C. UniProt reviewed entries (resistance markers + large fusion tags)
// ---------------------------------------------------------------------------

// Each spec: { id, name, category, query }
// The query is a UniProtKB search expression restricted to reviewed entries.
// We take the FIRST returned FASTA record and store its accession from the
// header, plus the canonical UniProt entry URL.
const UNIPROT_SPECS = [
  // B. Resistance / selection markers
  {
    id: "marker_ampr_bla",
    name: "AmpR (bla, beta-lactamase TEM)",
    category: "resistance_marker",
    query: '"Beta-lactamase TEM" AND gene:blaT-3 AND reviewed:true',
  },
  {
    id: "marker_kanr_neor",
    name: "KanR / NeoR (aph(3')-II, neo)",
    category: "resistance_marker",
    query:
      '"aminoglycoside 3\'-phosphotransferase" AND gene:nptII AND reviewed:true',
  },
  {
    id: "marker_cmr_cat",
    name: "CmR (cat, chloramphenicol acetyltransferase)",
    category: "resistance_marker",
    query: '"chloramphenicol acetyltransferase" AND reviewed:true',
  },
  {
    id: "marker_hygr",
    name: "HygR (hph, hygromycin-B 4-O-kinase)",
    category: "resistance_marker",
    query: '"hygromycin-B 4-O-kinase" AND reviewed:true',
  },
  {
    id: "marker_puror_pac",
    name: "PuroR (pac, puromycin N-acetyltransferase)",
    category: "resistance_marker",
    query: '"puromycin N-acetyltransferase" AND reviewed:true',
  },
  {
    id: "marker_specr_aada",
    name: "SpecR / aadA (aminoglycoside adenylyltransferase)",
    category: "resistance_marker",
    query: 'gene:aadA AND reviewed:true AND "adenylyltransferase"',
  },
  {
    id: "marker_tmpr_dhfr",
    name: "TmpR (trimethoprim-resistant dihydrofolate reductase)",
    category: "resistance_marker",
    query: '"dihydrofolate reductase" AND trimethoprim AND reviewed:true',
  },
  // C. Large fusion tags
  {
    id: "tag_mbp",
    name: "MBP (maltose-binding protein, MalE)",
    category: "fusion_tag",
    query: "maltose-binding protein MalE Escherichia coli AND reviewed:true",
  },
  {
    id: "tag_gst",
    name: "GST (glutathione S-transferase, S. japonicum)",
    category: "fusion_tag",
    query:
      "glutathione S-transferase Schistosoma japonicum AND reviewed:true",
  },
  {
    id: "tag_sumo",
    name: "SUMO (small ubiquitin-related modifier)",
    category: "fusion_tag",
    query: "small ubiquitin-related modifier SUMO AND reviewed:true",
  },
];

// Parse a single-record FASTA string into { accession, seq }.
function parseFasta(fasta) {
  const lines = fasta.split(/\r?\n/);
  let header = null;
  const seqLines = [];
  for (const line of lines) {
    if (line.startsWith(">")) {
      if (header !== null) break; // only the first record
      header = line;
    } else if (header !== null) {
      seqLines.push(line.trim());
    }
  }
  if (header === null) return null;
  // Header form: >sp|P62593|BLAT_ECOLX Beta-lactamase TEM ...
  const m = header.match(/^>\w+\|([^|]+)\|/);
  const accession = m ? m[1] : null;
  const seq = seqLines.join("").replace(/\s+/g, "").toUpperCase();
  return { accession, seq };
}

async function fetchUniProtEntries() {
  const out = [];
  for (const spec of UNIPROT_SPECS) {
    const url = `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(
      spec.query
    )}&format=fasta&size=1`;
    try {
      const fasta = await httpGet(url);
      if (!fasta.trim().startsWith(">")) {
        warn(`UniProt: no reviewed hit for ${spec.id} (omitted)`);
        continue;
      }
      const parsed = parseFasta(fasta);
      if (!parsed || !parsed.seq) {
        warn(`UniProt: could not parse FASTA for ${spec.id} (omitted)`);
        continue;
      }
      const entryUrl = parsed.accession
        ? `https://www.uniprot.org/uniprotkb/${parsed.accession}/entry`
        : url;
      const entry = {
        id: spec.id,
        name: spec.name,
        category: spec.category,
        sequenceType: "protein",
        seq: parsed.seq,
        source: "UniProt (Swiss-Prot, reviewed)",
        sourceUrl: entryUrl,
        license: "CC BY 4.0",
        accession: parsed.accession || undefined,
      };
      log(
        `UniProt OK ${spec.id} accession ${parsed.accession} <- ${url} (len ${parsed.seq.length})`
      );
      out.push(entry);
    } catch (err) {
      warn(`UniProt: fetch failed for ${spec.id} (omitted): ${err.message}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// D. Epitope / purification tags (cited canonical constants, NOT fetched)
// ---------------------------------------------------------------------------
// These are standard, published epitope-tag peptide sequences. They are
// definitional constants, included verbatim, never altered or guessed.
const EPITOPE_TAGS = [
  { id: "tag_his6", name: "His6", seq: "HHHHHH" },
  { id: "tag_his8", name: "His8", seq: "HHHHHHHH" },
  { id: "tag_flag", name: "FLAG", seq: "DYKDDDDK" },
  { id: "tag_3xflag", name: "3xFLAG", seq: "DYKDHDGDYKDHDIDYKDDDDK" },
  { id: "tag_ha", name: "HA", seq: "YPYDVPDYA" },
  { id: "tag_cmyc", name: "c-Myc", seq: "EQKLISEEDL" },
  { id: "tag_v5", name: "V5", seq: "GKPIPNPLLGLDST" },
  { id: "tag_strepii", name: "Strep-II", seq: "WSHPQFEK" },
  { id: "tag_t7", name: "T7-tag", seq: "MASMTGGQQMG" },
  { id: "tag_avitag", name: "AviTag", seq: "GLNDIFEAQKIEWHE" },
];

function buildEpitopeTags() {
  return EPITOPE_TAGS.map((t) => ({
    id: t.id,
    name: t.name,
    category: "epitope_tag",
    sequenceType: "protein",
    seq: t.seq.toUpperCase(),
    source: "standard",
    sourceUrl:
      "https://www.uniprot.org/help/tags (standard published epitope-tag sequences)",
    license: "public (standard sequence)",
    note: "Standard published epitope-tag sequence; definitional constant, included verbatim.",
  }));
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

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

async function main() {
  log("Building protein feature database...");
  log("");

  const fps = await fetchFluorescentProteins();
  log("");
  const uniprot = await fetchUniProtEntries();
  log("");
  const tags = buildEpitopeTags();
  log(`Epitope tags: ${tags.length} cited canonical constants included.`);
  log("");

  let all = [...fps, ...uniprot, ...tags];

  // Validate every entry; drop and log failures.
  all = all.filter(validateEntry);
  all = dedupeById(all);

  // Stable sort by category then id for human review.
  all.sort((a, b) =>
    a.category === b.category
      ? a.id.localeCompare(b.id)
      : a.category.localeCompare(b.category)
  );

  const counts = {};
  for (const e of all) counts[e.category] = (counts[e.category] || 0) + 1;

  const dataset = {
    generatedAt: new Date().toISOString(),
    sources: [
      {
        name: "FPbase",
        license: "Sequence data is copyright-free; attribution requested.",
        url: "https://www.fpbase.org",
      },
      {
        name: "UniProt (Swiss-Prot)",
        license: "CC BY 4.0",
        url: "https://www.uniprot.org",
      },
      {
        name: "Standard epitope tags",
        license: "public (standard published sequences)",
        url: "https://www.uniprot.org/help/tags",
      },
    ],
    count: all.length,
    countsByCategory: counts,
    entries: all,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(JSON_PATH, JSON.stringify(dataset, null, 2) + "\n", "utf8");
  writeFileSync(ATTRIBUTION_PATH, buildAttribution(counts, all.length), "utf8");

  log("Wrote:");
  log(`  ${JSON_PATH}`);
  log(`  ${ATTRIBUTION_PATH}`);
  log("");
  log(`Total entries: ${all.length}`);
  for (const [cat, n] of Object.entries(counts)) log(`  ${cat}: ${n}`);
}

function buildAttribution(counts, total) {
  const lines = [];
  lines.push("# Protein Feature Database, Attribution and Licensing");
  lines.push("");
  lines.push(
    "This dataset (frontend/public/feature-db/protein-features.json) powers an offline common-features detector. It was assembled by scripts/build-feature-db.mjs, which fetches real sequences from public APIs and combines them with a small set of cited standard epitope-tag constants. Re-run the script to regenerate or update the data."
  );
  lines.push("");
  lines.push(`Total entries: ${total}.`);
  lines.push("");
  for (const [cat, n] of Object.entries(counts)) {
    lines.push(`- ${cat}: ${n}`);
  }
  lines.push("");
  lines.push("## Sources and licenses");
  lines.push("");
  lines.push("### FPbase (fluorescent proteins)");
  lines.push("");
  lines.push(
    "Fluorescent protein sequences were fetched from the FPbase API (https://www.fpbase.org/api/proteins/). FPbase states that its sequence data is copyright-free; attribution is requested. Please cite FPbase: Lambert TJ (2019), FPbase: a community-editable fluorescent protein database, Nature Methods 16, 277-278. Each entry stores its exact FPbase API request URL and the FPbase UUID accession."
  );
  lines.push("");
  lines.push("### UniProt (resistance markers and large fusion tags)");
  lines.push("");
  lines.push(
    "Resistance markers and large fusion tags (MBP, GST, SUMO) were fetched from the UniProt REST API (https://rest.uniprot.org/uniprotkb/search), restricted to reviewed Swiss-Prot entries. UniProt data is distributed under the Creative Commons Attribution 4.0 International (CC BY 4.0) license. Please cite: The UniProt Consortium, UniProt: the Universal Protein Knowledgebase, Nucleic Acids Research. Each entry stores its UniProt accession and canonical entry URL."
  );
  lines.push("");
  lines.push("### Standard epitope and purification tags");
  lines.push("");
  lines.push(
    "Short epitope and purification tags (His6, His8, FLAG, 3xFLAG, HA, c-Myc, V5, Strep-II, T7-tag, AviTag) are standard published peptide sequences. They are definitional constants included verbatim from the literature and common molecular-biology references; they are not fetched. They are treated as public standard sequences. See the UniProt tag reference (https://www.uniprot.org/help/tags) and the original publications for each tag."
  );
  lines.push("");
  lines.push("## No-fabrication guarantee");
  lines.push("");
  lines.push(
    "Every sequence in this dataset comes from either a live HTTP fetch against the named APIs (FPbase, UniProt), with the exact source URL and accession recorded on each entry, or from one of the cited canonical epitope-tag constants. No sequence was invented, completed, or recalled from memory. Every fetched sequence is validated against the amino-acid alphabet and a plausible per-category length band before inclusion."
  );
  lines.push("");
  lines.push("## Scope and follow-up");
  lines.push("");
  lines.push(
    "This MVP covers PROTEIN features only. DNA elements (replication origins, promoters, multiple cloning sites, terminators) are intentionally excluded and require a separate DNA-reference curation pass with their own licensing review. That DNA pass is a planned follow-up."
  );
  lines.push("");
  return lines.join("\n");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
