# Launch Page Design Research

Deep web research brief for the ResearchOS public welcome / launch page redesign. The redesign goal is a modern, video-forward page built around autoplaying silent looping demos and real-feature screenshots. This document feeds the design doc. It does not touch code.

Compiled by the design-research sub-bot (branding arc). Research date 2026-06-04.

Voice note for whoever drafts the design doc from this. ResearchOS house style is no em-dashes, no emojis, no mid-sentence colons, warm and concept-first. The recommendations below are written to that standard so they can be lifted directly.

---

## Executive summary

The eight highest-leverage takeaways.

1. Lead with a single hero demo loop, not a hero video background. The strongest modern dev-tool pages (Linear, Cursor, Raycast) put one short silent product loop directly under the headline showing the real interface doing one real thing. It answers "does this actually work" before the visitor has to ask. Reported interactive-demo conversion is roughly 12 percent versus roughly 5 percent for a static hero image on 2025 B2B pages (Stackmatix). For an unknown academic tool where trust is the whole game, this is the single most important move.

2. Show the product, not abstraction. ResearchOS should avoid the AI-generated "abstract geometry fluid motion" hero-background fad. The audience is lab scientists who need to see the actual notebook, the actual folder, the actual sequence viewer. Real UI loops framed in browser chrome read as "this is a working tool," which is exactly the trust ResearchOS needs.

3. Use a bento grid for the 3 to 5 feature showcases, each cell pairing one short loop or annotated screenshot with one plain-language claim. This is the Apple-popularized, Linear-perfected pattern and it is the dominant 2025/2026 layout for exactly this job. It lets a few features breathe instead of becoming a flat feature inventory (the anti-pattern the house wiki voice already warns against).

4. Sequence the page hook to proof to action. The converting order is short headline, hero demo, immediate credibility strip, 3 to 5 feature showcases, the differentiator (local-first / privacy / free + open), then a final CTA. CTAs placed after social proof reduce perceived risk.

5. Technical pattern is settled and cheap. `<video autoplay muted loop playsinline preload="metadata">` with an MP4/H.264 source plus an optional WebM/AV1 source, a poster frame, IntersectionObserver to only play in view, a `prefers-reduced-motion` static fallback, and a per-loop budget around 2 MB for a 10 to 15 second clip at 720p. This is well-trodden and Next.js documents it directly.

6. Dark-first is the modern default for dev tools, but it is a choice, not a law. Linear, Raycast, Warp, Cursor, Superhuman all lean dark with calibrated palettes, oversized type, subtle gradients, and monospace accents. ResearchOS can go dark-first for the launch page even if the app is light, but should weigh whether a clean light variant reads as more trustworthy and clinical to non-design-savvy scientists. Recommend a dark hero with lighter feature sections, or a confident single-mode choice, not a muddy middle.

7. The "sell" is "try this free tool," so the CTA is a download / get-started, not a demo request or pricing table. Drop enterprise-sales furniture entirely. The differentiator block (your data is a plain folder you own, free and open source, funded by a fellowship) is the trust-flip and should get its own dedicated section, not a footnote.

8. Keep performance honest. Multiple autoplay loops can tank load. Lazy-mount below-the-fold videos, ship poster frames so the page paints instantly, and host the heavy files off the critical path (Vercel Blob or an external CDN, not the git repo / public folder for large assets). Vercel explicitly warns against serving large video directly.

---

## Section 1. Best-in-class launch pages that lead with looping silent video demos

How the reference companies integrate video. Note that markdown scrapers flatten autoplaying `<video>` elements into "screenshots," so several findings below combine the live-page read with corroborating case-study and design-analysis sources.

### Linear (linear.app)

- Above the fold sits an embedded silent autoplaying loop of the real product interface (an issue like ENG-2703 moving through states), set directly under the headline "The product development system for teams and agents." Movement without sound draws the eye while the headline sets context (Stackmatix analysis).
- Below the hero, five workflow sections (Intake, Plan, Build, Diffs, Monitor) each pair descriptive copy with supporting product media, and a code-diff section uses monospace. Social proof (OpenAI, Ramp, Opendoor quotes plus "33,000+ product teams") sits below the feature tour, ahead of the final "Built for the future. Available today" CTA.
- Media is framed as browser-chrome-style product mockups showing real Linear dashboards, not polished marketing renders. This is the credibility move.
- Aesthetic is dark-themed, high-quality 2x CDN imagery, clean sans-serif, monospace for code, glowing borders. Linear is widely cited as the "gold standard" that thousands of startups copied for dark mode plus glowing borders plus bento feature grids (Onecodesoft, Senorit).
- Source. https://linear.app and https://www.stackmatix.com/blog/saas-landing-page-examples and https://www.onecodesoft.com/blogs/the-bento-box-effect-why-modular-grids-dominate-2025-design

