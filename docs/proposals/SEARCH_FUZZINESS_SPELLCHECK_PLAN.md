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
