# Search Fuzziness and Spell-Check Plan

**Status:** Draft for review  
**Author:** research agent  
**Date:** 2026-06-09  
**Related features:** handwriting OCR capture (HANDWRITING_NOTE_CAPTURE.md), BeakerSearch (beakersearch-website-wide.md), InlineMarkdownEditor (CM6 Typora surface)

---

## Part 1 — How typo-tolerant is BeakerSearch today?

### The matching function

All BeakerSearch scoring goes through one function:
`frontend/src/components/sequences/editor-commands.ts`, lines 358-392.

```ts
export function fuzzyScore(query: string, haystack: string): number | null {
  const q = query.trim().toLowerCase().replace(/[-/_]/g, " ");
  if (q === "") return 0;
  const h = haystack.toLowerCase().replace(/[-/_]/g, " ");
  let qi = 0;
  let score = 0;
  let prevHit = -1;
  let firstHit = -1;
  for (let hi = 0; hi < h.length && qi < q.length; hi += 1) {
    if (h[hi] === q[qi]) {
      // … adjacency (+6) + word-boundary (+4) bonuses …
      qi += 1;
    }
  }
  if (qi < q.length) return null;          // <-- hard fail: all chars must match
  // … prefix bonus, relevance floor …
  const minScore = Math.max(2, q.length * 2);
  return score >= minScore ? score : null;
}
```

The algorithm is a **strict character-subsequence matcher**. Every character in the query must appear, in order, somewhere in the haystack. The scoring rewards runs of adjacent characters and word-boundary hits. It does NOT implement edit distance, Levenshtein distance, or any form of character substitution tolerance.

This function is the single scorer used for:
- Commands (via `scoreCommand`, line 396)
- Navigation items (via `scoreNavItem`, line 433), which includes notes with OCR keywords
- Global object entries (via `scoreGlobalEntry` in `global-source.ts`, line 119)

### The OCR wiring

`readBaseOcrText` (`frontend/src/lib/attachments/ocr.ts`, line 125) concatenates all `.ocr.json` sidecar texts for a note's `Images/` folder. The result is injected directly as the `keywords` field of each note's `PaletteNavItem` in `workbench-beaker-source.ts`, lines 1006-1014:

```ts
keywords: [
  note.description ? note.description.slice(0, 80) : "",
  note.is_running_log ? "running log" : "",
  note.is_shared ? "shared" : "",
  data.noteOcrText?.get(note.id) ?? "",
].filter(Boolean).join(" "),
```

The raw OCR text is therefore in the haystack. The scoring function then runs over it unchanged.

### Concrete failure analysis: the OCR example

Suppose ML Kit returned "PeR 30 cyels 7C" for a page that actually reads "PCR 30 cycles 72C". The keywords string contains exactly those garbled characters.

**Query "PCR" against haystack "per 30 cyels 7c ..."**

The matcher normalizes both to lowercase. It walks the haystack seeking 'p', 'c', 'r' in order.
- 'p' matches at position 0 (word boundary bonus, score = 5).
- 'c' seeks forward. The next 'c' appears at position 7 in "cyels" (after the space). That matches, score becomes 6 (no adjacency).
- 'r' seeks forward from position 7. The remaining characters are "yels 7c". There is no 'r' after position 7.
- `qi < q.length`, so the function returns `null`. The note is INVISIBLE to a "PCR" query.

**Query "cycles" against haystack "cyels"**

The matcher seeks 'c','y','c','l','e','s' in order through "cyels".
- 'c' matches at 0, 'y' at 1.
- 'c' seeks again from position 2. "els" has no 'c'. Returns `null`. The note is invisible to "cycles".

**Conclusion:** the existing matcher has zero typo tolerance. A single substituted or dropped character in the OCR text makes the indexed string unmatchable, even when the user types the correct word. Any OCR-touched note is unreliable to search.

---

## Part 2 — OSS fuzzy-search options

### Candidates

#### Fuse.js
- **License:** Apache 2.0 (permissive, compatible with AGPL)
- **Version:** 7.4.x, actively maintained (last publish June 2026)
- **Bundle size:** ~6.8 kB gzip (basic build), ~8.6 kB gzip (full build with extended search)
- **Algorithm:** Bitap algorithm, which is an approximate-match algorithm related to shift-and. It enforces a configurable `threshold` (0=exact, 1=match anything). For a given `threshold` it will accept matches within that "fuzziness" budget. The key distinction from pure Levenshtein is that Bitap computes the best substring match with at most k errors, where k is derived from `threshold * patternLength`.
- **Typo tolerance:** Yes. A single substitution like 'e' for 'C' in "PeR" vs "PCR" is within the default threshold. `"PeR"` in the haystack WILL match a query of `"PCR"` with the default `threshold: 0.6`.
- **In-browser/in-memory:** Yes. Index is built at call time from a plain array. No server, no persistent index file. Suitable for ResearchOS's local-first model.
- **Concern:** Fuse.js can produce false positives with a permissive threshold. Short acronyms like "PCR" and "NEB" may spuriously match unrelated words. The `minMatchCharLength` and `threshold` options mitigate this but require tuning.