### Cursor (cursor.com)

- Hero shows the "Cursor Desktop" interface with animated task states (In Progress, Ready for Review). Feature-specific demo loops appear throughout (a Mission Control interface with spring-based layout animations, a Slack integration demo, code-autocomplete sequences). The loops play within their own sections rather than as one continuous background video. This is the "hero loop plus per-feature loops" pattern.
- Media framing is varied and deliberate. Full-screen browser mockups with visible code files, floating cards for the Slack conversation, and immersive full-bleed demos with painted-landscape backgrounds. The mix keeps a long page from feeling monotonous.
- Sequence is hero plus CTA plus interactive demo, then agent value props, then feature deep-dives, then a dedicated five-testimonial social-proof band (Y Combinator, NVIDIA, OpenAI, Stripe), then capabilities and trust, then changelog, then CTA.
- Source. https://cursor.com

### Raycast (raycast.com)

- Heavy use of animated demo loops rather than static screenshots. A keyboard visualization animates keypresses, feature sections show real command flows. Dark-dominant with subtle glassmorphism (a blue glass backdrop on the Snippets section), gradient overlays, depth layering, monospace for code and keyboard references.
- Sequence is hero ("Your shortcut to everything" plus dual download CTAs), value prop, an Extensions carousel with category tabs, an AI feature block with a centered 3D cube and floating mobile mockup, a social-proof avatar carousel, three side-by-side feature showcases (Snippets, Quicklinks, Hotkeys), a 12-tile capability grid ("What else can Raycast do"), a community YouTube grid, a developer CTA, footer.
- The 12-tile capability grid is a clean model for "we do a lot more, here it all is" without drowning the lead features. Lead features get full side-by-side loops, everything else gets a compact tile.
- Source. https://raycast.com

### Vercel (vercel.com)

- Uses animated SVG illustrations with light/dark variants rather than full product-video loops, plus an interactive live code demo in the AI Gateway section (real model options, live ranking data) and an activity-pulsing globe in the footer. Oversized bold headlines, monospace code blocks, minimal grain, clean gradients, high contrast, system light/dark.
- Sequence is headline plus dual CTA ("Deploy" and "Get a Demo"), customer social proof with hard metrics, solution tabs, feature sections with illustrative visuals, a framework/template card showcase, final CTA, footer. Features arranged as distinct bento-like cards (Agents, AI Apps, Web Apps, Composable Commerce, Multi-tenant Platform).
- Takeaway for ResearchOS. Vercel shows that not every showcase has to be a video. A crisp animated illustration or a live mini-interaction can carry a cell. But ResearchOS has a strong real UI to show, so real loops should dominate over abstract illustration.
- Source. https://vercel.com

### Resend (resend.com)

- Developer-first, code-as-hero. Leans on visible code (SDK snippets across 9+ languages, OpenAPI specs), minimalist text-first aesthetic. Customer stories sit lower in the hierarchy.
- Takeaway. Code-as-hero is right for an API company and wrong for ResearchOS. The ResearchOS hero is a visual workspace, so the hero asset should be the workspace in motion, not a snippet. Keep Resend in mind only for the clean monospace-accent styling, not the structure.
- Source. https://resend.com

### Superhuman (superhuman.com), Warp (warp.dev), Framer-built sites

- Superhuman is gradient-rich, cursor-reactive mesh gradients on dark sections for a "futuristic, dreamlike" depth. Heavy aesthetic, light on raw product proof. Good reference for gradient craft, risky reference for a trust-first scientific tool (can read as slick rather than sincere).
- Warp centers a dark IDE-like interface with a block-based command UI, the canonical "developer tool landing page" dark treatment.
- Source. https://www.lapa.ninja/post/superhuman/ and https://getdesign.md/warp/design-md and https://www.framer.com/marketplace/components/gradient-pro/

### Cross-page pattern summary

