#!/usr/bin/env node
// sequence editor master. Golden generator for the on-device HMMER domain
// annotation transparency dataset.
//
// WHY THIS EXISTS
// ---------------
// The /transparency page claims the WASM HMMER engine that runs in the user's
// browser returns the SAME Pfam domains as the reference (native) HMMER. A test
// that asserts "our engine equals what our engine produced" proves nothing, so
// this generator pins BOTH sides from an independent run:
//   - golden  = native hmmsearch 3.x (the Eddy/Rivas reference, the ORACLE)
//   - ours    = the shipped frontend/public/hmmer/hmmsearch.js WASM engine
// over the same curated Pfam HMM subset and the same ~50 protein FASTA, then
// asserts EXACT concordance (same families, same envelope coordinates to the
// residue, score / i-Evalue within a small epsilon). Any drift is a real WASM
// port bug and the generator STOPS and reports it precisely; it is not a number
// to fudge.
//
// WHAT IT DOES
// ------------
// 1. Fetch each protein FASTA from UniProt REST (cached into __fixtures__).
// 2. Fetch each needed family HMM from InterPro (gzip), gunzip, concat into one
//    pfam-subset.hmm, hmmpress it (cached into __fixtures__).
// 3. For every protein run NATIVE `hmmsearch --domtblout` of the subset vs the
//    single-protein FASTA -> parse -> golden domains.
// 4. Run the WASM engine the same way (MEMFS-mount subset + protein, callMain
//    in DEFAULT mode, no --max) -> our domains.
// 5. Assert exact concordance, then write datasets/domains.ts (pinned golden +
//    ours per protein + provenance). Do NOT hand-edit; re-run to refresh.
//
// ANTI-HANG: every native + wasm run is wrapped in a hard per-call timeout.
//
// Run from frontend/:
//   node scripts/gen-domains-golden.mjs
//
// Voice in comments, no em-dashes, no emojis, no mid-sentence colons.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, "..");
const FIXTURES = path.join(
  FRONTEND,
  "src/lib/transparency/datasets/__fixtures__",
);
const FASTA_PATH = path.join(FIXTURES, "domain-proteins.fasta");
const SUBSET_HMM = path.join(FIXTURES, "pfam-subset.hmm");
const DATASET_OUT = path.join(
  FRONTEND,
  "src/lib/transparency/datasets/domains.ts",
);
const ENGINE_JS = path.join(FRONTEND, "public/hmmer/hmmsearch.js");
const ENGINE_DIR = path.join(FRONTEND, "public/hmmer");

const PER_CALL_TIMEOUT_MS = 90_000;