#### MiniSearch
- **License:** MIT
- **Version:** 7.2.0, last publish approximately 9 months ago (still maintained)
- **Bundle size:** ~7 kB gzip (approximate; the library is described as "tiny, zero runtime dependencies")
- **Algorithm:** Full-text search over an inverted index (radix tree). Supports prefix search and fuzzy search as separate modes. Fuzzy search uses Levenshtein distance, configurable as an integer (max edit distance 1 or 2) or a fraction of term length (e.g. `fuzzy: 0.2` allows 1 typo per 5 characters).
- **Typo tolerance:** Yes, genuine Levenshtein edit-distance. `"PeR"` in the haystack will match a query of `"PCR"` at edit distance 1. "cyels" will match "cycles" at edit distance 1 (one transposed letter).
- **In-browser/in-memory:** Yes. `new MiniSearch(); ms.addAll(docs)` builds the index from a plain array at startup. Documents can be added/removed at any time. Designed explicitly for mobile-constrained browsers.
- **Concern:** MiniSearch tokenizes text on whitespace and runs fuzzy matching per-token. Acronyms like "PCR" are a single token, which is exactly right. Longer lab-name phrases ("Gibco DMEM F12") tokenize naturally. The index must be rebuilt when the document set changes; for ResearchOS this happens on note load, which is already the pattern.

#### uFuzzy
- **License:** MIT
- **Version:** current (~7.5 kB minified, no published gzip figure)
- **Bundle size:** ~7.5 kB min (comparable to others)
- **Algorithm:** Multi-term subsequence matching (default `MultiInsert` mode) plus optional `SingleError` mode (Damerau-Levenshtein distance = 1 per term). `intraMode: 1` tolerates exactly one substitution, transposition, insertion, or deletion per search term.
- **Typo tolerance:** Yes in `intraMode: 1`, which allows a single error per term. "PeR" would match "PCR" (one substitution). "cyels" would match "cycles" (one transposition).
- **In-browser/in-memory:** Yes. No index to build; it searches a pre-existing string array directly. Extremely fast startup (sub-1ms for 162k entries).
- **Concern:** uFuzzy is optimized for short-to-medium phrase lists (titles, names, descriptions), exactly what BeakerSearch handles. However, it does NOT build an index, so it rescans the full haystack list on every keystroke. For ResearchOS's note counts (hundreds, not tens of thousands) this is fine; at very large lab sizes it could be a concern.

#### fuzzysort
- **License:** MIT
- **Bundle size:** ~5 kB min, zero dependencies
- **Algorithm:** SublimeText-style subsequence matching. Rewards contiguous runs. Does NOT support typo tolerance in v2/v3 (the `allowTypo` option was removed in v2.0). 
- **Typo tolerance:** No. This is pure subsequence, same as the current in-house matcher but faster. It would not solve the OCR problem.
- **Verdict:** Not a candidate for typo tolerance.

### Build vs. adopt

The current `fuzzyScore` is clean, well-tested, and already part of the codebase (it is re-exported from `editor-commands.ts` and used across multiple scoring functions). Three paths:

**Path A: Extend in-house matcher with edit-distance**  
Add a configurable `maxErrors` parameter to `fuzzyScore`. When `maxErrors >= 1`, fall back from pure subsequence to a Damerau-Levenshtein pass when the subsequence check fails. This keeps zero new dependencies and fits naturally alongside the existing scoring model (the error-tolerance penalty could subtract from the score so exact-subsequence hits still rank above fuzzy-tolerance hits).

**Path B: Adopt MiniSearch as a second, parallel index for note OCR text only**  
Keep the existing `fuzzyScore` for command palette items (sequences, methods, projects), which are short labels where subsequence matching is excellent. Add MiniSearch as a separate search layer exclusively for the OCR text field, with `fuzzy: 0.2` (allows 1 typo per 5 characters). Merge ranked results. The two scorers coexist without collision.

**Path C: Replace `fuzzyScore` with Fuse.js or MiniSearch site-wide**  
Higher integration cost, touches all scoring paths, requires retesting every palette surface. Not recommended without a clear need beyond OCR.

### Recommendation

**Start with Path A** (extend in-house matcher) for the first iteration. The change is small, the rollback is trivial, and it avoids a new dependency on a search surface that is already well-exercised. Add `maxErrors: 0 | 1` to `fuzzyScore`. When `maxErrors = 1` and the subsequence pass fails, retry with Damerau-Levenshtein distance 1 and apply a score penalty (e.g. `score - q.length`) so exact matches still win.

If Path A proves insufficient (e.g. OCR errors cluster at 2+ errors per term, which is realistic for poor-quality scans), escalate to **Path B with MiniSearch**. MiniSearch's MIT license, genuine Levenshtein, and explicit mobile-browser design are the best fit. Fuse.js is also viable (actively maintained, Apache 2.0) but its Bitap threshold model is harder to reason about than an explicit integer edit distance.

---

## Part 3 — Spell-check in the markdown editor

### Current state

The note editor is `InlineMarkdownEditor.tsx`, a CodeMirror 6 `EditorView` loaded via dynamic import. The CM6 packages already in `package.json` are `@codemirror/state 6.6.0`, `@codemirror/view 6.43.0`, `@codemirror/lang-markdown 6.5.0`, `@codemirror/commands 6.10.3`, and `@codemirror/language 6.12.3`. **CodeMirror 6 is live today**, not merely on the roadmap.

There is no `spellcheck` attribute set anywhere in `InlineMarkdownEditor.tsx` or `LiveMarkdownEditor.tsx`. The browser's native spell-check is therefore driven by whatever the `contenteditable` or CM6 default produces (typically off for CM6's canvas-like editor).

### Option 1: Browser-native `spellcheck=true`