- Format and length. Short loops, 10 to 30 seconds, silent, seamless. Background/ambient loops trend 15 to 30 seconds, focused product loops can be shorter.
- Behavior. Universally `autoplay muted loop playsinline`. Muted is mandatory or browsers block autoplay.
- Poster frames. Used so the section paints instantly and the wait feels shorter.
- Framing. The dominant credibility framing is real UI in a browser-chrome or app-window mockup (Linear, Cursor). Full-bleed immersive demos and floating cards are used for variety on long pages (Cursor). Floating cards work well for a single zoomed-in interaction.
- Hero loop vs feature loops. The best pages do both. One hero loop establishes "this is real," then a small number of per-feature loops in a grid or alternating side-by-side rows carry the feature story.

---

## Section 2. Video-in-landing-page technical patterns

Best practice for autoplaying silent looping demo videos on the web, 2025/2026.

### The base element

```html
<video
  autoplay
  muted
  loop
  playsinline
  preload="metadata"
  poster="/demos/notebook-poster.webp"
  aria-label="ResearchOS lab notebook editing a PCR recipe"
>
  <source src="/demos/notebook.webm" type="video/webm" />
  <source src="/demos/notebook.mp4" type="video/mp4" />
</video>
```

- `muted` is non-negotiable. Modern browsers block autoplay unless the video is muted (Cloudinary, MDN autoplay guide). Without it the loop will silently fail to start.
- `playsinline` is required for iOS Safari. Without it iOS forces fullscreen and breaks inline autoplay.
- `loop` for seamless repeat. `autoplay` to start without interaction.
- `preload="metadata"` for above-the-fold heroes (load enough to start fast without pulling the whole file). Use `preload="none"` for below-the-fold loops and let IntersectionObserver trigger the load/play. Reserve `preload="auto"` only for a hero you are certain will play.
- `poster` paints a still frame instantly so layout is stable and the wait feels shorter. Ship a compressed WebP/AVIF poster.
- Provide WebM/AV1 first and MP4/H.264 second. The browser picks the first it can play, so modern browsers get the smaller AV1/WebM and everything else falls back to the universally supported MP4. Always include the MP4 fallback.

### Codecs and formats

- MP4 with H.264 is the safe baseline that plays everywhere with hardware decode on essentially every device since 2010 (Practical Web Tools, Uploadcare).
- AV1 (in WebM or MP4 container) is roughly 50 percent smaller than H.264 and roughly 30 percent smaller than VP9 at equal quality, but some older devices cannot hardware-decode it and fall back to struggling software decode. Ship it as the first source with an H.264 fallback so modern hardware benefits and old hardware is unaffected.
- VP9/WebM is a middle option, smaller than H.264, broad but not universal support.
- Recommendation for ResearchOS. Dual source, AV1/WebM first, H.264/MP4 fallback. If toolchain simplicity matters more than the last 30 percent of bytes, a single well-compressed H.264 MP4 is perfectly acceptable and is what many shipped pages use.

### File-size budgets and encoding

- Target roughly 2 MB or less for a 15-second hero loop, with about 3 MB as the acceptable ceiling. Staying at 3 MB or less usually means keeping clips within 15 seconds (Zatta production-spec guide).
- 720p is the sweet spot for autoplay loops. It looks sharp and keeps bytes down. Avoid 4K for autoplay (file sizes explode, performance suffers). 1080p only if the clip is short and the detail genuinely matters.
- Reference encoding ladder rungs from Mux for demo video. 480p at ~1400 kbps, 720p at ~2800 kbps, 1080p at ~5000 kbps. For a silent UI loop you can often go below these because UI footage compresses well.
- Compress with FFmpeg. Two-pass H.264, tuned CRF, strip the audio track entirely (silent loops do not need it, and removing it saves bytes and avoids autoplay-policy edge cases).

### Lazy-loading with IntersectionObserver

Only play videos that are on screen. This is the single biggest performance lever on a multi-loop page. IntersectionObserver runs off the main thread, so it does not cause the jank old scroll listeners did, and it avoids loading video the user never scrolls to (LogRocket, Esau Silva).

Pattern (React-flavored, for the eventual Next.js implementation):

```tsx
// Observe the video, play when it crosses into view, pause when it leaves.
useEffect(() => {
  const el = videoRef.current;
  if (!el) return;
  const io = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) el.play().catch(() => {});
      else el.pause();
    },
    { threshold: 0.25 }
  );
  io.observe(el);
  return () => io.disconnect();
}, []);
```

