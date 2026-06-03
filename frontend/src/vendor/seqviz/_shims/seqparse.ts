// @ts-nocheck — vendored third-party source (SeqViz / bio-parsers facade); kept out of strict typecheck per the sequence-editor proposal. OUR code is strict; this file is owned-but-vendored.
// Local shim replacing the `seqparse` package.
// In this spike we always pass `seq` directly to SeqViz, so the accession-fetch
// (default export) and file-parse (parseFile) code paths are never exercised.
// We provide minimal stand-ins so the module type-checks and bundles without
// pulling the real dependency. If/when accession or file ingest is needed, wire
// in a real parser here.
//
// seqviz spike bot

export interface ParseOptions {
  fileName?: string;
  source?: string;
  [k: string]: unknown;
}

interface Parsed {
  name: string;
  seq: string;
  // upstream callers index annotations as AnnotationProp-shaped objects
  annotations: { name: string; start: number; end: number; direction?: number | string }[];
  // SeqViz.tsx reads parsed[0].seq etc. when treating the result like seqparse's
  // array return; keep this loose so the stub satisfies both shapes.
  [index: number]: { name?: string; seq?: string; annotations?: unknown[] };
  length?: number;
}

const empty: Parsed = { name: "", seq: "", annotations: [], length: 0 } as Parsed;

export function parseFile(_contents: string, _opts?: ParseOptions): Parsed {
  throw new Error("seqviz spike: parseFile() is stubbed; pass `seq` directly instead of `file`.");
}

export default function seqparse(_accession: string, _opts?: { cors?: boolean }): Promise<Parsed> {
  return Promise.resolve(empty);
}
