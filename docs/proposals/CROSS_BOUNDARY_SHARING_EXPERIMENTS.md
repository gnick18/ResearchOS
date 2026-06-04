# Cross-Boundary Sharing, Experiments (and Methods riding along)

How to extend cross-boundary sharing from notes to experiments, and why this mostly means wrapping a system the app already has rather than building a new one. Decisions locked by Grant 2026-06-04, experiments first (methods ride along), and fix the two import gaps (dependencies, shared-method ownership) before shipping.

This is the design contract for the experiment-sharing build. Notes sharing is already live; this reuses the relay, encryption, identity, and inbox shell from that work.

---

## The core insight, the hard part already exists

ResearchOS already has a full experiment **export/import** system, and it does almost exactly what cross-boundary experiment sharing needs.

- `frontend/src/lib/export/raw.ts` packages an experiment as a `researchos-experiment` bundle, the task record, its notes and results markdown plus all their file and image attachments, and every method the experiment references (each method record, its protocol record for PCR/LC/plate/cell-culture/mass-spec/coding-workflow/qPCR, its body or PDF), plus an export manifest.
- `frontend/src/lib/import/parse.ts` validates and parses that bundle into an `ImportPayload`.
- `frontend/src/lib/import/apply.ts` (`applyImportPlan`) re-materializes everything into another user's folder with full id-remapping, a fresh task id, project resolution (use-existing / import-new / no-project), per-method resolution (use-existing / import-new / skip), method-attachment remapping, and writing all the attachments. The interactive resolution UI for those choices already exists.

So an experiment is a composite, but the composite packing plus id-remap (the genuinely hard part) is already built and tested for the local export/import feature. Cross-boundary sharing wraps it.

### Methods ride along

Because the experiment package already includes and re-imports the experiment's referenced methods, sharing an experiment transitively shares its methods. Standalone "share just one method" then becomes a small follow-on that reuses the same method packaging and import helpers, which is why it can come later cheaply rather than as a separate hard build.

---

## Approach, wrap the existing export/import in the relay transport

The transport we built for notes (relay routes, sealed-box encryption, identity, inbox shell) is format-agnostic, it moves opaque sealed bytes. So experiments reuse the transport but carry a different payload, the existing `researchos-experiment` export bundle, sealed.

Notes keep their RO-Crate-in-BagIt bundle path (already built). Experiments and methods use the existing export format, sealed and relayed. The relay does not care which; the inbox dispatches on entity type when importing.

### Send flow (experiment)

1. From an experiment, "Share outside this folder" (the same entry-point pattern as notes, on the task detail view).
2. Produce the existing export bundle for that task (reuse `export/raw.ts`).
3. Seal it to the recipient's key (`sealToRecipient`) and relay it (`sendShare`), exactly as notes do, just with `entityType` "experiment" and the export bundle as the payload bytes.

### Receive flow (experiment)

1. Inbox, Shared-with-me tab, the row shows it is an experiment.
2. Review fetches and decrypts, then instead of the one-click note import, it hands the decrypted export bundle to the **existing import resolution flow** (parse, then the existing project + per-method resolution UI), then `applyImportPlan`.
3. Ack the relay after the import resolves (same ack-after-write rule as notes).

This is more steps than a note import (the user picks a project and resolves methods), but every one of those steps already exists in the import feature. We are wiring it into the inbox review, not building it.

---

## The two gaps to fix first (Grant, 2026-06-04, fix both now)

The existing import was built for same-app export/import, so two behaviors need correcting for cross-boundary use.

### Gap 1, task dependencies are not carried

Task-to-task dependencies (parent/child links, finish-start etc.) live in separate `users/<owner>/dependencies/<id>.json` records and are NOT in the export bundle. Sharing a single experiment would silently sever its links.

Handling,
- Include the shared task's dependency records in the bundle.
- On import, remap a dependency only when BOTH endpoints exist in the recipient's import (both tasks were shared together). For a single-experiment share the other endpoint is usually absent, so the dependency cannot be recreated.
- When an endpoint is missing, DROP the dependency and tell the user clearly ("this experiment had a link to another experiment that was not included; the link was not carried"), never silently sever. Full dependency carry across a multi-experiment or project share is a later tier.

### Gap 2, references to a shared method break

When an experiment references a method owned by someone else (a shared or public method in the sender's lab), the export bundles that method's content, but the current import resets `method_attachments[].owner` to null, assuming every imported method was authored locally.

Handling for cross-boundary,
- Every method the experiment references is bundled (content included) and re-imported as the RECIPIENT's own local method, with the reference remapped to the new local id. This is correct for cross-boundary, the recipient does not have the sender's lab-mate, so the method must become local, not dangle pointing at a foreign owner.
- The fix is to guarantee no imported `method_attachment` or `method_ids` entry is left pointing at an owner the recipient cannot resolve, every referenced method is either localized (bundled and recreated) or, if somehow not bundled, dropped with a warning. No dangling foreign-owner references.

Both fixes touch the existing export/import code (`export/raw.ts`, `import/parse.ts`, `import/apply.ts`, the import/export types). Because that code also powers the existing local export/import feature, the changes must be additive and guarded by tests that pin the current local behavior so nothing regresses.

---

## The one coordination point, inbox dispatch by type

The inbox review-and-import modal (`SharedWithMeTab.tsx`) currently handles only `entityType` "note" and shows "Unsupported item type" otherwise. Adding experiments (and later methods) means the modal must dispatch by entity type to the right importer, note to `importNoteBundle`, experiment to the existing import-resolution flow. Do this dispatch refactor as a thin shared pass first so the experiment work and any later method work plug into it without colliding.

---

## Scope and sequencing

In scope now,
1. Extend the existing export/import for the two gaps (dependencies, shared-method ownership), test-guarded so the local export/import feature does not regress.
2. The experiment send entry point (task detail view) and the send wrapper (export, seal, relay).
3. The inbox dispatch-by-type refactor, plus wiring the existing import-resolution flow into the experiment receive path.

Follow-on (smaller, after the above),
4. Standalone "share a single method" reusing the method packaging and import helpers.

Out of scope,
- Multi-experiment and full-project shares (a later tier; full dependency carry belongs there).
- Live collaborate mode (separate roadmap feature).

The relay, encryption, identity, inbox shell, and the two queued notes follow-ups (phantom rows, attributed look) are unchanged by this work.