CM6's `EditorView` exposes `contenteditable` under the hood. Setting `spellcheck: "true"` on the CM6 DOM element via an `EditorView` extension (or via a `ViewPlugin` that adds the attribute) enables the OS/browser's built-in underline squiggles. This is:
- Zero bundle cost.
- Zero setup or dictionary management.
- Works in Chrome/Edge on macOS (which already has system dictionary support).
- Lab terms like "miniprep", "qPCR", "ng/uL" will be flagged as misspelled. The user can right-click and add them to the OS dictionary, but that is per-device and invisible to the app.

**Verdict:** viable as a Phase 1 option if the false-positive noise is acceptable. Lab users are accustomed to scientific terms being flagged; most prose-editing tools behave this way. The right-click "Add to Dictionary" OS path is well understood.

### Option 2: nspell + wooorm/dictionaries + custom word list

`nspell` (wooorm/nspell) is a Hunspell-compatible spell checker in plain JavaScript (MIT license, last release 2.1.5, January 2021, no breaking changes since; the library is a stable utility). It consumes `.aff` and `.dic` files from the Hunspell format.

The `dictionary-en` package (from `wooorm/dictionaries`) distributes the en_US Hunspell dictionary under the MIT AND BSD licenses (both permissive; compatible with AGPL). This is the same dictionary data used by Firefox and LibreOffice.

**How it would work in ResearchOS:**
1. Load `nspell` and the `dictionary-en` `.aff`/`.dic` files at editor startup (via dynamic import, so they do not hit the initial bundle).
2. Add a CM6 linter via `@codemirror/lint` that runs `nspell.correct(word)` on each word token identified by the CM6 markdown syntax tree, excluding code spans, code blocks, URLs, and image alt text.
3. Seed `nspell.personal(...)` with a built-in ResearchOS scientific term list ("miniprep", "qPCR", "PCR", "plasmid", "ng/uL", "nmol", "transfection", "electroporation", "DMEM", "PBS", etc.) so these are never flagged.
4. Persist user-added words to a per-user localStorage key so "add to dictionary" survives page reload.

**Bundle cost:** nspell itself is small (roughly 15-20 kB min, not yet gzip-verified). The `dictionary-en` data files are large (the `.dic` alone is ~5 MB uncompressed). These must be lazy-loaded. A compressed `.aff`/`.dic` pair served via the Next.js `public/` folder and fetched on first editor open is the standard approach.

**Maintenance concern:** nspell's last release was January 2021. The library is stable and its API surface is tiny, so staleness is not a risk in practice, but it is worth noting.

**No ready-made CM6 + nspell package exists that is actively maintained for CM6.** The two visible packages (`codemirror-typo`, `codemirror-spell-checker`) target CM6 v5. A CM6 integration would be a thin `@codemirror/lint` wrapper, roughly 50-80 lines.

### Option 3: retext-spell

`retext-spell` (MIT) is a unified.js plugin that uses `nspell` under the hood. It is not a CM6 extension; it is a text-processing pipeline tool. Using it inside a CM6 linter is possible (call `retext().use(retextSpell, { dictionary: dictionaryEn }).process(text)`) but adds unnecessary complexity and a larger dependency chain for what is ultimately the same nspell call. Not recommended over a direct nspell integration.

### Option 4: Browser-native first, nspell layer later

A two-phase approach: ship `spellcheck="true"` on the CM6 editor container in Phase 1 (free, immediate). Add the nspell + custom-dict layer in Phase 2, behind a user preference toggle ("Use scientific spell-check dictionary" in user settings). This avoids the dictionary-loading overhead for users who prefer the OS spell-check or no spell-check.

### The scientific dictionary problem

Any generic en_US dictionary will flag common lab terms. The mitigation is a **bundled ResearchOS scientific word list** seeded at startup. Good candidates for the initial list (not exhaustive):

Molecular biology: PCR, qPCR, RT-PCR, miniprep, maxiprep, midiprep, plasmid, transfection, electroporation, nucleofection, ligation, Gibson, SDS-PAGE, FACS, ELISA, CRISPR, gRNA, sgRNA, siRNA, shRNA, mRNA, lncRNA, miRNA, ORF, promoter, terminator, enhancer, codon, exon, intron, operon, fluorophore, GFP, mCherry, RFP, YFP, CFP, BFP, luciferase, kanamycin, ampicillin, puromycin, hygromycin, blasticidin, zeocin.

Units and quantities: ng/uL, ug/mL, nmol, umol, pmol, fmol, bp, kb, Mb, kDa, mM, uM, nM, pM, rpm, rcf, OD600.

Cell culture: DMEM, RPMI, PBS, BSA, FBS, EDTA, HEPES, HBSS, DPBS, Tris, NaCl, MgCl2.

Instruments/methods: nanodrop, thermocycler, centrifuge, vortex, sonicator, autoclave, spectrophotometer, bioanalyzer.

This list should live in `frontend/src/lib/spellcheck/scientific-wordlist.ts` so it can be extended by pull request and referenced from both the nspell integration and any future dictionary tooling.

### Recommendation

Phase 1: enable browser-native spell-check on the CM6 container. Ship immediately, zero dependencies, lets users use their OS dictionary. Implement by adding `spellcheck` to the CM6 `EditorView` DOM attributes via an extension.

Phase 2: add the nspell + `dictionary-en` + ResearchOS scientific word list layer, gated behind a user preference. The nspell integration is a custom CM6 linter extension (not an off-the-shelf package), roughly 80-120 lines. Bundle the scientific word list in the app; lazy-load the Hunspell data files on first editor open.

