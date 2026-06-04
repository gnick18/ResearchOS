# Cross-Boundary Sharing, Standalone Methods

How to let a user send ONE method on its own across folders, the lighter sibling of experiment sharing. Experiment sharing already shipped and it bundles every method an experiment references, so the method packaging plus the structured-protocol id-remap already exist and are tested. This tier wraps the same packaging in the same relay transport, with a method-shaped send entry and a method-aware inbox dispatch. It is small precisely because almost nothing here is new.

This is the design contract for the standalone-method build. It assumes the experiment-sharing work (`CROSS_BOUNDARY_SHARING_EXPERIMENTS.md`) has landed, the inbox dispatch-by-type seam exists, and the two import gaps (dependencies, shared-method ownership) are already fixed.

---

## Scope

Send exactly one method to one recipient as an encrypted snapshot, the same copy-not-live model as notes and experiments. The payload carries everything that makes the method whole on the other side,

- the method record itself (`Method`, including `method_type`, `folder_path`, `tags`),
- its body, the markdown file for a `markdown` method or the PDF file for a `pdf` method,
- its structured protocol record if any, the PCR / LC gradient / plate / cell culture / mass spec / coding workflow / qPCR analysis record the `source_path` points at,
- its bundled `source_pdf_path` file if present (the kit source PDF),
- its `components` if the method is `compound`, plus each referenced child method packaged the same way.

Out of scope, an experiment, a project, multiple methods at once (bulk is N independent single-method sends per the roadmap), and live collaborate mode.

---

## Reuse, extract the method-packaging slice, do not build a method-only export

The experiment export already packages methods. `export/raw.ts` walks `payload.methods` and, per method, writes `methods/method-<id>.json` plus the body `.md`, the per-type protocol JSON (`method-<id>-pcr-protocol.json` and the six siblings), and the bound attachment file. `import/parse.ts` reads those exact path patterns back into per-method maps, and `import/apply.ts` recreates each method with id-remap, creating a fresh protocol record and rewriting `source_path` to `pcr://protocol/<newId>` (and the six siblings) so nothing dangles. That is the entire job for a standalone method, already written and test-guarded.

The cleanest reuse is therefore NOT a brand-new method-only export format. It is a thin method-only ENTRY that produces the same `researchos-experiment` bundle the import pipeline already reads, carrying just the one method (and its compound children) instead of a task subtree. Concretely,

- Reuse `extract.ts`'s `buildMethodPayload` / `extractMethodPackage` to turn a `Method` into a `MethodPackage` (record + body + protocol + attachment). This is the genuinely shared core.
- Reuse `raw.ts` to serialize those `MethodPackage` entries to the same `methods/method-<id>-*` layout, under the same `_export-manifest.json` envelope.
- Reuse `import/parse.ts` and `import/apply.ts` unchanged. They already resolve methods, recreate protocols, and remap ids. A bundle whose only content is methods is a strict subset of what they handle today.

