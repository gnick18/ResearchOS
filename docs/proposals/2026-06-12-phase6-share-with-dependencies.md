# Phase 6, share a note with its embedded objects (build plan)

Status: decisions APPROVED by Grant 2026-06-12 (all 8 forks on their recommended option, approved in chat). Mockup that was marked up: `docs/mockups/2026-06-12-share-with-dependencies-decisions.html`. This is the last share-related phase of the markdown embed system. See `docs/proposals/2026-06-11-markdown-embed-hybrid.md` for the parent design.

House voice throughout: no em-dashes, no emojis, no mid-sentence colons.

## The problem

A note often embeds molecules, sequences, Data Hub results, or other notes. Sharing a note across labs today sends only the text, so the embeds land as dead links for the recipient. Phase 6 bundles the note and what it references into one sealed package, lets the sender trim the dependencies, and lets the recipient choose where each item lands.

## Approved decisions

- **D1 Bundling default.** Include every embedded object by default; the sender deselects anything private. Hard to under-share.
- **D2 Copy vs read-only.** Recipient gets a full editable copy with a received-from provenance stamp. Data Hub objects default to a frozen result snapshot unless the sender opts to send the full dataset (see D8).
- **D3 Import landing.** Per-item destination picker on accept, defaulting to a `Shared by <sender>` collection. Re-file later anytime.
- **D4 Dedup.** Detect duplicates by content identity (InChIKey for molecules, content fingerprint for sequences, source id otherwise) and offer Link existing instead of importing a second copy. Recipient decides per item.
- **D5 Portable identity.** Mint a stable id at object creation for the types that lack a natural key; molecules use InChIKey, sequences use their content fingerprint. Encode it in the embed `ref=` fragment so a received note resolves its embeds by identity, not by the sender's local numeric id. Lazy-backfill existing objects on read.
- **D6 No-access embeds.** Ship the calm name-only placeholder now. The Request-access round trip (notify owner, grant, re-light) is a later sub-phase.
- **D7 Same-lab shares.** No bundling when sender and recipient share a folder; embeds resolve natively. The dependency panel and import picker only appear for cross-boundary sends.
- **D8 Heavy objects.** Data Hub embeds ship as a frozen result or plot snapshot by default, with an opt-in to send the full editable dataset. Keeps shares within the relay payload cap.

## Build decomposition

- **6a Foundation (no UI, data-shape touch, hold for Grant verify).** Portable identity (`source_uuid` minted at creation for note/method/project/task/experiment/collection, lazy-backfilled on read; natural keys reused for molecule and sequence), a `portableIdentityFor(type, record)` helper, embed-href encoding of `ref=`, a unified `canViewObject(type, id, user)` permission helper consolidating the scattered per-type checks, and a `scanNoteDependencies(markdown)` that lists a note's embeds plus their identities. Built behind the lazy-normalize pattern (add field, normalize on read, never a hard cutover). This is the prerequisite for every layer below.
- **6b Sender dependency panel** (D1, D2, D8). The "This note references" include/deselect panel in the cross-boundary send dialog, the share-safety summary line, and the bundle-format extension to carry the selected objects' data plus portable identity. Data Hub objects bundle a frozen snapshot unless the full-data box is checked.
- **6c Recipient import** (D3, D4). The per-item destination picker on accept, the `Shared by <sender>` default collection, and content-identity dedup with a Link existing row.
- **6d Permission-aware embeds** (D6). The no-access placeholder in the embed renderers when `canViewObject` is false or the object did not arrive in the bundle.
- **6e Same-lab native resolution** (D7). Gate the dependency panel and import picker to cross-boundary sends only.

## Verification reality

- 6a is unit-testable (identity minting and backfill idempotency, `portableIdentityFor` per type, `canViewObject` per type, dependency scan).
- 6b and 6c touch the E2E relay and the seal-to-recipient path, which CANNOT be orchestrator-verified (needs two browsers plus the relay). Those land as build-then-Grant-tests, mirroring the collab work.
- Data-shape changes (6a) wait for Grant's verification before merging, per the standing merge-timing rule.