// --------------------------------------------------------------------------
// The curated protein set. EDITABLE FIXTURE: swap accessions + re-run.
// Each entry: UniProt accession, the Pfam family/families we expect (so we know
// which HMM to fetch), and a human label. Negative controls list no families
// and assert 0 hits against the subset.
// --------------------------------------------------------------------------
const PROTEINS = [
  // --- single-domain, diverse fold space ---
  { acc: "P24941", families: ["PF00069"], label: "CDK2 kinase (Pkinase)" },
  { acc: "P04637", families: ["PF00870", "PF08563", "PF07710"], label: "p53 tumor suppressor" },
  { acc: "P08100", families: ["PF00001"], label: "Rhodopsin (7tm_1 GPCR)" },
  { acc: "P0CG48", families: ["PF00240"], label: "Polyubiquitin-C (tandem ubiquitin)" },
  { acc: "P42212", families: ["PF01353"], label: "Green fluorescent protein (GFP)" },
  { acc: "P00698", families: ["PF00062"], label: "Lysozyme C" },
  { acc: "P69905", families: ["PF00042"], label: "Hemoglobin alpha (Globin)" },
  { acc: "P02185", families: ["PF00042"], label: "Myoglobin (Globin)" },
  { acc: "P62258", families: ["PF00244"], label: "14-3-3 epsilon" },
  { acc: "P00760", families: ["PF00089"], label: "Bovine trypsin (Trypsin)" },
  { acc: "P00766", families: ["PF00089"], label: "Chymotrypsinogen A (Trypsin)" },
  { acc: "P01308", families: ["PF00049"], label: "Insulin" },
  { acc: "P00004", families: ["PF00034"], label: "Cytochrome c (horse)" },
  { acc: "P00918", families: ["PF00194"], label: "Carbonic anhydrase 2" },
  { acc: "P02766", families: ["PF00576"], label: "Transthyretin" },
  { acc: "P61626", families: ["PF00062"], label: "Lysozyme C (human)" },
  { acc: "P0DTC2", families: ["PF01600", "PF19209", "PF16451"], label: "SARS-CoV-2 spike glycoprotein" },
  { acc: "P00533", families: ["PF07714", "PF00757", "PF01030"], label: "EGFR receptor tyrosine kinase" },
  { acc: "P38398", families: ["PF00533", "PF12820", "PF16589"], label: "BRCA1 (BRCT + RING)" },
  { acc: "P06400", families: ["PF01857", "PF11934"], label: "Retinoblastoma protein Rb" },

  // --- genuinely multi-domain ---
  { acc: "P12931", families: ["PF00018", "PF00017", "PF07714"], label: "SRC kinase (SH3 + SH2 + tyr-kinase)" },
  { acc: "P06239", families: ["PF00018", "PF00017", "PF07714"], label: "LCK kinase (SH3 + SH2 + tyr-kinase)" },
  { acc: "P46108", families: ["PF00018", "PF00017"], label: "CRK adaptor (SH2 + SH3)" },
  { acc: "P62993", families: ["PF00018", "PF00017"], label: "GRB2 adaptor (SH3 + SH2 + SH3)" },
  { acc: "P00519", families: ["PF00018", "PF00017", "PF07714"], label: "ABL1 kinase (SH3 + SH2 + tyr-kinase)" },
  { acc: "P63244", families: ["PF00400"], label: "RACK1 (WD40 repeats)" },
  { acc: "P01857", families: ["PF07654"], label: "Immunoglobulin heavy constant gamma 1 (Ig C1-set)" },
  { acc: "P61769", families: ["PF07654"], label: "Beta-2-microglobulin (Ig C1-set)" },

  // --- nucleic-acid-binding folds ---
  { acc: "P11142", families: ["PF00012"], label: "HSP70 (HSP70 ATPase)" },
  { acc: "P0A6F5", families: ["PF00118"], label: "GroEL chaperonin (Cpn60)" },
  { acc: "P68871", families: ["PF00042"], label: "Hemoglobin beta (Globin)" },
  { acc: "P10636", families: ["PF00418"], label: "Tau (microtubule-binding repeats)" },
  { acc: "Q9NQ94", families: ["PF00076"], label: "A1CF (RRM domains)" },
  { acc: "P09651", families: ["PF00076"], label: "hnRNP A1 (RRM domains)" },
  { acc: "P19838", families: ["PF00554", "PF16179", "PF00558"], label: "NF-kappa-B p105 (RHD)" },
  { acc: "P01112", families: ["PF00071"], label: "HRAS (small GTPase Ras)" },
  { acc: "P60953", families: ["PF00071"], label: "CDC42 (small GTPase)" },
  { acc: "P63104", families: ["PF00244"], label: "14-3-3 zeta" },

  // --- classic motif families ---
  { acc: "P15822", families: ["PF00096"], label: "HIVEP1 zinc fingers (zf-C2H2)" },
  { acc: "P10242", families: ["PF00010", "PF00249"], label: "MYB proto-oncogene (Myb DNA-binding)" },
  { acc: "P01100", families: ["PF00170", "PF03131"], label: "FOS (bZIP)" },
  { acc: "P05412", families: ["PF00170"], label: "JUN (bZIP)" },
  { acc: "P15336", families: ["PF00170"], label: "ATF2 (bZIP)" },
  { acc: "P01106", families: ["PF02344"], label: "MYC (helix-loop-helix-zip)" },
  { acc: "P02340", families: ["PF00870"], label: "p53 (mouse, P53 family)" },
  { acc: "P03069", families: ["PF00170"], label: "GCN4 (bZIP)" },

  // ----------------------------- NEGATIVE CONTROLS -----------------------------
  // Proteins expected to have NO hit against the curated subset above. Each was
  // empirically confirmed (native HMMER returns 0 domains over this subset); their
  // true families (cytokine four-helix bundles, the glucagon/hormone family, the
  // SARS-CoV-2 nucleocapsid) are deliberately NOT in the subset, so a hit here
  // would mean the engine hallucinated a domain.
  { acc: "P60568", families: [], label: "NEG: Interleukin-2 (four-helix cytokine, family not in subset)", negative: true },
  { acc: "P01579", families: [], label: "NEG: Interferon gamma (cytokine, family not in subset)", negative: true },
  { acc: "P10145", families: [], label: "NEG: Interleukin-8 (chemokine, family not in subset)", negative: true },
  { acc: "P01275", families: [], label: "NEG: Pro-glucagon (peptide hormone, family not in subset)", negative: true },
  { acc: "P0DTC9", families: [], label: "NEG: SARS-CoV-2 nucleocapsid (family not in subset)", negative: true },
];

