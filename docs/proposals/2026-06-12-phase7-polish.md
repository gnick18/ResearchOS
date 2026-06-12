# Phase 7, markdown embeds polish (decisions + build plan)

Status: design proposal, 2026-06-12 (orchestrator session). The markdown + ResearchOS embed system shipped Phases 0 through 6 (the embed renderers, editor + preview live preview, captions and numbering, backlinks, export baking, and the full share-with-dependencies arc). Phase 7 is the polish layer that makes embeds feel finished. It is design-heavy, so this doc lays out the forks for sign-off before any build, the same change-by-change review we used for Phase 6. The interactive version is `docs/mockups/2026-06-12-phase7-polish-decisions.html`.

Parent design: `docs/proposals/2026-06-11-markdown-embed-hybrid.md` (the Phase 7 section sketches all of this). BeakerBot author guide: `docs/proposals/2026-06-11-beakerbot-embed-integration.md`.

## The problem

The embeds we ship today are always live. That is right most of the time, and it is the reason collaboration and version control work for free. But a finished research tool needs a few more things. A figure pasted into a lab note on the day of an experiment should be freezable as a record of that moment, and it should tell you when its source has moved on. A standard protocol paragraph should be writable once and reused everywhere. An embed should let you flip how it is shown without editing markup. And not everything worth embedding lives in your library, a note often needs to cite a paper or point at a compound you have not saved. Phase 7 is those finishing moves, plus the cross-cutting mobile and accessibility pass so a shared note reads correctly on a phone.

Everything here preserves the core contract. The raw stays portable markdown (a real link or a real image), so collab merges, version-control diffs, and search keep working with no embed-specific code.

## Decisions

Each decision has a recommended option (the first one). Approve to take it, Modify with a note, or Reject to defer. I build exactly what you approve, in the recommended order below.

### P7-1 Pinning and the staleness badge

The fork is how a frozen embed stores the moment it captured.

- **A (recommended). Live by default, opt-in pin, resolve smartly.** An embed stays live unless the user pins it. Pinning adds `&pin=<isoTimestamp>` to the fragment. For a note (a type with version-control history) we resolve the source as of that timestamp from the existing Loro history, no new storage. For a type without history (a molecule depiction, a Data Hub figure) we store a small snapshot blob in a per-note sidecar `<note>.ros-embeds.json`, keyed by a short id the fragment points at (`pin=s_a1b2`). The raw link stays a valid live link outside the tool. A pinned embed shows a quiet "source changed since you pinned this" badge when the live source has moved on, with view-current and re-pin actions, so a frozen record never silently rots. FLAG, this adds a new per-note sidecar file (`<note>.ros-embeds.json`), a data-shape touch held for your verify.
- **B. Live only, no pinning.** Simplest, but there is no way to freeze a figure as a record of a day. The export-baking provenance stamp is the only freeze.
- **C. Snapshot everything always.** Every embed stores a blob at insert time. Heavier storage, and it throws away the live-update benefit that makes embeds worth having.

### P7-2 Transclusion, and how the raw stays portable

A note can transclude a section of another note, so a standard protocol paragraph is written once and reused everywhere, edit the source and every transclusion updates. The real design question is the raw syntax, because the whole system depends on the raw being a portable link.

- **A (recommended). Author with `![[note#heading]]`, store as a portable link.** The user types the familiar `![[note#heading]]`, and on save we normalize it to the standard form `[heading](/notes/ID#ros=transclude&section=heading)`, the same fragment grammar as every other embed. Rendered live, depth-guarded against loops. The raw stays a real link, so collab and version control and a plain markdown reader all keep working.
- **B. Keep literal `![[ ]]` in the raw.** Familiar to Obsidian users, but `![[ ]]` is not a portable link, it breaks the contract that the raw renders sensibly outside the tool and feeds collab and version control with no special code.
- **C. Whole-note transclusion only.** No section anchors, embed the whole note inline. Simpler, but the common case is reusing one paragraph, not a whole note.
- **D. Defer transclusion.** Ship the rest of Phase 7 without it.

### P7-3 In-place view switching

A sequence can show as a map, a feature ribbon, or raw bases. A table can show as a grid or a summary. Today the view is fixed by the fragment at insert time.