---

## Part 4 — The plan

### Track 1: OCR-typo-tolerant search

**Phase 1A: Edit-distance extension to `fuzzyScore` (low effort, ~1-2 days)**

Extend `fuzzyScore` in `frontend/src/components/sequences/editor-commands.ts` to accept a `maxErrors` option (default 0, backward-compatible). When `maxErrors = 1` and the pure-subsequence pass fails, retry with a Damerau-Levenshtein distance 1 check and apply a score discount so exact matches still rank above fuzzy-tolerance matches. Add a flag `FUZZY_OCR_ERRORS_ENABLED` (default off) that sets `maxErrors = 1` only for `scoreNavItem` calls involving note keywords that came from OCR sidecars. This contains the blast radius: command matching and sequence name matching are unaffected.

The OCR flag path is narrow: `scoreNavItem` already receives the full `PaletteNavItem` including its `keywords`. An `ocrKeywords` field (separate from `keywords`) could be added to the nav item type so the scorer can apply a looser threshold specifically to the OCR portion of the haystack.

**Phase 1B: If 1+ errors is insufficient (optional, ~2-3 days)**

Add MiniSearch as a parallel index for OCR text only. Build a `MiniSearch` instance in `useWorkbenchBeakerSource` from the `noteOcrText` map each time the map changes. Run it in parallel with `fuzzyScore` on each query; merge the ranked results, keeping the best score per note. MiniSearch's `fuzzy: 0.2` setting (1 error per 5 characters) handles worse OCR quality than 1-error Damerau-Levenshtein. MIT license, ~7 kB gzip, zero server-side dependencies.

### Track 2: Spell-check in the markdown editor

**Phase 2A: Browser-native spell-check (low effort, ~0.5 days)**

Add a `@codemirror/view` `ViewPlugin` or DOM `attributes` extension to `InlineMarkdownEditor.tsx` that sets `spellcheck="true"` on the CM6 editor DOM node. Gate it behind a user preference (`enableNativeSpellcheck` in `user-settings.ts`), defaulting to `true`. This ships immediately and works with the OS dictionary.

**Phase 2B: nspell + scientific dictionary layer (medium effort, ~3-4 days)**

Write `frontend/src/lib/spellcheck/scientific-wordlist.ts` (the ResearchOS term list). Write `frontend/src/lib/spellcheck/cm6-spellcheck.ts`, a CM6 linter extension using `@codemirror/lint` that calls nspell, skips code blocks/spans/URLs/math via the CM6 markdown syntax tree, and seeds the scientific word list plus user-saved words from localStorage. Lazy-load the `nspell` package and `dictionary-en` data files together (~5 MB uncompressed, served from `public/spellcheck/`) on first editor open, cached in a module-scope promise. Gate the whole layer behind a separate user preference (`enableScientificSpellcheck`, default off).

**Note on sequencing:** Phase 2A can ship before or after Phase 2B independently. Both can ship before or after Track 1.

### Effort summary

| Item | Effort | New deps |
|---|---|---|
| 1A: Edit-distance in `fuzzyScore` | ~1-2 days | None |
| 1B: MiniSearch for OCR text | ~2-3 days | MiniSearch (MIT, ~7 kB gz) |
| 2A: Browser-native spell-check on CM6 | ~0.5 days | None |
| 2B: nspell + scientific dict CM6 linter | ~3-4 days | nspell (MIT), dictionary-en (MIT+BSD), @codemirror/lint |

### Open decisions for Grant

1. **Edit-distance in-house vs. MiniSearch for OCR search.** Start with 1A (extend the matcher) and only add MiniSearch if single-character edit distance is insufficient? Or adopt MiniSearch from the start to get proven Levenshtein semantics? The tradeoff is zero new dependency (1A) vs. guaranteed correctness under worse OCR quality (1B).

2. **Where does the edit-distance / fuzzy tolerance apply?** Only OCR-sourced text (safest, lowest false-positive risk), or also to note titles, task names, method names (helpful when users mistype queries)? The answer changes which score paths get the `maxErrors = 1` treatment.

3. **Spell-check default: on or off?** Browser-native spell-check (Phase 2A) is nearly free to ship. Should it default to on (good for prose sections of notes) or off (avoids false positives for lab users who mostly write reagent names)? Could default to on since OS dictionaries now include many scientific terms.

4. **Scientific word list: bundled only, or user-extendable in the UI?** A UI for adding custom words (e.g. proprietary reagent names, PI-specific shorthand) requires a settings surface. The localStorage "add to dictionary" path is simpler but not shareable across devices. Decide before building 2B.

5. **Phase 2B timing: before or after the CM6 migration completes?** CM6 is already live as the sole editor (`InlineMarkdownEditor`). No migration gate exists. Phase 2B can be built now.

## Part 5 — Spell-check as a conservative OCR auto-corrector (Grant, 2026-06-09)

A synthesis of Tracks 1 and 2. Once a spell checker exists (Track 2), it can also
clean up the rough OCR text. The key insight (Grant) is to be CONSERVATIVE,
because a WRONG confident correction is worse than an ambiguous misspelling:

- Leave "cyels" raw, and fuzzy search (Track 1) matches it to "cycles" (1 edit),
  so the right answer is in the candidate set.
- "Correct" it to the wrong word ("cells"), and search now confidently matches
  the WRONG word and never surfaces "cycles". The signal is destroyed.

The rule: only auto-correct when there is exactly ONE obvious answer; otherwise
keep the OCR version and let fuzzy search do the work.

