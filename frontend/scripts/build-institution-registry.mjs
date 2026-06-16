#!/usr/bin/env node
// Build the canonical institution registry from the ROR data dump.
//
// SOURCE + LICENSE: Research Organization Registry (ROR), https://ror.org.
// The ROR dataset is released under CC0 1.0 (public domain dedication), so it
// can be redistributed freely. We still credit ROR as the source. The data
// dump is a versioned zip of a single large JSON array, published on Zenodo
// under the concept DOI 10.5281/zenodo.6347574 (always resolves to latest).
//
// WHAT THIS EMITS: a static, server-side-only JSON asset
// (frontend/public/institution-registry.json) keyed by website domain
// (lowercased registrable host + notable subdomains), with the schema:
//
//   {
//     "meta": { source, license, rorRelease, generatedAt, orgCount, domainCount, cap },
//     "byDomain": {
//       "<domain>": {
//         "domain": string,
//         "canonicalName": string,   // ROR ror_display name
//         "rorId": string,           // bare ROR id, e.g. "https://ror.org/0..."
//         "country": string | null,  // ISO country name from first location
//         "aliases": string[],       // ROR alias/label/acronym names
//         "clusterDomains": string[] // every domain mapping to the same org
//       }
//     }
//   }
//
// The resolver (src/lib/social/institution-registry.ts) reads ONLY this asset
// at request time. No network, no DB. Unknown domain -> null (caller falls
// back to humanizeInstitutionSlug).
//
// USAGE:
//   1. Download the latest dump (auto-resolves the concept DOI to latest):
//        node frontend/scripts/build-institution-registry.mjs --download
//      or point at an already-extracted dump:
//        node frontend/scripts/build-institution-registry.mjs --in /path/to/ror-data.json
//   2. Optionally cap the number of orgs processed (testing): --limit 5000
//   3. Optionally only education/research orgs first: --edu-first (default on)
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_FRONTEND = path.resolve(__dirname, "..");
const OUT_PATH = path.join(REPO_FRONTEND, "public", "institution-registry.json");
const CONCEPT_RECORD = "6347574"; // Zenodo concept record, redirects to latest.

// ----------------------------- arg parsing ------------------------------

function parseArgs(argv) {
  const args = { download: false, in: null, limit: Infinity, eduFirst: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--download") args.download = true;
    else if (a === "--in") args.in = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]) || Infinity;
    else if (a === "--no-edu-first") args.eduFirst = false;
    else if (a === "--edu-first") args.eduFirst = true;
    else if (a === "--out") args.out = argv[++i];
  }
  return args;
}

// --------------------------- domain helpers ------------------------------

// A short, dependency-free set of multi-label public suffixes we care about for
// research/education hosts. This is NOT the full Public Suffix List; it covers
// the common academic patterns (ac.uk, edu.au, ac.jp, edu.cn, ...) so that
// "cs.ox.ac.uk" collapses to the registrable "ox.ac.uk" rather than "ac.uk".
// Anything not matched falls back to the last two labels.
const MULTI_SUFFIXES = new Set([
  "ac.uk", "gov.uk", "org.uk", "co.uk", "sch.uk",
  "ac.jp", "co.jp", "go.jp", "or.jp", "ne.jp",
  "edu.au", "gov.au", "org.au", "com.au", "net.au",
  "edu.cn", "gov.cn", "org.cn", "com.cn", "ac.cn",
  "edu.in", "ac.in", "gov.in", "org.in",
  "edu.br", "gov.br", "org.br", "com.br",
  "ac.nz", "edu.nz", "govt.nz",
  "ac.za", "edu.za", "gov.za", "org.za",
  "ac.kr", "or.kr", "go.kr", "re.kr",
  "edu.sg", "gov.sg", "org.sg",
  "edu.hk", "gov.hk",
  "ac.il", "org.il", "gov.il",
  "edu.mx", "gob.mx", "org.mx",
  "edu.ar", "gov.ar", "org.ar",
  "ac.ir", "edu.tr", "gov.tr",
  "ac.th", "go.th", "or.th",
  "ac.id", "go.id", "or.id",
  "edu.my", "gov.my", "org.my",
  "edu.ph", "gov.ph",
  "edu.pk", "gov.pk",
  "ac.at", "gv.at", "co.at",
]);

function cleanHost(raw) {
  if (!raw || typeof raw !== "string") return null;
  let h = raw.trim().toLowerCase();
  if (!h) return null;
  // Strip scheme + path + port + userinfo.
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  h = h.split("/")[0];
  h = h.split("?")[0];
  h = h.split("#")[0];
  h = h.split("@").pop();
  h = h.split(":")[0];
  h = h.replace(/^www\./, "");
  h = h.replace(/\.$/, "");
  if (!h.includes(".")) return null;
  // Reject obvious non-hostnames.
  if (!/^[a-z0-9.-]+$/.test(h)) return null;
  return h;
}