- Combine with `preload="none"` so below-the-fold loops fetch only when approached.
- A threshold around 0.25 starts playback once a quarter of the loop is visible, which feels responsive without firing too early.

### Reduced-motion and accessibility

- Honor `prefers-reduced-motion`. Users who set "reduce motion" at the OS level should see a static poster, not an autoplaying loop. Either gate the autoplay in JS by reading `window.matchMedia('(prefers-reduced-motion: reduce)')`, or render the poster image instead of the video for those users.

```css
@media (prefers-reduced-motion: reduce) {
  /* show poster, suppress the loop */
}
```

- WCAG 2.2.2 (Pause, Stop, Hide). Content that auto-plays and lasts more than 5 seconds must offer a way to pause/stop it. A looping silent demo technically loops indefinitely, so provide an unobtrusive pause control or a global "reduce motion" respect path. The cleanest compliant approach is reduced-motion respect plus a small pause affordance on hero loops.
- Captions are for audio content. A silent UI loop has nothing to caption, but give each loop a meaningful `aria-label` describing what it shows (for screen-reader users), and provide an equivalent text claim adjacent in the layout (the feature copy already does this in the bento pattern).

### Next.js / Vercel specifics

- Next.js documents the `<video>` approach directly and recommends `autoPlay` always paired with `muted` and `playsInline`, plus `<track>` for captions and fallback content inside the tag (Next.js Videos guide).
- Do not commit large video into the repo / `public` folder. Vercel explicitly advises against serving large video directly because of bandwidth, and recommends Vercel Blob or an external host (Vimeo, Mux, Cloudinary, S3 plus BunnyCDN/CloudFront). Vercel Blob gives automatic CDN delivery.
- The open-source `next-video` component (next-video.dev) wraps `<video>` with automatic optimization, remote storage (Vercel Blob, S3, Backblaze, Mux), poster generation, and lazy behavior. Strong candidate to avoid hand-rolling all of the above, though a hand-rolled `<video>` plus IntersectionObserver is light enough that the dependency is optional.
- Sources. https://nextjs.org/docs/app/guides/videos and https://vercel.com/kb/guide/best-practices-for-hosting-videos-on-vercel-nextjs-mp4-gif and https://www.npmjs.com/package/next-video

---

## Section 3. Aesthetic direction trends for 2025/2026 dev-tool and SaaS launch pages

Concrete trend plus the company that exemplifies it, so a direction can be picked.

- Dark-first design. Calibrated dark palettes that hold contrast and build hierarchy without white backgrounds. Exemplars Linear, Warp, Raycast, Cursor. This is the default expectation for a "serious tool" in 2026 (Eloqwnt, Mockflow, DesignStudio).
- Oversized, assertive typography. Big confident headlines that set hierarchy instantly. Exemplars Vercel, Linear. Pairs naturally with dark mode for a modern striking feel (SaaSFrame).
- Subtle gradients and gradient mesh. Cursor-reactive or GPU simplex-noise meshes for depth on dark sections. Exemplar Superhuman (the gradient-mesh poster child), Framer-built sites. Use sparingly as atmosphere behind real content, not as the whole hero.
- Glassmorphism, alive but restrained. Frosted translucent panels for depth layering. Exemplar Raycast (blue glass Snippets backdrop). Status is "accent, not foundation" in 2026.
- Monospace accents. Mono type for code, shortcuts, file paths, technical labels signals "built for technical people." Exemplars Linear, Raycast, Resend, Vercel. ResearchOS can use mono for things like file paths, recipe values, sequence bases.
- Bento grids. Asymmetric modular cells of varying sizes for feature showcases. Exemplars Apple (popularized), Linear (perfected for dark technical UIs), Notion. The dominant feature-layout pattern for 2025/2026 (Onecodesoft, Senorit, Galaxy UX).
- Neo-brutalism and dopamine color. Bold borders, solid blocks, prominent shadows, saturated high-contrast palettes (electric purple, magenta, neon green). Exemplar trend-level across SaaS (Ariel Digital, SaaSFrame). Caution for ResearchOS. This reads as playful/consumer and can undercut scientific trust. Use a restrained version at most (one confident accent color), not full dopamine.
- Meaningful motion, not decorative motion. Hover effects, scroll progress, animated dashboards that communicate a feature instantly. "Minimal motion that adds meaning, not noise" is called out as one of the strongest 2026 trends (SaaSFrame). This is exactly the silent demo loop philosophy.

