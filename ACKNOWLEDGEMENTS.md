# Built on open source

ResearchOS exists because thousands of people gave their work away. Every screen here rests on open-source software written and maintained by volunteers, students, and engineers who chose to share. We are deeply grateful to all of them.

We are just as grateful to the scientists whose published methods we lean on. The calculators reproduce decades of careful measurement, freely written down so the rest of us can stand on it. That spirit, sharing your work so the next person gets further, is the same spirit ResearchOS is built in. It is free and open source for exactly that reason.

This file is the human-readable version of our thank-you and our attribution. You can read the same page inside the app at `/open-source`. The formal, machine-generated license inventory for every package we ship is in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES). Both are produced from the actual installed dependency tree by `scripts/build-open-source-credits.mjs`, so they never drift from reality.

---

## What powers each part of the app

A few of the projects we rely on most, grouped by where you meet them.

**The writing surface.** Notes and methods are Markdown, edited live and rendered cleanly. [CodeMirror](https://github.com/codemirror/view) is the code-grade editor under the note and sequence surfaces; [marked](https://github.com/markedjs/marked) and the [unified](https://github.com/unifiedjs/unified) remark/rehype pipeline (with [rehype-sanitize](https://github.com/rehypejs/rehype-sanitize)) render Markdown safely; [turndown](https://github.com/mixmark-io/turndown) turns pasted HTML back into clean Markdown.

**Sequence and cloning tools.** Plasmid maps and the sequence editor lean on [Konva](https://github.com/konvajs/konva) and [react-konva](https://github.com/konvajs/react-konva) for canvas drawing, plus the vendored code credited below.

**Calculators and the math layer.** [expr-eval-fork](https://github.com/jorenbroekema/expr-eval) is the lightweight expression engine behind the scientific calculator, and our primer melting temperature is ported from Biopython (see "Code we recycle").

**Charts, files, and state.** [Recharts](https://github.com/recharts/recharts) draws the dashboards, [frappe-gantt](https://github.com/frappe/gantt) the project timeline, [JSZip](https://github.com/Stuk/jszip) handles `.zip` bundles, [idb-keyval](https://github.com/jakearchibald/idb-keyval) backs offline-first storage, [Zustand](https://github.com/pmndrs/zustand) holds app state, [TanStack Query](https://github.com/TanStack/query) fetches and caches data, [date-fns](https://github.com/date-fns/date-fns) does the date math, and [@react-pdf/renderer](https://github.com/diegomura/react-pdf) generates PDF exports.

**The framework.** The whole app is built on [React](https://github.com/facebook/react) and [Next.js](https://github.com/vercel/next.js).

---

## Code we recycle

Some projects we do not just depend on, we carry their source directly. We keep their licenses and copyright alongside the code, exactly as their authors intended.

- **[SeqViz](https://github.com/Lattice-Automation/seqviz)** (MIT, Copyright (c) 2019 Lattice Automation). A subset of the SeqViz sequence viewer is vendored under `frontend/src/vendor/seqviz` to draw linear and circular plasmid maps. See `frontend/src/vendor/seqviz/LICENSE`.
- **[TeselaGen bio-parsers (tg-oss)](https://github.com/TeselaGen/tg-oss)** (MIT, Copyright (c) 2023 Teselagen Biotechnology, Inc.). The GenBank and FASTA readers and writers from TeselaGen's tg-oss bio-parsers are vendored under `frontend/src/vendor/bio-parsers`. See `frontend/src/vendor/bio-parsers/LICENSE`.
- **[Biopython MeltingTemp (Tm_NN)](https://github.com/biopython/biopython)** (BSD, the Biopython License Agreement). Our nearest-neighbor primer melting temperature is a faithful TypeScript port of Biopython's `Bio.SeqUtils.MeltingTemp.Tm_NN`, transcribed verbatim in `frontend/src/lib/calculators/tm-nn.ts`.

---

## Scientific references

The calculators reproduce published methods. The parameters and equations come straight from these papers (see `frontend/src/lib/calculators/tm-nn.ts`).

- Allawi, H.T. & SantaLucia, J. (1997). Thermodynamics and NMR of internal G·T mismatches in DNA. Biochemistry 36: 10581-10594. The nearest-neighbor dH/dS parameter table used for primer Tm.
- SantaLucia, J. (1998). A unified view of polymer, dumbbell, and oligonucleotide DNA nearest-neighbor thermodynamics. PNAS 95: 1460-1465. The salt correction applied to the entropy term.
- von Ahsen, N., Wittwer, C.T. & Schutz, E. (2001). Oligonucleotide melting temperatures under PCR conditions. Clin Chem 47: 1956-1961. The sodium-equivalent that folds in K+, Tris, Mg2+, and dNTPs.

---

## Every dependency we ship, by license

The full per-package list with versions and source links is in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES). Grouped by license, the runtime dependencies are:

- **MIT** (53): @codemirror/commands, @codemirror/lang-markdown, @codemirror/language, @codemirror/lint, @codemirror/state, @codemirror/view, @duckdb/duckdb-wasm, @lezer/common, @lezer/highlight, @lezer/markdown, @neondatabase/serverless, @noble/ciphers, @noble/curves, @noble/hashes, @react-pdf/renderer, @scure/bip39, @tanstack/react-query, @tanstack/react-virtual, @upstash/ratelimit, @upstash/redis, @vercel/analytics, date-fns, exceljs, expr-eval-fork, fflate, frappe-gantt, jstat, konva, loro-codemirror, loro-crdt, marked, minisearch, ml-levenberg-marquardt, ml-matrix, next, nspell, qrcode, react, react-dom, react-konva, react-markdown, recharts, rehype-highlight, rehype-raw, rehype-sanitize, remark-gfm, remark-parse, remark-rehype, resend, stripe, turndown, unified, zustand
- **Apache-2.0** (18): @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @huggingface/transformers, @stdlib/stats-anova1, @stdlib/stats-base-dists-chisquare, @stdlib/stats-base-dists-f, @stdlib/stats-base-dists-normal, @stdlib/stats-base-dists-t, @stdlib/stats-kruskal-test, @stdlib/stats-ttest, @stdlib/stats-ttest2, @stdlib/stats-wilcoxon, apache-arrow, idb-keyval, ketcher-core, ketcher-react, ketcher-standalone, pdfjs-dist
- **ISC** (8): d3-hierarchy, d3-interpolate, d3-scale, d3-selection, d3-shape, d3-transition, d3-zoom, next-auth
- **BSD-3-Clause** (2): @rdkit/rdkit, diff
- **(MIT AND BSD)** (1): dictionary-en
- **(MIT OR GPL-3.0-or-later)** (1): jszip
- **MPL-2.0** (1): ical.js

---

With gratitude to everyone who wrote and maintains the software and science above, and to the broader open-source and scientific community.