// Registrable domain (eTLD+1, with academic multi-suffix awareness).
function registrable(host) {
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_SUFFIXES.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}

// Collect the domains worth keying an org by, ranked by how strong a signal
// each is that THIS org owns THIS domain. Returned tiers (lower = stronger):
//   tier 0 (exact): a host that appears LITERALLY in ROR's curated domains[]
//     or as the literal host of a website link. Strong ownership signal.
//   tier 1 (derived): the registrable reduction of a tier-0 host
//     (e.g. wgnhs.wisc.edu -> wisc.edu). Useful for CLUSTERING sibling
//     subdomains, but a weak ownership claim, so a sub-org's "wgnhs.wisc.edu"
//     must not steal the bare "wisc.edu" key from the parent university.
// `all` is every domain (both tiers) for relationship-based cluster expansion.
function orgDomains(org) {
  const exact = new Set();
  const derived = new Set();
  const addHost = (raw) => {
    const h = cleanHost(raw);
    if (!h) return;
    exact.add(h);
    const reg = registrable(h);
    if (reg !== h) derived.add(reg);
  };
  for (const d of org.domains || []) addHost(d);
  for (const l of org.links || []) {
    if (l && l.type === "website" && l.value) addHost(l.value);
  }
  // A domain that is exact for this org is never also counted as derived.
  for (const d of exact) derived.delete(d);
  return {
    exact: [...exact].filter(Boolean),
    derived: [...derived].filter(Boolean),
    all: [...new Set([...exact, ...derived])].filter(Boolean),
  };
}

function displayName(org) {
  const names = org.names || [];
  const display = names.find((n) => (n.types || []).includes("ror_display"));
  if (display) return display.value;
  const label = names.find((n) => (n.types || []).includes("label"));
  if (label) return label.value;
  return names[0] ? names[0].value : org.id;
}

function aliasNames(org, canonical) {
  const out = new Set();
  for (const n of org.names || []) {
    const v = (n.value || "").trim();
    if (!v || v === canonical) continue;
    const types = n.types || [];
    if (
      types.includes("alias") ||
      types.includes("label") ||
      types.includes("acronym")
    ) {
      out.add(v);
    }
  }
  return [...out];
}

function countryOf(org) {
  const loc = (org.locations || [])[0];
  return (loc && loc.geonames_details && loc.geonames_details.country_name) || null;
}

// ----------------------------- download ----------------------------------

function downloadDump() {
  const tmp = path.join(os.tmpdir(), "ror-registry-build");
  fs.mkdirSync(tmp, { recursive: true });
  console.log("[ror] resolving latest release from Zenodo concept record...");
  const meta = JSON.parse(
    execSync(`curl -sL "https://zenodo.org/api/records/${CONCEPT_RECORD}"`, {
      maxBuffer: 64 * 1024 * 1024,
    }).toString(),
  );
  const file = (meta.files || []).find((f) => /ror-data\.zip$/.test(f.key));
  if (!file) throw new Error("could not find ror-data.zip in Zenodo record");
  const url = (file.links && (file.links.self || file.links.download)) || "";
  console.log(`[ror] latest release: ${file.key} (${file.size} bytes)`);
  const zipPath = path.join(tmp, file.key);
  execSync(`curl -sL -o "${zipPath}" "${url}"`, { stdio: "inherit" });
  execSync(`unzip -o -q "${zipPath}" -d "${tmp}"`);
  const jsonName = file.key.replace(/\.zip$/, ".json");
  const jsonPath = path.join(tmp, jsonName);
  if (!fs.existsSync(jsonPath)) throw new Error(`extracted JSON not found: ${jsonPath}`);
  return { jsonPath, release: file.key.replace(/\.zip$/, "") };
}

// ------------------------------- build ------------------------------------