Heuristic:
- "Confident" = the OCR token is within edit-distance 1 of a SINGLE dictionary
  word, no close runner-up. Apply the correction.
- Ambiguous (multiple candidates, or no dictionary match), leave raw.

Two consequences fall out for free:
1. It auto-protects lab jargon. "miniprep", "qPCR", "ng/uL" are not in a generic
   dictionary, so they are never a confident single-match and never touched.
2. Fuzzy search is the safety net, so auto-correct is an ENHANCEMENT, never
   load-bearing. If it does nothing, search still works.

Safeguards:
- Track machine corrections separately from human edits. A human edit is
  authoritative; a re-OCR or re-correct must never overwrite it. The sidecar
  already has `edited`; add `autoCorrected` (or per-token provenance) so human
  vs machine is distinguishable.
- Show, do not silently mutate. Preview the confident corrections (a diff in the
  editable reveal) so the user sees what changed, rather than the text shifting
  under them.

Additional open decisions:
6. Confidence threshold (edit-distance 1 single-match only, or allow distance 2
   for long tokens?).
7. Preview/diff the corrections, vs apply silently with an undo.
8. Run auto-correct on-device (mobile, at OCR time) or on the laptop (after the
   sidecar lands)? The laptop is simpler (the nspell + dictionary from Track 2
   are already there) and keeps the RAW OCR in the sidecar as the source of
   truth, with corrections layered on.

---

