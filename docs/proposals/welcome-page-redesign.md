# Welcome page redesign (video-driven, modern rebuild)

Status: READY for review. Feature picks and shot list LOCKED by Grant 2026-06-04. Aesthetic, video-technical, inspiration, and sequencing sections are filled from the launch-page design research (`docs/research/launch-page-design-research.md`). One open decision remains for Grant: dark-first vs light (see Aesthetic direction).

## Goal

Rebuild the public welcome / sell page (`/welcome`, `frontend/src/components/landing/LandingPage.tsx`) from scratch. Way more modern, and it sells the actual tools through autoplaying silent looping demo videos plus tight screenshots. We do not list every feature. We lead with the few that make a researcher go "I have to try this," and trust them to discover the rest once they are in.

## What we keep (working today, do not throw away)

- The comparison section (ResearchOS vs LabArchives vs SnapGene, honest, features + price). Grant likes it. Carry it forward, restyle to the new aesthetic.
- The hero welcome mechanic: the BeakerBot mascot that waves on land then settles into its living idle, the soft rainbow bloom, the thin rainbow ribbon at the top edge. Grant likes how this reads. Keep the soul of it, modernize the frame around it.
- The two-path sign-in model already built (Google / GitHub for sharing-inbox-collab vs "use locally without an account"). The new page must preserve BOTH paths clearly. The notebook needs no account. Sign-in is only for sharing, inbox, and collaboration.

## What we rebuild

- The flat feature-card grid (eight `FeatureCard`s in a flex-wrap) and the alternating `HeroBand` / `IllustratedBand` image-text bands. These are static screenshots and inline-SVG placeholders. They get replaced by a curated set of video-led showcases for the locked hero features only.
- Overall layout, type scale, motion, and section sequencing move to the modern direction the research recommends.

## Feature prioritization (LOCKED, Grant 2026-06-04)

### Hero showcases (each gets a full demo video, top-billing)

1. **Sequence / plasmid editor.** SnapGene-style cloning and circular plasmid maps, free and built in. The single strongest "oh my gosh" for molecular biologists who pay hundreds for SnapGene.
2. **You own your data.** Everything is a plain folder on your own machine. Local-first, private, no lock-in. The trust-flip vs LabArchives and cloud ELNs.
3. **Replaces 5 tools.** Notebook + methods + Gantt + purchasing + calendar in one workspace. The all-in-one story.
4. **Preloaded biotech methods library.** The method catalog ships real, structured protocols (PCR, qPCR, LC-MS kit templates, more) with bundled source PDFs. "It already knows how to run my experiment" out of the box.
5. **Live collaboration (COMING SOON teaser).** Google-Docs-style real-time editing via the unified CRDT model. NOT built yet (deep research in flight). Gets a "coming soon" showcase slot, not a present-tense claim. Frame as on the roadmap so we do not overpromise.

### Secondary loops (smaller demo loops, second tier)

6. **Snap from the bench.** Phone photos and notes over Telegram land in the notebook inbox, ready to attach.
7. **PI Lab Overview.** Live bird's-eye dashboard of every member's projects, funding, progress. Sells the tool to the decision-maker.
8. **NIH compliance + Zenodo.** Data-management compliance and Zenodo deposit with grant metadata. Sells to anyone under an NIH data-sharing mandate.

### Dropped from the hero set (still discoverable in-app, may appear in comparison / smaller mentions)

- Protocols-do-the-math (PCR auto-scaling): folds into the methods-library showcase rather than standing alone.
- Cross-boundary encrypted sharing: keep as a supporting mention near the sign-in paths, not a hero loop.
- Gantt, Purchases, Search, Calendar, LabArchives import, comments: these populate the "Replaces 5 tools" montage and the comparison, not standalone heroes.

## Shot list (what Grant records / captures)

Grant records his own screen doing each action. Capture in FIXTURE mode only (`?wikiCapture=1`), never real data. Each clip should be short (target 6 to 12 seconds), silent, loopable (start and end on a calm frame so the loop seam is invisible). Final encoding spec comes from the research section.

### 1. Sequence / plasmid editor (HERO)
- Video A: open a plasmid, the circular map renders with colored feature arcs, hover a feature to see its annotation.
- Video B: a cloning action (drop in a fragment / pick a restriction site) and the map updates live.
- Screenshot: a clean circular map with several annotated features and restriction ticks (for the poster frame and reduced-motion fallback).

### 2. You own your data (HERO)
- Video: the folder picker connecting a local folder, then the OS file browser showing the plain folder of files (notes, images) sitting on disk. The "it is just my folder" reveal.
- Screenshot: a Finder window of the data folder next to the app showing the same content.

### 3. Replaces 5 tools (HERO)
- Video: a montage cutting fast between Workbench (notebook entry), Gantt timeline, Methods, Purchases dashboard, Calendar. One smooth tour that lands the all-in-one point in one breath.
- Screenshots: one clean frame of each of the five surfaces for a bento fallback grid.