function build() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = args.out || OUT_PATH;

  let jsonPath = args.in;
  let release = "unknown";
  if (args.download) {
    const dl = downloadDump();
    jsonPath = dl.jsonPath;
    release = dl.release;
  } else if (jsonPath) {
    const m = path.basename(jsonPath).match(/(v[\d.]+-\d{4}-\d{2}-\d{2})/);
    release = m ? m[1] : path.basename(jsonPath);
  } else {
    console.error(
      "Provide --download (fetch latest from Zenodo) or --in <ror-data.json>.",
    );
    process.exit(1);
  }

  console.log(`[ror] reading ${jsonPath} ...`);
  const orgs = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  console.log(`[ror] ${orgs.length} total organizations in dump`);

  // Pass 1: index every active org by ROR id, capturing its own domains.
  const byId = new Map();
  for (const org of orgs) {
    if (org.status !== "active") continue;
    const dom = orgDomains(org);
    byId.set(org.id, {
      id: org.id,
      canonicalName: displayName(org),
      country: countryOf(org),
      aliases: aliasNames(org, displayName(org)),
      domains: dom.all, // for cluster expansion across relationships
      exactDomains: dom.exact,
      derivedDomains: dom.derived,
      hasParent: (org.relationships || []).some((r) => r.type === "parent"),
      relationships: (org.relationships || [])
        .filter((r) => ["parent", "child", "related"].includes(r.type))
        .map((r) => r.id),
      types: org.types || [],
    });
  }
  console.log(`[ror] ${byId.size} active organizations indexed`);

  // Optionally prioritize education/research orgs so a cap keeps the most
  // relevant entries. Ordering only matters when --limit is set.
  let ordered = [...byId.values()];
  if (args.eduFirst) {
    const rank = (o) =>
      o.types.includes("education")
        ? 0
        : o.types.includes("facility") || o.types.includes("archive")
          ? 1
          : 2;
    ordered.sort((a, b) => rank(a) - rank(b));
  }

  // Pass 2: build the domain-keyed registry. clusterDomains = this org's own
  // domains UNION the domains of each parent/child/related org (one hop), so a
  // single institution page aggregates verified subdomains and member campuses.
  //
  // Collision policy (deterministic): each domain key records the winning org's
  // priority score; a later org overwrites only with a strictly LOWER score.
  //   score = tier*100 + parentPenalty*10 + typeRank   (lower = better)
  //   tier:          0 = exact (literal curated/link host), 1 = registrable-derived.
  //   parentPenalty: 0 = top of its hierarchy, 1 = has a parent org.
  //   typeRank:      education 0, facility/archive 1, else 2.
  // So for the bare "wisc.edu" registrable key, the parent University (which
  // links www.wisc.edu, an EXACT host -> tier 0) beats a sub-survey that only
  // produces wisc.edu by reducing its curated subdomain (tier 1). And for an
  // exact key like "mit.edu", MIT (curated, no parent) beats a same-domain
  // sub-institute. Ties keep the first org seen (stable, education-first order).
  const byDomain = {};
  const winScore = new Map(); // domain -> best score seen so far
  let processed = 0;
  let skippedNoDomain = 0;

  const typeRank = (o) =>
    o.types.includes("education")
      ? 0
      : o.types.includes("facility") || o.types.includes("archive")
        ? 1
        : 2;

  for (const o of ordered) {
    if (processed >= args.limit) break;
    if (o.domains.length === 0) {
      skippedNoDomain++;
      continue;
    }
    processed++;

    const cluster = new Set(o.domains);
    for (const relId of o.relationships) {
      const rel = byId.get(relId);
      if (rel) for (const d of rel.domains) cluster.add(d);
    }
    const clusterDomains = [...cluster].sort();

    const entry = {
      canonicalName: o.canonicalName,
      rorId: o.id,
      country: o.country,
      aliases: o.aliases,
      clusterDomains,
    };

    const base = (o.hasParent ? 10 : 0) + typeRank(o);
    const exactSet = new Set(o.exactDomains);
    for (const domain of o.domains) {
      const tier = exactSet.has(domain) ? 0 : 1;
      const score = tier * 100 + base;
      const prev = winScore.get(domain);
      if (prev === undefined || score < prev) {
        byDomain[domain] = { domain, ...entry };
        winScore.set(domain, score);
      }
    }
  }

  const domainCount = Object.keys(byDomain).length;
  const capped = processed < byId.size && Number.isFinite(args.limit);

  const payload = {
    meta: {
      source: "Research Organization Registry (ROR), https://ror.org",
      license: "CC0 1.0 Universal (public domain dedication)",
      rorRelease: release,
      generatedAt: new Date().toISOString(),
      orgCountInDump: orgs.length,
      activeOrgs: byId.size,
      orgsWithDomain: processed,
      orgsSkippedNoDomain: skippedNoDomain,
      domainCount,
      cap: capped ? args.limit : null,
    },
    byDomain,
  };

  fs.writeFileSync(outPath, JSON.stringify(payload));
  const bytes = fs.statSync(outPath).size;
  console.log(`[ror] wrote ${outPath}`);
  console.log(
    `[ror] orgs-with-domain=${processed} domains=${domainCount} bytes=${bytes}` +
      (capped ? ` (CAPPED at ${args.limit})` : " (FULL)"),
  );
}

build();