The one wrinkle is that `extractMethodPackage` currently takes a `Task` so it can read per-task protocol OVERRIDES (the `pcr_gradient` / `pcr_ingredients` etc. on the task's `method_attachment`). A standalone method has no task and no overrides, we want the method's CANONICAL stored protocol, not a task-instance overlay. The protocol fetch helpers already key on `method.owner` first and only fall back to the task for shared methods, so the task argument is close to inert for an owned method. The recommended path is a task-less call shape (pass the method, no attachment, no overrides) so the bundle carries the method as it lives in the library. This is the only real adapter code in the whole tier.

Recommendation, add a small `lib/sharing/method-transfer.ts` adapter mirroring `experiment-transfer.ts`, with a `buildMethodSendPayload(method, currentUser)` that runs the task-less method extract plus the existing `raw.ts` serializer, and reuses `sealToRecipient` / `sendRawShare` verbatim. No new bundle format, no new importer.

---

## Send, a "Share outside this folder" entry on the method detail view

Mirror `ExperimentSendOutsideDialog.tsx` as a sibling `MethodSendOutsideDialog.tsx` (a separate component, do not edit the note or experiment dialogs). It is the same four-state identity gate (`useSharingIdentity`, launching `SharingSetupWizard` on `none`, pointing at recovery on `needs-restore`), the same recipient-email field, the same encrypted-copy-not-live copy, and the same sealed relay via `sendRawShare`. The only differences are the summary line ("Sending this method", the method name) and the payload builder (`buildMethodSendPayload` instead of `buildExperimentSendPayload`).

The entry point is the method detail view (`MethodLibraryDetail.tsx`), a "Share outside this folder" action next to the existing detail actions, opening the dialog with the selected method. Use the `Tooltip` component for any icon-only trigger and an inline SVG glyph (no icon library, no emoji), matching the experiment dialog's glyph set.

---

## Receive, define the method marker and reuse method resolution

The inbox sniffs the decrypted bytes because the relay is blind and stores no entity type. `sniffSharePayload` in `experiment-transfer.ts` returns `note | experiment | unknown` today, keying on disjoint zip markers, `_export-manifest.json` at root means experiment, a BagIt bag means note.

The problem, a standalone-method bundle reuses the SAME `_export-manifest.json` envelope as an experiment, so the current sniff would label it `experiment` and route it to the experiment import dialog. We need a marker that distinguishes a method-only bundle from a task bundle.

The cleanest method marker, the manifest field shape, not a new file. A task bundle's manifest carries `task_id` and `task_key`. A method-only bundle has no task. Define the method marker as a manifest with NO `task_id` (or, more explicitly, a `kind: "method"` field the method entry stamps and the experiment entry omits). The sniff then reads the manifest and returns `method` when there is no task, `experiment` when there is. This keeps the disjoint-marker discipline the experiment sniff already uses, it just reads one manifest field instead of only checking the file's presence.

Receive flow,

1. Inbox row shows it is a method (the dispatch-by-type seam from the experiment work, extended with a `method` case).
2. Review fetches and decrypts, then hands the bytes to the method import path. This reuses `import/parse.ts` + the method-resolution slice of `import/apply.ts` so each structured protocol is recreated under a fresh id and the new method's `source_path` is rewritten (`pcr://protocol/<newId>` and siblings). Markdown and PDF bodies are written to `methods/<slug>/...` and `source_path` set, exactly as the existing import does.
3. The method lands as the recipient's own LOCAL method (`is_public: false`, `owner` = recipient). No dangling foreign owner, the same localization invariant the experiment Gap 2 fix already guarantees.
4. Ack the relay only after the method is on disk (ack-after-write, same as notes and experiments).

A method-only bundle has no project and no task, so the experiment review's project + per-method resolution UI is heavier than this tier needs. The lightest path reuses the method-resolution helper directly (recreate the one method and its children, import-new) rather than driving the full experiment dialog. If reusing the experiment dialog's machinery is cheaper than a dedicated mini-flow, a single-method bundle would surface as one method to resolve with no project step, that is a build-time call, but the underlying resolver is the same code either way.

---

## Structured-method specifics

For `markdown` and `pdf` methods this tier is trivial, the bundle carries one body file, import writes it and sets `source_path`, done. The real work is the structured types and it is already done by the existing import.

- Protocol-store indirection, a structured method's `source_path` is a pointer like `pcr://protocol/<id>` into a SEPARATE store, not inline data. The export bundles the referenced protocol record; the import recreates it under a new id and rewrites the pointer. This is the existing `import/apply.ts` per-type branch (seven types), reused unchanged.
- id-remap, the recreated protocol gets a fresh id in the recipient's namespace, the new method record points at it. Already handled.
- Public-vs-private store on import, every imported method is created `is_public: false`, a private method in the recipient's own library. This matches the experiment import and is correct for cross-boundary, the recipient is not in the sender's lab, so a method must localize, never reference a foreign or public owner the recipient cannot resolve.

### Compound / components

A `compound` method's `components` array references child methods by `(method_id, owner)`. Sharing the compound standalone means the children must ride along, the same way an experiment carries every method it references. The bundle must include each child method package (record + body + protocol + attachment) AND the compound itself, then the import must,

1. recreate each child first (id-remap, fresh protocol per child),
2. recreate the compound, rewriting every `components[].method_id` to the child's new local id and resetting `components[].owner` to null (same-user-as-compound), so no child reference points at a foreign owner.

Confirm whether the existing experiment export already walks a compound's children into `payload.methods` (an experiment that attaches a compound would need this), and whether `import/apply.ts` rewrites `components` on recreate. If the experiment path already covers compounds, this tier inherits it for free. If experiment shares never exercised a compound child, the components walk-and-rewrite is the one piece of genuinely new logic here, and it should be test-guarded the same additive way the experiment gaps were.

---

## Edge cases

- A method that references another method (compound components), covered above, children bundle and id-remap, owner resets to null. A non-compound method does not reference other methods, so this is compound-only.
- `source_pdf_path` present (kit-bundled source PDF), the bundle must carry that file alongside the structured protocol and the import must rewrite `source_pdf_path` to the recipient's local path. Verify the experiment export already carries `source_pdf_path` files; if not, this is a small additive carry mirroring the body-file handling.
- `method_type` variants, all of `markdown | pdf | pcr | lc_gradient | plate | cell_culture | mass_spec | compound | coding_workflow | qpcr_analysis` are already enumerated in both export and import. A `null` method_type or a missing body should import as a bare record with a warning, never block the whole share.
- Sharing a method the SENDER does not own (a public or shared-with-them method showing in their library), the export must read it via `method.owner` (public or the original owner), and the import still localizes it to the recipient. This mirrors the experiment Gap 2 fix exactly.
- A structured method whose protocol record failed to bundle, drop with a clear warning rather than importing a method that points at a nonexistent protocol, the existing import already skips-with-warning in this case.

---

## Phasing, mostly reused

Genuinely new,

1. `lib/sharing/method-transfer.ts`, the task-less `buildMethodSendPayload` adapter (task-less method extract + existing `raw.ts` serializer). Small.
2. `MethodSendOutsideDialog.tsx`, a near-copy of `ExperimentSendOutsideDialog.tsx` with the method summary and method payload builder. Small, mostly mechanical.
3. The send entry on `MethodLibraryDetail.tsx`. Tiny.
4. The method marker in the sniff (`task_id` absence or `kind: "method"`) and the inbox `method` dispatch case. Small.
5. Possibly, the compound components walk-and-rewrite and the `source_pdf_path` carry, IF the experiment path did not already exercise them. Test-guarded and additive.

Reused unchanged,

- the relay, encryption, identity, inbox shell (notes work),
- the export method packaging in `raw.ts` and the method extract in `extract.ts`,
- `import/parse.ts` and the method-resolution slice of `import/apply.ts`, the id-remap, protocol recreation, source_path rewrite, and the localization invariant,
- the dispatch-by-type inbox seam (experiment work).

This is the smallest tier in the arc, the hard part (composite packing plus structured id-remap) was paid for by the local export/import feature and again by experiment sharing.

---

## Open questions for Grant

1. Receive UX, drive the existing experiment import dialog with a method-only bundle (one method to resolve, no project step), or build a lighter dedicated single-method import flow? The resolver code is the same either way; this is purely the review surface.
2. Compound coverage, do we ship compound-method sharing in this tier, or defer compounds to a follow-on and ship markdown / pdf / single-structured first? Compounds are the only piece that might need new walk-and-rewrite logic.
3. Method marker, prefer the implicit signal (no `task_id` in the manifest) or an explicit `kind: "method"` field stamped by the method send path? The explicit field is clearer for future tiers (project) but touches the manifest type.