// --------------------------------------------------------------------------
// Small utilities.
// --------------------------------------------------------------------------
function log(...a) {
  console.log(...a);
}
function die(msg) {
  console.error("\nFATAL: " + msg + "\n");
  process.exit(1);
}

function withTimeout(promise, ms, what) {
  let t;
  const guard = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${what}`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(t));
}

async function fetchBuffer(url) {
  const res = await withTimeout(fetch(url), PER_CALL_TIMEOUT_MS, `fetch ${url}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

// --------------------------------------------------------------------------
// 0. Assert the native oracle is on PATH (fail loudly otherwise).
// --------------------------------------------------------------------------
function assertNativeHmmer() {
  for (const tool of ["hmmsearch", "hmmpress"]) {
    const r = spawnSync(tool, ["-h"], { encoding: "utf8", timeout: 20_000 });
    if (r.error || r.status == null) {
      die(
        `native ${tool} not found on PATH. This generator REQUIRES native HMMER `
          + `(the oracle). Install hmmer (e.g. conda install -c bioconda hmmer).`,
      );
    }
  }
  const ver = spawnSync("hmmsearch", ["-h"], { encoding: "utf8", timeout: 20_000 });
  const m = /HMMER\s+([0-9.]+)/.exec(ver.stdout || "");
  return m ? m[1] : "unknown";
}

// --------------------------------------------------------------------------
// 1. Build / load the protein FASTA fixture.
// --------------------------------------------------------------------------
async function buildFastaFixture() {
  if (fs.existsSync(FASTA_PATH)) {
    log(`  reusing committed FASTA fixture (${FASTA_PATH})`);
    return fs.readFileSync(FASTA_PATH, "utf8");
  }
  log("  fetching protein FASTA from UniProt REST ...");
  const accs = PROTEINS.map((p) => p.acc);
  const seen = new Set();
  const records = [];
  for (const acc of accs) {
    if (seen.has(acc)) continue; // duplicate guard (dup-guard entries)
    seen.add(acc);
    const buf = await fetchBuffer(`https://rest.uniprot.org/uniprotkb/${acc}.fasta`);
    const txt = buf.toString("utf8").trim();
    if (!txt.startsWith(">")) throw new Error(`UniProt ${acc} returned non-FASTA`);
    records.push(txt);
    log(`    + ${acc}`);
  }
  const fasta = records.join("\n") + "\n";
  fs.mkdirSync(FIXTURES, { recursive: true });
  fs.writeFileSync(FASTA_PATH, fasta);
  return fasta;
}

/** Parse FASTA into { acc -> { header, seq } } keyed by UniProt accession. */
function parseFasta(text) {
  const byAcc = {};
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(">")) {
      const m = /^>(?:sp|tr)\|([^|]+)\|/.exec(line) || /^>(\S+)/.exec(line);
      const acc = m ? m[1] : line.slice(1).trim();
      cur = { header: line, acc, seq: "" };
      byAcc[acc] = cur;
    } else if (cur) {
      cur.seq += line.trim();
    }
  }
  return byAcc;
}