Recommended direction for ResearchOS. Dark-first hero with calibrated palette and one confident accent (lean into the existing BeakerBot sky-blue as the accent so brand and page agree), oversized concept-first headline, real-UI loops in browser-chrome framing, a bento feature grid, monospace accents on technical specifics, restrained gradient atmosphere on dark sections, and lighter clean sections for the trust/differentiator and CTA blocks so the page does not feel like a single dark slab. Avoid mesh-gradient maximalism and dopamine color, which would undercut the "real, trustworthy scientific tool" read.

Sources. https://www.eloqwnt.com/blog/saas-website-design-trends and https://mockflow.com/blog/saas-website-design-trends and https://www.saasframe.io/blog/10-saas-landing-page-trends-for-2026-with-real-examples and https://www.arieldigitalmarketing.com/blog/web-design-trends-2026/

---

## Section 4. Bento-grid and feature-showcase layouts

How modern pages arrange multiple feature demos.

- Origin and gold standard. Apple popularized the bento layout in product pages and keynote summary slides (camera, battery, chip, screen each in its own glanceable cell). Linear adapted it for dark technical UIs with strong information-density-to-whitespace balance. Notion uses it to connect template previews, testimonials, and feature copy naturally (Onecodesoft, Senorit, Galaxy UX).
- Why it fits ResearchOS. A bento grid forces a small number of features to breathe, each as a self-contained cell pairing one visual with one claim. It is the structural cure for the "flat feature inventory" anti-pattern the house wiki voice already flags. It also stacks gracefully to a single clean column on mobile.

When to use a big hero loop vs a grid of smaller loops.

- Big hero loop. One. Reserve it for the single most representative "this is what the tool feels like" moment (for ResearchOS, likely the lab notebook in motion, or the project folder opening from a plain folder on disk). It carries the "does it work" burden alone.
- Grid of smaller loops/screenshots. The 3 to 5 supporting features. Lead-tier features get a large cell with a real loop. Secondary capabilities get compact cells with an annotated still or a tiny loop. Raycast's 12-tile capability grid is the model for "and a lot more" without diluting the leads.

Pairing a short video with a one-line feature claim.

- Each cell is one verb-led plain claim plus one piece of media. The claim states the outcome in the user's language (for example "Your whole project lives in one folder you own"), the media proves it. Keep the claim to a single line, concept-first, no jargon. The bento cell is the unit where ResearchOS earns trust feature by feature.
- Framing inside cells. Browser-chrome or app-window mockup for full-UI loops (credibility), floating card for a single zoomed-in interaction (focus), full-bleed only for the hero or a deliberate immersive break.

Sources. https://www.onecodesoft.com/blogs/the-bento-box-effect-why-modular-grids-dominate-2025-design and https://senorit.de/en/blog/bento-grid-design-trend-2025 and https://www.galaxyux.studio/blog/bento-grids-the-new-standard-for-modular-ui-design/

---

## Section 5. Sell-the-tool storytelling structure

The converting top-to-bottom sequence, synthesized from conversion research (Webflow, Grafit, KlientBoost, SaaS Hero) and the reference pages.

Recommended order for ResearchOS.

1. Hook headline plus subhead. Short, concept-first headline under about 44 characters performs best (SaaS Hero). State the core promise in the scientist's language. One primary CTA visible immediately. Subhead carries the one-sentence what-it-is.
2. Hero demo loop. The single silent real-UI loop directly under the headline. This is the proof-of-life. Frame it in browser/app chrome.
3. Immediate credibility strip. For a SaaS this is logos or a hard metric near the hero (SaaS Hero). ResearchOS has no enterprise logos, so substitute honest credibility. The university fellowship backing, open-source and auditable, a real lab using it, a "built by researchers for researchers" line, or a short testimonial. Trust substitutes are essential here precisely because the brand is unknown.
4. The 3 to 5 feature showcases (bento grid). Lead with the few features that matter most, not everything. Each cell is one claim plus one loop/screenshot. Pick the features that are both differentiating and immediately legible (the notebook, the local folder, the sequence/cloning surface, sharing, instrument templates). Resist listing the full feature set here.
5. The differentiator / trust block. ResearchOS-specific and load-bearing. Your data is a plain folder you own, it runs locally, it is private by default, it is free and open source funded by a fellowship and donations. This is the LabArchives trust-flip and deserves its own confident section, not a footnote. Local-first competitors (Logseq, Anytype, Notesnook, Joplin) all foreground exactly these themes (data ownership, privacy by default, open-source auditability, no lock-in, open file formats).
6. Mid and late CTAs. Place a CTA after the feature showcases and again after the trust block. CTAs after social proof and after benefits reduce perceived risk and convert visitors who read the whole page (SaaS Hero). Every CTA is the same single action (get started / download / try it), never a pricing or demo-request fork.
7. Optional comparison. A light "how this differs from a cloud ELN" framing can live before the final CTA, but keep it gracious and concept-first, not a combative feature-matrix against a named competitor.
8. Final CTA plus footer. One last unambiguous get-started, then footer.

