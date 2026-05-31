# ResearchOS roadmap

A living roadmap. A curated, honest subset surfaces on the welcome page (the "what we are building" section). No hard dates, nothing over-promised: a feature is listed only when we are confident in the direction. Shaped by what real labs ask for.

## Recently shipped
- Version history and restore on every record (Notes, Tasks, Projects), with 24h undo. Built in, not a paid add-on.
- Bulletproof template library: structured protocols bundled with the original vendor source PDF, so any value can be verified against the insert it came from (19 kit templates verified this round).
- Built-in lab calculators: molarity, dilution, serial dilution, primer Tm, DNA/RNA conversion, buffer recipe. Pure client-side, reachable from anywhere.
- Smarter reordering in Purchases: one-tap quick-reorder capture from anywhere (autocompletes from past purchases, drops into the needs-ordering queue), one-click buy-again on received items, and a reorder-suggestions widget that learns cadence from purchase history. Zero data-shape change, all on the existing PurchaseItem.

## In progress / near-term (confident)
- More structured protocol types: Western blot, spectrophotometry / Nanodrop, ELISA. Field specs designed (see COMPETITIVE_GAP_DEEPDIVE.md). Western blot establishes a shared antibody-application shape the others reuse.
- A growing template library across the thin categories: immunology, microbiology, protein biochemistry, nucleic-acid prep (a 45-template backlog; many ship as content with zero new code).

## Exploring / not committed
- Biological registries (plasmid, antibody) as a catalog of a lab's reusable materials (see INVENTORY_DESIGN.md section 6).
- Inventory list: explored in depth and SHELVED as a poor fit for small academic labs. Real labs run reactive "grab the last tube, reorder it"; a maintained stock list adds a logging step nobody sustains. The design and the reasoning are preserved in INVENTORY_DESIGN.md so we do not re-litigate it; the only surviving thread is the reorder polish above.

## Internal / NOT public (do not put on the welcome page)
- AGPL relicense + CLA activation: blocked on the Wisconsin LLC + the UW/WARF IP check (see project_llc_blocked_followups memory).
- Hosted pricing / founding-lab tier: Phase 2, after the LLC + a payment path exist (see SUSTAINABILITY_POSITIONING_BRIEF).

## Public subset for the welcome page
Recently shipped (version history, bundled-PDF templates, calculators) + in-progress (more structured protocol types, growing template library, smarter reordering). Framed as "what we are building, shaped by what labs ask for," with no dates and an invitation to suggest features. Keep the "exploring" and "internal" buckets OFF the public page.