*research agent (Parts 1-4); mobile manager (Part 5, from Grant's design input)*

---

## Part 6 - OSS library deep-dive (definitive picks)

**Date:** 2026-06-09  
**Scope:** Verified against live npm registry, GitHub, Bundlephobia, and npm download API (week of 2026-05-27 to 2026-06-02). No claim relies on memory alone.

---

### 1. SymSpell JS ports: full audit

The original SymSpell algorithm (Wolf Garbe, C#, MIT license) is well-suited to all three needs: typo-tolerant search, spell-check, and conservative OCR auto-correction. The algorithm pre-generates a delete-only edit-distance index at load time, then does O(1) candidate lookups at query time. It exposes three operations:
- `Lookup` (single-word spelling correction, suitable for per-token spell-check and per-token OCR correction)
- `LookupCompound` (multi-word phrase correction, handles split/merged OCR words)
- `WordSegmentation` (recovers word boundaries from space-stripped OCR output)

**The problem is that every maintained JS port has a critical flaw for browser use or is effectively unmaintained.**

#### node-symspell (MathieuLoutre)
- npm: `node-symspell`, version 0.1.0, last publish **2019-12-30** (over 6 years ago)
- Weekly downloads: **428** (week ending 2026-06-02, npm API)
- License: not declared in package.json
- Dependencies: `difflib` + `iter-tools` (no Node.js built-ins in package.json)
- Dictionary loading: via async `loadDictionary(dictFile, ...)` -- the signature takes a file-path string. The README says "needs at least Node 12.x" and mentions no browser support. The async generator internals were not verified to be fs-free but the design is clearly Node-first.
- Exposes: Lookup, LookupCompound, WordSegmentation (all three)
- **Verdict: unmaintained (6+ years), Node-first design, 428 downloads/week. Reject.**

#### symspell-ex (reneklacan port)
- npm: `symspell-ex`, version 1.1.10, last publish **2022-06-22** (4 years ago)
- Weekly downloads: **396** (npm API)
- License: MIT
- Dependencies: `ioredis` (a Redis client) and `megahash` (a Node.js native addon)
- `ioredis` is explicitly a Node.js-only library and will cause webpack/Next.js bundle failures in any client-side import path. `megahash` is a native C++ addon that cannot run in a browser.
- **Verdict: hard browser incompatibility (ioredis + native addon). Reject regardless of maintenance status.**

#### symspell / dongyuwei
- npm: `symspell`, version 0.6.1, last publish: approximately 11 years ago per npm search results
- Weekly downloads: **57** (npm API)
- License: **LGPL-3.0** (confirmed from package.json)
- LGPL-3.0 is incompatible with an AGPL project in many interpretations for bundled code. It also requires dynamic linking or source distribution for modifications. For a bundled in-browser app, this is a practical problem.
- **Verdict: LGPL license is a deal-breaker for a bundled browser app. Reject.**

#### SymSpell.js (itslenny)
- npm: not published; TypeScript/JS proof of concept only
- GitHub: itslenny/SymSpell.js, described by its author as "a proof of concept and can easily be adapted"
- A known open issue ("Heap out of Memory on Newer Versions of Node") was never resolved
- **Verdict: proof-of-concept quality, not production-ready. Reject.**

#### @maieuticallabs/symspell-wasm
- npm: `@maieuticallabs/symspell-wasm`, version 0.4.1-wasm1, last publish **2020-04-23** (6 years ago)
- Weekly downloads: **10** (npm API)
- License: MIT
- A Rust-compiled WASM build from reneklacan/symspell. ~183 KB unpacked.
- **Verdict: essentially abandoned (10 downloads/week, 6 years no update). Reject.**

#### spellchecker-wasm (justinwilaby)
- npm: `spellchecker-wasm`, version 0.3.3, last publish **2020-05-13** (6 years ago)
- Weekly downloads: **869** (npm API)
- License: MIT
- Rust port of SymSpell v6.6 compiled to WASM, ~3.4 MB unpacked. Designed for Worker threads.
- One CM6 community post (discuss.codemirror.net, 2021) demonstrated this as a spell-check backend. The author described it as ~70 KB WASM + ~2 MB English dictionary.
- Browser support exists in principle (the WASM runs in a browser), but the `postinstall` script decompresses assets in a Node.js-specific way, and the package has not been updated in 6 years.
- **Verdict: best of the SymSpell WASM options but still abandoned for 6 years. Risky for production.**

#### Summary on SymSpell JS ports

Every JS/TS/WASM port of SymSpell is either unmaintained (most last touched 4-6 years ago), has a browser-blocking dependency (ioredis, native addon), or carries a license issue (LGPL). The SymSpell algorithm itself is well-suited to the problem. However, **no currently maintained, browser-safe, permissively licensed npm package delivers it in 2026**. The algorithm's dictionary data (`frequency_dictionary_en_82_765.txt`) is MIT-licensed per the wolfgarbe/SymSpell repo LICENSE file (derived from Google Books Ngrams CC-BY 3.0 + SCOWL, but the combined output is distributed under MIT by Wolf Garbe).

**Implication:** SymSpell cannot be adopted via an existing npm package without accepting significant maintenance or compatibility risk. The algorithm could be ported in-house (~200 lines of TypeScript for a single-word Lookup), but that contradicts Grant's explicit "no rolling our own" requirement.

---

### 2. Fuzzy search for in-browser OCR-tolerant search: ranked candidates

All data verified via npm download API and Bundlephobia API.

| Library | Version | Last publish | Weekly DLs | License | Gzip | Edit-distance? | Browser safe? |
|---|---|---|---|---|---|---|---|
| fuse.js | 7.4.2 | ~Jan 2025 | 10,519,902 | Apache-2.0 | 9.2 kB | Yes (Bitap) | Yes |
| minisearch | 7.2.0 | Jan 2025 | 1,334,287 | MIT | 5.8 kB | Yes (Levenshtein) | Yes |
| @orama/orama | 3.1.18 | Dec 2024 | 744,725 | Apache-2.0 | 24.4 kB | Yes (Levenshtein) | Yes |
| flexsearch | 0.8.212 | Feb 2025 | 1,063,732 | Apache-2.0 | 16.8 kB | No | Yes |
| @leeoniya/ufuzzy | 1.0.19 | Dec 2024 | 297,263 | MIT | 4.0 kB | Yes (Damerau-Lev, intraMode:1) | Yes |

**FlexSearch:** does NOT implement edit-distance. Its "tolerance" is a tokenizer/encoder strategy. A GitHub issue explicitly titled "Warning to new users: FlexSearch has no fuzzy search" (issue #452, nextapps-de/flexsearch) confirms this. Excluded from the typo-tolerance candidates.

**Fuse.js (7.4.2, Apache-2.0):** uses the Bitap algorithm (a shift-and approximate matcher, bounded by a `threshold` parameter from 0.0 to 1.0). Genuine approximate matching, not just subsequence. Will match "PeR" against "PCR" at the default threshold of 0.6. The threshold is a ratio, not an integer edit count, which is harder to reason about precisely (a threshold of 0.6 on a 3-character pattern allows roughly 1-2 errors). Very widely used (10.5M downloads/week). The Apache-2.0 license is compatible with an AGPL app (Apache-2.0 is permissive, downstream AGPL use is fine). Concern: false-positive noise on short acronyms with a permissive threshold.

**MiniSearch (7.2.0, MIT):** uses a genuine Levenshtein distance computed via a Wagner-Fischer variant on a radix tree (verified in the DESIGN_DOCUMENT.md). The `fuzzy` option accepts either an integer (exact max edit distance) or a fraction of term length. `fuzzy: 1` means exactly 1 edit allowed per term, regardless of length. This is the most semantically precise control for OCR use: a known OCR error rate (1-2 characters per token for ML Kit output) maps directly to `fuzzy: 1` or `fuzzy: 2`. Full-text inverted index means it requires `addAll(docs)` at startup. Zero external dependencies, TypeScript types included, explicitly designed for mobile browsers and memory-constrained environments. 1.3M downloads/week. MIT license is the most permissive possible.

**@orama/orama (3.1.18, Apache-2.0):** genuine Levenshtein distance (verified in the source levenshtein.ts: `boundedLevenshtein` function uses a real DP matrix with substitution/insertion/deletion). Configured via `tolerance: N` (integer edit distance). A full-featured search engine with BM25 ranking, facets, vector search - significantly more than needed. Gzip size of 24.4 kB is larger than the alternatives. Requires Node >= 20 per the registry metadata, which may complicate bundling. Strong typo tolerance, but overkill for BeakerSearch's needs.

**@leeoniya/uFuzzy (1.0.19, MIT):** the smallest option at 4.0 kB gzip. Uses Damerau-Levenshtein in `intraMode: 1` (one error per term: substitution, transposition, insertion, or deletion). Does NOT build an index - scans the source array on every query, which is fast for hundreds-of-items lists but slower at scale. No `addAll` step; just pass the raw string array. TypeScript types included, zero runtime dependencies. 297K downloads/week. The tradeoff is that it is a pure matcher with no ranking sophistication beyond adjacency scoring; MiniSearch's BM25-like per-field ranking is absent.

**Ranking for ResearchOS OCR search:**

1. **MiniSearch** (primary recommendation): genuine Levenshtein with precise integer `fuzzy` control, MIT, 5.8 kB gzip, 1.3M downloads/week, zero deps, designed for browser/mobile. Best fit for the note OCR index use case (build index once per session from the OCR text map, query on each keystroke).
2. **@leeoniya/uFuzzy** (secondary/alternative): 4.0 kB gzip, Damerau-Levenshtein, zero deps, MIT. Best fit if a full-text index is undesirable or if the search target is a short label list (command palette items) rather than a document corpus.
3. **Fuse.js** (viable but third choice): largest adoption, but the Bitap threshold model is less intuitive for OCR error-rate tuning than MiniSearch's integer edit distance. Apache-2.0 is fine.
4. **@orama/orama**: excluded from the primary recommendation because the 24.4 kB gzip bundle cost and the Node >= 20 requirement are both unnecessary for BeakerSearch's scope.
5. **FlexSearch**: excluded. No genuine edit-distance. Cannot solve the OCR problem.

---

### 3. Spell-check for CM6: nspell vs Typo.js vs native

#### nspell (2.1.5, MIT)
- Last publish: 2021-01-17
- Weekly downloads: **173,087** (npm API)
- Gzip: 3.8 kB (library alone; the dictionary is separate)
- Dependencies: `is-buffer` only
- Hunspell-compatible; consumes `.aff`/`.dic` files
- Supports adding personal words via `nspell.personal(wordList)` - critical for the ResearchOS scientific word list
- Has prebuilt browser bundles (`nspell.js`, `nspell.min.js`) confirmed in the package metadata
- Performance note from community comparisons: nspell is "much faster" than Typo.js for suggestion generation; Typo.js can take 7+ seconds for suggestions on long words (confirmed in GitHub PR #4 of ace_spell_check_js replacing Typo.js with nspell)
- The library has not been updated since 2021 but its API is stable and minimal; the Hunspell format does not change

#### Typo.js (1.3.2, BSD-3-Clause)
- Last publish: **2026-05-12** (very recently updated)
- Weekly downloads: **326,538** (npm API)
- Gzip: 3.2 kB (library alone)
- Also Hunspell-compatible, also browser-safe (`fs: false` in browser field)
- Custom words: via `.dic` file additions (not as clean as nspell's `personal()` method)
- Performance: significantly slower at generating suggestions for long misspelled words; this matters for the auto-correct path

#### dictionary-en (wooorm/dictionaries)
- npm: `dictionary-en`, version 4.0.0, last publish 2023-11-03
- Weekly downloads: **98,277** (npm API)
- License: MIT AND BSD (dual, both permissive)
- Provides the en_US Hunspell `.aff` + `.dic` files (~5 MB uncompressed) used by both nspell and Typo.js
- This is the same dictionary data as Firefox and LibreOffice spell-check

#### Browser-native spellcheck
- Zero cost, zero bundle, delegates to OS dictionary
- Cannot be extended with lab-specific terms programmatically (user must add per-device via right-click)
- Works on Chrome/Edge/macOS natively (ResearchOS targets Chrome/Edge only per existing docs)
- CM6 support: requires either `inputStyle: 'contenteditable'` with `spellcheck: true` on the DOM element. The `beforeinput` event approach (described in the CM6 forums) works for intercepting browser replacements in CM5; for CM6 the recommended pattern is to add `spellcheck: "true"` to the EditorView DOM attributes extension.

#### Scientific / biomedical wordlists
Three open-source options were found:
- **LexisMed** (anobel/LexisMed-wordlist): CC BY-NC-SA 4.0. The NC (NonCommercial) clause makes it unusable for an app with any commercial offering (the LLC + metered storage model is commercial use). **License is incompatible. Reject.**
- **wordlist-medicalterms-en** (glutanimate): 98,119 medical terms, plain `.txt`, GNU GPL v3. GPL is copyleft and incompatible with bundling into an AGPL app in a clean way. **Reject.**
- **jakelever/biowordlists**: genes, drugs, diseases in TSV format, designed for text mining. No npm package; would need manual curation for spell-check use.

**Conclusion on external biomedical wordlists:** none of the available open-source ones carry a permissive license suitable for ResearchOS. The right path is the one already designed in Part 3: a curated ResearchOS scientific word list in `frontend/src/lib/spellcheck/scientific-wordlist.ts`, built and maintained in-house (it is not an algorithm, just a list of strings, so "no rolling our own algorithm" does not apply).

#### Spell-check verdict
Use **nspell + dictionary-en** for the CM6 linter integration. Reasons:
1. `personal()` API makes it trivial to seed the ResearchOS scientific wordlist at initialization
2. Faster than Typo.js for suggestion generation (critical for the OCR auto-correct path where we need single-best-match confidence checks)
3. MIT license (cleaner than BSD-3-Clause, both are fine)
4. 173K downloads/week - healthy adoption
5. The 2021 last-publish date is not a concern: the Hunspell format is stable, nspell has 100% test coverage, and the API has not changed

For **Phase 1** (browser-native), set `spellcheck: "true"` on the CM6 EditorView DOM attributes - zero cost, ships immediately. For **Phase 2** (scientific dict), use nspell + dictionary-en + the in-house scientific wordlist.

---

### 4. OCR post-correction: dedicated tooling vs. SymSpell vs. spell-check

Dedicated OCR post-correction tools in the JavaScript/npm ecosystem are essentially nonexistent for browser use. The academic OCR post-correction literature (2024 survey, arxiv:1204.0191) confirms the dominant approaches are:
- Character-level confusion matrix correction (requires training data per OCR engine)
- Seq2seq neural models (far too heavy for in-browser use)
- Dictionary-based edit-distance correction (what SymSpell's Lookup does)

The dictionary-based approach is what nspell + a scientific wordlist provides anyway. The only difference SymSpell adds is speed (O(1) lookup via the delete-index) and the LookupCompound/WordSegmentation operations for multi-word errors. For ResearchOS's conservative single-token correction policy (Part 5's heuristic: correct only when one confident single match), nspell's `suggest()` returning a single best candidate at edit-distance 1 is equivalent to SymSpell's Lookup at max_edit_distance=1.

**Conclusion:** a dedicated OCR post-correction library is not needed. The nspell + scientific-wordlist path satisfies OCR correction requirements within the conservative policy defined in Part 5. The conservative rule is: call `nspell.suggest(token)`; if the result is a non-empty array of length 1, that is the single confident correction; otherwise leave the token raw.

---

### 5. Definitive recommendation

#### The minimal set

| Role | Package | Version | License | Gzip | Weekly DLs | Notes |
|---|---|---|---|---|---|---|
| Typo-tolerant search (OCR notes) | `minisearch` | 7.2.0 | MIT | 5.8 kB | 1,334,287 | Levenshtein, `fuzzy: 1`, browser/mobile first |
| Spell-check + OCR auto-correct engine | `nspell` | 2.1.5 | MIT | 3.8 kB | 173,087 | Hunspell compat, `personal()` API |
| English dictionary data | `dictionary-en` | 4.0.0 | MIT AND BSD | ~5 MB lazy-loaded | 98,277 | Firefox/LibreOffice same data |

Total runtime bundle addition: **9.6 kB gzip** (minisearch + nspell library code). The 5 MB dictionary data is lazy-loaded on first editor open, not in the critical path.

No SymSpell JS port is adopted. The reason: every available npm port is either unmaintained (all last touched 4-6 years ago), has a hard browser incompatibility (ioredis, native addon), or carries an incompatible license (LGPL). The algorithm would need to be re-implemented in TypeScript to be viable, which contradicts the "no rolling our own" requirement.

#### How it plugs in

**BeakerSearch (OCR search - Track 1B replacement for in-house edit-distance):**

```typescript
import MiniSearch from 'minisearch'

const ocrIndex = new MiniSearch({
  fields: ['ocrText'],
  storeFields: ['noteId'],
  searchOptions: { fuzzy: 1, prefix: true },
})
// Build from noteOcrText map in useWorkbenchBeakerSource
ocrIndex.addAll(Array.from(noteOcrText.entries()).map(([id, text]) => ({ id, noteId: id, ocrText: text })))
// Query
const hits = ocrIndex.search(query)  // returns [{ noteId, score }, ...]
```

The existing `fuzzyScore` path remains untouched for commands, sequences, and project names. MiniSearch is a parallel index only for OCR text, merging results by note ID.

**CM6 spell-check linter (Track 2B):**

```typescript
import nspell from 'nspell'
import { linter } from '@codemirror/lint'
import { SCIENTIFIC_WORDLIST } from '@/lib/spellcheck/scientific-wordlist'

// Lazy-loaded on first editor open
const getChecker = once(async () => {
  const [aff, dic] = await Promise.all([
    fetch('/spellcheck/en_US.aff').then(r => r.arrayBuffer()),
    fetch('/spellcheck/en_US.dic').then(r => r.arrayBuffer()),
  ])
  const checker = nspell({ aff, dic })
  checker.personal(SCIENTIFIC_WORDLIST.join('\n'))
  return checker
})

export const spellCheckLinter = linter(async (view) => {
  const checker = await getChecker()
  // Walk the CM6 syntax tree, skip code/url/math nodes
  // For each word token: checker.correct(word) -> diagnostic if false
  // For suggest: checker.suggest(word) -> actions
})
```

**OCR conservative auto-correct (Track 1 + 2 synthesis from Part 5):**

```typescript
function conservativeCorrect(token: string, checker: nspell): string {
  if (checker.correct(token)) return token          // already valid, leave as-is
  const suggestions = checker.suggest(token)
  if (suggestions.length === 1) return suggestions[0]  // one confident match
  return token                                          // ambiguous, leave raw
}
```

#### Deal-breakers checked

- No GPL or LGPL dependencies in the set. MiniSearch (MIT), nspell (MIT), dictionary-en (MIT AND BSD). All permissive and compatible with an AGPL app.
- No Node.js-only modules. MiniSearch has zero runtime dependencies. nspell depends only on `is-buffer` which is browser-compatible.
- Bundle cost is minimal (9.6 kB gzip for code; dictionary is lazy-loaded, not in the initial bundle).
- MiniSearch is explicitly designed for mobile browsers and memory-constrained environments.
- nspell has prebuilt browser bundles in its package.

#### What Part 4's plan changes

Part 4 recommended "Path A: extend the in-house `fuzzyScore` with edit distance" as the first step for Track 1. This research supersedes that recommendation: **adopt MiniSearch directly as Track 1B** rather than implementing Damerau-Levenshtein in-house. The effort is comparable (1-2 days either way), but MiniSearch delivers a proven, tested Levenshtein implementation with no maintenance burden. The "try Path A first" logic was sound when the assumption was that OSS options would have drawbacks; this research shows MiniSearch has no significant drawbacks for the use case.

Part 4's Track 2 plan (nspell + scientific wordlist as Phase 2B) is **confirmed and unchanged**. Browser-native spellcheck is still the right Phase 2A.

---

*research agent (OSS deep-dive)*