How to decide which few features to lead with. Choose features that are simultaneously differentiating (a cloud ELN cannot easily claim them, local-first ownership being the headline) and instantly legible in a 10-second silent loop (visually obvious without narration). A feature that needs a paragraph to explain is a bad hero-grid candidate, push it to docs/wiki. The bento grid should make the visitor think "oh, I see what this is" five times fast.

CTA framing for a free open tool. The entire enterprise-sales vocabulary is wrong here. No "Get a demo," no "Contact sales," no pricing tiers, no "Start free trial" (it is not a trial, it is just free). The CTA is "try this free tool" energy. A single primary action repeated down the page. Reinforce free-and-open near the CTA so the ask feels low-risk.

Sources. https://webflow.com/blog/saas-landing-page and https://www.grafit.agency/blog/saas-landing-page-best-practices and https://www.saashero.net/design/landing-page-design-cta-placement/ and https://www.klientboost.com/landing-pages/saas-landing-page/ and https://openalternative.co/alternatives/obsidian

---

## Shortlist. 3 to 5 pages to take direct inspiration from

1. Linear (https://linear.app). Why. The definitive template for the exact thing ResearchOS is building. Silent real-UI hero loop, browser-chrome credibility framing, dark calibrated palette, bento feature tour, social proof below the tour, single confident CTA. Closest structural match. Copy the structure, adapt the palette.

2. Cursor (https://cursor.com). Why. Best reference for sustaining a long video-forward page without monotony. Hero loop plus per-feature loops, varied framing (browser mockup, floating card, full-bleed), a strong dedicated testimonial band. Study how it alternates framing to keep scroll energy.

3. Raycast (https://raycast.com). Why. Best reference for "lead features get full loops, everything else gets a compact tile." The 12-tile capability grid solves "we do a lot more" gracefully, and the glassmorphism plus monospace accents are tasteful, not overwrought. Good model for ResearchOS having many features but only a few hero-worthy ones.

4. Vercel (https://vercel.com). Why. Reference for restraint and for proving not every cell needs a video. Crisp animated illustrations and one live mini-interaction carry sections, oversized type, light/dark, hard-metric social proof. Useful counterweight so ResearchOS does not over-rotate into wall-to-wall video.

5. A local-first competitor page for positioning, not visuals (for example Anytype or Logseq via https://openalternative.co/alternatives/obsidian). Why. To borrow the trust language for the differentiator block. Data ownership, privacy by default, open-source auditability, open file formats, no lock-in. ResearchOS should out-warm these (concept-first, scientist-facing) while making the same core promises.

---

## Technical implementation checklist for the autoplay-video pattern

- [ ] Each loop is silent, seamless, 10 to 30 seconds, real UI doing one legible thing.
- [ ] Element ships `autoplay muted loop playsinline`. Muted and playsInline are mandatory.
- [ ] `preload="metadata"` for the hero loop, `preload="none"` for below-the-fold loops.
- [ ] Every loop has a compressed `poster` (WebP/AVIF) so the section paints instantly with no layout shift.
- [ ] Dual source, AV1/WebM first then H.264/MP4 fallback, or a single well-compressed H.264 MP4 if simpler. Always include MP4.
- [ ] Audio track stripped during encode (silent loops do not need it).
- [ ] Per-loop budget around 2 MB for ~15s at 720p, hard ceiling ~3 MB. 720p, not 4K.
- [ ] IntersectionObserver mounts/plays loops on scroll-in and pauses on scroll-out (threshold ~0.25).
- [ ] `prefers-reduced-motion: reduce` shows the poster, not the loop.
- [ ] WCAG 2.2.2 satisfied via reduced-motion respect plus an unobtrusive pause affordance on hero loops.
- [ ] Each loop has a descriptive `aria-label` and an adjacent text claim (the bento copy).
- [ ] Heavy video hosted off the git repo (Vercel Blob or external CDN), never large files in `public`. Consider `next-video` for automatic optimization, posters, and lazy behavior.
- [ ] Fallback content inside the `<video>` tag for unsupported browsers.
- [ ] Total page weight watched. Lazy-mount below-the-fold loops so initial paint stays fast even with many demos.

---

## Open questions and risks

- Dark vs light. The app may be light-first while the launch page goes dark-first. Decide whether a dark launch page that does not match the app feels dishonest to scientists, or whether it simply reads as "modern marketing page." Recommend dark hero plus lighter trust/CTA sections, or a committed single mode. Needs a design call.
- Authenticity vs polish. Mesh gradients and heavy motion (Superhuman direction) can read as slick rather than sincere, which is dangerous for a trust-first academic audience. Risk of the page looking "too good to be a real free tool." Lean concept-first and real-UI-forward to counter this.
- Asset production cost. Several high-quality silent loops require capturing real UI cleanly with fixture data only (house rule, never real research data). Plan capture using the existing `?wikiCapture=1` fixture mode and `/demo` gate. This is a real production effort, not just design.
- Privacy in captures. Every loop and screenshot must use fixture data, never the real data folder. This is a hard house constraint and a release-blocker if violated.
- Performance under many loops. Even with lazy-mount and posters, a video-heavy page can hurt Core Web Vitals on slower lab machines. Budget total weight and test on modest hardware, since the audience is not all on fast machines.
- AV1 toolchain. Producing AV1/WebM plus H.264 doubles encode steps. Decide whether the byte savings justify the dual pipeline or whether a single optimized MP4 is enough for v1.
- Caption/transcript expectation. Silent UI loops need no captions, but if any loop ever gains a voiceover or narration, captions become mandatory. Keep launch loops silent to stay simple and compliant.
- Comparison framing tone. Any "vs cloud ELN" section risks reading combative. Keep it gracious and concept-first, avoid naming and attacking a specific competitor on the public page.

---

### Full source list

- https://linear.app
- https://cursor.com
- https://raycast.com
- https://vercel.com
- https://resend.com
- https://www.stackmatix.com/blog/saas-landing-page-examples
- https://www.mux.com/articles/best-practices-for-video-playback-a-complete-guide-2025
- https://nextjs.org/docs/app/guides/videos
- https://vercel.com/kb/guide/best-practices-for-hosting-videos-on-vercel-nextjs-mp4-gif
- https://www.npmjs.com/package/next-video
- https://cloudinary.com/guides/video-effects/video-autoplay-in-html
- https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
- https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- https://practicalwebtools.com/blog/video-format-conversion-web-2025-guide
- https://uploadcare.com/blog/navigating-codec-landscapes/
- https://zatta.link/en/web/video-tag-and-recommended-file-spec.html
- https://blog.logrocket.com/build-custom-tiktok-autoplay-react-hook-intersection-observer/
- https://esausilva.com/2021/06/14/react-hook-to-play-video-using-intersection-observer/
- https://www.onecodesoft.com/blogs/the-bento-box-effect-why-modular-grids-dominate-2025-design
- https://senorit.de/en/blog/bento-grid-design-trend-2025
- https://www.galaxyux.studio/blog/bento-grids-the-new-standard-for-modular-ui-design/
- https://www.eloqwnt.com/blog/saas-website-design-trends
- https://mockflow.com/blog/saas-website-design-trends
- https://www.saasframe.io/blog/10-saas-landing-page-trends-for-2026-with-real-examples
- https://www.arieldigitalmarketing.com/blog/web-design-trends-2026/
- https://www.lapa.ninja/post/superhuman/
- https://getdesign.md/warp/design-md
- https://www.framer.com/marketplace/components/gradient-pro/
- https://webflow.com/blog/saas-landing-page
- https://www.grafit.agency/blog/saas-landing-page-best-practices
- https://www.saashero.net/design/landing-page-design-cta-placement/
- https://www.klientboost.com/landing-pages/saas-landing-page/
- https://openalternative.co/alternatives/obsidian
