# Sequences redesign Phase 5: results as artifacts

The last piece of the editor redesign. Operations that PRODUCE something (an
alignment, a domain scan) stop being throwaway popups and become saved RESULT
ARTIFACTS that land in the History tab under a "Results" section, revisitable,
each carrying its lineage (the sequence + version + inputs that produced it).
The Geneious "result drops back into the browser" loop.

## Locked decisions (signed off 2026-06-07)

- STORAGE: a per-sequence sidecar, `sequences/{id}.artifacts.json`, next to the
  existing `{id}.meta.json` and `{id}.gb`. Durable, local-first, survives reload,
  does not bloat the CRDT doc. Read and written through `fileService.readJson` /
  `fileService.writeJson`, mirroring `src/lib/sequences/enzyme-sets.ts`.
- V1 OPERATIONS: Align (Compare) and Find domains (the HMMER / InterProScan
  scan). These two exist today and produce a real, re-openable result. The model
  is extensible to tree snapshots / digest gels later.
- PLACEMENT: a "Results" section in the existing History tab (`SequenceHistoryPanel`),
  newest first, above or below the edit-version history.

## Data model

`Artifact` (one entry in the sidecar array):

- `id`: stable unique id.
- `type`: `"alignment" | "domains"` (string union, extensible).
- `title`: a human label, e.g. `Align to pEGFP-N1-TRAP1` / `Domains in EGFP`.
- `summary`: a one-line readout for the list row, e.g. `92% identity, 4 gaps` /
  `2 Pfam hits (GFP, ...)`.
- `createdAt`: ISO timestamp.
- `lineage`: `{ sequenceId; sequenceVersion: string; inputs: object }` where
  `sequenceVersion` is a content fingerprint / Loro version of the sequence at
  the time the result was computed, and `inputs` records the parameters (align:
  the reference sequence id/name + algorithm; domains: the db + the feature/CDS
  scanned). This is what makes a result revisitable and lets us flag it STALE
  when the sequence has changed since.
- `result`: the data needed to RE-RENDER the result without recomputing (the
  formatted alignment payload from `compare-format`, or the domain-hit list).
  Keep it self-contained.

## Storage lib (`src/lib/sequences/artifacts.ts`)

Pure-ish, mirrors `enzyme-sets.ts`:

- `artifactsPath(username, seqId)` -> `users/{username}/sequences/{id}.artifacts.json`.
- `listArtifacts(fileService, username, seqId): Promise<Artifact[]>` (newest first; tolerant of a missing file -> []).
- `saveArtifact(fileService, username, seqId, artifact): Promise<void>` (append, cap to a sane max e.g. 50, drop oldest beyond the cap).
- `deleteArtifact(fileService, username, seqId, artifactId): Promise<void>`.
- A small `isArtifactStale(artifact, currentSequenceVersion): boolean`.
- Unit-tested with a mock fileService (like `enzyme-sets.test.ts`).

## Save points

- ALIGN: when `CompareSequencesDialog` finishes a comparison, save an `alignment`
  artifact (title + summary from the compare result, `result` = the formatted
  alignment, `inputs` = the reference + algorithm). Do not change the dialog's
  existing behavior, just also persist.
- FIND DOMAINS: when the domain scan completes (the InterProScan / HMMER flow
  behind `openProteinDrawerForFeature` / the protein drawer), save a `domains`
  artifact (the hit list + the feature scanned).
- Saving is best-effort and never blocks or breaks the operation; a failed write
  shows a calm toast, not an error.

## History tab "Results" section

In `SequenceHistoryPanel`:

- A "Results" group listing the artifacts (newest first). Each row: a type icon
  via `<Icon>` (alignment -> `align`, domains -> `protein`), the title, the
  summary, the relative time, and a STALE chip when the sequence has changed
  since (the lineage version no longer matches the live sequence).
- Row actions: OPEN (re-render the saved result, re-open the Compare dialog
  seeded with the stored alignment, or the domain list, in a read view), and
  DELETE (with the standard confirm/undo affordance if cheap, else a confirm).
- A calm empty state ("Run an analysis and its result is saved here") so the
  section teaches itself, part of the richer-empty-state goal.

## Constraints

- Icons via `<Icon>` only (the guard blocks new inline svgs). Voice rules (no
  em-dashes, en-dashes, emojis, mid-sentence colons). Dark-mode tokens.
  `<Tooltip>` not native title=.
- Additive and best-effort: never regress Align or Find domains; saving an
  artifact is a side effect that fails quietly.
- Re-opening a STALE artifact still works (it is a snapshot); the stale chip just
  signals the sequence moved on, with a "re-run" affordance.

## Out of scope for v1 (future)

Tree snapshots, digest/gel artifacts, cross-sequence result shelves, exporting an
artifact. The model leaves room (the `type` union + the self-contained `result`).