### 4. Preloaded biotech methods library (HERO)
- Video: open the method catalog, pick a kit template (e.g. an LC-MS or PCR template), the structured protocol fills in, then the PCR reaction-mix math auto-scales as you change sample count.
- Screenshot: the catalog grid + one opened structured protocol.

### 5. Live collaboration (COMING SOON teaser)
- No recording yet (not built). Use a tasteful "coming soon" visual: a mock of two cursors editing one note, clearly badged as on the roadmap. Revisit once the CRDT collab MVP ships.

### 6. Snap from the bench (SECONDARY)
- Video: a phone screen sending a photo over Telegram, cut to the photo landing in the notebook inbox, then attaching it to an experiment.
- Screenshot: the inbox with a captured photo.

### 7. PI Lab Overview (SECONDARY)
- Video: the PI dashboard with member tiles, funding, progress, maybe reconfiguring a widget.
- Screenshot: the default PI lab-overview dashboard.

### 8. NIH compliance + Zenodo (SECONDARY)
- Video: the Zenodo deposit flow, picking files, filling grant/ORCID metadata, the deposit confirming.
- Screenshot: the deposit dialog with metadata filled.

## Page structure (research-backed sequence)

The research-recommended converting order is hook to proof to action. Adapted to ResearchOS top to bottom:

1. **Hook headline + subhead.** Short concept-first headline (under ~44 chars), one-sentence what-it-is subhead, the two sign-in paths visible immediately. Keep the BeakerBot welcome mechanic and rainbow bloom as the brand frame around it.
2. **Hero demo loop.** ONE silent real-UI loop directly under the headline, framed in a browser-chrome / app-window mockup. This is the most important single asset on the page. Candidate: the lab notebook in motion, or a project opening from a plain folder on disk (the "this is real and it is mine" moment). Decide the exact clip with Grant.
3. **Credibility strip.** ResearchOS has no enterprise logos, so substitute honest credibility: built by researchers for researchers, university fellowship backing, open-source and auditable, a real lab using it. Trust substitutes are essential for an unknown brand.
4. **Hero feature showcases (bento grid).** The locked hero features, video-led, each cell = one verb-led plain claim + one real loop. Lead features get large cells with full loops. This is the structural cure for the flat-feature-inventory anti-pattern.
5. **The "you own your data" differentiator block.** Its own dedicated section, not a footnote. Plain folder you own, runs locally, private by default, free and open source funded by a fellowship. The LabArchives trust-flip. The research is emphatic this is load-bearing and deserves its own confident section.
6. **Secondary loops** (snap-from-bench, PI overview, NIH/Zenodo), lighter treatment: compact bento tiles with a small loop or annotated still, Raycast's "and a lot more" model.
7. **Live-collaboration coming-soon teaser.** Badged as on the roadmap.
8. **Comparison** (kept, restyled). Keep it gracious and concept-first, not a combative matrix.
9. **Final CTA** reinforcing both paths (sign in for sharing, or just start locally), free and open. Same single primary action repeated down the page, never a pricing or demo-request fork.

## Voice and copy rules (every section, every sub-bot brief)

- No em-dashes, no emojis (every icon is an inline SVG, no lucide), no mid-sentence colons. Contractions are good. Concept-first, warm.
- BeakerBot is the only mascot.
- The notebook needs no account. Sign-in is only for sharing, inbox, and collaboration. Repeat this wherever sign-in appears so local-only users never feel gated.
- The local-first notebook is free and open source, funded by a university fellowship and donations. No per-seat fees, every feature is free. The only paid part is optional cloud storage above a free pool. Never say "free forever" about the cloud, never promise "never charge," and do not write "no paid tier." Canonical billing copy: docs/branding/BILLING_FACTS.md.

## Aesthetic direction

Full analysis in `docs/research/launch-page-design-research.md` section 3. The research recommendation:

- **Dark-first hero** with a calibrated palette and one confident accent. Lean into the existing BeakerBot sky-blue so brand and page agree.
- Oversized, assertive, concept-first headline type.
- **Real-UI loops in browser-chrome framing** (the credibility move), NOT abstract gradient backgrounds.
- Bento feature grid. Monospace accents on technical specifics (file paths, recipe values, sequence bases).
- Restrained gradient atmosphere. **Avoid mesh-gradient maximalism** (the Superhuman direction) and dopamine color, both read slick rather than sincere and can undercut scientific trust.
- **Lighter, clean sections for the trust/differentiator and CTA blocks** so the page is not one dark slab.

The biggest ResearchOS-specific risk the research flags: the page looking too slick to be a sincere free academic tool. The whole direction leans concept-first and real-UI-forward to counter that.

DECIDED (Grant 2026-06-04, then REVERSED same day): **light**, not dark. Grant first picked dark-first from the mockups, then after seeing the built `/welcome-preview` with real video decided he wants the page LIGHT. Clean white / pale-blue throughout (the `?v=light` mockup at `tools/welcome-mock/index.html`), keeping the rainbow ribbon + bloom + the real BeakerBot + the "actually own" rainbow-gradient headline word. The sky-gradient NIH band and any colored accent sections still pop against the light base. The earlier dark build is being converted to light.

