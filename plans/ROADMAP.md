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
- Lab inventory with barcode scanning: previously shelved as a poor fit (manual stock logging nobody sustains), but REOPENED 2026-06-05 based on multiple beta-tester requests and the mobile-app arc. The barcode-scan-to-log UX is meaningfully different from the manual stock list that was shelved and pairs naturally with a future mobile app. Design doc needed before building; the original analysis in INVENTORY_DESIGN.md stays as context.

## Big upcoming features (public roadmap)
These are the high-confidence direction items that surface on the welcome page and login screen. No hard dates. Listed only when direction is confident.
- Live real-time collaboration: Google-Docs-style simultaneous editing on notes, methods, and experiments. CRDT foundation (Loro) already building.
- Cross-lab sharing: send a note, method, or project to anyone by email — even a different lab with no shared folder. Encrypted relay, verified identity.
- NIH data sharing and Zenodo deposit: one-click deposit to Zenodo with grant number, ORCID, and DataCite metadata pre-filled. Supports NIH Data Management and Sharing Plan compliance.
- Lab inventory with barcode scanning: track reagents and consumables by scanning barcodes. Beta-requested; pairs with the mobile app.
- Mobile app: a full ResearchOS experience on iOS and Android, beyond the current Telegram bench-capture inbox.

## Internal / NOT public (do not put on the welcome page)
- AGPL relicense + CLA activation: blocked on the Wisconsin LLC + the UW/WARF IP check (see project_llc_blocked_followups memory).
- Hosted pricing / founding-lab tier: Phase 2, after the LLC + a payment path exist (see SUSTAINABILITY_POSITIONING_BRIEF).

## Public subset for the welcome page
Recently shipped (version history, bundled-PDF templates, calculators) + in-progress (more structured protocol types, growing template library, smarter reordering). Framed as "what we are building, shaped by what labs ask for," with no dates and an invitation to suggest features. Keep the "exploring" and "internal" buckets OFF the public page.
