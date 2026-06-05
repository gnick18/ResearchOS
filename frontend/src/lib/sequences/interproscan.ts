// sequence editor master. EBI InterProScan client (browser-direct, opt-in).
//
// Submits ONE translated protein (the user's selected CDS) to EBI InterProScan,
// polls for completion, fetches the JSON result, and parses the domain matches
// into a flat, typed DomainHit[]. The browser calls EBI directly because the
// iprscan5 REST service returns `access-control-allow-origin: *` on GET and the
// POST /run preflight (verified live, the Zenodo case, not Figshare). No proxy,
// no server, nothing on our infrastructure.
//
// PRIVACY. The ONLY thing that ever leaves the machine is the single protein
// string the caller passes to submitInterProScan. We send NO DNA, no file name,
// no user data, and a FIXED app-level email (EBI requires a syntactically valid
// address purely for job tracking on the public service; we never collect or
// send the user's email).
//
// The network calls are thin wrappers; the PARSER (parseInterProScanResult) is
// pure and unit-tested against a saved real CDK2 response.
//
// Voice in comments, no em-dashes, no emojis, no mid-sentence colons.

/** Base URL of the EBI InterProScan 5 REST service. */
export const IPRSCAN_BASE =
  "https://www.ebi.ac.uk/Tools/services/rest/iprscan5";

/**
 * A FIXED, app-level address. EBI's public service requires a syntactically
 * valid email purely to track jobs; it is never used to reach a person here.
 * We deliberately do NOT ask the user for, or send, their real email. Verified
 * live that EBI accepts this generic form and returns a job id.
 */
export const IPRSCAN_EMAIL = "interproscan@research-os.app";

/** The Pfam member-database application id (verified live via the appl
 *  parameterdetails endpoint). v1 requests Pfam only; the value is carried on
 *  each hit so per-source labeling works when more databases are added. */
export const IPRSCAN_DEFAULT_APPL = "PfamA";

/** Job lifecycle states the status endpoint returns. RUNNING means keep polling;
 *  anything else is terminal. */
export type IprscanStatus =
  | "RUNNING"
  | "FINISHED"
  | "ERROR"
  | "FAILURE"
  | "NOT_FOUND"
  | "PENDING"
  | "QUEUED";

/** One parsed domain hit, in PROTEIN residue coordinates (1-based, inclusive),
 *  the way InterProScan reports them. The caller maps [start, end] back onto the
 *  CDS's DNA. */
export interface DomainHit {
  /** Member database the hit came from, e.g. "Pfam". Carried so a later UI can
   *  filter / label by source. */
  db: string;
  /** The family accession, e.g. "PF00069". */
  accession: string;
  /** The short family name, e.g. "Pkinase". */
  name: string;
  /** The family description / long name, when present. */
  description?: string;
  /** 1-based inclusive residue start on the protein. */
  start: number;
  /** 1-based inclusive residue end on the protein. */
  end: number;
  /** The match bit score, when the database reports one. */
  score?: number;
  /** The match E-value, when the database reports one. */
  evalue?: number;
}

/** Options for a submission. */
export interface SubmitOptions {
  /** Member database(s) to search. Defaults to Pfam. A comma-joined string or a
   *  single id; passed through to EBI's `appl` param. */
  appl?: string;
  /** Override the tracking email (tests). Defaults to the fixed app address. */
  email?: string;
  /** Cancel an in-flight request. */
  signal?: AbortSignal;
}

/** A network or service failure surfaced to the UI. */
export class InterProScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InterProScanError";
  }
}

/**
 * Submit a protein for an InterProScan run. Returns the plain-text job id.
 *
 * Only `protein` (plus the fixed email + chosen appl) is sent. The protein is
 * stripped of whitespace and uppercased; an empty protein is rejected before any
 * network call so we never submit junk.
 */