### BeakerBot in the implementation (LOCKED)

- Use the **real, live `<BeakerBot alive />` component** (the one that waves on land then settles into its living idle), exactly like the current welcome page hero. Do NOT recreate BeakerBot as a static or hand-drawn SVG. The mockup's recreated mascot was a layout stand-in only.
- Keep his branding exactly as shipped: the **blue eyes**, the sky-blue stroke, the rainbow liquid. Do not restyle, recolor, or simplify him for the dark background. He renders on dark the same way the existing landing hero already handles it.

## Video technical implementation

From `docs/research/launch-page-design-research.md` section 2. The pattern is settled and cheap.

- Base element: `<video autoplay muted loop playsinline preload="metadata" poster="..." aria-label="...">` with sources inside.
- `muted` is mandatory (browsers block unmuted autoplay). `playsinline` mandatory for iOS Safari.
- `preload="metadata"` for the hero, `preload="none"` for below-the-fold loops (let IntersectionObserver trigger play).
- Every loop ships a compressed WebP/AVIF **poster** so the section paints instantly with no layout shift. The poster doubles as the `prefers-reduced-motion` fallback (show poster, not loop).
- Sources: AV1/WebM first then H.264/MP4 fallback, OR a single well-compressed H.264 MP4 for v1 simplicity. Always include the MP4. Strip the audio track during encode.
- **File-size budget: ~2 MB for a ~15s loop at 720p, ~3 MB ceiling. 720p, not 4K.**
- IntersectionObserver plays on scroll-in, pauses on scroll-out (threshold ~0.25). This is the main performance lever on a multi-loop page.
- WCAG 2.2.2: reduced-motion respect + a pause affordance on hero loops. Descriptive `aria-label` + adjacent text claim per loop.
- **Host the heavy MP4s OFF the git repo** (Vercel Blob or external CDN), never large files in `frontend/public`. Vercel explicitly warns against serving large video directly. The `next-video` component is a candidate but a hand-rolled `<video>` + IntersectionObserver is light enough to make it optional.
- Lazy-mount below-the-fold loops so initial paint stays fast. Test on modest lab hardware.

## Inspiration pages (shortlist)

From `docs/research/launch-page-design-research.md`. Direct design inspiration, ranked:

1. **Linear** (linear.app) — closest structural match by far. Silent real-UI hero loop, browser-chrome credibility, dark calibrated palette, bento feature tour, social proof below the tour, single confident CTA. Copy the structure, adapt the palette to BeakerBot sky-blue.
2. **Cursor** (cursor.com) — best reference for sustaining a long video-forward page without monotony (hero loop + per-feature loops, varied framing).
3. **Raycast** (raycast.com) — the "lead features get full loops, everything else gets a compact tile" model for our secondary loops. Tasteful glass + monospace accents.
4. **Vercel** (vercel.com) — restraint reference, proof that not every cell needs a video (a crisp animated illustration can carry one).
5. **A local-first competitor** (Anytype / Logseq) — for positioning language only, not visuals. Borrow the trust vocabulary (data ownership, privacy by default, open-source auditability, no lock-in) and out-warm it.

## Open questions / risks

- **Dark-first vs light** (the one design decision left). Research leans dark hero + lighter trust/CTA sections. Recommend rendered mockups so Grant picks from real options. See Aesthetic direction.
- **Live collaboration "coming soon."** Confirm Grant is comfortable teasing an unshipped feature on the public page, and the exact wording.
- **Video production load.** Eight features is a lot of recording. Stage it: ship the page with the hero loops first, add secondary loops as Grant records them. Posters/screenshots stand in until each video exists.
- **Video hosting (resolved by research):** heavy MP4s go OFF the git repo, on Vercel Blob or an external CDN, never large files in `frontend/public`. v1 can be a single well-compressed 720p H.264 MP4 per loop under ~2 MB.
- **"Too slick to be sincere" risk.** The research's top ResearchOS-specific warning. Lean real-UI-forward and concept-first, avoid gradient maximalism.
- **Fixture coverage.** Some captures need seeded fixture data (PI dashboard, Zenodo metadata, Telegram inbox). Track which fixtures are missing before Grant records.
- **Performance on modest lab hardware.** The audience is not all on fast machines. Lazy-mount and test.

## Build plan (phased, after design doc sign-off)

1. Design doc finalized with aesthetic direction chosen by Grant.
2. Grant records the hero clips against the shot list (fixture mode).
3. Sub-bot builds the new page shell + hero showcases with the video pattern, posters as fallback.
4. Secondary loops and the coming-soon teaser added as clips arrive.
5. Verifier loop (mechanics + spec-compliance + fresh-eyes) per the post-redesign verification convention.
