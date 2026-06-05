/**
 * THE ASYNC DOMAIN GATE.
 *
 * The other transparency subjects recompute their value synchronously inside
 * `build<X>Domain()` on every render, so `report.test.ts` already proves their
 * pinned numbers are still what the live code produces. Domain annotation cannot
 * do that: the engine is HMMER compiled to WebAssembly (async, MEMFS), not a sync
 * pure function. So this separate gate provides the same "recomputed on every
 * commit" guarantee for domains: it loads the SHIPPED engine
 * (public/hmmer/hmmsearch.js) in Node, re-runs it on the committed proteins over
 * the committed Pfam subset in DEFAULT mode (no --max, exactly as the browser
 * runs it), parses with the SHIPPED parseDomtblout, and asserts it still
 * reproduces the pinned `ours` domains in datasets/domains.ts to the residue.
 *
 * If the WASM engine regresses, or the committed fixtures drift from the pinned
 * data, this test fails. It does NOT need native HMMER: native is the oracle the
 * generator pins against, and `report.test.ts` enforces ours == golden from the
 * pinned data; this gate enforces live-engine == pinned-ours.
 *
 * Every engine run is hard-capped so a hung WASM call fails the test instead of
 * hanging CI. Voice in comments, no em-dashes, no emojis, no mid-sentence colons.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseDomtblout } from "@/lib/sequences/hmmer-domtbl";

import { DOMAIN_PROTEINS } from "./datasets/domains";

const FRONTEND = path.resolve(__dirname, "../../..");
const ENGINE_JS = path.join(FRONTEND, "public/hmmer/hmmsearch.js");
const ENGINE_DIR = path.join(FRONTEND, "public/hmmer");
const FIXTURES = path.join(__dirname, "datasets/__fixtures__");
const FASTA_PATH = path.join(FIXTURES, "domain-proteins.fasta");
const SUBSET_HMM = path.join(FIXTURES, "pfam-subset.hmm");

// Per-call hard cap. Native hmmsearch on one protein is fast and the WASM engine
// is the same algorithm, so this is generous; a run that blows past it is hung.
const PER_PROTEIN_TIMEOUT_MS = 60_000;
// Whole-suite timeout (51 proteins x one engine init + run each).
const SUITE_TIMEOUT_MS = 540_000;

/** Parse the committed FASTA into { accession -> single-record FASTA text }. */
function loadProteinFastas(): Map<string, string> {
  const text = fs.readFileSync(FASTA_PATH, "utf8");
  const byAcc = new Map<string, string>();
  let header: string | null = null;
  let acc = "";
  let seq = "";
  const flush = () => {
    if (header && acc) byAcc.set(acc, `${header}\n${seq}\n`);
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(">")) {
      flush();
      header = line;
      seq = "";
      const m = /^>(?:sp|tr)\|([^|]+)\|/.exec(line) || /^>(\S+)/.exec(line);
      acc = m ? m[1] : line.slice(1).trim();
    } else {
      seq += line.trim();
    }
  }
  flush();
  return byAcc;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const guard = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${what}`)), ms);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(t)) as Promise<T>;
}

/**
 * Run the shipped WASM engine on one protein against the subset, returning the
 * raw --domtblout text. DEFAULT mode (no --max), the same flags the browser uses
 * with the fixed build.
 */
async function runEngine(
  factory: (opts: unknown) => Promise<{
    FS: {
      writeFile: (p: string, data: Buffer | string) => void;
      readFile: (p: string, o: { encoding: string }) => string;
    };
    callMain: (argv: string[]) => number;
  }>,
  proteinFasta: string,
  hmmBytes: Buffer,
  label: string,
): Promise<string> {
  let log = "";
  const Module = await withTimeout(
    factory({
      noInitialRun: true,
      locateFile: (p: string) => (p.endsWith(".wasm") ? path.join(ENGINE_DIR, p) : p),
      print: (s: string) => {
        log += s + "\n";
      },
      printErr: (s: string) => {
        log += s + "\n";
      },
    }),
    PER_PROTEIN_TIMEOUT_MS,
    `engine init for ${label}`,
  );

  Module.FS.writeFile("/db.hmm", hmmBytes);
  Module.FS.writeFile("/query.fa", proteinFasta);
  const rc = Module.callMain(["--domtblout", "/o.tbl", "/db.hmm", "/query.fa"]);
  try {
    return Module.FS.readFile("/o.tbl", { encoding: "utf8" });
  } catch {
    throw new Error(`WASM engine wrote no table for ${label} (exit ${rc}). ${log.slice(-300)}`);
  }
}

/** A stable, comparable signature for one domain (family + exact envelope span). */
function sig(d: { accession: string; start: number; end: number }): string {
  return `${d.accession}:${d.start}-${d.end}`;
}

describe("on-device HMMER domain gate — live engine reproduces the pinned domains", () => {
  it("the committed fixtures exist", () => {
    expect(fs.existsSync(ENGINE_JS), "shipped engine missing").toBe(true);
    expect(fs.existsSync(FASTA_PATH), "FASTA fixture missing").toBe(true);
    expect(fs.existsSync(SUBSET_HMM), "Pfam subset fixture missing").toBe(true);
  });

  it(
    "re-runs the WASM engine on every protein and matches datasets/domains.ts exactly",
    async () => {
      const require = createRequire(__filename);
      // The UMD glue does module.exports = createHmmer under CommonJS.
      const factory = require(ENGINE_JS) as Parameters<typeof runEngine>[0];

      const fastas = loadProteinFastas();
      const hmmBytes = fs.readFileSync(SUBSET_HMM);

      const failures: string[] = [];
      for (const p of DOMAIN_PROTEINS) {
        const fasta = fastas.get(p.acc);
        if (!fasta) {
          failures.push(`${p.acc}: missing from FASTA fixture`);
          continue;
        }
        const table = await runEngine(factory, fasta, hmmBytes, p.acc);
        const live = parseDomtblout(table)
          .map((h) => ({ accession: h.accession, start: h.start, end: h.end }))
          .sort((a, b) => a.start - b.start || a.end - b.end || a.accession.localeCompare(b.accession));

        const pinned = [...p.ours]
          .map((d) => ({ accession: d.accession, start: d.start, end: d.end }))
          .sort((a, b) => a.start - b.start || a.end - b.end || a.accession.localeCompare(b.accession));

        const liveSet = live.map(sig).join(", ");
        const pinnedSet = pinned.map(sig).join(", ");
        if (liveSet !== pinnedSet) {
          failures.push(`${p.acc} (${p.label}): live [${liveSet}] != pinned [${pinnedSet}]`);
        }
        // The negative controls must reproduce zero hits.
        if (p.negative && live.length !== 0) {
          failures.push(`${p.acc} negative control produced ${live.length} hit(s)`);
        }
      }

      expect(
        failures,
        `the live on-device engine drifted from the pinned domains:\n` + failures.join("\n"),
      ).toEqual([]);
    },
    SUITE_TIMEOUT_MS,
  );
});