- **A (recommended). One-tap switch that persists.** A small control on the rendered embed flips the view, and we rewrite the `#ros=view` in the source so the choice sticks in the document. The author sets how each figure reads without touching markup.
- **B. Ephemeral switch.** The view flips on screen but does not save to the document. Lighter, but the next reader sees the original view, so it is a viewer convenience, not an authoring tool.
- **C. Defer.** Leave the view fixed at insert time, change it by re-inserting.

### P7-4 External and literature embeds

Not everything worth embedding lives in your library. These embed too, fetched and rendered, and they stay portable because the raw is still a link to a real external URL.

- **A (recommended). All four, cached for offline.** DOI and PubMed render a citation card (title, authors, journal, year), reusing the literature companion fetch path the chemistry papers panel already uses. A PubChem CID or a loose SMILES renders a structure card through the same RDKit path as a local molecule, with an "Add to my library" action. A bare URL gets a link-preview fallback. Fetched metadata is cached into the note sidecar so the card stays readable offline and the export bibliography writes itself from the citation embeds. FLAG, the metadata cache reuses the `<note>.ros-embeds.json` sidecar from P7-1.
- **B. Citations only this round.** DOI and PubMed cards now, PubChem and URL later. Smaller surface, gets the paper-citation case (the most common one) shipped first.
- **C. Defer.** No external embeds in Phase 7.

### P7-5 BeakerBot authoring

BeakerBot should insert real embeds when it composes a note, not plain text. The author and read guide already exists (`docs/proposals/2026-06-11-beakerbot-embed-integration.md`).

- **A (recommended). Relay the embed-authoring spec to the BeakerAI lane, gate on AI go-live.** Embed authoring lives in `lib/ai/tools/*`, which the BeakerAI session owns (I do not touch it). I hand them the spec and the existing guide so BeakerBot inserts embeds, and it ships when the AI billing arc ships, not before. This is a coordination item, not an embeds-team build.
- **B. Defer entirely until AI billing is live.** Revisit after the billing gate.

### P7-6 Mobile and accessibility

The cross-cutting finishing pass so a shared note reads correctly everywhere.

- **A (recommended). Read-only everywhere, plus an accessibility pass.** Every embed renders read-only at least on mobile and the companion, so a phone reads a shared note correctly. The accessibility pass gives each card a caption-derived alt text, a keyboard-focusable Open action, and ARIA roles, and respects reduced-motion.
- **B. Desktop first, defer mobile and a11y.** Ship the desktop polish now, do the mobile and accessibility pass as its own later round.

## Recommended build order

Core polish first, since it improves the embeds people already use, then expansion, then the cross-cutting pass.

1. **P7-3 in-place view switching.** Pure UI over the existing renderers, no data-shape, fast win.
2. **P7-1 pinning and staleness.** Introduces the `<note>.ros-embeds.json` sidecar that P7-4 also reuses, so it lands before external embeds.
3. **P7-2 transclusion.** Builds on the parser and the depth guard already in place.
4. **P7-4 external and literature embeds.** Reuses the literature companion fetch path and the sidecar cache from P7-1.
5. **P7-6 mobile and accessibility.** A finishing pass once the renderers are final.
6. **P7-5 BeakerBot authoring.** Relayed to the BeakerAI lane, ships on the AI timeline.

## Verification reality

P7-3 and P7-6 are orchestrator-verifiable (render and component tests). P7-1 pinning is verifiable for notes (version-control resolve) and for the sidecar round-trip, but the staleness badge against a live-moved source wants a real edit-then-reopen on your `:3000`. P7-4 external embeds need network, so the fetch path is testable with a mocked response, the real fetch is your manual check. P7-5 is the BeakerAI lane's verification, not ours.

## Pointers

- Parent design: `docs/proposals/2026-06-11-markdown-embed-hybrid.md`.
- BeakerBot author guide: `docs/proposals/2026-06-11-beakerbot-embed-integration.md`.
- The Phase 6 decisions doc and mockup, the template for this review: `docs/proposals/2026-06-12-phase6-share-with-dependencies.md`, `docs/mockups/2026-06-12-share-with-dependencies-decisions.html`.
- Running memory: `~/.claude/projects/-Users-gnickles-Desktop-ResearchOS/memory/project_markdown_embed_hybrid.md`.