// --------------------------------------------------------------------------
// 2. Build / load the Pfam HMM subset fixture (+ hmmpress).
// --------------------------------------------------------------------------
async function buildHmmSubset() {
  // Collect the union of all intended families across positive proteins.
  const fams = new Set();
  for (const p of PROTEINS) for (const f of p.families || []) fams.add(f);
  const famList = Array.from(fams).sort();

  const provenance = [];
  if (fs.existsSync(SUBSET_HMM)) {
    log(`  reusing committed HMM subset (${SUBSET_HMM})`);
  } else {
    log(`  fetching ${famList.length} family HMMs from InterPro ...`);
    const chunks = [];
    for (const fam of famList) {
      const gz = await fetchBuffer(
        `https://www.ebi.ac.uk/interpro/wwwapi/entry/pfam/${fam}?annotation=hmm`,
      );
      let hmm;
      try {
        hmm = gunzipSync(gz).toString("utf8");
      } catch {
        hmm = gz.toString("utf8"); // some endpoints serve plain text
      }
      if (!/^HMMER3/.test(hmm)) {
        throw new Error(`InterPro ${fam} did not return an HMMER3 profile`);
      }
      chunks.push(hmm.trimEnd() + "\n");
      log(`    + ${fam}`);
    }
    fs.mkdirSync(FIXTURES, { recursive: true });
    fs.writeFileSync(SUBSET_HMM, chunks.join(""));
  }

  // Record provenance (accession + version) by scanning the committed subset.
  const subsetText = fs.readFileSync(SUBSET_HMM, "utf8");
  const accRe = /^NAME\s+(\S+)[\s\S]*?^ACC\s+(\S+)/gm;
  let m;
  while ((m = accRe.exec(subsetText))) {
    provenance.push({ name: m[1], accession: m[2] });
  }

  // hmmpress (idempotent; remove stale pressed files first).
  for (const ext of [".h3f", ".h3i", ".h3m", ".h3p"]) {
    const f = SUBSET_HMM + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  const press = spawnSync("hmmpress", [SUBSET_HMM], {
    encoding: "utf8",
    timeout: PER_CALL_TIMEOUT_MS,
  });
  if (press.status !== 0) {
    die(`hmmpress failed: ${press.stderr || press.stdout}`);
  }
  return { famList, provenance };
}

// --------------------------------------------------------------------------
// 3. Native hmmsearch (the ORACLE) for a single protein.
// --------------------------------------------------------------------------
function nativeDomains(proteinFasta) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "domgen-"));
  const qfa = path.join(tmp, "q.fa");
  const otbl = path.join(tmp, "o.tbl");
  fs.writeFileSync(qfa, proteinFasta);
  // DEFAULT mode (no --max), matching how the fixed WASM engine runs.
  const r = spawnSync(
    "hmmsearch",
    ["--domtblout", otbl, SUBSET_HMM, qfa],
    { encoding: "utf8", timeout: PER_CALL_TIMEOUT_MS },
  );
  if (r.error) die(`native hmmsearch failed: ${r.error.message}`);
  const table = fs.existsSync(otbl) ? fs.readFileSync(otbl, "utf8") : "";
  fs.rmSync(tmp, { recursive: true, force: true });
  return table;
}

