# Cross-Boundary Sharing, Share-Type Roadmap

What kinds of things a user can send across folders, in what order we build them, and the one architectural decision (large-project packaging) that we want settled on paper before it forces our hand. Written 2026-06-03 while the notes-first send/receive is being built.

This is direction, not a build spec. Each tier gets its own focused build when we reach it.

---

## The invariant that makes this tractable

The transport does not care what it carries. The relay (send, inbox, fetch, ack) moves one opaque, encrypted blob per share, addressed to a recipient key, and the sealed-box encryption seals arbitrary bytes. The bundle format (RO-Crate inside BagIt) already declares `entityType` as `note | method | project`, so it was built with the bigger shares in mind from the start.

So the rails never need rearchitecting as shares get bigger. What changes per share type is only two things,

1. The OUTBOUND adapter, how we walk a thing and pack its records plus files into a bundle.
2. The INBOUND adapter, how we materialize that bundle into the recipient's folder, which for anything composite means allocating fresh ids and rewriting internal references.

The app already does id-remapping for its existing import feature (that is how a structured method imports today, recreating its referenced protocol under a new id and rewriting the pointer). Every composite share type reuses that machinery rather than inventing it.

---

## Two dimensions, kept separate

People say "share more" to mean two different things, and they need different builds.

**Bulk** is many independent items at once, three notes, a note and two methods. The clean model is N independent sends, each item becomes its own bundle and lands in the recipient's inbox as its own reviewable row. No all-or-nothing import, which fits the review-then-import model exactly. Bulk is mostly multi-select UI on top of the single-item send, so it is cheap and can land early.

**Composite** is one structured thing whose internals matter, an experiment with its results and notes, a project with its experiments and methods and files. A composite is genuinely one bundle, because the cross-references between its parts have to survive the trip. This is the substantive work.

---

## The tiers, in build order

### Tier 1, Notes (in build now)
A note is one record plus its image attachments under `notes/<id>/Images/`. Self-contained, no cross-references, no id-remap beyond the note's own id. This is the pipeline-proving tier and the target of the first live test.

### Tier 2, Methods (next, phase 2c)
A method is often a pointer. Structured methods (PCR, LC gradient, plate, cell culture, mass spec, and so on) keep their real data in separate protocol stores, with the method record holding a reference like `pcr://protocol/<id>`. Sending one correctly means bundling the referenced protocol too, and importing it means recreating that protocol under a new id and rewriting the reference. This is the first tier that needs id-remapping, and it reuses the existing import/apply machinery. Markdown and PDF methods are the easy sub-case (just a body file); structured methods are the work.

### Tier 3, Experiments
An experiment (a task) is a small composite, the experiment record plus its child notes, result files, and images. Same shape as a project but smaller, so it is the natural stepping stone, walk the experiment subtree, pack records plus files, remap ids on import. Proves the composite path at a manageable size before projects.

### Tier 4, Projects (the big one)
A project is the whole subtree, experiments, notes, methods, files. It is the largest and most-wanted share, and it is where two new problems appear that the smaller tiers never hit, scale (below) and import semantics (below).

---

## The architectural decision to settle now, large-project packaging

Today one share is one bundle, built in the browser, sealed in memory, and uploaded as a single R2 object. That is perfectly fine for a note, a method, or a modest experiment. A full project with many large image and PDF attachments can blow past browser memory and produce a single sealed blob that is unwieldy to build, upload, and re-download atomically.

The evolution, and the reason to design it before the project tier, is to move from one monolithic sealed blob to a **share manifest plus per-file sealed objects**. The manifest (itself small and sealed) lists the records and the file entries with their hashes and R2 keys; each large file is sealed and uploaded as its own object; the recipient pulls the manifest first, then streams the files it needs. This keeps memory bounded, makes uploads and downloads resumable, and lets the review UI show the project's contents before pulling gigabytes.

We do NOT need to build this for notes or methods. But we want the manifest shape decided now so the smaller tiers do not bake in assumptions (one-bundle-equals-one-object) that the project tier would then have to repaint.

Open sub-question for that design, do we always seal every file to the recipient, or seal a per-share symmetric key once and encrypt files under it (faster for many files, one wrapped key in the manifest). The latter is the usual answer for large multi-file payloads and is worth pricing when we design the manifest.

---

## The product fork to settle before the project tier

**Importing a whole project, does it always create a new project in the recipient's folder, or can it merge into an existing one?**

- Always-new is simple and safe, the project lands as a fresh project with remapped ids and a provenance marker, no conflict handling. Recommended starting point.
- Merge-into-existing is powerful (collaborators converging a shared project) but pulls in real conflict semantics, what happens when both sides edited the same note, how duplicates are detected, how versions reconcile. This is a substantial design in its own right.

Recommendation, ship always-new first (it covers "here is my project, take a copy"), and treat merge as a later, separately-designed capability if the need is real.

---

## Summary

| Tier | What it is | New problem it introduces | Reuses |
| --- | --- | --- | --- |
| Notes | record + images | none (pipeline proof) | - |
| Methods | record + body, or pointer to a protocol | id-remap for structured protocols | import/apply id-remap |
| Experiments | composite subtree (small) | walking a subtree, composite import | import/apply id-remap |
| Projects | composite subtree (large) | scale (manifest + per-file sealing), import semantics | import/apply id-remap, manifest format |
| Bulk | many independent items | none (multi-select + loop) | single-item send |

The rails are done and entity-agnostic. The roadmap is a sequence of richer adapters plus, at the project tier, the share-manifest packaging decided here.