export async function submitInterProScan(
  protein: string,
  opts: SubmitOptions = {},
): Promise<string> {
  const sequence = (protein || "").replace(/\s+/g, "").toUpperCase();
  if (!sequence) {
    throw new InterProScanError("No protein sequence to submit.");
  }
  const body = new URLSearchParams();
  body.set("email", opts.email || IPRSCAN_EMAIL);
  body.set("sequence", sequence);
  body.set("stype", "p");
  body.set("appl", opts.appl || IPRSCAN_DEFAULT_APPL);

  let res: Response;
  try {
    res = await fetch(`${IPRSCAN_BASE}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/plain",
      },
      body: body.toString(),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new InterProScanError("Could not reach EBI InterProScan.");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new InterProScanError(
      `EBI InterProScan rejected the submission (${res.status}). ${text}`.trim(),
    );
  }
  const jobId = (await res.text()).trim();
  if (!jobId) throw new InterProScanError("EBI InterProScan returned no job id.");
  return jobId;
}

/** Fetch the current status of a job (single GET, no looping). */
export async function pollInterProScan(
  jobId: string,
  signal?: AbortSignal,
): Promise<IprscanStatus> {
  let res: Response;
  try {
    res = await fetch(`${IPRSCAN_BASE}/status/${encodeURIComponent(jobId)}`, {
      headers: { Accept: "text/plain" },
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new InterProScanError("Could not reach EBI InterProScan.");
  }
  if (!res.ok) {
    throw new InterProScanError(`Could not read job status (${res.status}).`);
  }
  return (await res.text()).trim() as IprscanStatus;
}

/** Options for the polling loop. */
export interface WaitOptions {
  /** Cancel the wait (and reject with the AbortError). */
  signal?: AbortSignal;
  /** Seconds between status checks. Default 5. */
  intervalSec?: number;
  /** Give up after this many seconds. Default 300 (5 minutes). */
  timeoutSec?: number;
  /** Called after each status check, for a calm progress UI. */
  onStatus?: (status: IprscanStatus) => void;
}

/** Internal cancelable sleep that rejects with an AbortError if aborted mid-wait
 *  (so a cancel during the gap between polls returns promptly). */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Poll a job until it FINISHES, ERRORS, or times out. Resolves with the terminal
 * status (FINISHED on success). Throws InterProScanError on a service error /
 * failure / timeout, and the AbortError when the signal is aborted, so the UI can
 * tell "cancelled" from "failed".
 */
export async function waitForInterProScan(
  jobId: string,
  opts: WaitOptions = {},
): Promise<IprscanStatus> {
  const intervalMs = (opts.intervalSec ?? 5) * 1000;
  const timeoutMs = (opts.timeoutSec ?? 300) * 1000;
  const startedAt = Date.now();

  for (;;) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const status = await pollInterProScan(jobId, opts.signal);
    opts.onStatus?.(status);
    if (status === "FINISHED") return status;
    if (status === "ERROR" || status === "FAILURE" || status === "NOT_FOUND") {
      throw new InterProScanError(`EBI InterProScan job did not finish (${status}).`);
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new InterProScanError(
        "EBI InterProScan timed out. The service can be slow under load. Try again.",
      );
    }
    await sleep(intervalMs, opts.signal);
  }
}

/** Fetch the raw JSON result for a finished job. */
export async function fetchInterProScanResult(
  jobId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${IPRSCAN_BASE}/result/${encodeURIComponent(jobId)}/json`, {
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new InterProScanError("Could not reach EBI InterProScan.");
  }
  if (!res.ok) {
    throw new InterProScanError(`Could not read job result (${res.status}).`);
  }
  return res.json();
}

// --- PARSER (pure, unit-tested against a real CDK2 response) ----------------

/** Map an InterProScan signature-library name to the short db label we carry on
 *  a hit. InterProScan reports the library as "PFAM"; surface it as "Pfam". */
function dbLabel(library: string | undefined): string {
  const lib = (library || "").trim().toUpperCase();
  switch (lib) {
    case "PFAM":
      return "Pfam";
    case "NCBIFAM":
    case "TIGRFAM":
      return "NCBIfam";
    case "SMART":
      return "SMART";
    case "SUPERFAMILY":
      return "SUPERFAMILY";
    case "CDD":
      return "CDD";
    default:
      // Title-case-ish fallback that keeps an unknown library readable.
      return library ? library.trim() : "domain";
  }
}

/**
 * The subset of the InterProScan 5 JSON result we read. The full shape is large;
 * we only touch what a domain hit needs. Defensive: every field is optional and
 * validated at parse time, so a shape drift degrades to "no hits" rather than a
 * crash.
 *
 * Result shape (verified against a real CDK2 PfamA run):
 *   { results: [ { matches: [ {
 *       signature: {
 *         accession, name, description,
 *         signatureLibraryRelease: { library, version },
 *       },
 *       "model-ac": "PF00069",
 *       evalue, score,
 *       locations: [ { start, end, ... }, ... ],
 *   } ] } ] }
 */
interface RawSignature {
  accession?: string;
  name?: string;
  description?: string;
  signatureLibraryRelease?: { library?: string; version?: string };
}
interface RawLocation {
  start?: number;
  end?: number;
}
interface RawMatch {
  signature?: RawSignature;
  "model-ac"?: string;
  evalue?: number;
  score?: number;
  locations?: RawLocation[];
}
interface RawResultEntry {
  matches?: RawMatch[];
}
interface RawResult {
  results?: RawResultEntry[];
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Parse an InterProScan JSON result into a flat list of DomainHit. Each
 * signature match can carry several locations (the same family hitting more than
 * one region of the protein); EACH location becomes its own hit, so a repeated
 * domain maps to several features. Hits are sorted by start, then end.
 *
 * Pure: takes the already-fetched JSON (any shape), returns DomainHit[]. Unknown
 * / malformed input yields an empty list, never a throw.
 */
export function parseInterProScanResult(raw: unknown): DomainHit[] {
  const root = (raw || {}) as RawResult;
  const results = Array.isArray(root.results) ? root.results : [];
  const hits: DomainHit[] = [];

  for (const entry of results) {
    const matches = Array.isArray(entry?.matches) ? entry.matches : [];
    for (const m of matches) {
      const sig = m?.signature || {};
      const accession =
        (sig.accession && String(sig.accession)) ||
        (m["model-ac"] && String(m["model-ac"])) ||
        "";
      if (!accession) continue;
      const db = dbLabel(sig.signatureLibraryRelease?.library);
      const name = sig.name ? String(sig.name) : accession;
      const description = sig.description ? String(sig.description) : undefined;
      const score = num(m?.score);
      const evalue = num(m?.evalue);
      const locations = Array.isArray(m?.locations) ? m.locations : [];
      for (const loc of locations) {
        const start = num(loc?.start);
        const end = num(loc?.end);
        if (start === undefined || end === undefined) continue;
        hits.push({
          db,
          accession,
          name,
          description,
          start: Math.min(start, end),
          end: Math.max(start, end),
          score,
          evalue,
        });
      }
    }
  }

  hits.sort((a, b) => a.start - b.start || a.end - b.end);
  return hits;
}