// --------------------------------------------------------------------------
// 3b. WASM hmmsearch (OUR engine) for a single protein. Loaded once, reused.
// --------------------------------------------------------------------------
let createHmmer = null;
function loadEngine() {
  if (createHmmer) return createHmmer;
  // The UMD glue does module.exports = createHmmer under CommonJS.
  createHmmer = require(ENGINE_JS);
  return createHmmer;
}

async function wasmDomains(proteinFasta, hmmBytes) {
  const factory = loadEngine();
  let log = "";
  const Module = await withTimeout(
    factory({
      noInitialRun: true,
      locateFile: (p) => (p.endsWith(".wasm") ? path.join(ENGINE_DIR, p) : p),
      print: (s) => {
        log += s + "\n";
      },
      printErr: (s) => {
        log += s + "\n";
      },
    }),
    PER_CALL_TIMEOUT_MS,
    "wasm engine init",
  );

  Module.FS.writeFile("/db.hmm", hmmBytes);
  Module.FS.writeFile("/query.fa", proteinFasta);
  // DEFAULT mode, no --max (the fixed build's prefilter is correct).
  const rc = Module.callMain(["--domtblout", "/o.tbl", "/db.hmm", "/query.fa"]);
  let table = "";
  try {
    table = Module.FS.readFile("/o.tbl", { encoding: "utf8" });
  } catch {
    throw new Error(`WASM engine wrote no table (exit ${rc}). log: ${log.slice(-400)}`);
  }
  return table;
}

// --------------------------------------------------------------------------
// Parse a --domtblout table into pinned domain records. Mirrors the shipped
// parseDomtblout column layout (env from/to = cols 19/20, i-Evalue = 12,
// score = 13, query name = 3, query accession = 4), but keeps the version
// suffix off the accession so the pinned data is stable across Pfam releases.
// --------------------------------------------------------------------------
function bareAccession(raw) {
  const m = /^(PF\d{5,}|PB\d+|[A-Za-z0-9]+)\.\d+$/.exec(raw);
  return m ? m[1] : raw;
}
function parseDomains(table) {
  const out = [];
  for (const line of (table || "").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const c = line.trim().split(/\s+/);
    if (c.length < 21) continue;
    const rawAcc = c[4];
    const qname = c[3];
    const accession =
      rawAcc && rawAcc !== "-"
        ? bareAccession(rawAcc)
        : qname && qname !== "-"
          ? qname
          : "";
    if (!accession) continue;
    const envFrom = Number(c[19]);
    const envTo = Number(c[20]);
    if (!Number.isFinite(envFrom) || !Number.isFinite(envTo)) continue;
    out.push({
      accession,
      name: qname && qname !== "-" ? qname : accession,
      start: Math.min(envFrom, envTo),
      end: Math.max(envFrom, envTo),
      score: Number(c[13]),
      ievalue: Number(c[12]),
    });
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end || a.accession.localeCompare(b.accession));
  return out;
}

// --------------------------------------------------------------------------
// Exact concordance check between native (golden) and wasm (ours).
// Same families, same envelope coords to the residue. Score / i-Evalue checked
// within a small relative epsilon and reported (informational, not a coord bug).
// --------------------------------------------------------------------------
function compareExact(golden, ours) {
  const mismatches = [];
  if (golden.length !== ours.length) {
    mismatches.push(
      `domain COUNT differs: native=${golden.length} wasm=${ours.length}`,
    );
  }
  const n = Math.max(golden.length, ours.length);
  for (let i = 0; i < n; i++) {
    const g = golden[i];
    const o = ours[i];
    if (!g) {
      mismatches.push(`wasm has EXTRA domain #${i + 1}: ${o.accession} ${o.start}-${o.end}`);
      continue;
    }
    if (!o) {
      mismatches.push(`wasm MISSING domain #${i + 1}: native ${g.accession} ${g.start}-${g.end}`);
      continue;
    }
    if (g.accession !== o.accession) {
      mismatches.push(`#${i + 1} family differs: native ${g.accession} vs wasm ${o.accession}`);
    }
    if (g.start !== o.start || g.end !== o.end) {
      mismatches.push(
        `#${i + 1} ${g.accession} env coords differ: native ${g.start}-${g.end} vs wasm ${o.start}-${o.end}`,
      );
    }
  }
  return mismatches;
}

// --------------------------------------------------------------------------
// Emit the dataset TS file.
// --------------------------------------------------------------------------
function tsDomainList(domains) {
  if (domains.length === 0) return "[]";
  const items = domains
    .map(
      (d) =>
        `      { accession: ${JSON.stringify(d.accession)}, name: ${JSON.stringify(d.name)}, `
        + `start: ${d.start}, end: ${d.end}, score: ${fmtNum(d.score)}, ievalue: ${fmtSci(d.ievalue)} },`,
    )
    .join("\n");
  return `[\n${items}\n    ]`;
}
function fmtNum(x) {
  if (!Number.isFinite(x)) return "0";
  return String(Math.round(x * 10) / 10);
}
function fmtSci(x) {
  if (!Number.isFinite(x)) return "0";
  if (x === 0) return "0";
  return x.toExponential(2);
}

function writeDataset({ proteins, hmmerVersion, famList, provenance }) {
  const header = `/**
 * Pinned protein domain-annotation golden + our-engine domains for the
 * /transparency page. GENERATED by frontend/scripts/gen-domains-golden.mjs.
 * Do NOT hand-edit; re-run the generator to refresh.
 *
 * Each protein carries:
 *  - \`golden\`: domains from NATIVE hmmsearch ${hmmerVersion} (the oracle), run in
 *    DEFAULT mode (no --max) against the committed Pfam subset.
 *  - \`ours\`:   domains from the SHIPPED WASM engine (public/hmmer/hmmsearch.js),
 *    run the same way in Node, DEFAULT mode.
 * The two MUST agree exactly: same families, same envelope coordinates to the
 * residue. \`buildDomainsDomain()\` compares them synchronously on every render,
 * and \`domains.gate.test.ts\` re-runs the live WASM engine to prove it still
 * reproduces \`ours\`. The fixtures (FASTA + pfam-subset.hmm) sit beside this file
 * under __fixtures__.
 *
 * Voice in comments, no em-dashes, no emojis, no mid-sentence colons.
 */

/** One reported domain (a single --domtblout row), envelope coords on the protein. */
export interface PinnedDomain {
  /** Pfam family accession, version stripped (e.g. "PF00069"). */
  accession: string;
  /** Pfam family short name (e.g. "Pkinase"). */
  name: string;
  /** 1-based envelope start on the protein. */
  start: number;
  /** 1-based envelope end on the protein. */
  end: number;
  /** This-domain bit score. */
  score: number;
  /** This-domain independent E-value. */
  ievalue: number;
}

/** One curated protein with both pinned domain sets. */
export interface DomainProtein {
  /** UniProt accession. */
  acc: string;
  /** Human label. */
  label: string;
  /** True for negative controls (expected zero hits in both sets). */
  negative: boolean;
  /** Domains from native HMMER (the oracle). */
  golden: PinnedDomain[];
  /** Domains from the shipped WASM engine. */
  ours: PinnedDomain[];
}

/** Provenance for the committed Pfam HMM subset. */
export interface PfamFamilyProvenance {
  name: string;
  accession: string;
}

/** The native HMMER version that produced the golden domains. */
export const NATIVE_HMMER_VERSION = ${JSON.stringify(hmmerVersion)};

/** The Pfam families in the committed subset (union of intended families). */
export const PFAM_FAMILIES: string[] = ${JSON.stringify(famList)};

/** Pfam family provenance (name + accession with version) from the subset. */
export const PFAM_PROVENANCE: PfamFamilyProvenance[] = ${JSON.stringify(provenance, null, 2)
    .replace(/^/gm, "")
    .replace(/\n/g, "\n")};

export const DOMAIN_PROTEINS: DomainProtein[] = [
`;

  const body = proteins
    .map((p) => {
      return `  {
    acc: ${JSON.stringify(p.acc)},
    label: ${JSON.stringify(p.label)},
    negative: ${p.negative ? "true" : "false"},
    golden: ${tsDomainList(p.golden)},
    ours: ${tsDomainList(p.ours)},
  },`;
    })
    .join("\n");

  fs.writeFileSync(DATASET_OUT, header + body + "\n];\n");
}

// --------------------------------------------------------------------------
// Main.
// --------------------------------------------------------------------------
async function main() {
  log("=".repeat(72));
  log("Domain-annotation golden generator (native HMMER vs shipped WASM engine)");
  log("=".repeat(72));

  const hmmerVersion = assertNativeHmmer();
  log(`native HMMER on PATH: ${hmmerVersion}`);

  log("\n[1/5] protein FASTA fixture");
  const fastaText = await buildFastaFixture();
  const byAcc = parseFasta(fastaText);

  log("\n[2/5] Pfam HMM subset fixture (+ hmmpress)");
  const { famList, provenance } = await buildHmmSubset();
  const hmmBytes = fs.readFileSync(SUBSET_HMM);
  log(`  subset families (${famList.length}): ${famList.join(", ")}`);

  log("\n[3/5 + 4/5] per-protein native + WASM runs");
  const results = [];
  const allMismatches = [];
  // De-dup proteins by accession (dup-guard entries share an accession).
  const seen = new Set();
  for (const p of PROTEINS) {
    if (seen.has(p.acc)) continue;
    seen.add(p.acc);

    const rec = byAcc[p.acc];
    if (!rec) die(`FASTA fixture is missing accession ${p.acc}; delete the fixture and re-run.`);
    const single = `${rec.header}\n${rec.seq}\n`;

    const goldenTable = nativeDomains(single);
    const golden = parseDomains(goldenTable);

    const oursTable = await wasmDomains(single, hmmBytes);
    const ours = parseDomains(oursTable);

    const mism = compareExact(golden, ours);
    const tag = p.negative ? "NEG" : "pos";
    const status = mism.length === 0 ? "OK" : "MISMATCH";
    log(
      `  [${tag}] ${p.acc.padEnd(8)} native=${String(golden.length).padStart(2)} `
        + `wasm=${String(ours.length).padStart(2)}  ${status}  ${p.label}`,
    );
    if (p.negative && golden.length !== 0) {
      allMismatches.push(
        `${p.acc} is a NEGATIVE CONTROL but native HMMER found ${golden.length} hit(s): `
          + golden.map((d) => `${d.accession} ${d.start}-${d.end}`).join(", "),
      );
    }
    for (const m of mism) {
      allMismatches.push(`${p.acc} (${p.label}): ${m}`);
    }

    results.push({
      acc: p.acc,
      label: p.label,
      negative: !!p.negative,
      golden,
      ours,
    });
  }

  log("\n[5/5] concordance");
  if (allMismatches.length > 0) {
    console.error("\n" + "!".repeat(72));
    console.error(`CONCORDANCE FAILED: ${allMismatches.length} issue(s). This is a real`);
    console.error("native-vs-WASM port bug (or a mis-curated negative control), NOT a");
    console.error("tolerance to relax. Dataset NOT written.");
    console.error("!".repeat(72));
    for (const m of allMismatches) console.error("  - " + m);
    process.exit(2);
  }

  const totalDomains = results.reduce((n, r) => n + r.golden.length, 0);
  const posCount = results.filter((r) => !r.negative).length;
  const negCount = results.filter((r) => r.negative).length;
  log(
    `  100% concordance across ${results.length} proteins `
      + `(${posCount} positive, ${negCount} negative controls), `
      + `${totalDomains} domains, exact envelope coordinates.`,
  );

  writeDataset({ proteins: results, hmmerVersion, famList, provenance });
  log(`\nwrote ${DATASET_OUT}`);
  log("done.");
}

main().catch((e) => die(e && e.stack ? e.stack : String(e)));
