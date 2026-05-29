# BeakerBot Showcase Proposal

**Author:** showcase-design sub-bot (dispatched by orchestrator manager)
**Date:** 2026-05-29
**Status:** Design proposal. No code yet. Open questions for Grant at the end; the JSX snippets inside are illustrative sketches, not wired into the app.

---

## 0. TL;DR

Users keep telling Grant the BeakerBot animations are adorable. Right now they live in a dev-only dropdown gallery (`frontend/src/app/dev/beakerbot-gallery/page.tsx`) where you watch one animation at a time, and the multi-stage scenes hijack the whole screen because they portal to `document.body`. That is fine for QA. It is not a delight feature.

This proposal turns that hidden inventory into **a public-facing, scroll-through showcase page**: a tiny vanity stage where BeakerBot performs all of his looks and all of his scenes, presented like a fashion shoot. You scroll, he poses, the spotlights track him, the cameras flash. It is meant to feel like finding the secret room, not opening a settings panel.

Three decisions drive the whole thing:

1. **Primary concept: "The Runway + The Performance Hall."** Poses get a glossy runway treatment up top (BeakerBot strutting a lineup of looks under spotlights with camera flashes). Scenes get a sequence of framed prosceniums below, each its own little theater box, so the long-form gags play one at a time without colliding.
2. **Scene containment: refactor each scene to accept an optional bounds/container prop (Option 1), shipped progressively behind a fallback to the scroll-into-view-one-at-a-time sequencer (Option 3).** Option 1 is the only approach that makes scenes truly live *inside* the page instead of taking it over. Option 3 is the safety net for the MVP and for any scene that resists containment.
3. **Discovery: a hidden, unlinked route plus a click-count easter egg on the BeakerBot mascot.** No main-nav entry. You earn it.

Everything below expands these three.

---

## 1. Vision

Picture a backstage door in an app that is otherwise all business: folders, notes, PCR recipes, Gantt charts. You click BeakerBot a few too many times and the door swings open. The screen dims at the edges, a soft spotlight warms up, and a hush settles over a little stage. Then BeakerBot walks out.

This is BeakerBot's photoshoot. The page reads like a fashion-meets-science-fair magazine spread come to life. Up top is **the runway**: BeakerBot striking each of his looks one at a time under a moving spotlight, paparazzi flashes popping in the dark around him, a "now showing" caption naming the look. The poses are his wardrobe (waving, cheering, thinking, reading, sleeping, the dramatic volcano-eruption finale). Scroll, and he changes into the next look. The framing is unapologetically vain in the most charming way: he is a beaker who knows he is cute, and the page lets him have his moment.

Scroll past the wardrobe and you reach **the main stage**, where his full scenes play as a sequence of acts. Each act lives inside its own framed theater box (a proscenium with a curtain header and a "now performing" placard) so the climbing-the-ladder bit never crashes into the skateboarding bit. The acts are scroll-triggered: the one in view performs, the ones above and below rest in a poster frame, ready to replay when you tap them. The long gags get room to breathe. The coffee-refill scene, whose entire joke is the eight-second brew wait, finally has a stage patient enough to let the gag land.

The tone is **easter egg, not utility**. There is no search bar, no filter dropdown, no metadata table. It does not look like the dev gallery and it must not. It is a reward for curiosity, the kind of thing a user screenshots and posts in their lab Slack with "look what I found." If the dev gallery is the spec sheet, this is the runway show. Same wardrobe, completely different vibe.

---

## 2. Concept directions

Three concrete directions follow. The recommendation grafts the best of all three into one page, but they are described standalone first so the trade-offs are visible.

### Concept A: "The Runway" (recommended for the poses section)

A dark catwalk recedes toward a vanishing point. A single spotlight cone falls on a mark at the front of the stage. BeakerBot strides up to the mark, hits a pose, holds it while a caption flips up naming the look ("THE WAVE", "THE BIG IDEA", "VOLCANO COUTURE"), and paparazzi flashes stutter in the dark wings. Then he turns and the next look loads.

- **Layout:** vertical scroll where each look is one full-height (or tall) "frame" of the catwalk. Snap-scroll between looks (CSS `scroll-snap-type: y mandatory`) so each pose centers itself. Alternatively a horizontal swipe-through carousel for a more literal runway-walk feel.
- **Why it fits poses:** poses are single-bot, contained-by-default CSS-keyframe animations (`<BeakerBot pose=... />`). They already render fine in a bounded box. They are the natural "wardrobe lineup."
- **Effects to build:** a radial spotlight gradient (CSS `radial-gradient`), a camera-flash SVG burst that fires on look-change and on click, a flip-up caption pill, optional sparkle confetti on the celebratory looks.
- **Cost:** low. Poses do not portal and do not need refactoring. This is mostly presentation CSS plus a scroll observer.

Illustrative sketch (not wired in):

```tsx
// One runway "look" frame. Spotlight + flash are pure CSS/SVG decoration.
function RunwayLook({ pose, caption }: { pose: BeakerBotPose; caption: string }) {
  return (
    <section className="runway-frame">       {/* full-height, scroll-snap-align: center */}
      <div className="runway-spotlight" />    {/* radial-gradient cone */}
      <CameraFlashLayer />                    {/* SVG bursts on enter + click */}
      <BeakerBot pose={pose} className="h-64 w-64 text-sky-500" />
      <p className="runway-caption">{caption}</p>
    </section>
  );
}
```

### Concept B: "The Photoshoot Set"

A studio: seamless paper backdrop, a pedestal, a key light and a fill light. BeakerBot stands on the pedestal and cycles his poses on a slow auto-timer, the way a model holds, shifts, holds. Hover or click anywhere and a paparazzi flash fires plus a shutter-click feedback (visual frame-freeze, like a captured photo dropping into a contact sheet at the side).

- **Layout:** a single hero "studio" panel rather than a long scroll. The whole pose wardrobe cycles in place; a film-strip / contact-sheet rail down one side fills in with the "shots you triggered" as thumbnails.
- **Why it is tempting:** the most photoshoot-literal of the three, and the contact-sheet rail is a genuinely cute collect-the-shots mechanic.
- **Why it is secondary:** it does not scroll, and Grant's seed vision is explicitly "scroll down and his different full scenes play." It also does not naturally host the 9 long-form scenes (those want their own stages, not a pedestal). Best used as a *graft*: steal the contact-sheet "captured shots" idea and the shutter-flash feedback for the runway.

### Concept C: "The Performance Hall" (recommended for the scenes section)

A theater. Each scene is an act on a framed stage: a proscenium arch (or a simpler bordered "stage box") with a small curtain valance up top, a "NOW PERFORMING" placard, and footlights along the bottom. As you scroll, the act currently centered in the viewport raises its curtain and performs; the others sit curtain-down with a poster frame (a static BeakerBot in a resting pose plus the act's title). Tap a resting act to jump-replay it.

- **Layout:** vertical scroll, one framed stage per scene, generous vertical spacing so two stages are never both mid-performance.
- **Why it fits scenes:** this is the section that solves the hard problem. Scenes are full-viewport portal animations; a framed proscenium is exactly the "bounds" they need to be poured into. And scroll-sequencing guarantees only one is ever active.
- **Effects to build:** curtain raise/lower (CSS transform on two curtain halves), footlight glow, placard, a "replay" affordance.

### Recommendation

**Stack Concept A on top of Concept C in a single scrolling page, and graft Concept B's "captured shots" contact sheet as an optional flourish.**

The page reads top to bottom as: a brief curtain-up intro, then the **Runway** (poses as a wardrobe lineup), then the **Performance Hall** (scenes as framed acts), then a small curtain-call footer. This gives Grant exactly the "scroll down and his scenes play" experience while showing off the full emotional range up top, and it keeps the two animation *types* (contained CSS poses vs. full-viewport portal scenes) in the presentation that suits each. The fashion-stage / photoshoot framing Grant floated is the connective tissue: spotlights, flashes, placards, curtains throughout.

---

## 3. Section layout for the scroll

Top to bottom:

| # | Section | Contents | Animation type | No-overlap mechanism |
|---|---------|----------|----------------|----------------------|
| 1 | **Curtain-up intro** | Title ("BeakerBot, on stage"), a single waving BeakerBot under a warming spotlight, a "scroll to begin" cue | Pose (`waving`) | N/A (single contained bot) |
| 2 | **The Runway** (wardrobe) | All 21 poses as a vertical snap-scroll lineup of "looks", spotlight + camera-flash per look, flip-up caption | Poses (contained CSS keyframes) | Poses never portal; each look is its own bounded frame. No collision possible. |
| 3 | **The Performance Hall** (acts) | The 9 scenes as framed prosceniums, scroll-triggered, one active at a time, others poster-framed and tap-to-replay | Scenes (portal -> contained via the §4 solution) | Only the centered act is `active`; bounds prop keeps it inside its frame. |
| 4 | **Pose-celebration cameo** (optional) | The 3 `BeakerBotPoseCelebrationScene` variants as a small "encore" row | Corner-portal poses | Same one-at-a-time sequencing; or render inline since they are single poses |
| 5 | **Curtain call** | A bow-wink BeakerBot, credits-style caption, link back to the app | Pose (`bow-wink`) | N/A |

The structural rule baked into every section: **at most one full-viewport-capable animation is `active` at any scroll position.** Poses are inert on this point (they are contained by nature). Scenes are governed by the §4 containment solution plus the scroll-into-view sequencer so the rule holds even before every scene is refactored.

Snap-scroll between runway looks is recommended (`scroll-snap-type: y mandatory` on the runway container, `scroll-snap-align: center` on each look) so each pose self-centers and gets its spotlight moment. The Performance Hall should NOT snap-scroll hard; the acts want a gentler scroll so the curtain-raise can trigger as a stage enters view rather than snapping past it.

---

## 4. Scene containment solution

This is the load-bearing technical decision. The three options from the brief, evaluated:

### The problem restated

Every scene component (`BeakerBotLadderScene`, etc.) calls `createPortal(..., document.body)` and renders `position: fixed`, full-viewport, at `z-index: 800` (verified in `BeakerBotSkateboardScene.tsx` and siblings). Two consequences for a showcase page:

1. **Overlap.** If two scenes are `active`, they both paint over the whole viewport and stack on each other. Grant's hard constraint forbids this.
2. **Page hijack.** Even one active scene covers the entire screen, including the showcase chrome (the stage frame, the placard, the scroll position). It does not live *in* the page; it lives *over* it.

### Option 1: refactor scenes to accept an optional bounds/container prop

Add an optional prop to each scene that, when provided, makes the scene render into a passed-in container (or with passed-in bounds) instead of portaling to `document.body`. Inside the showcase, each act passes its own framed `<div>` as the stage; the scene's `position: fixed` becomes `position: absolute` relative to that frame, and its viewport-percentage transforms resolve against the frame instead of the window.

- **Pros:** the only option that makes a scene genuinely live inside the page. No overlap (each scene is clipped to its own frame). No hijack (the page chrome stays visible around it). Reusable beyond the showcase (wiki captures, the `/demo` tour, embedded thumbnails all benefit). Clean long-term.
- **Cons:** the most work. Touches all 9 scene components. Several scenes hardcode viewport-relative math (`vh` ground lines via `SCENE_GROUND_BOTTOM_VH`, skateboard's `bottomY` percentage, off-screen entry/exit distances computed from `window.innerWidth`). Each needs to read from the container's box instead of the window. Some scenes that were tuned for a wide viewport (skateboard cruising the full width, coffee-refill's horizontal carry-off) may need a minimum frame aspect ratio or will look cramped.

### Option 2: isolated framed stage that visually bounds the un-refactored scene

Wrap each portaled scene in a CSS-contained shell (`position: relative; overflow: hidden`, plus a `transform: scale()` to shrink the full-viewport animation down into the frame), or an `<iframe>` that has its own `document.body` for the portal to target.

- **Pros:** less invasive than Option 1; no per-scene refactor of the animation math.
- **Cons:** a `transform: scale()` wrapper does NOT actually rebind a `position: fixed` child to the wrapper; fixed positioning escapes most containing blocks, so the portal would still escape to the real viewport unless the wrapper establishes a containing block (`transform`/`filter`/`will-change` on an ancestor does create one for fixed children in modern browsers, which is the trick, but it is fragile and easy to break with a stray `contain` or stacking change). The `<iframe>` route genuinely isolates the portal but is heavy: you must inject the app's CSS into each frame, you lose shared React context, and 9 iframes on one page is a real performance and complexity cost. Either sub-variant risks scenes looking cropped (their geometry assumes a full viewport, so a scaled-down 16:9 frame clips a bot that walks to `x = window.innerWidth`).

### Option 3: scroll-into-view, one scene active at a time

Never refactor. Only the scene currently centered in the viewport gets `active = true`; all others are paused and show a poster frame. Because only one is ever active, two never overlap.

- **Pros:** trivial to build (an `IntersectionObserver` flipping `active`). Zero scene-component changes. Solves the *overlap* constraint completely and immediately.
- **Cons:** does NOT solve the hijack. The one active scene still portals to body and covers the whole screen while it plays, so the page chrome (the framed stage, the placard) is invisible during the performance. The user is looking at a full-screen takeover, not a contained act. That is acceptable for an MVP (it is literally how the dev gallery works today and how scenes appear in the real app), but it is not the "lives inside a little theater box" vision.

### Recommendation

**Ship Option 3 as the MVP sequencer and adopt Option 1 as the target architecture, migrating scenes one at a time behind it.**

Rationale:

- Option 3 alone gives a shippable, no-overlap showcase on day one with zero risk to the 9 scene components. It satisfies Grant's hard constraint (no two scenes on top of each other) immediately.
- Option 1 is the only path to the actual vision (scenes living inside framed stages, page chrome intact). It is worth the work because the bounds prop pays off well beyond this page: wiki screenshot capture, the public `/demo`, and embedded thumbnails all want contained scenes too.
- The two compose cleanly. Keep the scroll sequencer (Option 3) permanently as the "only one active" governor. As each scene gains the bounds prop (Option 1), it graduates from full-screen-takeover to in-frame. A scene that has not been migrated yet simply still takes over the screen when it is the active one, which is graceful and obvious, not broken.
- Reject Option 2: the `transform`/`contain` containing-block trick for fixed children is too fragile to stake the feature on, and the iframe route is disproportionate cost.

A pragmatic bounds-prop shape for the eventual Option 1 work (illustrative, do NOT implement here):

```tsx
// Sketch of the envelope extension. Today scenes accept { active, onComplete }.
// Add an optional bounds target; when present, render absolute-in-container
// instead of fixed-to-body.
type SceneBounds = {
  /** Render into this element instead of portaling to document.body. */
  container: HTMLElement;
  /** The scene resolves its vh/percentage math against this box, not window. */
  width: number;
  height: number;
};
// scene props become: { active, onComplete?, bounds?: SceneBounds }
// when bounds is undefined -> today's behavior (portal to body, full-viewport).
```

---

## 5. Discovery / entry point

It is an easter egg, so it should be *found*, not *navigated to*. Options considered:

- **Hidden unlinked route** (`/showcase` or `/beakerbot`): reachable if you know the URL, undiscoverable from the UI. (This is already how the dev gallery works: the route exists in production but nothing links to it.)
- **Click-count easter egg on the mascot:** tap BeakerBot N times somewhere prominent (the AppShell brand mark, the settings header) to unlock the door. BeakerBot already owns a per-click reaction (the heart easter egg in `BeakerBot.tsx`), so a hidden click counter is a natural extension and thematically perfect: you pester the cute beaker enough and he invites you backstage.
- **Link from the existing heart easter egg:** after spawning the max 6 hearts (`HEART_MAX_CONCURRENT`), reveal a subtle "see more of me ->" affordance.
- **Footer link:** lowest-effort but the least easter-egg-y; a visible footer link is just navigation.

**Recommendation: a hidden unlinked route (`/showcase`) as the canonical home, unlocked/surfaced via a click-count easter egg on the BeakerBot mascot.** Concretely: the route always exists (so power users and shared links work), and clicking BeakerBot some count (say 7, matching the "lucky" feel, exact number is Grant's call) triggers a little "backstage door" reveal that navigates there. This keeps it OUT of the main nav entirely (the brief's hard requirement) while giving non-URL-savvy users a delightful way to stumble in. The heart easter egg stays as the default click reaction; the showcase unlock is the *escalation* after repeated clicks, so the two do not fight (hearts on clicks 1 through N-1, door reveal on click N).

Route name: `/showcase` reads clean and on-theme (it is a showcase). `/beakerbot` is more discoverable-by-guessing but slightly more "dev console" than "easter egg." Leaning `/showcase`; flagged as an open question.

---

## 6. Which catalog entries to feature, and how

The full inventory is 21 poses + 9 scenes + 3 pose-celebrations = 33 entries (`BEAKERBOT_ANIMATION_CATALOG`). Recommendation: **feature all 21 poses and all 9 scenes; treat the 3 pose-celebrations as an optional encore, since they are wrappers around poses already shown.** The whole point is "show off ALL of his emotions in a way that looks cooler," so curating *down* the poses would undercut the vision. The presentation does the heavy lifting, not a curated subset.

Group the runway looks into themed "collections" (mini section headers within the runway scroll) so 21 looks do not read as an undifferentiated dump:

| Collection | Poses | Mood |
|------------|-------|------|
| **The Greetings** | idle, waving, bouncing, bow-wink | warm, welcoming openers |
| **The Big Feelings** | cheering, giggle, rolling-laughing, amazed | high-energy joy |
| **The Quiet Looks** | thinking, reading, sleeping, yawn | calm, contemplative |
| **The Lab Life** | typing, typing-on-laptop, pointing, pointing-up, pointing-down | working bot |
| **The Drama** | panicked, embarrassed, hiccup, volcano-eruption | comedic / dramatic finale |

The pointing trio (`pointing`, `pointing-up`, `pointing-down`) are the least "showy" looks: they exist to anchor tour pointer-lines, and out of that context they are just an arm sticking out. Recommend including them but de-emphasized (smaller, grouped tightly as "the directors" or folded into Lab Life) rather than each getting a full hero frame. Flagged for Grant.

The scenes group naturally too: **lab-life gags** (Centrifuge, Eureka, CoffeeRefill, TooManyBeakers), **antics** (Skateboard, BugStomp, BlowingBubbles, Ladder), **a greeting** (MouseWave). The Performance Hall can use these as act-cluster headers or just run them in a curated order that paces energy (open with a greeting, build to the big physical gags, close on a crowd-pleaser like BlowingBubbles since it is interactive).

**Entries that may not showcase well in a contained frame** (relevant once Option 1 migration starts):

- **MouseWave** appears *near the cursor*; in a fixed stage with no meaningful cursor target it loses its hook. Either re-anchor it to the frame center for the showcase or cut it from the Hall (it is the weakest as a standalone act). Flagged.
- **Skateboard** cruises the full viewport width; a narrow framed stage crops the cruise. Wants a wide (cinematic aspect) frame, or keep it as a full-width "intermission" band that spans the page rather than a boxed act.
- **CoffeeRefill** is ~13s with an 8s brew wait as the gag. In a small poster-then-play frame the long wait may read as "is it broken?" Needs a visible progress cue (the pot filling must be legible at frame size) or a gentle "the wait is the joke" caption.
- **BlowingBubbles** is click-to-pop interactive; that is a *strength* in a contained frame (the bubbles can be confined to the stage and remain clickable). Good closer.

---

## 7. Polish ideas

Layered roughly MVP-to-luxury:

- **Spotlight gradients.** A `radial-gradient` cone behind the active pose/act; subtle animation so it "warms up" as a frame enters view. Cheap, high impact, sets the whole stage mood.
- **Camera-flash SVG bursts.** A short white-burst SVG (radial spikes + a quick opacity flash) firing on look-change and on click, scattered in the dark wings of the runway. Build as an inline-SVG component (project rule: no emojis, custom SVGs only), mirroring the existing particle patterns in `BeakerBot.tsx` (`VOLCANO_PARTICLES`, `HICCUP_POP_PARTICLES`).
- **"Now showing" / "Now performing" placard.** A flip-up caption pill naming each look/act (reuse the `ANIMATION_METADATA` `name` + `description`, which already exist per entry).
- **Curtain raise/lower** on Performance Hall acts (two curtain halves, CSS transform), with a small valance and footlight glow.
- **Captured-shots contact sheet** (grafted from Concept B): clicking a runway look drops a thumbnail into a side rail, a little "you took a photo" collectible. Pure delight, fully optional.
- **Click-to-replay** on every frame (poses and acts). Trivial and expected; users will want to re-watch.
- **Ambient idle between acts.** Between the big scenes, a small idle BeakerBot (idle-bob, occasional waving) keeps the page alive while you scroll, so it never feels static. The app already has an `IdleAnimationManager`; the showcase can run a lightweight local version.
- **Reduced-motion respect.** Every scene already honors `prefers-reduced-motion` (verified: scenes fall back to a static hold). The showcase chrome (spotlights, flashes, curtains) must do the same: collapse to static poster frames with captions. Non-negotiable; it is already the house pattern.
- **Sound** (likely out of scope): a soft shutter click, a runway beat, a "ta-da." Tasteful but risky (autoplay audio policies, accessibility, and it is easy to make annoying). Recommend deferring; if ever added, default OFF with an obvious mute, gated behind a user gesture.

---

## 8. Open questions for Grant

1. **Route name:** `/showcase` (recommended) or `/beakerbot`, or something else?
2. **Discovery mechanism:** hidden route + click-count unlock on the mascot (recommended) is the proposal. Confirm? If yes, what click count unlocks the backstage door (proposal floats 7), and *which* BeakerBot instance is the trigger (AppShell brand mark? settings header? both?)?
3. **Curated vs. all:** show all 21 poses + all 9 scenes (recommended), or curate a subset?
4. **Pointing trio:** include `pointing` / `pointing-up` / `pointing-down` de-emphasized (recommended), give them full hero frames, or cut them?
5. **Pose-celebration variants:** show the 3 `BeakerBotPoseCelebrationScene` wrappers as an "encore," or skip them since they reuse poses already on the runway?
6. **Scenes to cut or special-case:** MouseWave (cursor-dependent), Skateboard (wants full width), CoffeeRefill (13s, long wait) each need special handling. Cut any? Keep all with the special-casing in §6?
7. **Audience:** member-facing only, or also surfaced in the public `/demo`? (Public exposure raises the polish + reduced-motion bar.)
8. **Containment ambition for v1:** ship the Option 3 sequencer MVP first (full-screen-takeover acts, no overlap) and migrate to Option 1 framed stages later (recommended), or hold the launch until scenes are refactored into proper framed prosceniums?
9. **Sound:** confirmed out of scope for now?

---

## 9. Rough build phases

### P1: MVP, the scroll-through showcase (Option 3 sequencer)

- New route at `/showcase` (or chosen name), no nav link.
- The Runway: all 21 poses as a snap-scroll lineup, spotlight gradient + camera-flash on each look, flip-up caption from existing metadata, collection sub-headers, click-to-replay.
- The Performance Hall: all 9 scenes, scroll-into-view sequencer (`IntersectionObserver` flips `active`, one at a time), poster frame + "now performing" placard for resting acts, tap-to-replay. Scenes still take over the screen when active (un-refactored), but never overlap.
- Curtain-up intro + curtain-call footer.
- Reduced-motion fallbacks throughout.
- Reuse `BEAKERBOT_ANIMATION_CATALOG` so the page can never drift from the real inventory.

This is a shippable, on-vision-enough delight feature with zero changes to the 9 scene components.

### P2: Containment + framed stages (Option 1 migration)

- Add the optional `bounds` prop to the scene envelope.
- Migrate scenes one at a time (start with the easy contained ones: Eureka, Centrifuge, BugStomp; defer Skateboard / CoffeeRefill / MouseWave). Each migrated scene graduates from full-screen-takeover to performing *inside* its proscenium with page chrome intact.
- Build the full proscenium chrome: curtain raise/lower, valance, footlights.
- Special-case the awkward scenes per §6 (MouseWave re-anchored or cut, Skateboard as a full-width intermission band, CoffeeRefill progress cue).

### P3: Discovery + delight polish

- Wire the click-count easter-egg unlock on the BeakerBot mascot, with the "backstage door" reveal animation.
- Captured-shots contact sheet (Concept B graft).
- Ambient idle between acts.
- Optional: the encore row for pose-celebration variants.
- Sound only if Grant green-lights it (default OFF, gated behind a gesture).

---

*Sketches in this document are illustrative. No routes, scene props, or components were built. Hand-off to implementation chips happens only after Grant locks the §8 open questions.*

---
---

# Visual Design (R2): The Drag Main Stage

**Author:** showcase-drag-stage sub-bot (dispatched by orchestrator manager)
**Date:** 2026-05-29
**Status:** Visual design refinement. Builds on R1 above. Still doc-only: no routes, no scene props, no components built. The JSX / CSS / SVG below are illustrative sketches inside this doc, not wired into the app.

## R2.0 What changed from R1, and why

Grant reviewed R1 and gave the centerpiece a real creative direction. The runway is not a generic fashion catwalk. It is **a drag main stage**, in the spirit of a RuPaul's Drag Race runway. BeakerBot is the queen. He works the catwalk, serves each emotion as a "look", and the photographers' pit lights him up with flashbulbs.

This is personal and it is the point. BeakerBot is already rainbow (five pastel stops in his liquid: peach, yellow, mint, sky, lavender, verified in `BeakerBot.tsx` lines 517 to 523). That rainbow came from Grant being gay, and he wants the app to feel genuinely inclusive. So the showcase is a loving, celebratory homage to drag culture: glamour, confidence, joy, self-expression. It is NOT a caricature, NOT a cheap gag, NOT a stereotype. The design rule for every choice below: would this read as warmth and respect, or as a punchline at drag's expense? Only the first kind ships.

R1's bones survive intact. The two-part structure (poses up top, scenes below) and the scene-containment plan (Option 3 sequencer now, Option 1 `bounds` prop later) are unchanged. What R2 does is re-skin and re-stage all of it as a drag main stage, and propose new BeakerBot scenes built for that stage. Read R1 §3 and §4 for the structural and technical decisions; this section is the visual layer on top.

The R1 open questions (§8) are now mostly locked by the dispatch brief:

- Discovery: BOTH a `/showcase` route AND a click-count unlock on the mascot. (Settled. Composes on top of the existing per-click heart easter egg, see R2.7.)
- Catalog: feature ALL 21 poses + all 9 existing scenes, plus the new drag-stage scenes proposed in R2.2.
- Audience: members AND the public `/demo`.
- This round: detailed visual design, not a build.

New open questions specific to the drag-stage direction are collected at the end (R2.9).

## R2.1 The Drag Main Stage (the runway centerpiece)

### The set

A drag main stage, built top to bottom in layers. Reference picture: the lit T-shaped runway, a glittering backdrop wall, side curtains framing the stage mouth, and a dark pit at the foot where the photographers crouch with cameras.

**Layer 1, the backdrop.** A `BEAKERBOT` marquee spelled in round bulb-lights across the back wall, sitting over a slow rainbow gradient sweep. The bulbs are inline-SVG circles with a soft glow (`filter: blur` halo behind each), chasing left to right on a gentle loop so the sign reads as "live." Behind the marquee, a vertical rainbow wash using BeakerBot's own five liquid stops as the gradient stops, kept low-contrast (heavily darkened / desaturated) so it sets mood without fighting the lit bot in front. The rainbow is the through-line of the whole page, never an accent you have to hunt for.

**Layer 2, the side curtains.** Two deep-jewel-tone curtain panels (a saturated plum / aubergine reads "theater" without going literal red velvet, which clashes with the pastel rainbow) frame the left and right edges of the stage mouth. Soft pleating via repeating linear-gradient stripes, a gold-ish valance swag across the top. These are the proscenium edges; they stay put while looks change.

**Layer 3, the catwalk floor.** The iconic light-up runway. A perspective trapezoid receding from a wide foot (front, near the viewer) to a narrow head (back, where BeakerBot is revealed), tiled with **light-up panels** that pulse. Each panel is a CSS gradient cell; a traveling highlight runs head-to-foot so the floor reads as animated stage lighting, not a static checkerboard. Panels glow in sequence toward the pit, pulling the eye down the runway the way a real light-up catwalk does. (Illustrative panel snippet in R2.5.)

**Layer 4, the tracking spotlight.** A single warm spotlight cone falls on BeakerBot's mark at the head of the runway. It is a CSS `radial-gradient` ellipse, brightest at the bot and falling to near-black at the stage edges (the rest of the page is dim so the lit bot pops). When a new look loads, the spotlight does a quick "find the queen" sweep (a short translate + brighten) before settling on the mark. (Concrete gradient values in R2.5.)

**Layer 5, the photographers' pit.** Along the dark front edge of the stage (nearest the viewer), a row of small camera silhouettes (simple inline-SVG lens + body shapes, kept abstract, no faces). Flashbulbs **pop** here: short white bursts that fire on every look change and on click, scattered along the pit so the flashes feel like a crowd of photographers, not one strobe. Between bursts, a low ambient flicker keeps the pit alive. (Flashbulb burst snippet in R2.5.)

### How each of the 21 poses presents as a "look"

Each pose gets a full stage moment, served as a look:

1. **The reveal.** As the look scrolls into view, the spotlight does its quick find-sweep and lands on the mark at the head of the runway. (For the few poses that already animate an entrance, like `bouncing`, the entrance plays here. Most poses are static silhouettes or in-place loops, so the *spotlight* does the revealing, not the bot walking. The actual walking strut is a NEW scene, see R2.2, kept separate so we never fake motion a pose does not have.)
2. **The look lands.** BeakerBot strikes the pose under the spotlight at 128px (the canonical `BEAKERBOT_SCENE_SIZE_PX`, so he matches his scale everywhere else in the app), tinted `text-sky-500` with his hardcoded pastel-rainbow liquid (exactly as he renders in every scene today).
3. **Cameras flash.** Two or three flashbulbs pop in the pit, staggered by 40 to 120ms (mirroring the existing particle `delayMs` stagger pattern in `VOLCANO_PARTICLES`), so it reads as a crowd catching the moment, not a single click.
4. **The category card flips up.** A placard rises naming the look (R2.1 "the category is" framing below).
5. **Hold.** The bot holds the look; looping poses (`idle`, `sleeping`, `reading`, `waving`, `thinking`, `typing`) keep looping; one-shot poses (`bouncing`, `bow-wink`, `hiccup`, `yawn`, `volcano-eruption`) replay on tap and on a gentle auto-interval so the look never freezes dead.

The whole thing is unapologetically about letting BeakerBot have his moment. He is a beaker who knows he is fabulous and the stage agrees.

### "The category is..." placards

Homage to the show's runway-category announcements. Each look gets a title card framed as a category, drawing on the pose's real `name` + `description` from `BEAKERBOT_ANIMATION_CATALOG` (so the cards can never drift from the inventory). The framing is "THE CATEGORY IS..." in a smaller kicker line, then the look name big underneath.

The R1 collections (R1 §6) map cleanly onto categories. Tasteful, warm, never mean. Proposed category names per collection (Grant can rename any; flagged):

| R1 collection | Poses | "The category is..." |
|---|---|---|
| The Greetings | idle, waving, bouncing, bow-wink | THE CATEGORY IS... **OPENING NUMBER REALNESS** |
| The Big Feelings | cheering, giggle, rolling-laughing, amazed | THE CATEGORY IS... **PURE JOY, SERVED** |
| The Quiet Looks | thinking, reading, sleeping, yawn | THE CATEGORY IS... **SOFT GLAMOUR** |
| The Lab Life | typing, typing-on-laptop, pointing, pointing-up, pointing-down | THE CATEGORY IS... **EXECUTIVE LAB REALNESS** |
| The Drama | panicked, embarrassed, hiccup, volcano-eruption | THE CATEGORY IS... **HIGH DRAMA, DARLING** |

Each individual look still gets its own name card underneath the category kicker (e.g. category "PURE JOY, SERVED", look "THE BIG IDEA" for `amazed`). The category is the collection header that announces the next run of looks; the look name is the per-pose card. This keeps the homage affectionate (it celebrates the format) without putting words in any real person's mouth.

The pointing trio stays de-emphasized per R1: folded into "Executive Lab Realness" as a tight three-up "the directors" mini-row rather than three full hero moments, since out of tour context they are just an arm out.

### Layout and spacing (the hard no-overlap constraint)

Grant's hard rule: poses never crowd. The drag stage makes this easy because the staging itself enforces one-look-at-a-time.

**Chosen layout: a vertical scroll where each look gets a full stage moment.** This is the cleanest fit and it matches Grant's seed vision ("scroll down and his looks play").

- The runway is one tall scroll column. Each look is a **full-viewport-height stage frame** (`min-height: 100svh`, `svh` not `vh` so mobile browser chrome does not clip the stage), with `scroll-snap-align: center` on each frame and `scroll-snap-type: y mandatory` on the column. Each pose self-centers under the spotlight as you scroll; you cannot have two looks half-on-screen fighting for the spotlight.
- Inside each frame: the catwalk + backdrop + curtains + pit are the persistent set (rendered once, behind the scroll, or repeated per frame at the designer's discretion; rendering once behind a transparent scroll column is cheaper and keeps the marquee continuous). The bot mark sits at roughly 38% from the top (head of the runway, leaving the lit catwalk to recede toward the pit in the lower 50%). The category placard flips up at roughly 62% from the top, in the clear space between the bot and the pit, so it never overlaps the bot.
- Bot footprint: 128px square, centered on the mark, with a generous clear zone (at least 200px radius of empty spotlight around him) so the silhouette always has air. The spotlight ellipse is sized so its bright core is about 320px wide, comfortably larger than the 128px bot.
- Collection category cards get their own short interstitial frame (about 60svh) between collections, so the five "THE CATEGORY IS..." announcements punctuate the scroll and the 21 looks read as five curated runs, not one undifferentiated parade.

Approximate vertical budget: 5 category interstitials (60svh each) + 21 look frames (100svh each) = roughly 2400svh of runway scroll. That is long, but it is a scroll-through showcase; length is the feature, and snap-scroll makes it feel like flipping looks, not endless scrolling. (A "skip to the scenes" affordance pinned in a corner lets impatient users jump to the Performance Hall; flagged as optional polish.)

**Why not horizontal swipe:** a horizontal catwalk reads more literally as a runway walk, but it fights the rest of the app (everything else is vertical scroll), it is worse on desktop with a mouse, and it makes the "scroll down and his looks play" muscle memory wrong. Vertical wins. The *walk* itself lives in the new Runway Strut scene (R2.2) where a horizontal motion is contained inside one frame.

### Inclusive, celebratory tone (the through-line)

- Rainbow is everywhere and load-bearing: BeakerBot's liquid, the backdrop sweep, the confetti on the joy looks, the motion trails on the spin scene. It is the visual signature, not a sprinkle.
- The copy is warm and proud. "Serving looks", "the category is", "she works", "give him his flowers". Affectionate insider-fan language, the kind a drag fan uses with love. Never mocking.
- No stereotype shortcuts. No exaggerated body parts, no "comedy drag" gags, no anything that reads as laughing *at* drag. The humor is BeakerBot being a confident little diva, which is the same charm users already love about him.
- The whole page should make a queer user feel seen and make everyone else feel invited to the party. That is the bar.

## R2.2 New drag-stage scenes to build (brainstorm)

Grant explicitly opened the door to new BeakerBot scenes for this stage ("do new scenes too, the whole dance, or think about what else we can make"). Each scene below lists: the animation beats, which existing poses/primitives it composes from (so build cost is legible), and a difficulty estimate. All compose from the existing scene scaffolding (portal or `bounds` container, `position` absolute/fixed, 128px bot, `prefers-reduced-motion` gate, `onComplete` envelope) so they slot into the same sequencer as the 9 existing scenes.

### 1. The Runway Strut (RECOMMENDED for P1)

**Beats.** BeakerBot enters from stage left (head of the runway), struts down the lit catwalk toward the pit with a confident bob-and-sway walk cycle, hits his mark center-front, strikes a freeze pose (`cheering` or `bow-wink`), and the pit erupts in flashes. Holds the freeze a beat, then a small hair-flick and he is done.

**Composes from.** The skateboard scene already moves the bot horizontally across the viewport with a translate timeline and a vertical anchor (`bottomY`), and the coffee scene already does a "walk on, do a thing, walk off" structure with `botTranslateX` + a bob (`botBobPx`). The strut is those two patterns minus the props: a left-to-right (or back-to-front, using scale to fake perspective) translate, the existing idle-bob applied as a walk sway, ending on an existing freeze pose. Flashbulbs reuse the R2.5 burst component. The catwalk panels reuse the R2.5 panel.

**Difficulty.** Medium. No new bot art (poses already exist). New work is the walk-cycle timing curve (a sway + bob loop) and the perspective scale ramp if walking front-to-back. Mostly a new timeline over existing primitives. This is the signature scene of the whole page and the most worth building first.

### 2. The Twirl / Spin (RECOMMENDED for P1)

**Beats.** BeakerBot plants center stage and does a celebratory 360 (or a double spin), trailing rainbow motion streaks that arc behind him, settling on a `cheering` freeze with a flash. Short (about 1.5s), joyful, very gif-able.

**Composes from.** A CSS `rotateY` (or `rotate`) on the bot wrapper is trivial. The rainbow trail is the genuinely new bit: a set of fading arc strokes in the five liquid colors (`#FFD2B0 #FFF1A8 #B7EBB1 #A6D2F4 #D6B5F0`), spawned per-frame like the existing particle arrays (`VOLCANO_PARTICLES` shape: `{cx, cy, fill, delayMs, endX, endY}`), but laid out on a circular path instead of a fountain. End on `cheering`.

**Difficulty.** Medium. The spin is cheap; the rainbow trail wants a few hours of tuning to look like motion-blur ribbons and not a smear. High joy-to-effort ratio. Strong P1 pick because it is the purest "rainbow celebration" beat and reuses the particle system everyone already understands.

### 3. The Curtain Reveal (RECOMMENDED for P1)

**Beats.** The two side curtains (already part of the set) sweep closed over the stage, hold a beat of anticipation, then part dramatically to reveal BeakerBot already mid-pose under a brightening spotlight (a "ta-da" `cheering` or `amazed`), flashes popping as the curtains clear.

**Composes from.** The curtains are R1 Performance Hall chrome (two halves, CSS `transform: translateX`), reused here as a transition. The spotlight brighten is the R2.5 radial-gradient with an opacity ramp. The revealed bot is any existing pose. This doubles as the **page-entry / click-unlock transition** (R2.7), so building it pays for two features at once.

**Difficulty.** Low to medium. All CSS transforms on existing chrome + an existing pose. No new bot art. Cheap and high-impact, and it is the natural "the stage is yours" moment for the unlock. Build it in P1 because the unlock depends on it.

### 4. The Death Drop (P2 or P3, the showstopper)

**Beats.** The iconic dramatic drop, done cutely and safely for a beaker (he cannot actually fall flat without spilling, and that is the joke). BeakerBot raises both arms (`cheering`), tips back with a dramatic lean, and instead of slamming down he does a controlled tip onto a hidden cushion / a gentle bounce-landing, liquid sloshing but not spilling, lands in a triumphant `bow-wink`. A big flash on the landing.

**Composes from.** This needs the most new art: a tip-back rotation, a sloshing-liquid wobble (the volcano pose already animates the liquid reacting, so the liquid-wobble primitive partly exists), and a soft landing. The cushion / safe-landing is a small new prop. Reuses `cheering` and `bow-wink` as bookend poses.

**Difficulty.** High. The cute-and-safe execution is the whole point and it is fiddly to make the drop read as glamorous-not-painful while keeping it physically safe for a liquid-filled beaker. The single best "users will screenshot this" moment, but it needs real animation polish. P2 if there is appetite, else the P3 centerpiece. Worth it but not first.

### 5. The Dance Number (P3)

**Beats.** A short choreographed bounce/sway sequence: BeakerBot grooves through a few-beat routine (step-touch sway, a bounce, a little shimmy, a pose-and-hold), rainbow confetti raining down throughout, ending on a `cheering` freeze with a flash flurry. The closer of the whole show.

**Composes from.** The bounce/sway is the existing idle-bob and `bouncing` keyframes sequenced into a routine. Confetti is the particle system (the five rainbow colors) raining downward (inverse of the volcano fountain). End on `cheering`.

**Difficulty.** Medium to high. No new bot art, but choreographing the beats so it reads as a *dance* and not a random twitch is the work, plus a confetti system that does not tank performance. This is the "full dance" Grant floated. P3 finale once the simpler scenes prove the stage.

### 6. The Duckwalk (P3, optional)

**Beats.** BeakerBot does a low, bouncy duckwalk across the front of the stage (the iconic crouched runway walk), bobbing on each step, flashes tracking him.

**Composes from.** A horizontal translate (like the strut) but with a low vertical squash-bob per step. Reuses the strut's translate timeline with a different vertical curve. No new poses.

**Difficulty.** Medium. Mostly a variant of the Runway Strut with a different walk curve. Lower priority than the strut itself; ship it as a strut variant later if the strut lands well.

### 7. The Shantay / Curtsy + Throwing Shade (P3, optional pair)

**Beats.** Two tiny grace-note scenes. *The Curtsy*: a gracious dip-and-bow (a deeper `bow-wink` with a hold), a single dignified flash. *Throwing Shade*: a playful wink-and-point combo (`bow-wink` wink + `pointing` arm) with a sly sideways glance, one cheeky flash. Both are short reaction beats, not full numbers.

**Composes from.** Both are recombinations of existing poses (`bow-wink`, `pointing`) with small timing tweaks. No new art.

**Difficulty.** Low. Pose recombinations. Cheap delight to sprinkle in P3. "Throwing shade" stays affectionate (a playful wink, never an insult) per the tone rule.

### Recommended build order

- **P1 (build first): the Curtain Reveal, the Runway Strut, the Twirl/Spin.** Rationale: the Curtain Reveal doubles as the click-unlock transition (so it earns its keep twice), the Runway Strut is the signature drag-stage moment that defines the whole page, and the Twirl is the cheapest pure-joy rainbow beat with the best effort-to-delight ratio. All three reuse existing poses + the existing particle/translate primitives, so P1 needs no new bot art.
- **P2: the Death Drop.** The showstopper, but it needs new animation art (the safe-drop + liquid slosh), so it waits until the stage is proven.
- **P3: the Dance Number** (the full choreographed closer) plus the optional grace notes (Duckwalk, Curtsy, Throwing Shade).

## R2.3 The Performance Hall (existing 9 scenes), restyled for the stage

R1 §3, §4, §6 keep the framed-proscenium, one-scene-at-a-time approach (IntersectionObserver sequencer for the MVP, then the optional `bounds` prop migration). R2 only restyles the frames to match the drag stage. The structural plan is unchanged; read R1 for it.

**Restyled frame: a marquee-lit proscenium.** Each act's stage box gets a bulb-light arch across the top (the same chasing-bulb treatment as the backdrop marquee, scaled down), the deep-plum side curtains as the frame edges, a gold-ish valance swag, and footlight glow along the bottom lip. The resting (curtain-down) state shows the curtains drawn with the act's "NOW PERFORMING" placard reading as the marquee title; the active state raises the curtains and the scene plays inside. (Marquee-lit proscenium snippet in R2.5.)

**The three awkward scenes (R1 §6), concrete in-frame treatment:**

- **MouseWave.** Its whole hook is waving near the cursor, which is meaningless in a fixed stage box. In-frame treatment: render a **faux cursor** inside the stage (a small inline-SVG arrow pointer that drifts in from the frame edge to a target point), and BeakerBot waves at the faux cursor. The gag survives because the stage supplies its own "cursor" to wave at. Caption: "now performing: THE GREETING".
- **Skateboard.** Cruises the full viewport width; a narrow box crops the cruise. In-frame treatment: give this one act a **wide letterbox stage** (a cinematic ~21:9 frame spanning the full page width as an intermission band, breaking the uniform proscenium grid for one act). The skateboard's `bottomY=85%` anchor and full-width translate then have room to read. Caption styled as an "INTERMISSION" band so the format break feels intentional, not broken.
- **CoffeeRefill.** 13s total with an 8s brew wait as the gag (verified: `TOTAL_DURATION_MS = 13000`, `brewing: 8000`). At frame size the long wait risks reading as frozen. In-frame treatment: add a **progress shimmer**, a thin rainbow progress bar (or a filling-pot fill-line) along the bottom of the frame that advances across the 13s, plus a small "the wait is the look" caption so the patience reads as intentional drama, not a hang. The shimmer is showcase chrome layered over the scene, not a change to the scene component.

**"Now performing" caption per stage.** Every act frame carries a marquee placard pulling the act's real `name` + `description` from `BEAKERBOT_ANIMATION_CATALOG`. Active state: "NOW PERFORMING: [name]". Resting state: the name as the drawn-curtain marquee title with a small "tap to replay" affordance.

The act running order from R1 §6 (open on a greeting, build to the big physical gags, close on interactive BlowingBubbles) carries over; on the drag stage it reads as a show bill, so the order is the set list.

## R2.4 Page chrome and mood

### Hero / marquee header: "BeakerBot Live"

The page opens on a **show-bill marquee**, the kind you would see outside a theater. A big bulb-lit title, drag-show-bill styling:

> **BEAKERBOT** *live*
> ONE BEAKER. TWENTY-ONE LOOKS. ONE STAGE.
> *the category is... everything*

The title `BEAKERBOT` in chasing bulb-lights over the rainbow backdrop sweep, `live` in a glamorous script-ish accent, a tagline that counts the looks, and a "the category is... everything" kicker that sets the homage tone immediately and warmly. A single waving BeakerBot under a warming spotlight stands center, with a "scroll to begin the show" cue. This replaces R1's plainer "curtain-up intro" with the drag-bill framing.

### Palette and typography

The app theme is deliberately minimal (Tailwind v4, default utility palette, white `#ffffff` / near-black `#171717` base, `text-sky-500` as BeakerBot's tint, Geist Sans / Geist Mono fonts, verified in `globals.css` and `BeakerBot.tsx`). The showcase is an easter-egg room, so it gets to be theatrical and dark where the rest of the app is light, but it must still ground in the real tokens so it composes:

- **Base:** a deep theater dark (near `#0b0b12`, a touch warmer/cooler than the app's `#171717` foreground to read as "stage black" not "dark mode"), so the spotlights and rainbow pop. This is the one place the app goes dark; that contrast is exactly what sells "you found the secret stage."
- **Rainbow:** BeakerBot's five liquid stops are the canonical palette and recur everywhere: `#FFD2B0` (peach), `#FFF1A8` (yellow), `#B7EBB1` (mint), `#A6D2F4` (sky), `#D6B5F0` (lavender). The backdrop sweep, confetti, motion trails, and progress shimmer all draw from exactly these five so the page reads as "made of BeakerBot's own colors."
- **Accent metals:** a soft gold (`#E7C873`-ish) for the valance, bulb glow, and category-card frames. Gold + jewel-tone curtains + rainbow is the glamour triad.
- **Bot tint:** stays `text-sky-500` with the hardcoded rainbow liquid, identical to everywhere else in the app. He does not get re-colored; he is already the rainbow.
- **Type:** keep Geist Sans for body / captions (grounds in the app). For the marquee + category cards, an optional theatrical display face loaded only on this route (a condensed bold for "THE CATEGORY IS", a glamorous high-contrast serif or a tasteful script for "live"); flagged, since adding a webfont is a real (if small) cost and Geist-bold-uppercase-tracked-wide can carry the marquee look without a new font if Grant prefers zero new dependencies.

The palette is theatrical, glamorous, rainbow-forward, and grounded in the exact five colors BeakerBot already is, so nothing drifts from the mascot.

### The click-unlock moment

The existing per-click heart easter egg fires on **every** BeakerBot click (`handleClick` to `spawnHeart()`, capped at 6 concurrent, verified in `BeakerBot.tsx`). The showcase unlock is an **escalation that composes on top**, it does not replace the hearts:

- **Count:** clicks 1 through N-1 spawn hearts as today. On click **N** (recommend **7**, the "lucky" feel R1 floated; Grant's call), the backstage door opens. The counter is per-session and resets so it stays a delight, not a chore.
- **Which BeakerBot instance:** the **AppShell brand-mark BeakerBot** is the canonical trigger (it is the most-present, most-clicked instance and the natural "front door"). The public `/demo` BeakerBot should also trigger it so public visitors can find the stage too (audience is members AND `/demo`). Other decorative instances (settings header, tip cards) stay hearts-only to avoid surprise navigations mid-task. Flagged for confirmation.
- **What the reveal feels like:** on click 7, instead of a 7th heart, the screen dims to stage-black from the edges inward, the deep-plum curtains sweep IN across the whole viewport (the **Curtain Reveal** scene from R2.2, which is why it is a P1 build), a beat of held black, then the curtains part to reveal the BeakerBot Live marquee, and the route transitions to `/showcase`. A soft "the stage is yours" toast can confirm for users who want the words. Net feeling: the cute beaker you have been pestering finally says "fine, come backstage, watch me work", and the curtains literally open on his show. Recommend the curtain-sweep transition over plain confetti: confetti is the *reward inside* the show (the dance number, the twirl), the *entry* should feel like a theater going dark and the curtain rising.

### Reduced-motion fallback

Every existing scene already honors `prefers-reduced-motion` (verified: `matchMedia("(prefers-reduced-motion: reduce)")` with a static "done"-state fallback in the scene components). The showcase chrome must match, and the fallback should stay **glamorous, just static**:

- **Runway:** the spotlight is a static (non-sweeping) lit ellipse on the mark; BeakerBot holds the pose statically (poses already fall back to static silhouettes); flashbulbs do not strobe but render as a single soft static glow in the pit (a flash *captured*, not flashing). Category cards appear without the flip animation. The rainbow backdrop is a static gradient, not a sweep. It still looks like a queen lit on a stage, it just does not move.
- **Flashes:** no bursts; instead a constant gentle bloom near the pit so the "photographed" mood survives without motion.
- **Curtains:** drawn open statically (no sweep); the reveal is an instant cut to the open stage rather than an animated part.
- **Scenes:** unchanged, they already fall back to their static done-states.
- **Confetti / trails / dance:** suppressed entirely (these are pure motion), replaced by a static "she served" freeze-frame of the end pose.

Non-negotiable, and it is already the house pattern; the fallback is "the show, paused on its best freeze-frame," which is still glam.

## R2.5 Illustrative snippets (doc-only, NOT wired into the app)

Clearly illustrative. None of this is imported or rendered anywhere. It is here so the implementation chips have concrete starting values. No emojis (custom SVGs only, per project rule).

### Flashbulb burst (inline-SVG + CSS keyframe)

```tsx
// ILLUSTRATIVE ONLY. A single photographer's flashbulb pop. Render
// several of these scattered along the pit with staggered delays
// (mirror the VOLCANO_PARTICLES delayMs stagger: 0, 40, 80, 120ms)
// so it reads as a crowd of cameras, not one strobe.
function FlashBurst({ delayMs = 0 }: { delayMs?: number }) {
  return (
    <svg viewBox="0 0 40 40" className="flash-burst" style={{ animationDelay: `${delayMs}ms` }} aria-hidden>
      {/* hot white core */}
      <circle cx="20" cy="20" r="4" fill="#ffffff" />
      {/* radial spikes, four cardinal + four diagonal */}
      <g stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round">
        <line x1="20" y1="20" x2="20" y2="4" />
        <line x1="20" y1="20" x2="20" y2="36" />
        <line x1="20" y1="20" x2="4"  y2="20" />
        <line x1="20" y1="20" x2="36" y2="20" />
        <line x1="20" y1="20" x2="9"  y2="9" />
        <line x1="20" y1="20" x2="31" y2="9" />
        <line x1="20" y1="20" x2="9"  y2="31" />
        <line x1="20" y1="20" x2="31" y2="31" />
      </g>
    </svg>
  );
}
```

```css
/* ILLUSTRATIVE ONLY. The pop: snap to bright, fast decay, like a real
   xenon flash. transform-origin center so the spikes burst outward. */
.flash-burst {
  position: absolute;
  width: 56px; height: 56px;
  opacity: 0;
  transform: scale(0.4);
  animation: flashPop 360ms ease-out forwards;
}
@keyframes flashPop {
  0%   { opacity: 0;    transform: scale(0.4); }
  12%  { opacity: 1;    transform: scale(1.15); }  /* hot peak */
  30%  { opacity: 0.85; transform: scale(1.0); }
  100% { opacity: 0;    transform: scale(0.95); }
}
/* Ambient pit flicker between bursts: a low, slow opacity wander so
   the photographers' pit is never fully dead. */
@keyframes pitFlicker {
  0%, 100% { opacity: 0.10; }
  50%      { opacity: 0.22; }
}
@media (prefers-reduced-motion: reduce) {
  .flash-burst { animation: none; opacity: 0.6; transform: scale(1); }
}
```

### A lit catwalk panel

```css
/* ILLUSTRATIVE ONLY. One light-up runway panel. Tile a grid of these
   down the perspective trapezoid; offset --panel-index per cell so the
   traveling highlight chases head-to-foot down the runway toward the
   pit. Colors stay cool/neutral so they don't fight BeakerBot's rainbow;
   the rainbow lives in the backdrop + confetti, the floor is "stage
   light" white-blue. */
.catwalk-panel {
  background: linear-gradient(
    180deg,
    rgba(180, 210, 255, 0.06) 0%,
    rgba(180, 210, 255, 0.18) 100%
  );
  border: 1px solid rgba(180, 210, 255, 0.14);
  /* the chase: each panel pulses on a delay tied to its position so
     the glow runs down the runway */
  animation: panelPulse 2.4s ease-in-out infinite;
  animation-delay: calc(var(--panel-index, 0) * -0.12s);
}
@keyframes panelPulse {
  0%, 100% { background-color: rgba(180, 210, 255, 0.04); }
  50%      { background-color: rgba(180, 210, 255, 0.28); }
}
@media (prefers-reduced-motion: reduce) {
  .catwalk-panel { animation: none; background-color: rgba(180, 210, 255, 0.12); }
}
```

```css
/* ILLUSTRATIVE ONLY. The tracking spotlight cone on BeakerBot's mark.
   Bright warm core falling to near-black at the stage edges. The
   sweep (find-the-queen) is a short translate+brighten on look change. */
.runway-spotlight {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 320px 420px at 50% 38%,   /* core over the bot mark */
    rgba(255, 248, 230, 0.92) 0%,     /* warm white core */
    rgba(255, 244, 214, 0.45) 28%,
    rgba(20, 18, 30, 0.78) 62%,
    rgba(11, 11, 18, 0.96) 100%       /* stage black at the edges */
  );
  animation: spotWarmUp 700ms ease-out;
}
@keyframes spotWarmUp {
  0%   { opacity: 0.35; transform: translateX(-6%); }   /* sweep in */
  100% { opacity: 1;    transform: translateX(0); }      /* settle on mark */
}
@media (prefers-reduced-motion: reduce) {
  .runway-spotlight { animation: none; opacity: 1; }     /* static lit ellipse */
}
```

### A "the category is..." placard

```tsx
// ILLUSTRATIVE ONLY. The category title card. `category` is the
// collection-level homage line; `look` is the per-pose name pulled from
// BEAKERBOT_ANIMATION_CATALOG. Flips up into the clear zone between the
// bot and the pit so it never overlaps BeakerBot.
function CategoryPlacard({ category, look }: { category: string; look: string }) {
  return (
    <div className="category-placard" role="status" aria-live="polite">
      <span className="category-kicker">THE CATEGORY IS&hellip;</span>
      <span className="category-name">{category}</span>
      <span className="look-name">{look}</span>
    </div>
  );
}
```

```css
/* ILLUSTRATIVE ONLY. Gold-framed card on stage black, flips up on entry. */
.category-placard {
  position: absolute;
  left: 50%; top: 62%;
  transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 12px 28px;
  background: rgba(11, 11, 18, 0.72);
  border: 1.5px solid #E7C873;                 /* soft gold frame */
  border-radius: 12px;
  box-shadow: 0 0 24px rgba(231, 200, 115, 0.35);
  animation: placardFlipUp 520ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  transform-origin: center bottom;
}
.category-kicker { font-size: 0.72rem; letter-spacing: 0.28em; color: #E7C873; text-transform: uppercase; }
.category-name   { font-size: 1.4rem;  font-weight: 800; letter-spacing: 0.06em; color: #fff; text-transform: uppercase; }
.look-name       { font-size: 0.9rem;  letter-spacing: 0.14em; color: #A6D2F4; text-transform: uppercase; } /* BeakerBot sky stop */
@keyframes placardFlipUp {
  0%   { opacity: 0; transform: translateX(-50%) rotateX(-90deg); }
  100% { opacity: 1; transform: translateX(-50%) rotateX(0deg); }
}
@media (prefers-reduced-motion: reduce) {
  .category-placard { animation: none; }       /* appears, no flip */
}
```

### A marquee-lit proscenium frame (Performance Hall act)

```tsx
// ILLUSTRATIVE ONLY. The frame each existing scene performs inside.
// Curtains drawn = resting (poster); raised = active (scene plays).
// In the Option-3 MVP the active scene still portals full-screen; once
// a scene gains the R1 §4 `bounds` prop it performs INSIDE `stageRef`.
function ProsceniumFrame({
  title, active, stageRef, children,
}: {
  title: string;
  active: boolean;
  stageRef: React.Ref<HTMLDivElement>;
  children: React.ReactNode;  // the scene, or the resting poster
}) {
  return (
    <figure className="proscenium" data-active={active}>
      {/* chasing bulb-light arch across the top */}
      <div className="proscenium-bulbs" aria-hidden>
        {Array.from({ length: 14 }).map((_, i) => (
          <span key={i} className="bulb" style={{ animationDelay: `${i * -0.1}s` }} />
        ))}
      </div>
      {/* gold valance swag */}
      <div className="proscenium-valance" aria-hidden />
      {/* the two plum curtains that raise/part when active */}
      <div className="curtain curtain-left" aria-hidden />
      <div className="curtain curtain-right" aria-hidden />
      {/* the stage the scene plays inside (bounds target, P2+) */}
      <div className="proscenium-stage" ref={stageRef}>{children}</div>
      {/* footlight glow along the bottom lip */}
      <div className="proscenium-footlights" aria-hidden />
      <figcaption className="proscenium-placard">
        {active ? "NOW PERFORMING" : "TAP TO REPLAY"} &middot; {title}
      </figcaption>
    </figure>
  );
}
```

```css
/* ILLUSTRATIVE ONLY. */
.proscenium {
  position: relative;
  aspect-ratio: 16 / 10;
  background: #0b0b12;
  border: 2px solid #E7C873;                   /* gold frame */
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 0 36px rgba(231, 200, 115, 0.22);
}
.proscenium-bulbs { position: absolute; inset: 0 0 auto 0; display: flex; justify-content: space-around; padding: 6px 10px; }
.bulb {
  width: 8px; height: 8px; border-radius: 50%;
  background: #fff6d8;
  box-shadow: 0 0 6px 2px rgba(255, 246, 216, 0.8);
  animation: bulbChase 1.4s ease-in-out infinite;
}
@keyframes bulbChase { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
.curtain { position: absolute; top: 0; bottom: 0; width: 52%; background:
  repeating-linear-gradient(90deg, #3a1d3d 0 14px, #4a2750 14px 28px);  /* pleated plum */
  transition: transform 700ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.curtain-left  { left: 0;  transform: translateX(0); }
.curtain-right { right: 0; transform: translateX(0); }
.proscenium[data-active="true"] .curtain-left  { transform: translateX(-100%); }  /* part open */
.proscenium[data-active="true"] .curtain-right { transform: translateX(100%); }
.proscenium-valance { position: absolute; top: 0; left: 0; right: 0; height: 26px;
  background: linear-gradient(#E7C873, #b9923f); border-bottom: 2px solid #8a6a2c; }
.proscenium-footlights { position: absolute; left: 0; right: 0; bottom: 0; height: 18px;
  background: radial-gradient(ellipse at center bottom, rgba(255,246,216,0.5), transparent 70%); }
.proscenium-placard { position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%);
  font-size: 0.72rem; letter-spacing: 0.18em; color: #E7C873; text-transform: uppercase; }
@media (prefers-reduced-motion: reduce) {
  .bulb { animation: none; opacity: 0.85; }
  .curtain { transition: none; }   /* curtains snap, no sweep */
}
```

## R2.6 Where the snippets ground in real code

So implementation chips know these are not invented:

- **128px bot, `text-sky-500` tint, rainbow liquid:** `BEAKERBOT_SCENE_SIZE_PX = 128` and `BEAKERBOT_SCENE_SIZE_CLASS = "w-32 h-32"` (`scene-constants.ts`); liquid stops `#FFD2B0 / #FFF1A8 / #B7EBB1 / #A6D2F4 / #D6B5F0` (`BeakerBot.tsx` lines 517 to 523).
- **Particle stagger pattern** for the flashbulb crowd: `VOLCANO_PARTICLES` / `HICCUP_POP_PARTICLES` arrays with per-item `delayMs` and `endX/endY` in 0-40 viewBox units (`BeakerBot.tsx`).
- **Scene envelope** the new scenes plug into: `{ active, onComplete? }`, `createPortal` to `document.body`, `position: fixed`, `SCENE_Z_INDEX = 800`, `matchMedia("(prefers-reduced-motion: reduce)")` with a static done-state fallback (every scene component).
- **Per-click heart easter egg** the unlock composes on top of: `handleClick` to `spawnHeart()`, `HEART_MAX_CONCURRENT = 6`, `HEART_FILL = "#ff5b8a"` (`BeakerBot.tsx`).
- **CoffeeRefill timing** the progress shimmer paces against: `TOTAL_DURATION_MS = 13000`, `brewing: 8000` (`BeakerBotCoffeeRefillScene.tsx`).
- **Skateboard full-width cruise** the letterbox stage accommodates: `bottomY = 85`, `window.innerWidth` snapshot translate (`BeakerBotSkateboardScene.tsx`).
- **Theme tokens** the dark palette grounds against: app base `#ffffff` / `#171717`, Geist Sans / Geist Mono, default Tailwind palette (`globals.css`).

## R2.7 Updated build phases

Supersedes R1 §9 with the drag-stage scope folded in. Structure / containment plan (R1 §4) is unchanged; this re-phases around the drag staging.

### P1: the smallest playable drag stage

- New `/showcase` route, no nav link (R1 §5).
- The drag main stage set: rainbow backdrop sweep + `BEAKERBOT` bulb marquee, plum side curtains + gold valance, the light-up catwalk panels, the tracking spotlight, the photographers' pit with flashbulb bursts.
- All 21 poses as looks: each in a full-stage scroll frame (snap-scroll), spotlight reveal, flashbulb pops, "the category is..." placards driven by `BEAKERBOT_ANIMATION_CATALOG`, the five collections as category interstitials.
- All 9 existing scenes in restyled marquee-lit prosceniums, Option-3 IntersectionObserver sequencer (one active at a time, no overlap), "now performing" placards, the three awkward-scene treatments (MouseWave faux cursor, Skateboard letterbox intermission, CoffeeRefill progress shimmer).
- The 3 P1 new scenes: **Curtain Reveal, Runway Strut, Twirl/Spin** (all reuse existing poses + particle/translate primitives, no new bot art).
- The click unlock: clicks 1 to 6 spawn hearts as today, click 7 fires the Curtain Reveal transition into `/showcase`; AppShell brand mark + `/demo` BeakerBot as triggers.
- "BeakerBot Live" marquee hero + curtain-call footer.
- Reduced-motion fallbacks throughout (static-but-glam).

### P2: the showstopper + framed containment

- The **Death Drop** scene (needs new safe-drop + liquid-slosh art).
- Begin the R1 §4 Option-1 `bounds`-prop migration: graduate the easy scenes (Eureka, Centrifuge, BugStomp) from full-screen takeover to performing INSIDE their prosceniums; defer Skateboard / CoffeeRefill / MouseWave.

### P3: the full dance + polish

- The **Dance Number** (choreographed closer, rainbow confetti).
- Optional grace notes: **Duckwalk, Curtsy, Throwing Shade**.
- Finish the `bounds` migration for the remaining scenes.
- Captured-shots contact sheet (R1 Concept B graft), ambient idle between acts, optional encore row for the 3 pose-celebration wrappers.
- Sound only if Grant green-lights (default OFF, gated behind a gesture).

## R2.8 Summary of the drag-stage direction

The showcase is BeakerBot's drag main stage: a lit catwalk receding into a photographers' pit, a `BEAKERBOT` bulb-light marquee over a rainbow backdrop sweep, plum curtains and a gold valance framing the stage. BeakerBot is the queen working the runway. You scroll, the spotlight finds him, he serves each of his 21 emotions as a "look", the cameras flash, and a "THE CATEGORY IS..." placard names the moment. Below the runway, the 9 existing scenes play as acts in marquee-lit prosceniums. It is a loving, rainbow-forward homage to drag culture: glamour, confidence, joy, never caricature. The rainbow (BeakerBot's own five liquid colors) is the through-line of every surface.

## R2.9 New open questions for Grant (drag-stage specific)

The R1 §8 questions are mostly settled by the dispatch brief. These are new, raised by the drag-stage direction:

1. **Category names:** the five "THE CATEGORY IS..." lines (OPENING NUMBER REALNESS, PURE JOY SERVED, SOFT GLAMOUR, EXECUTIVE LAB REALNESS, HIGH DRAMA DARLING) are proposals. Keep, rename, or write your own? (You know the references better than I do; I aimed for affectionate, not in-jokey-to-the-point-of-exclusion.)
2. **New display font:** load a theatrical webfont on this route for the marquee + category cards (more glam, small cost + dependency), or carry the look with Geist bold + wide tracking + uppercase (zero new dependency)?
3. **Unlock click count + instances:** confirm 7 clicks, and confirm AppShell brand mark + `/demo` BeakerBot as the trigger instances (settings/tip-card instances stay hearts-only)?
4. **Death Drop appetite:** it is the best screenshot moment but needs the most new art (a safe drop + liquid slosh). Build it in P2, or hold it for P3?
5. **Stage-black on `/demo`:** the public `/demo` is light-themed; the showcase goes dark for the stage effect. Confirm the dark takeover is fine for public visitors, or should `/demo` get a lighter "matinee" variant?
6. **Runway length:** 21 full-stage look frames + 5 category interstitials is a long (about 2400svh) scroll. Keep it full-length with a "skip to the scenes" pin, or tighten (e.g. two looks per frame for the lower-energy collections)?

---

*R2 sketches are illustrative. No routes, scene props, or components were built. The drag-stage direction and new scenes are design proposals; hand-off to implementation chips happens after Grant locks the R2.9 questions. Authored by the showcase-drag-stage sub-bot per orchestrator manager dispatch.*

---
---

# Visual Design (R3): Build-Ready Spec + Category Menu

**Author:** showcase-spec sub-bot (dispatched by orchestrator manager)
**Date:** 2026-05-29
**Status:** Build-ready spec. Builds on R1 (concept) and R2 (the Drag Main Stage visual direction). Still doc-only: no routes, no scene props, no components built. Every snippet below is illustrative and lives inside this doc. The goal of R3 is that a build sub-bot can scaffold the showcase with zero further design decisions left to make.

## R3.0 What Grant locked after R2, folded in here

Grant reviewed R2 and locked three more decisions. R3 bakes them in:

1. **Dark stage-black takeover EVERYWHERE, including the public `/demo`.** No light "matinee" variant. R2.9 question 5 is answered: the dramatic dark house IS the experience in both the app and the demo. So this spec does not carry a light variant. The one thing it does address is the transition INTO the dark takeover so it does not jar against the light demo chrome: the Curtain Reveal dim handles it (R3.9), dimming the page to stage-black from the edges inward before the curtains ever move, so the light demo never hard-cuts to black.
2. **Category names come from a fuller menu.** R2.9 question 1 floated five collection-level lines. Grant wants to pick from a wider set, and he wants per-pose category names (not just per-collection), so R3.1 drafts a wide menu: 2 to 4 candidate "THE CATEGORY IS..." names per pose across all 21 poses, in tasteful drag-show voice crossed with lab and science wordplay. A single starred favorite per pose gives Grant a default if he wants to rubber-stamp, but nothing is finalized to one each. He picks.
3. **One more pass to a build-ready spec.** Every visual from R2 is made concrete enough to implement: exact dimensions, exact keyframes, exact gradient values, the component breakdown with props contracts. R3.2 through R3.11 do this. The R2 collection-level lines are retired in favor of the per-pose menu in R3.1; collection interstitials now draw their header from whichever per-pose names Grant picks (see R3.1's note on collection headers).

Where R3 and R2 conflict, R3 wins, because R3 is the version that ships. Where R3 is silent, R2 (and under it R1) stands.

## R3.1 The Category Menu (THE CATEGORY IS...)

The runway is BeakerBot's drag main stage and every look gets a "THE CATEGORY IS..." card. R2 framed those at the collection level. R3 moves them to the **per-pose** level so each of the 21 looks gets its own announced category, with the five R2 collections (R1 section 6, reused verbatim) as the grouping scaffold.

**Voice rules (non-negotiable, from the dispatch brief and R2's tone section):**

- RuPaul's-Drag-Race runway-category cadence: "THE CATEGORY IS... Executive Realness", "Eleganza Extravaganza", "Night of 1000...". Celebratory, clever, confident.
- Crossed with lab and science wordplay (eleganza meets the electron microscope).
- Always loving, never mocking, never a stereotype, never a punchline at drag's expense. The bar from R2: would this read as warmth and respect, or as mockery? Only the first kind is in the menu.
- No emojis. No em-dashes.

**How to read the menu:** each pose lists 2 to 4 candidate category names. The starred (`*`) one is the spec's recommended default; the rest are the menu Grant picks from. Grant can mix, rename, or write his own. The per-pose `name` and `description` still come from `BEAKERBOT_ANIMATION_CATALOG` and render on the look card underneath the category line (R2's two-tier card: kicker "THE CATEGORY IS...", then the category name big, then the look name from the catalog). The category names below are the middle line.

**Collection headers:** the five collections still punctuate the scroll as interstitials (R2's "category interstitial" frames). Each collection interstitial draws its header from the collection's lead pose's chosen category name, or Grant can write a dedicated five-collection header set (the R2 lines OPENING NUMBER REALNESS / PURE JOY SERVED / SOFT GLAMOUR / EXECUTIVE LAB REALNESS / HIGH DRAMA DARLING are still available for that purpose). The per-pose menu below is the primary deliverable; the collection headers are a thin layer on top.

### Collection 1: The Greetings (idle, waving, bouncing, bow-wink)

| Pose | "THE CATEGORY IS..." candidates |
|---|---|
| **idle** | * Resting Reaction Realness / Steady State Eleganza / Equilibrium, Darling / The Control Group |
| **waving** | * A Warm Welcome, Serotonin-Approved / Hello, Hypothesis / Greetings From The Bench / Salutations Realness |
| **bouncing** | * Spring In Her Step (And Her Springs) / Kinetic Energy, Served / Bounce Rate: Zero / Buoyancy Eleganza |
| **bow-wink** | * The Curtsy And The Wink / Charm Offensive, Peer-Reviewed / A Wink Worth Citing / Coquette Catalyst |

### Collection 2: The Big Feelings (cheering, giggle, rolling-laughing, amazed)

| Pose | "THE CATEGORY IS..." candidates |
|---|---|
| **cheering** | * Eureka Eleganza / Breakthrough Realness / Hypothesis: Confirmed / Standing Ovation, Statistically Significant |
| **giggle** | * The Giggles, Catalyzed / Bubbling Over (Effervescence Realness) / A Light Reaction / Mirth In Suspension |
| **rolling-laughing** | * Dying. Literally. Of Laughter. / Reaction Of The Year / Exothermic Hysterics / ROFL, Replicated |
| **amazed** | * Gagged At The Microscope / Wonderstruck Realness / Serving Scientific Awe / Astonished, Under Magnification |

### Collection 3: The Quiet Looks (thinking, reading, sleeping, yawn)

| Pose | "THE CATEGORY IS..." candidates |
|---|---|
| **thinking** | * Pensive Eleganza / The Hypothesis Brewing / Contemplation, Peer-Reviewed / A Quiet Eureka, Loading |
| **reading** | * Literature Review Realness / Devouring The Methods Section / Booked And Busy / Citation Eleganza |
| **sleeping** | * Beauty Sleep, Incubating / Overnight Culture / Dormant Phase Glamour / Resting Beautifully (Cells Pending) |
| **yawn** | * The Long Incubation / Diauxic Shift Realness / A Well-Earned Stretch / Languid Lab Eleganza |

### Collection 4: The Lab Life (typing, typing-on-laptop, pointing, pointing-up, pointing-down)

| Pose | "THE CATEGORY IS..." candidates |
|---|---|
| **typing** | * Executive Lab Realness / Manuscript In Progress / Keystroke Couture / Drafting At The Bench |
| **typing-on-laptop** | * Working Hypothesis, Mobile Edition / Field Notes Eleganza / Productivity, Portable / Remote Bench Realness |
| **pointing** | * The Direction Is Clear / Stage Directions, Darling / Serving Sign-Posts / This Way To The Data |
| **pointing-up** | * Onward And Upward Realness / Aim For The Hypothesis / Reaching For Significance / The Sky-Bound Cite |
| **pointing-down** | * Down To The Footnotes / The Fine Print, Served / Grounded Eleganza / Right Here, In The Data |

The pointing trio stays de-emphasized per R1 and R2 (a tight three-up "the directors" mini-row inside The Lab Life, not three full hero frames). The three category names above let the mini-row caption each arm with its own tiny placard if Grant wants, or the trio can share one card (lead pose `pointing`, starred "The Direction Is Clear") with the other two un-carded. Either way the menu covers all three.

### Collection 5: The Drama (panicked, embarrassed, hiccup, volcano-eruption)

| Pose | "THE CATEGORY IS..." candidates |
|---|---|
| **panicked** | * High Drama, Darling / Catastrophic Reaction Realness / The Lab Is On Fire (Figuratively) / Serving Five-Alarm Eleganza |
| **embarrassed** | * Contamination, But Make It Fashion / Failed Replicate Realness / Sheepish Sample Glamour / Oops, Peer-Reviewed |
| **hiccup** | * Effervescent Mishap / The Unexpected Bubble / Carbonation Realness / A Reaction, Uninvited |
| **volcano-eruption** | * Exothermic Eleganza / Serving Chemical Reaction / The Showstopper, Erupting / Mount Eleganza |

All 21 poses are covered, each with 2 to 4 candidates and one starred favorite. The starred set, gathered for a quick rubber-stamp read:

idle: Resting Reaction Realness / waving: A Warm Welcome, Serotonin-Approved / bouncing: Spring In Her Step (And Her Springs) / bow-wink: The Curtsy And The Wink / cheering: Eureka Eleganza / giggle: The Giggles, Catalyzed / rolling-laughing: Dying. Literally. Of Laughter. / amazed: Gagged At The Microscope / thinking: Pensive Eleganza / reading: Literature Review Realness / sleeping: Beauty Sleep, Incubating / yawn: The Long Incubation / typing: Executive Lab Realness / typing-on-laptop: Working Hypothesis, Mobile Edition / pointing: The Direction Is Clear / pointing-up: Onward And Upward Realness / pointing-down: Down To The Footnotes / panicked: High Drama, Darling / embarrassed: Contamination, But Make It Fashion / hiccup: Effervescent Mishap / volcano-eruption: Exothermic Eleganza.

## R3.2 Catwalk geometry (exact)

All vertical measures are `svh` (small viewport height) so mobile browser chrome never clips the stage; horizontal are `vw` or `%` of the stage frame. The set (backdrop, marquee, curtains, catwalk, pit) is rendered ONCE behind a transparent scroll column (R2's cheaper option), so the marquee stays continuous and the spotlight is the only thing that moves per look.

**The stage frame (per look).** Each look is one scroll-snap frame, `min-height: 100svh`, `width: 100vw`, `scroll-snap-align: center`, inside a column with `scroll-snap-type: y mandatory`.

**Vertical layout inside a 100svh look frame (top to bottom):**

- 0 to 14svh: the `BEAKERBOT` bulb marquee band + rainbow backdrop wash (R3.3). The marquee sits in this band; the rainbow wash bleeds down behind everything.
- 14 to 30svh: upper dark house (backdrop continues, dim).
- The bot mark: centered horizontally, vertical center at **38svh from the top** (R2's "head of the runway" figure). The 128px bot is centered on this mark.
- 30 to 80svh: the catwalk trapezoid recedes from the bot mark down toward the pit (so the lit floor occupies roughly the lower-middle half).
- ~62svh: the category placard flips up here (R2's clear zone between bot and pit), horizontally centered, never overlapping the bot's 200px clear radius.
- 80 to 100svh: the photographers' pit band (dark front edge nearest the viewer), camera silhouettes + flashbulbs (R3.6).

**The catwalk trapezoid.** A CSS perspective trapezoid using `clip-path: polygon(...)` on a panel grid container. Concrete shape, foot (front, near viewer, wide) at the bottom narrowing to head (back, where the bot stands) at the top:

- Foot width: 78vw, centered (so `11vw` margin each side).
- Head width: 26vw, centered (so `37vw` each side).
- Vertical span: from 30svh (head) to 80svh (foot), a 50svh-tall trapezoid.
- `clip-path: polygon(37vw 30svh, 63vw 30svh, 89vw 80svh, 11vw 80svh)` on the catwalk container (values relative to the look frame; build uses CSS custom props so the trapezoid scales with the frame).
- Perspective recede angle: the head-to-foot width ratio 26:78 = 1:3 gives an apparent recede consistent with a ~62 degree floor rake. No literal CSS `perspective`/`rotateX` is needed; the trapezoid clip plus the panel-row scaling below fakes the recede cheaply and predictably across browsers. (If a build wants true 3D, `transform: perspective(1200px) rotateX(58deg)` on the panel grid is the alternative, but the clip-path approach is the spec default because it has no z-fighting or backface surprises.)

**The lit-panel grid.** The trapezoid floor is tiled with light-up panels (R3.5 has the panel CSS):

- **Rows:** 9 panel rows from head to foot.
- **Columns:** 5 panels per row.
- **Panel sizing:** rows scale with the trapezoid. The head row (back) panels are ~5.2vw wide; the foot row (front) panels are ~15.6vw wide (3x, matching the 1:3 trapezoid ratio). Row height is uniform in screen space at `~5.5svh` per row (50svh / 9 rows), so the rake reads from the width taper, not row-height taper (cleaner, avoids a fish-eye look).
- **Lit-vs-dim timing:** the traveling highlight runs head-to-foot (back to front, toward the pit) so the eye is pulled down the runway. Each panel's `--panel-index` is its row index (0 at head, 8 at foot); `animation-delay: calc(var(--panel-index) * -0.12s)` so the glow chases foot-ward on a 2.4s loop (R3.5 keyframe). All 5 panels in a row share a row index so the highlight reads as a horizontal light-bar sweeping down the runway, not a diagonal scatter.

**Where BeakerBot stands.** The 128px scene-size bot (`BEAKERBOT_SCENE_SIZE_PX = 128`, `BEAKERBOT_SCENE_SIZE_CLASS = "w-32 h-32"`, `text-sky-500` tint, hardcoded rainbow liquid) is centered horizontally on the look frame, vertical center at 38svh. Clear zone: at least a 200px radius of empty lit spotlight around him (R2). The spotlight bright core is sized 320px wide so it comfortably clears the 128px bot (R3.4).

**Photographers' pit placement.** A horizontal band at 80 to 100svh, full frame width, stage-black. 5 to 7 camera silhouettes (R3.6) sit along the 88 to 96svh line, evenly spaced with slight random horizontal jitter (`+/- 2vw` per camera, fixed per camera so it does not jump). Flashbulbs fire from points just above each camera (84 to 88svh). The pit is the darkest band on the stage so the flashes read as bright pops.

## R3.3 The marquee (concrete inline-SVG)

The `BEAKERBOT` bulb-light marquee spelled in round bulbs across the back wall, over a slow rainbow gradient sweep using BeakerBot's five liquid stops (heavily darkened so it sets mood without fighting the lit bot). Bulbs chase left to right on a gentle loop so the sign reads "live."

**Geometry:** the marquee is an inline-SVG sitting in the 0 to 14svh band, horizontally centered, max-width 70vw. The word `BEAKERBOT` is 9 letters; each letter is a small bulb cluster. To keep the snippet legible the spec uses a **bulb-outline-per-letter** approach: each letter is traced by evenly spaced bulb circles (think a theater marquee sign). Bulb spacing: bulbs are `r = 5` in a 0-to-720 viewBox, spaced ~18 units center-to-center along each letter stroke. The chase animation lights bulbs in left-to-right index order with a 60ms step.

Illustrative SVG (doc-only, NOT wired in). To keep it compact, the snippet shows the marquee structure with the first two letters fully bulbed and the rest summarized; a build expands the same bulb-placement pattern across all 9 letters (or generates bulb coordinates from a font path at build time):

```tsx
// ILLUSTRATIVE ONLY. The BEAKERBOT bulb marquee. Bulbs are <circle>s
// placed along each letter's strokes; they chase left-to-right via a
// per-bulb animation-delay tied to the bulb's global left-to-right
// index. Behind the bulbs sits a darkened rainbow wash (R3 palette).
// A build would generate the bulb coordinates from a chunky display
// font's letter outlines; the two letters below show the intended
// density and the rest follow the same pattern.
function Marquee() {
  return (
    <div className="marquee" aria-label="BEAKERBOT">
      <div className="marquee-rainbow" aria-hidden />   {/* darkened rainbow wash */}
      <svg className="marquee-bulbs" viewBox="0 0 720 120" aria-hidden>
        {/* glow filter shared by all bulbs */}
        <defs>
          <filter id="bulbGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {/* Letter B: bulbs traced around the glyph. style sets --i (the
            global left-to-right bulb index) so the chase delay is
            calc(var(--i) * -60ms). */}
        <g filter="url(#bulbGlow)">
          <circle className="mbulb" cx="20"  cy="20"  r="5" style={{ ['--i' as string]: 0 }} />
          <circle className="mbulb" cx="20"  cy="40"  r="5" style={{ ['--i' as string]: 1 }} />
          <circle className="mbulb" cx="20"  cy="60"  r="5" style={{ ['--i' as string]: 2 }} />
          <circle className="mbulb" cx="20"  cy="80"  r="5" style={{ ['--i' as string]: 3 }} />
          <circle className="mbulb" cx="20"  cy="100" r="5" style={{ ['--i' as string]: 4 }} />
          <circle className="mbulb" cx="40"  cy="20"  r="5" style={{ ['--i' as string]: 5 }} />
          <circle className="mbulb" cx="40"  cy="60"  r="5" style={{ ['--i' as string]: 6 }} />
          <circle className="mbulb" cx="40"  cy="100" r="5" style={{ ['--i' as string]: 7 }} />
          {/* E */}
          <circle className="mbulb" cx="80"  cy="20"  r="5" style={{ ['--i' as string]: 8 }} />
          <circle className="mbulb" cx="80"  cy="40"  r="5" style={{ ['--i' as string]: 9 }} />
          <circle className="mbulb" cx="80"  cy="60"  r="5" style={{ ['--i' as string]: 10 }} />
          <circle className="mbulb" cx="80"  cy="80"  r="5" style={{ ['--i' as string]: 11 }} />
          <circle className="mbulb" cx="80"  cy="100" r="5" style={{ ['--i' as string]: 12 }} />
          <circle className="mbulb" cx="100" cy="20"  r="5" style={{ ['--i' as string]: 13 }} />
          <circle className="mbulb" cx="100" cy="60"  r="5" style={{ ['--i' as string]: 14 }} />
          <circle className="mbulb" cx="100" cy="100" r="5" style={{ ['--i' as string]: 15 }} />
          {/* A K E R B O T continue the same bulb-tracing pattern,
              indices 16..~95, spaced ~80 viewBox units per letter. */}
        </g>
      </svg>
    </div>
  );
}
```

```css
/* ILLUSTRATIVE ONLY. Marquee bulb chase + darkened rainbow wash. */
.marquee { position: absolute; top: 0; left: 50%; transform: translateX(-50%);
  width: 70vw; max-width: 980px; height: 14svh; }
/* The rainbow wash: BeakerBot's five liquid stops, heavily darkened
   (multiply against stage-black) so it is mood, not glare. */
.marquee-rainbow {
  position: absolute; inset: 0; opacity: 0.30; mix-blend-mode: screen;
  background: linear-gradient(100deg,
    #FFD2B0 0%, #FFF1A8 25%, #B7EBB1 50%, #A6D2F4 75%, #D6B5F0 100%);
  filter: brightness(0.45) saturate(0.85);
  background-size: 220% 100%;
  animation: rainbowSweep 14s linear infinite;     /* slow sweep */
}
@keyframes rainbowSweep { 0% { background-position: 0% 0; } 100% { background-position: 220% 0; } }
.marquee-bulbs { position: absolute; inset: 0; width: 100%; height: 100%; }
.mbulb {
  fill: #fff6d8;                                    /* warm bulb white */
  animation: bulbChase 1.8s ease-in-out infinite;
  animation-delay: calc(var(--i, 0) * -60ms);       /* left-to-right chase */
}
@keyframes bulbChase {
  0%, 100% { fill: #6b5a2e; }                        /* dim amber (bulb "off") */
  50%      { fill: #fff6d8; }                        /* lit warm white */
}
@media (prefers-reduced-motion: reduce) {
  .marquee-rainbow { animation: none; background-position: 50% 0; }
  .mbulb { animation: none; fill: #fff6d8; }          /* all bulbs lit, static */
}
```

Colors: bulbs warm white `#fff6d8` lit / `#6b5a2e` dim. Rainbow wash uses exactly the five liquid stops `#FFD2B0 / #FFF1A8 / #B7EBB1 / #A6D2F4 / #D6B5F0` (R2.6 grounding). The optional accent-rainbow flourish for the marquee underline (the "the category is... everything" kicker) can run the same five stops un-darkened as a thin 2px underline rule.

## R3.4 Curtains + valance (dimensions + keyframes)

The two deep-plum side curtains frame the stage mouth; the gold valance swags across the top. They stay put during look changes (the spotlight does the work) and only sweep during the Curtain Reveal transition (R3.9) and per-act in the Performance Hall (R3.8).

**Dimensions (page-level side curtains, runway):**

- Each side curtain: `width: 16vw`, `height: 100svh`, anchored to the left and right frame edges, `z-index` above the backdrop but below the bot and spotlight.
- Pleating: `repeating-linear-gradient(90deg, #3a1d3d 0 16px, #4a2750 16px 32px)` (plum / aubergine pleats, 32px pitch). A subtle inner shadow `box-shadow: inset -24px 0 40px rgba(0,0,0,0.5)` on the left curtain (mirror for right) deepens the fold nearest the stage.
- Valance: full top width, `height: 7svh`, `background: linear-gradient(#E7C873, #b9923f)`, scalloped lower edge via `border-radius` on repeated swag segments or a `clip-path` scallop. `border-bottom: 2px solid #8a6a2c`. A row of the R3.3 bulbs can line the valance lower lip (optional, ties marquee and valance together).

**Part/sweep keyframes (used by the Curtain Reveal and per-act raise):**

```css
/* ILLUSTRATIVE ONLY. Curtain sweep. Closed = covering the stage mouth;
   open = swept off to the sides. Easing matches the R2 proscenium
   curtain (cubic-bezier(0.2, 0.8, 0.2, 1)) so all curtains feel like
   the same fabric. */
.stage-curtain { position: absolute; top: 0; bottom: 0; width: 56vw;  /* overlaps at center when closed */
  background: repeating-linear-gradient(90deg, #3a1d3d 0 16px, #4a2750 16px 32px);
  box-shadow: inset 0 0 60px rgba(0,0,0,0.55);
  transition: transform 820ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.stage-curtain.left  { left: 0;  transform: translateX(0); }      /* closed: covers left half */
.stage-curtain.right { right: 0; transform: translateX(0); }      /* closed: covers right half */
.stage[data-curtains="open"] .stage-curtain.left  { transform: translateX(-100%); }   /* sweep off-left */
.stage[data-curtains="open"] .stage-curtain.right { transform: translateX(100%); }    /* sweep off-right */
/* The dramatic SLAM-CLOSED used in the reveal (faster in, with a
   tiny overshoot bounce at the meeting point for a theatrical thunk). */
@keyframes curtainSlamClosed {
  0%   { transform: translateX(var(--off)); }       /* off-stage */
  78%  { transform: translateX(var(--in-overshoot)); }  /* meet + slight overlap */
  100% { transform: translateX(var(--in)); }        /* settle closed */
}
@media (prefers-reduced-motion: reduce) {
  .stage-curtain { transition: none; }              /* curtains snap, no sweep */
}
```

Durations: page-side curtains are decorative and static during normal scroll. The reveal sweep-closed is 820ms with the overshoot bounce; the part-open is 820ms. The valance never moves; it frames the top throughout.

## R3.5 The lit catwalk panel (exact)

Reuses the R2.5 panel almost verbatim, now with the R3.2 grid wired in (9 rows x 5 columns, `--panel-index` = row index 0 head to 8 foot):

```css
/* ILLUSTRATIVE ONLY. One light-up runway panel. The grid container is
   clipped to the R3.2 trapezoid; each panel gets --panel-index = its
   ROW index (0 at the head/back, 8 at the foot/front) so the highlight
   sweeps head-to-foot toward the pit as a horizontal light bar. Cool
   white-blue so the floor reads as stage light and never fights
   BeakerBot's rainbow (rainbow lives in the backdrop + confetti). */
.catwalk-panel {
  background: linear-gradient(180deg,
    rgba(180, 210, 255, 0.06) 0%, rgba(180, 210, 255, 0.18) 100%);
  border: 1px solid rgba(180, 210, 255, 0.14);
  animation: panelPulse 2.4s ease-in-out infinite;
  animation-delay: calc(var(--panel-index, 0) * -0.12s);
}
@keyframes panelPulse {
  0%, 100% { background-color: rgba(180, 210, 255, 0.04); }
  50%      { background-color: rgba(180, 210, 255, 0.28); }
}
@media (prefers-reduced-motion: reduce) {
  .catwalk-panel { animation: none; background-color: rgba(180, 210, 255, 0.12); }
}
```

Grid container (illustrative): `display: grid; grid-template-columns: repeat(5, 1fr); grid-auto-rows: 1fr; gap: 3px;` inside the trapezoid `clip-path` wrapper from R3.2. The column widths taper visually because the wrapper is clipped to the trapezoid, so a uniform 5-column grid reads as a receding runway once clipped.

## R3.6 The tracking spotlight (exact)

The R2.5 radial-gradient spotlight, with the tracking behavior pinned down: the spotlight **sweeps in on look entry** (the "find the queen" move), then **settles on the mark** and holds. It does NOT continuously follow anything (the bot is static on the mark); the only motion is the entry sweep. On scroll into a new look, the entry sweep re-fires (driven by the IntersectionObserver flipping the active look).

```css
/* ILLUSTRATIVE ONLY. Tracking spotlight on BeakerBot's 38svh mark.
   Warm core falling to stage-black at the edges. Sweeps in on entry,
   settles, holds. opacity ramps with the sweep. screen blend so it
   adds light rather than painting over the bot. */
.runway-spotlight {
  position: absolute; inset: 0; pointer-events: none;
  mix-blend-mode: screen;
  background: radial-gradient(
    ellipse 320px 420px at 50% 38%,     /* core over the bot mark, 320px wide > 128px bot */
    rgba(255, 248, 230, 0.92) 0%,       /* warm white core */
    rgba(255, 244, 214, 0.45) 28%,
    rgba(20, 18, 30, 0.78) 62%,
    rgba(11, 11, 18, 0.96) 100%);       /* stage black at the edges */
}
.runway-look[data-active="true"] .runway-spotlight { animation: spotWarmUp 700ms ease-out both; }
@keyframes spotWarmUp {
  0%   { opacity: 0.35; transform: translateX(-6%); }   /* sweep in from stage-left */
  60%  { opacity: 0.85; transform: translateX(1.5%); }  /* slight past-mark, theatrical */
  100% { opacity: 1;    transform: translateX(0); }      /* settle on the mark */
}
@media (prefers-reduced-motion: reduce) {
  .runway-look .runway-spotlight { animation: none; opacity: 1; transform: none; }
}
```

Exact values: ellipse `320px x 420px` centered `50% 38%`; stops `rgba(255,248,230,0.92)` at 0%, `rgba(255,244,214,0.45)` at 28%, `rgba(20,18,30,0.78)` at 62%, `rgba(11,11,18,0.96)` at 100%; `mix-blend-mode: screen`; entry sweep 700ms `ease-out` with a slight 1.5% past-mark overshoot. Reduced motion: static lit ellipse, no sweep.

## R3.7 Flashbulb bursts (exact)

The R2.5 FlashBurst SVG + keyframes are the per-flash primitive (kept verbatim, see R2.5). R3 pins the photographers'-pit random-flicker pattern around them:

**Per-look flash flurry.** On look entry (and on click), fire **3 flashes**, staggered by the existing particle stagger `0 / 40 / 80ms` (mirrors `VOLCANO_PARTICLES` delayMs), from 3 of the pit's camera positions chosen pseudo-randomly per entry. Each is a `FlashBurst` (R2.5) at 56px, positioned just above its camera (84 to 88svh).

**Ambient pit flicker (between flurries).** Each camera also runs a low ambient bloom on the R2.5 `pitFlicker` keyframe (`0.10` to `0.22` opacity, slow), with a **per-camera random offset** so the pit shimmers asynchronously and never reads as a synchronized strobe:

```css
/* ILLUSTRATIVE ONLY. Ambient pit shimmer. Each camera's bloom runs the
   pitFlicker keyframe (R2.5) on a slightly different duration + delay so
   the pit twinkles asynchronously, like a crowd of idle cameras. */
.pit-camera-bloom {
  position: absolute;
  width: 40px; height: 28px;
  background: radial-gradient(ellipse at center, rgba(255,255,255,0.5), transparent 70%);
  animation: pitFlicker var(--flick-dur, 3.2s) ease-in-out infinite;
  animation-delay: var(--flick-delay, 0s);          /* per-camera random offset */
}
@keyframes pitFlicker { 0%, 100% { opacity: 0.10; } 50% { opacity: 0.22; } }
@media (prefers-reduced-motion: reduce) {
  .pit-camera-bloom { animation: none; opacity: 0.18; }   /* constant gentle bloom */
}
```

Camera count: 6 cameras (R3.2 said 5 to 7; spec pins **6**). Positions: evenly spaced across the pit band with `+/- 2vw` fixed per-camera jitter. Per-camera `--flick-dur` in `2.6s` to `3.8s` and `--flick-delay` in `0s` to `2s`, assigned once at mount (a small fixed array, not re-randomized per frame, so it is stable). The camera silhouette itself is a simple inline-SVG lens + body (abstract, no faces) sitting under each bloom.

```tsx
// ILLUSTRATIVE ONLY. An abstract camera silhouette for the pit. No
// faces, just a body + lens, kept dark so the flash bloom reads.
function PitCamera() {
  return (
    <svg viewBox="0 0 48 32" className="pit-camera" aria-hidden>
      <rect x="6" y="10" width="36" height="18" rx="3" fill="#0e0e16" stroke="#23202e" />
      <rect x="16" y="6" width="12" height="6" rx="2" fill="#0e0e16" stroke="#23202e" />  {/* viewfinder hump */}
      <circle cx="24" cy="19" r="7" fill="#15131f" stroke="#2c2838" />                      {/* lens */}
      <circle cx="24" cy="19" r="3" fill="#23202e" />                                        {/* inner lens */}
    </svg>
  );
}
```

## R3.8 The snap-scroll runway + proscenium frames

### Snap-scroll runway container

```css
/* ILLUSTRATIVE ONLY. The runway scroll column. One look per frame,
   each self-centering under the spotlight. The set (backdrop, marquee,
   curtains, catwalk, pit) is rendered ONCE behind this transparent
   column (position: fixed behind it), so only the spotlight + bot +
   placard change per frame. */
.runway-scroll {
  scroll-snap-type: y mandatory;
  overflow-y: auto;
  height: 100svh;
}
.runway-look {
  scroll-snap-align: center;
  min-height: 100svh;
  position: relative;
}
.runway-interstitial {          /* the 5 collection headers */
  scroll-snap-align: center;
  min-height: 60svh;
  position: relative;
}
@media (prefers-reduced-motion: reduce) {
  .runway-scroll { scroll-snap-type: y proximity; }   /* gentler, no forced snap */
}
```

One-look-per-frame height: `100svh` per look, `60svh` per collection interstitial (R2). Vertical budget unchanged from R2 (~2400svh) with the optional "skip to the scenes" corner pin.

### The CategoryPlacard component

The R2.5 placard SVG/CSS is the primitive (kept verbatim). R3 pins its position and animation:

- Position: `left: 50%; top: 62svh; transform: translateX(-50%)` (R2's clear zone between bot and pit). Width auto, max 70vw.
- Flip-in: `placardFlipUp` 520ms `cubic-bezier(0.2, 0.8, 0.2, 1)`, `transform-origin: center bottom`, fires on look entry (tied to `data-active="true"` on the parent `.runway-look`, same trigger as the spotlight sweep).
- Typography: kicker `font-size: 0.72rem; letter-spacing: 0.28em; color: #E7C873; text-transform: uppercase`. Category name `font-size: 1.4rem; font-weight: 800; letter-spacing: 0.06em; color: #fff; uppercase`. Look name `font-size: 0.9rem; letter-spacing: 0.14em; color: #A6D2F4` (BeakerBot's sky stop). Geist Sans by default (R2.9 q2's webfont stays optional / Grant's call; the spec ships zero-new-dependency Geist bold + wide tracking unless Grant green-lights a display face).

### Proscenium frames (the 9 existing scenes)

Reuses the R2.5 `ProsceniumFrame` SVG/CSS (kept verbatim) with these pinned values:

- **Frame dimensions:** `aspect-ratio: 16 / 10`, max-width `min(900px, 84vw)`, centered. One per scene, stacked vertically in the Performance Hall with `~24svh` vertical gap so two are never both mid-performance.
- **Marquee-lit border:** the R2.5 `.proscenium-bulbs` chasing arch (14 bulbs, `animation-delay: i * -0.1s`, `bulbChase` 1.4s). Gold `border: 2px solid #E7C873`, glow `box-shadow: 0 0 36px rgba(231,200,115,0.22)`.
- **Curtain treatment:** the R2.5 `.curtain-left` / `.curtain-right` plum pleats, parting on `data-active="true"` (`translateX(-100%)` / `translateX(100%)`, 700ms `cubic-bezier(0.2,0.8,0.2,1)`).
- **Poster / idle state (curtain-down, resting):** curtains drawn closed; a static `idle` BeakerBot (or the scene's signature resting pose) sits behind the closed curtain as a faint silhouette; the placard reads the act name as the drawn-curtain marquee title with a "TAP TO REPLAY" affordance.
- **"Now performing" caption:** active = `NOW PERFORMING - [name]`, resting = `[name] - TAP TO REPLAY`, name from `BEAKERBOT_ANIMATION_CATALOG`. Placard at `bottom: 8px`, centered, `0.72rem`, `letter-spacing: 0.18em`, gold.
- **IntersectionObserver sequencer:** one observer per Performance Hall. Threshold array `[0, 0.5, 0.6, 1]`; the act whose intersectionRatio is highest AND `>= 0.6` becomes `active`; all others get `active=false` (curtains close, scene pauses to poster). When two are tied (transitional scroll), the one closer to viewport center wins (compare `boundingClientRect` center to `window.innerHeight/2`). Only one `active` at a time enforces the hard no-overlap rule (R1 section 4 Option 3). `rootMargin: "-20% 0px -20% 0px"` so an act only goes active when it is comfortably centered, not as it is half entering.

**The three special-case scenes (R2.3 treatments, pinned):**

- **MouseWave (in-frame faux cursor):** render a faux cursor inside the frame, a small inline-SVG arrow pointer that drifts in from the frame's right edge to a target at `~60%` width / `~45%` height over ~900ms `ease-out`, then BeakerBot waves at it. The faux cursor is showcase chrome layered into the frame, not a scene change. Caption: "NOW PERFORMING - The Greeting".
- **Skateboard (wide letterbox frame):** this one act breaks the 16:10 grid for a `aspect-ratio: 21 / 9` letterbox band spanning the full page width (`width: 100vw`, margin-bleed out of the centered column). Caption styled as an "INTERMISSION" band. The skateboard's `bottomY = 85` and full-width translate get room to read.
- **CoffeeRefill (13s progress shimmer):** a thin rainbow progress bar (the five liquid stops) along the bottom inner lip of the frame, advancing left-to-right over `TOTAL_DURATION_MS = 13000` (linear). Caption: "the wait is the look". The shimmer is chrome layered over the scene, paced against the verified `13000ms` total / `8000ms` brew (R2.6).

## R3.9 The Curtain Reveal unlock transition (frame-by-frame)

The click-unlock escalation composes on top of the existing per-click heart easter egg (`handleClick` to `spawnHeart()`, `HEART_MAX_CONCURRENT = 6`, `HEART_FILL = "#ff5b8a"`, verified in `BeakerBot.tsx`). Clicks 1 to 6 spawn hearts exactly as today. **Click 7** fires the reveal instead of a 7th heart. Trigger instances: the AppShell brand-mark BeakerBot and the `/demo` BeakerBot (R2; settings/tip-card instances stay hearts-only). The counter is per-session and resets so it stays a delight.

Frame-by-frame timing (t = 0 at the 7th click):

- **t = 0 to 600ms - the dim.** Instead of a 7th heart, a stage-black overlay fades IN from the edges of the viewport inward (a radial `rgba(11,11,18,...)` mask growing from the corners to center), reaching full stage-black at 600ms. This is the bit that keeps the dark takeover from jarring against the light app/demo chrome: the page does not hard-cut to black, it dims theatrically from the edges. `ease-in` so it accelerates into darkness. (This dim is the universal entry, in the app AND on the light `/demo`, per Grant's decision 1.)
- **t = 600 to 1420ms - curtains sweep CLOSED.** The two plum stage curtains sweep IN from off-stage to cover the now-black viewport, `curtainSlamClosed` (R3.4) 820ms with the slight overshoot thunk at the meeting line. They meet center at ~1340ms, settle at 1420ms.
- **t = 1420 to 1820ms - the held beat.** Curtains closed, full black behind, a 400ms beat of anticipation. The route change to `/showcase` happens during this beat (the closed curtain hides the route swap, so there is no flash of unstyled content). An optional soft "the stage is yours" toast can fade in at the bottom here.
- **t = 1820 to 2640ms - curtains PART on the marquee.** The curtains sweep open (`translateX(-100%)` / `translateX(100%)`, 820ms, `cubic-bezier(0.2,0.8,0.2,1)`) to reveal the "BeakerBot Live" marquee hero (R2.4) with the `BEAKERBOT` bulbs lighting up and the spotlight warming on a center `waving` (or `cheering`) BeakerBot.
- **t = 2640ms+ - the spotlight settles, the show begins.** The spotlight `spotWarmUp` (R3.6) finishes settling, flashbulbs fire a welcome flurry (R3.7), and the user is on `/showcase` at the marquee hero, ready to scroll into the runway.

Total reveal: ~2.6s from click to "you are on the stage." Reduced motion (R3.10): the dim is an instant cut to stage-black, the curtains appear already-parted, the route changes immediately, and the user lands on the static marquee hero with no sweep, no flurry.

## R3.10 Reduced-motion fallback (the static-but-glam version)

`prefers-reduced-motion: reduce` collapses all motion to a static, still-glamorous freeze. Every existing scene already honors it (verified, static done-state). The showcase chrome matches, pinned per surface (R2 established this; R3 makes it concrete and complete):

- **Marquee:** all bulbs lit static (`#fff6d8`), rainbow wash static at `background-position: 50%`, no sweep, no chase.
- **Catwalk panels:** static at `rgba(180,210,255,0.12)`, no chase.
- **Spotlight:** static lit ellipse on the mark (`opacity: 1`, no sweep).
- **Flashbulbs:** no bursts; each pit camera shows a constant gentle bloom (`pit-camera-bloom` at `opacity: 0.18`) so the "photographed" mood survives without strobing.
- **Category placard:** appears instantly (no flip), at its 62svh position.
- **Runway scroll:** `scroll-snap-type: y proximity` (gentler) instead of `mandatory`.
- **Proscenium curtains:** drawn open statically (no sweep); active scene shows its static done-state inside.
- **Curtain Reveal unlock:** instant cut to stage-black, curtains already parted, immediate route change, land on the static marquee hero.
- **New drag scenes (Strut / Twirl / Death Drop / Dance / etc.):** suppressed motion; replaced by a static "she served" freeze-frame of the scene's end pose (`cheering` / `bow-wink`) under the static spotlight. Confetti and rainbow trails are suppressed entirely.

The fallback is "the show, paused on its best freeze-frame." Still a queen lit on a stage; it just does not move.

## R3.11 Component breakdown (props contracts, so a build can scaffold directly)

The React components a build creates for the showcase. Each lists its props contract. No component is built here; this is the scaffold map. (BeakerBot itself and the 9 scene components already exist and are reused as-is in P1.)

| Component | Props contract | Notes |
|---|---|---|
| `ShowcasePage` | none (route component for `/showcase`) | Top-level. Renders `StageBackdrop` (fixed, once) + `MarqueeHero` + `Runway` + `PerformanceHall` + `CurtainCallFooter`. Sets the stage-black theme on this route only. |
| `StageBackdrop` | none | Rendered once, `position: fixed`, behind the scroll. Composes `Marquee`, `RainbowWash`, the two page `SideCurtain`s, `Valance`, `Catwalk`, `PhotographersPit`. Stage-black base `#0b0b12`. |
| `Marquee` | `{ word?: string }` (default `"BEAKERBOT"`) | R3.3 bulb-light marquee + darkened rainbow wash. `aria-label` the word. |
| `MarqueeHero` | `{ tagline?: string }` | R2.4 "BeakerBot Live" show-bill hero: marquee title, "ONE BEAKER. TWENTY-ONE LOOKS. ONE STAGE.", "the category is... everything", a center `waving` BeakerBot, "scroll to begin" cue. |
| `Catwalk` | none | R3.2 trapezoid clip + R3.5 panel grid (9 rows x 5 cols), `--panel-index` = row index. |
| `Spotlight` | `{ active: boolean }` | R3.6 radial-gradient; `spotWarmUp` fires when `active` (the centered look). |
| `Runway` | `{ looks: RunwayLookData[] }` where `RunwayLookData = { pose: BeakerBotPose; category: string; lookName: string; collection: string }` | R3.8 snap-scroll column. Drives the per-look `data-active` via IntersectionObserver. `looks` derived from `BEAKERBOT_ANIMATION_CATALOG` poses + the R3.1 chosen category names. |
| `RunwayLook` | `{ pose: BeakerBotPose; category: string; lookName: string; active: boolean }` | One 100svh frame. Renders the 128px `<BeakerBot pose={pose} className="w-32 h-32 text-sky-500" />` on the mark, the `Spotlight active={active}`, the `Flashbulbs` flurry on active, and the `CategoryPlacard`. |
| `CollectionInterstitial` | `{ title: string; collection: string }` | The 60svh collection header frame (5 of them). |
| `CategoryPlacard` | `{ category: string; look: string }` | R2.5 + R3.8. Two-tier card: "THE CATEGORY IS..." kicker, category name, look name. `role="status" aria-live="polite"`. |
| `Flashbulbs` | `{ fire: boolean; cameraPositions: PitPosition[] }` | R3.7. On `fire` (look entry / click), 3 staggered `FlashBurst`es from random camera positions. |
| `FlashBurst` | `{ delayMs?: number }` | R2.5 single-flash SVG primitive. |
| `PhotographersPit` | `{ cameraCount?: number }` (default 6) | R3.7. 6 `PitCamera` silhouettes + per-camera ambient `pit-camera-bloom` with fixed random `--flick-dur` / `--flick-delay`. |
| `PitCamera` | none | R3.7 abstract camera silhouette SVG. |
| `SideCurtain` | `{ side: "left" \| "right" }` | R3.4 page-level plum side curtain (static during scroll). |
| `Valance` | none | R3.4 gold valance swag across the top. |
| `RainbowWash` | none | The darkened five-stop rainbow gradient behind the marquee. |
| `PerformanceHall` | `{ acts: ActData[] }` where `ActData = { id: string; name: string; Component: SceneComponent; special?: "mouse-wave" \| "skateboard" \| "coffee-refill" }` | R3.8. Stacks `ProsceniumFrame`s, runs the IntersectionObserver sequencer (one `active` at a time). |
| `ProsceniumFrame` | `{ title: string; active: boolean; stageRef: React.Ref<HTMLDivElement>; children: React.ReactNode }` | R2.5 marquee-lit frame. `children` is the scene (active) or the resting poster. `stageRef` is the future Option-1 `bounds` target (P2+). |
| `FauxCursor` | `{ targetX: number; targetY: number }` | The MouseWave in-frame faux cursor (R3.8). |
| `ProgressShimmer` | `{ durationMs: number }` | The CoffeeRefill rainbow progress bar (R3.8), paced to `TOTAL_DURATION_MS = 13000`. |
| `CurtainReveal` | `{ onArrived?: () => void }` | R3.9 unlock transition: dim, sweep closed, hold (route swap), part open. Doubles as the page-entry animation. `onArrived` fires when the curtains finish parting. |
| `CurtainCallFooter` | none | R2 curtain-call footer: a `bow-wink` BeakerBot, credits-style caption, link back to the app. |
| `useShowcaseUnlock` (hook) | `(brandMarkRef) => { onBeakerBotClick: () => void }` | Wraps the existing heart click. Counts clicks per session; clicks 1 to 6 spawn hearts (existing behavior), click 7 fires `CurtainReveal` + routes to `/showcase`. Wired into the AppShell brand mark and the `/demo` BeakerBot only. |

New drag scenes from R2.2 (each its own component, P1 = Curtain Reveal already above + these two):

| Component | Props contract | Notes |
|---|---|---|
| `RunwayStrutScene` | `{ active: boolean; onComplete?: () => void; bounds?: SceneBounds }` | R2.2 signature strut. Same scene envelope as the 9 existing scenes (so it plugs into the sequencer). |
| `TwirlScene` | `{ active: boolean; onComplete?: () => void; bounds?: SceneBounds }` | R2.2 twirl/spin + rainbow trail (five liquid stops on a circular path). |
| `DeathDropScene` (P2) | `{ active: boolean; onComplete?: () => void; bounds?: SceneBounds }` | R2.2 showstopper (needs new safe-drop + liquid-slosh art). |
| `DanceNumberScene` (P3) | `{ active: boolean; onComplete?: () => void; bounds?: SceneBounds }` | R2.2 choreographed closer + rainbow confetti. |

`SceneBounds` is the R1 section 4 optional-bounds shape (`{ container: HTMLElement; width: number; height: number }`), undefined in P1 (portal-to-body, full-viewport), supplied in P2+ to render in-frame.

## R3.12 Residual open questions

Nearly zero, by design. The only items a build genuinely cannot decide:

1. **Category name picks (R3.1).** A build can ship the starred defaults verbatim with zero further input; this is only "open" in the sense that Grant may want to swap some. The starred set is a complete, shippable default. Not a blocker.
2. **Display webfont vs. Geist (carried from R2.9 q2).** The spec ships zero-new-dependency Geist bold + wide tracking + uppercase. If Grant wants a theatrical display face, it is a one-line `@font-face` swap on this route; everything else is unchanged. Not a blocker.

Everything else (geometry, keyframes, gradients, timings, component contracts, reduced-motion, the dark-everywhere decision, the per-pose categories) is pinned. A build sub-bot can scaffold P1 from R3.11 + the snippets without making a new design decision.

---

*R3 sketches are illustrative. No routes, scene props, or components were built. R3 is a build-ready specification + a category-name menu; hand-off to the build chip happens at Grant's word. Authored by the showcase-spec sub-bot per orchestrator manager dispatch.*

---
---

# Visual Design (R4): Death Drop + Dance Number Choreography

**Author:** showcase-choreography sub-bot (dispatched by orchestrator manager)
**Date:** 2026-05-29
**Status:** Detailed choreography spec for the two marquee new scenes. Builds on R1 (concept), R2 (the Drag Main Stage direction + the new-scene brainstorm), and R3 (the build-ready spec + component breakdown). Still doc-only: no routes, no scene props, no components built. Every snippet below is illustrative and lives inside this doc. The goal of R4 is that a build sub-bot can implement the Death Drop (P2) and the Dance Number (P3) with zero further animation decisions left to make: every beat, duration, easing curve, liquid-slosh keyframe, and confetti parameter is pinned here.

## R4.0 Scope, and what R4 inherits

R2.2 brainstormed seven new drag-stage scenes and recommended a build order: P1 (Curtain Reveal, Runway Strut, Twirl), P2 (Death Drop), P3 (Dance Number + the optional grace notes). R3.11 gave each new scene a component contract (`DeathDropScene`, `DanceNumberScene`) on the same envelope as the nine existing scenes (`{ active, onComplete?, bounds? }`). R4 takes the two marquee scenes (Death Drop, Dance Number) from one-paragraph brainstorm to frame-by-frame choreography.

What R4 inherits and does NOT re-decide (read R1 to R3 for these):

- **Scene envelope:** `{ active, onComplete?, bounds? }`, `createPortal` to `document.body` (P1/P2 takeover) or into `bounds.container` (P2+ in-frame), `position: fixed` / `absolute`, `SCENE_Z_INDEX = 800`, a `prefers-reduced-motion` gate with a static end-pose fallback. (Verified pattern: `BeakerBotEurekaScene.tsx`, `BeakerBotCentrifugeScene.tsx`.)
- **Bot scale + tint:** 128px (`BEAKERBOT_SCENE_SIZE_PX = 128`, class `w-32 h-32`), `text-sky-500`, hardcoded pastel-rainbow liquid. He is never re-colored; he is already the rainbow.
- **The five liquid stops** (the canonical palette for trails / confetti / slosh tints): `#FFD2B0` peach, `#FFF1A8` yellow, `#B7EBB1` mint, `#A6D2F4` sky, `#D6B5F0` lavender. (Verified: `BeakerBot.tsx` lines 517 to 523.)
- **The particle-array pattern:** `{ cx, cy, r, fill, delayMs, endX, endY }` in a 0-to-40 viewBox, with a per-item `delayMs` stagger and a per-particle CSS-var destination (`--volcano-end-x` / `-y`) the keyframe arcs toward. (Verified: `VOLCANO_PARTICLES`, `HICCUP_POP_PARTICLES` in `BeakerBot.tsx`; keyframe `beakerBotVolcanoParticle` in `BeakerBot.module.css`.)
- **The existing tilt-with-liquid primitive:** the `volcano-eruption` pose already rotates the whole filled beaker (`beakerBotVolcanoBody`, up to +/-7deg, lines 364 to 398) while the liquid rides along. The Death Drop's bigger tip extends exactly this idea. The liquid surface itself is a single SVG `<path>` (the wavy meniscus at `y=19`, body to `y=32`: `d="M 12 19 Q 14 17.8, 16 19 T 20 19 T 24 19 T 28 19 L 28 24 C 28 30, 24 32, 20 32 C 16 32, 12 30, 12 24 L 12 19 Z"`, verified `BeakerBot.tsx` line 547). The slosh animates a wrapper around THIS path.
- **Timing convention to compose with:** the nine scenes run roughly 5.5 to 6s (Centrifuge `TOTAL_DURATION_MS = 5800`, Eureka `5700`, both verified by summing their `STAGE_DURATIONS`), with the longest (CoffeeRefill) at `13000` because the wait IS the joke. The new scenes target this band so they sit naturally in the same sequencer.

Where R4 and R2.2's one-paragraph sketch differ, R4 wins (R4 is the version a build implements). R4 deliberately keeps R2.2's safety promise (the drop is cute and intentional, never harm) and makes it concrete.

---

## R4.1 The Death Drop (P2): the iconic move, done for a beaker

### R4.1.0 The brief, and the safety thesis

The death drop (the "dip") is the signature drag-runway finale: a dramatic, controlled backward fall to the floor, one leg tucked under, frozen in a striking pose, while the room loses its mind. BeakerBot is a rounded beaker with liquid inside, so the whole charm is in how a beaker death-drops: he cannot slam flat (he would spill, and a spill reads as harm), so the comedy and the grace both live in the **controlled tip onto a hidden cushion**, the **liquid sloshing but never cresting the lip**, and the **triumphant freeze** at the bottom. The move is glamour and confidence, not a pratfall.

**The safety thesis (the bar every beat is measured against):** the drop must read as *fabulous, intentional, and cute*, never as the beaker getting hurt. Concretely, that means:

- **No shattering, no cracks, no impact lines, no "ow" stars** (the volcano-dizzy stars are a wobble cue and must NOT appear here; they would read as concussion).
- **No spilling.** The liquid sloshes up the inside wall but its surface never crosses the beaker lip at `y=12`. The slosh peak is capped at `y=14` (R4.1.4). A spill would read as injury and break the no-harm rule.
- **No face of distress.** He wears `cheering` confidence on the way down and lands in a winking `bow-wink`. No `panicked`, no `embarrassed`, no wide-eyes-of-terror at any frame.
- **The landing is soft.** A hidden cushion (a small pillow that puffs up to catch him) plus a gentle settle-bounce, not a thud. The cushion is the visual promise that this was always safe and planned.
- **He is in control the whole time.** The wind-up is a confident vogue flourish (he chose this); the drop is a slow, controlled tip (not a free-fall); the recovery is a proud rise. Speed and easing carry "control": no fast `ease-in` accelerations that read as falling, only `ease-out` and `ease-in-out` that read as placing himself down.

If any single frame could be screenshotted and read as "the beaker fell and got hurt," that frame is wrong and gets retuned. The screenshot we WANT is "the beaker just served the most fabulous dip you have ever seen."

### R4.1.1 Beat-by-beat choreography (the stages)

Six stages, on the same state-machine pattern as the existing scenes (a `STAGE_DURATIONS` object summed to `TOTAL_DURATION_MS`, a timer chain advancing the stage, transforms switched per stage). Total runtime **5800ms**, deliberately matched to Centrifuge so it composes in the same sequencer band.

| # | Stage | Duration | What happens | Bot pose | Easing |
|---|---|---|---|---|---|
| 1 | `voguePrep` | 900ms | The wind-up. BeakerBot stands on the mark, then strikes a confident vogue flourish: a sharp arm-frame (reuse `cheering`'s both-arms-up), a tiny chin-up head-tilt, weight shifts back. A single anticipatory flash pops. This is "watch this." | `cheering` | `ease-in-out` |
| 2 | `theTipBack` | 1100ms | The drop itself: a CONTROLLED backward tip. The body rotates backward (negative rotate on the head-back axis) while translating down toward the floor, pivoting around a low point so it arcs rather than falls. The cushion puffs up underneath in the last 300ms to meet him. Liquid sloshes (R4.1.4). | `cheering` holding, transitioning | `cubic-bezier(0.34, 0.02, 0.3, 1)` (slow, controlled, NO sharp accel) |
| 3 | `theFreeze` | 700ms | The pose lands. He hits the floor-contact freeze: tipped back at the dip angle, resting on the cushion, one "leg" tucked (the beaker has no legs, so the tuck reads as the body angled with the rounded bottom kicked up and out, plus a jaunty arm line). He goes dead still. The liquid settles. | `bow-wink` (winking, held) | none (instant freeze) |
| 4 | `flashbulbFrenzy` | 900ms | The held moment: the pit goes WILD. A rapid flurry of 6 to 8 flashbulbs fires in fast succession across the whole pit (R4.1.5), the spotlight pulses brighter twice, the bot holds the freeze rock-steady through it. This is the screenshot beat. | `bow-wink` held | flash-driven |
| 5 | `theRecovery` | 1200ms | The rise. He pushes back up smoothly to standing (the cushion deflates away), arriving back upright with a small triumphant settle-bob. NOT a snap-up; a graceful, proud recovery. A final celebratory flash on arrival upright. | `bow-wink` rising to `cheering` | `cubic-bezier(0.2, 0.8, 0.2, 1)` (confident ease-out) |
| 6 | `holdAndDone` | 1000ms | Standing tall, `cheering` freeze, one last flash, then `onComplete`. (In the showcase this either loops on tap or rests as a poster of the freeze pose.) | `cheering` | `ease-out` |

`STAGE_DURATIONS` sum: 900 + 1100 + 700 + 900 + 1200 + 1000 = **5800ms**. (Mirrors `BeakerBotCentrifugeScene.STAGE_DURATIONS`.)

**The "controlled, not falling" rule restated in motion terms:** the only stage that moves the body downward is `theTipBack`, and it uses a slow ease with a near-flat entry (the `0.34, 0.02` control points keep the first third gentle) so he eases INTO the tip rather than dropping. The cushion arriving in the last 300ms of the tip is the visual guarantee of a soft landing before contact ever happens.

### R4.1.2 The body transform per stage (exact)

The bot wrapper (the 128px square) gets a per-stage `transform` switched via CSS transition (the existing scene pattern: a `switch (stage)` returning a transform string, transitioned by `transition: transform <stageDuration> <easing>`). Pivot is a low point so the tip ARCS (a dip), not a topple. `transform-origin: 50% 92%` (near the rounded bottom, so he hinges from his base like a dancer dipping from the hips).

| Stage | `transform` on the bot wrapper | Notes |
|---|---|---|
| `voguePrep` | `translateY(0) rotate(0deg) scale(1)` then a 4% settle: `translateY(-2%) rotate(-2deg)` at the prep peak | weight-back chin-up flourish |
| `theTipBack` | `translateY(34%) rotate(-58deg) scale(0.98)` | the dip: down + tipped back 58deg, hinging from the low pivot. 58deg (not 90deg flat) keeps the liquid safely below the lip and reads as a glamorous dip, not a flat collapse |
| `theFreeze` | `translateY(34%) rotate(-58deg) scale(0.98)` (held, identical to tip end) | dead still |
| `flashbulbFrenzy` | same held transform | rock-steady through the flashes |
| `theRecovery` | `translateY(0) rotate(0deg) scale(1)` | smooth rise back to upright |
| `holdAndDone` | `translateY(0) rotate(0deg) scale(1)` with a tiny `-2%` settle-bob at midpoint | proud landing |

**Why -58deg, not flat:** a real death drop ends near-horizontal, but a beaker tipped past ~60deg would let the liquid surface approach the lip and threaten a spill read. 58deg is the sweet spot: dramatic enough to read unmistakably as a dip, shallow enough that the sloshed liquid surface (R4.1.4) stays at or below `y=14`, comfortably under the `y=12` lip. The cushion + the tucked-bottom silhouette sell the "all the way down" drama without the body actually going flat. (If Grant wants it more extreme, -64deg is the absolute max before the liquid cap has to tighten; flagged.)

### R4.1.3 The hidden cushion (new prop)

A small soft pillow that puffs up under BeakerBot during the last 300ms of `theTipBack` to catch him, stays through `theFreeze` + `flashbulbFrenzy`, then deflates away during `theRecovery`. It is the visual promise of safety: you see him land on something soft and intentional.

- **Art:** a simple rounded-rectangle pillow, inline-SVG, in a soft plum-tinted neutral that reads against stage-black without competing with the bot. A subtle gold piping edge (`#E7C873`, the showcase accent) ties it to the stage. Two small corner tassels optional. No emojis; pure SVG shapes.
- **Geometry:** roughly 90px wide x 36px tall, centered under the bot's landing point, sitting on the floor-contact line.
- **Puff-in:** `scaleY(0)` to `scaleY(1)` with a slight `scaleX` overshoot (1.0 to 1.08 to 1.0), `cubic-bezier(0.2, 0.8, 0.2, 1)`, over 300ms, so it inflates to meet him.
- **Deflate-out:** reverse, `scaleY(1)` to `scaleY(0)` over 400ms as he rises, `ease-in`, so it tucks away as if it was never needed.

### R4.1.4 The internal liquid slosh (the signature charm beat)

This is the beat the whole scene is built around: how a beaker's liquid behaves when the beaker dips. It is the cutest, most "it is a BEAKER doing this" moment, and it is what users will replay.

**The mechanism.** The liquid is one SVG `<path>` (the meniscus + body, verified `BeakerBot.tsx` line 547). To slosh it independently of the body tilt, the build wraps that single liquid path in a `<g class="dropLiquid">` and animates a `transform` on THAT group, in the bot's local 0-to-40 viewBox coordinate space, while the body tilts around it. The liquid lags and overshoots the body's rotation (inertia), then settles. Because the slosh is a transform on the existing path (not a redrawn surface), it is cheap and stays perfectly rainbow.

**The physics story, beat by beat:**

1. **On the tip (during `theTipBack`):** as the body rotates backward, the liquid's inertia makes its surface lag, so it appears to slosh UP the wall that is now lower (the back/upper wall as he tips). Modeled as a counter-rotation + skew on the liquid group: the liquid rotates slightly LESS than the body (lag) and skews so the surface stays closer to true-horizontal than the tilted beaker walls (liquid wants to stay level). Peak slosh at about 70% through the tip.
2. **The cap (the no-spill guarantee):** the sloshed surface is clamped so its highest point never crosses `y=14` (well under the `y=12` lip). This is enforced by limiting the skew + translate magnitude (values in the keyframe below). The liquid kisses the upper wall, it never crests it.
3. **At the freeze (during `theFreeze`):** the liquid does two or three quick damped wobbles (decreasing amplitude) and settles flat-relative-to-gravity, i.e. it finds its level inside the tipped beaker. This "settling" is the satisfying punctuation: the body is frozen mid-dip but the liquid does its little jiggle and goes calm. Pure charm.
4. **On the recovery (during `theRecovery`):** a gentle reverse slosh as he rises (the liquid sways back the other way once, softly), settling level again by the time he is upright.

**Color:** the liquid is unchanged (the five-stop rainbow gradient). The slosh does not recolor it; the rainbow simply rides the wobble, which is exactly the joy of it. (For the five named single-color variants peach/yellow/mint/sky/lavender that BeakerBot can render, the slosh is identical; only the fill differs, and the build inherits whatever fill the instance already uses. No per-color slosh tuning needed.)

**Illustrative liquid-slosh keyframe (doc-only, NOT wired in).** The transform animates the `<g>` wrapping the liquid path, in the 0-to-40 local viewBox (so `transform-origin` and translate values are in viewBox units; 1 unit ~ 3.2px at the 128px render). The skew keeps the surface level-ish while the body tilts; the translate is the up-the-wall slosh; both are capped to keep the surface under `y=14`. Damped settle wobbles encoded as decreasing-amplitude keyframe steps.

```css
/* ILLUSTRATIVE ONLY. The death-drop liquid slosh. Applied to the <g>
   that wraps BeakerBot's single liquid <path> (the wavy-meniscus path
   at y=19, body to y=32). The BODY tilts -58deg around 50% 92%; this
   group counter-moves so the liquid surface lags, sloshes up the wall,
   then damps to level. transform-origin is the liquid centroid
   (~20, 26 in viewBox units) so the slosh pivots inside the beaker.
   Magnitudes are CAPPED so the surface never crosses y=14 (lip is y=12)
   => no spill, no harm. Total 5800ms to match the scene; the percentages
   below map onto the R4.1.1 stage timeline. */
.dropLiquid {
  transform-origin: 20px 26px;   /* liquid centroid, viewBox units */
  animation: deathDropSlosh 5800ms cubic-bezier(0.34, 0.02, 0.3, 1) both;
}
@keyframes deathDropSlosh {
  /* voguePrep (0 to ~15.5%): a tiny anticipatory ripple */
  0%    { transform: rotate(0deg)   skewX(0deg)   translate(0, 0); }
  12%   { transform: rotate(1.5deg) skewX(-1deg)  translate(-0.2px, 0); }
  15.5% { transform: rotate(0deg)   skewX(0deg)   translate(0, 0); }
  /* theTipBack (~15.5% to ~34.5%): body tips -58deg; liquid LAGS
     (rotates less, ~+12deg the other way relative to the body) and
     sloshes UP the now-lower wall. Surface stays <= y=14 (capped). */
  26%   { transform: rotate(8deg)  skewX(6deg)  translate(1.4px, -1.6px); }  /* sloshing up */
  31%   { transform: rotate(12deg) skewX(9deg)  translate(2.0px, -2.2px); }  /* peak slosh, surface ~y=14 */
  34.5% { transform: rotate(10deg) skewX(7deg)  translate(1.6px, -1.4px); }  /* tip settles */
  /* theFreeze (~34.5% to ~46.5%): damped wobbles, decreasing amplitude,
     liquid finds its level inside the tipped beaker. */
  38%   { transform: rotate(13deg) skewX(8deg)  translate(1.2px, -1.0px); }  /* wobble 1 */
  41%   { transform: rotate(9deg)  skewX(5deg)  translate(0.7px, -0.6px); }  /* wobble 2 */
  44%   { transform: rotate(11deg) skewX(6.5deg) translate(0.9px, -0.8px); } /* tiny wobble 3 */
  46.5% { transform: rotate(10deg) skewX(6deg)  translate(0.8px, -0.7px); }  /* settled, level in the dip */
  /* flashbulbFrenzy (~46.5% to ~62%): held level, dead calm (the body
     is frozen; the liquid is calm so the freeze reads as a POSE). */
  62%   { transform: rotate(10deg) skewX(6deg)  translate(0.8px, -0.7px); }
  /* theRecovery (~62% to ~83%): he rises; one gentle reverse sway. */
  72%   { transform: rotate(-4deg) skewX(-3deg) translate(-0.6px, 0.2px); } /* reverse sway */
  83%   { transform: rotate(0deg)  skewX(0deg)  translate(0, 0); }          /* level, upright */
  /* holdAndDone (~83% to 100%): level, still. */
  100%  { transform: rotate(0deg)  skewX(0deg)  translate(0, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .dropLiquid { animation: none; transform: none; }   /* static, level */
}
```

The cap values (skew <= ~9deg, translate-up <= ~2.2px = ~7px on screen) are chosen so the meniscus high point lands at about `y=14`, a clear 2 viewBox units below the `y=12` lip. A build should verify visually that no part of the rainbow fill crosses the lip at any frame; if it does, scale the `theTipBack`/`theFreeze` translate-y and skew down proportionally (the angle of the body can stay; only the liquid magnitude needs to shrink to honor the no-spill rule).

### R4.1.5 Flashbulb frenzy (reuses the R3.7 / R2.5 FlashBurst)

The held moment is where the pit erupts. This reuses the existing `FlashBurst` SVG primitive (R2.5) and the pit-camera layout (R3.7) verbatim; only the firing pattern is new (denser than the per-look 3-flash flurry).

- **Anticipatory flash (`voguePrep`):** 1 flash, from a center-pit camera, on the vogue peak. "Watch this."
- **Landing flash (`theFreeze` start):** 2 flashes, staggered 0 / 60ms, as he hits the freeze.
- **The frenzy (`flashbulbFrenzy`):** 6 to 8 flashes across all 6 pit cameras in rapid succession, staggered `0 / 50 / 90 / 140 / 190 / 250 / 320 / 400ms` (denser than the normal `0/40/80` look flurry, deliberately, so it reads as a crowd losing it). Each is a standard `FlashBurst` at 56px above its camera. The spotlight does two quick brighten-pulses during this window (a short `filter: brightness(1.0 -> 1.25 -> 1.0)` on the `.runway-spotlight`, 250ms each).
- **Recovery flash:** 1 celebratory flash as he arrives upright.

No new flash art; the frenzy is purely a denser firing schedule over the existing component.

### R4.1.6 New art vs. reused (build-cost ledger for the Death Drop)

| Item | New or reused | Build cost |
|---|---|---|
| Tipped-back body pose (the -58deg dip) | **New keyframe / transform** (composes the existing `cheering` + `bow-wink` poses at a new rotation; no new SVG geometry for the bot) | Low-medium. It is a transform on the existing 128px bot, not new bot art. |
| Liquid-slosh keyframe (`deathDropSlosh`) | **New keyframe** (animates a wrapper `<g>` around the EXISTING liquid path) | Medium. The signature beat; needs visual tuning to honor the no-spill cap. The single most important new thing in this scene. |
| Hidden cushion | **New small SVG prop** (rounded pillow + puff/deflate keyframes) | Low. Simple rounded-rect SVG + two scale keyframes. |
| Floor-contact shadow | **New, but trivial** (a soft radial-gradient ellipse that grows/darkens as he dips and shrinks as he rises; sells the floor contact + softens the landing read) | Low. One `radial-gradient` div + a scale/opacity keyframe synced to the body translateY. |
| Flashbulb frenzy | **Reused** (`FlashBurst` from R2.5/R3.7; only a denser firing schedule is new) | Trivial. A timing array. |
| Spotlight brighten-pulses | **Reused** (`.runway-spotlight` from R3.6 + a brief brightness filter) | Trivial. |
| Bookend poses (`cheering`, `bow-wink`) | **Reused** (existing poses) | Zero. |
| State machine / envelope / reduced-motion gate | **Reused pattern** (mirror `BeakerBotCentrifugeScene`) | Low. Boilerplate the build already knows. |

**Net new art:** one body-tip transform, one liquid-slosh keyframe (the real work), one small cushion SVG, one floor-shadow gradient. Everything else composes. This matches R2.2's "High difficulty, but worth it" estimate: the difficulty is concentrated in tuning the slosh + the controlled-tip easing so it reads fabulous-not-painful, not in volume of new assets.

### R4.1.7 Reduced-motion fallback (Death Drop)

Per the house pattern (R3.10) and verified scene behavior: under `prefers-reduced-motion: reduce`, the scene skips the motion entirely and shows a **static "she served the dip" freeze-frame**: BeakerBot rendered statically in the freeze pose (tipped at -58deg, `bow-wink`, on the inflated cushion, floor-shadow present) under a static lit spotlight, with the pit cameras showing their constant gentle bloom (no strobing). The liquid sits static and level-in-the-dip (the slosh end-state, `transform: none`). It still looks like a queen who just landed the most fabulous dip; it simply does not move. Dwell ~2000ms (matching the existing scenes' `REDUCED_MOTION_DURATION_MS = 2000`), then `onComplete`.

---

## R4.2 The Dance Number (P3): the closer

### R4.2.0 The brief

The grand finale of the showcase: a short choreographed celebration routine, music-video / production-number energy WITHOUT audio (audio is out of scope per R1 section 7 / R2). Rhythm is conveyed entirely through motion timing: regular, on-beat accents so the eye feels a tempo even in silence. It composes from existing poses + the P1 Strut/Twirl + the P2 Death Drop (the routine incorporates the drop as its showstopper center), rains rainbow confetti throughout, and ends on a big finish pose. It is the longest scene, so the choreography is built to stay engaging: a clear four-phrase structure with escalating energy, each phrase visually distinct, no dead air.

### R4.2.1 Conveying rhythm without sound

The trick to "production number" without audio is a **felt beat**: pick a tempo and put every accent on it. Spec tempo: **120 BPM = 500ms per beat = 2000ms per 4-beat phrase.** Every pose-hit, confetti burst, and spotlight accent lands on a beat or a clean half-beat (250ms). The eye reads regular spacing as rhythm. Four phrases of 2000ms = a tight, danceable structure. (A build can treat the 500ms beat as the grid that all sub-timings snap to.)

### R4.2.2 The four phrases (the routine)

Total runtime **8500ms**: a 500ms entrance pickup + four 2000ms phrases (8000ms). Longest scene on the page, but the phrase structure + escalation keep it from dragging. Each phrase is a self-contained 4-beat unit with its own move and its own visual flourish.

**Pickup (0 to 500ms, 1 beat), the entrance.** BeakerBot pops up into frame from a low crouch (a quick `scaleY` squash-and-rise, or a reuse of the `bouncing` keyframe's up-pop) onto the center mark, arms snapping to a ready `cheering` frame on the downbeat. The spotlight snaps on. One flash. This is the "and... GO" pickup beat.

**Phrase 1 (500 to 2500ms), STEP-TOUCH WARM-UP (establish the beat).**
- Beats 1 to 4: a step-touch sway, the body translating left, center, right, center on each beat (`translateX(-8%)`, `0`, `+8%`, `0`), with a synced gentle bob (`translateY` -3% on each step, the existing idle-bob amplitude) and a slight `rotate` lean into each side (+/-4deg, the `beakerBotThink` lean amplitude). Pose: `idle` body with a relaxed arm sway, or `waving` arms loosely keeping time.
- **Flourish:** the first confetti drizzle begins (light, a few particles per beat, R4.2.4), and the catwalk panels pulse ON THE BEAT (override their ambient chase to flash on each 500ms downbeat during the dance). Establishes the tempo.

**Phrase 2 (2500 to 4500ms), THE TWIRL + SHIMMY (build energy).**
- Beats 1 to 2: BeakerBot does the P1 **Twirl** (the celebratory 360 with the rainbow motion trail, R2.2 scene 2), landing facing front on beat 2.
- Beats 3 to 4: a little shimmy: rapid small `rotate` oscillations (+/-6deg at ~125ms each, i.e. four quick shakes across two beats) with `cheering` arms up. A liquid-jiggle rides the shimmy (a small-amplitude version of the slosh, the liquid keeping time).
- **Flourish:** confetti steps up to a medium fall; the rainbow trail from the twirl lingers and fades across beats 3 to 4. Spotlight does a small circular sweep following the twirl.

**Phrase 3 (4500 to 6500ms), THE DEATH DROP (the showstopper center).**
- This is the centerpiece: the routine drops the P2 **Death Drop** in here, time-compressed to fit two-and-a-half phrases-worth of drama into ~2000ms. The full 5800ms Death Drop is too long for a phrase, so the dance uses a **compressed cut**: vogue-prep is folded into the end of Phrase 2's shimmy (he is already arms-up), so Phrase 3 is just tip (700ms) + freeze (400ms) + a SHORT frenzy (500ms) + a quick recovery (400ms). The liquid slosh runs its compressed version (same shape, ~1600ms instead of the standalone's longer arc).
- **Flourish:** the BIGGEST confetti burst of the routine fires on the freeze (a full burst, not a drizzle), the pit erupts (the R4.1.5 frenzy, compressed), the spotlight double-pulses. This is the peak. Putting the death drop at Phrase 3 (not the very end) means the routine has somewhere to GO after the biggest move (the finish), so it does not peak-then-fizzle.

**Phrase 4 (6500 to 8500ms), THE FINISH (the button).**
- Beats 1 to 2: he rises from the drop's recovery into a final strut-step toward front-center (a 2-beat micro-strut, reusing the P1 Strut's bob-sway, just two steps), building back up.
- Beats 3 to 4: the big finish pose. Arms thrown wide into `cheering`, a final settle-bob, and he HITS the pose on the final downbeat (beat 4) and freezes. A full confetti cannon + a flash flurry land exactly on that final downbeat (the "button" of the number, everything hits at once). Hold the freeze ~500ms past the beat, then `onComplete`.
- **Flourish:** confetti cannon (the densest moment, R4.2.4), full pit flash flurry, spotlight at max brightness, all synchronized to the final downbeat. The whole thing lands together. That synchronized hit is what makes a silent number feel like it had a final chord.

| Segment | Window | Move | Composed from | Confetti level |
|---|---|---|---|---|
| Pickup | 0 to 500ms | Pop-up entrance | `bouncing` up-pop, `cheering` | none yet |
| Phrase 1 | 500 to 2500ms | Step-touch sway | `idle`/`waving` + idle-bob + think-lean | light drizzle |
| Phrase 2 | 2500 to 4500ms | Twirl + shimmy | **P1 Twirl** + small rotate-oscillation + cheering | medium |
| Phrase 3 | 4500 to 6500ms | **Death Drop** (compressed) | **P2 Death Drop** (tip/freeze/short-frenzy/recovery) | big burst on freeze |
| Phrase 4 | 6500 to 8500ms | Micro-strut to big finish | **P1 Strut** (2 steps) + `cheering` finish freeze | cannon on final downbeat |

`STAGE_DURATIONS` sum: 500 + 2000 + 2000 + 2000 + 2000 = **8500ms**.

**Keeping it engaging (not draggy):** the escalation is the engine. Energy and confetti density climb monotonically (drizzle to medium to burst to cannon), each phrase has a visually distinct move (sway is lateral, twirl is rotational, drop is vertical, finish is a pose-hit), and the on-beat accents give a felt pulse the whole way. There is never a phrase that repeats the previous one's silhouette, so the eye always has a new shape. The death-drop-at-Phrase-3 (not the end) is the deliberate anti-fizzle: the routine still has the finish to climb to.

### R4.2.3 The body transform per phrase (exact, on the 500ms beat grid)

(Transforms on the bot wrapper, switched per beat; the build can drive these with a small beat-indexed timeline or one long keyframe at 8500ms with stops on the 500ms grid. Pivot `transform-origin: 50% 92%` to match the Death Drop's hinge.)

- **Pickup (beat 0):** `scaleY(0.7) translateY(20%)` to `scaleY(1) translateY(0)` (squash-and-pop), `cubic-bezier(0.2,0.9,0.3,1.2)` (a touch of overshoot for bounce).
- **Phrase 1 step-touch (beats 1 to 4):** per beat, `translateX(-8% / 0 / +8% / 0)` + `translateY(-3%)` on the step + `rotate(-4deg / 0 / +4deg / 0)`, each beat `cubic-bezier(0.3,0,0.3,1)` (a crisp on-beat snap).
- **Phrase 2 twirl (beats 1 to 2):** `rotateY(0 -> 360deg)` (or `rotate` for a flat spin) over 1000ms `ease-in-out`; **shimmy (beats 3 to 4):** `rotate(+/-6deg)` oscillating at 125ms intervals (8 micro-steps), `ease-in-out`.
- **Phrase 3 death drop (compressed):** tip to `translateY(34%) rotate(-58deg)` over 700ms (the R4.1.2 dip, `cubic-bezier(0.34,0.02,0.3,1)`), hold 400ms, then recover to upright over 400ms (`cubic-bezier(0.2,0.8,0.2,1)`). Cushion + floor-shadow as in R4.1.3.
- **Phrase 4 micro-strut (beats 1 to 2):** two strut steps, `translateX` small forward-feel + bob (`translateY(-4%)` per step); **finish (beats 3 to 4):** settle to `translateY(0) rotate(0)` and HIT `cheering` on the final downbeat with a tiny `-3%` settle-bob, freeze.

### R4.2.4 Rainbow confetti (the particle system)

Confetti reuses the established particle pattern (the `VOLCANO_PARTICLES` array shape + the `beakerBotVolcanoParticle` CSS-var-destination keyframe), inverted to fall DOWNWARD (the volcano fountain goes up; confetti rains down) and scaled up in count. The five liquid stops ARE the confetti colors, so the confetti is literally made of BeakerBot's own rainbow.

**Approach: a staged emitter, not one giant array.** Rather than one 200-particle array (a perf risk and hard to escalate), the confetti is emitted in **bursts tied to the phrases**, each burst a small array of particles with staggered `delayMs`, mounted at the phrase boundary and cleaned up when its animation completes (`onAnimationEnd` removes the particle, the standard cleanup pattern). This keeps the live particle count bounded and lets density escalate by burst size.

- **Particle shape (mirrors `VOLCANO_PARTICLES`):** `{ id, xPct, fill, sizePx, delayMs, driftXPct, durationMs, rotDeg }` where `xPct` is the spawn x across the frame top, `fill` is one of the five stops (round-robin or random across the five), `driftXPct` is the horizontal sway as it falls, `rotDeg` is a tumble rotation.
- **Physics:** each particle falls from above the frame (`top: -5%`) to below (`top: 105%`) over `durationMs` (1800 to 2600ms, randomized so they do not fall in lockstep), with a horizontal sine-ish drift (`driftXPct` +/-6%) and a tumble (`rotateZ` 0 to `rotDeg`, 180 to 540deg). Gentle, floaty, celebratory; NOT fast/heavy (heavy reads as debris, floaty reads as celebration). Confetti pieces are tiny rounded rects or circles (4 to 8px), inline-SVG or styled divs.
- **Counts per phrase (the escalation):** Phrase 1 drizzle ~6 particles, Phrase 2 medium ~14, Phrase 3 burst ~30 on the death-drop freeze, Phrase 4 cannon ~40 on the final downbeat. Peak live count stays modest (a few dozen) because earlier bursts have largely fallen out by the time later ones spawn.
- **Stagger:** within a burst, `delayMs` staggered like the volcano array (e.g. `0, 40, 80, 120...`) so the confetti enters as a shower, not a wall.
- **Cleanup:** each particle removes itself `onAnimationEnd` (the existing scene cleanup convention), so nothing accumulates. The whole confetti layer unmounts with the scene.

**Illustrative confetti-burst keyframe + emitter sketch (doc-only, NOT wired in).** Mirrors the `beakerBotVolcanoParticle` CSS-var-destination pattern, inverted to fall downward, with a drift + tumble. The five-stop palette is the confetti color set.

```tsx
// ILLUSTRATIVE ONLY. One confetti burst for the dance number. Mirrors
// the VOLCANO_PARTICLES array shape; the five liquid stops are the
// colors (the confetti is literally made of BeakerBot's rainbow). A
// burst is mounted at a phrase boundary; each piece cleans itself up
// onAnimationEnd. Escalate by passing a bigger `count`.
const CONFETTI_STOPS = ["#FFD2B0", "#FFF1A8", "#B7EBB1", "#A6D2F4", "#D6B5F0"];

function ConfettiBurst({ count, originXPct = 50 }: { count: number; originXPct?: number }) {
  // deterministic pseudo-random per index (mirrors the seeded jitter
  // pattern in BeakerBotCentrifugeScene so it is stable across renders)
  const pieces = Array.from({ length: count }, (_, i) => {
    const seed = (i * 7919 + 104729) % 233280;
    const r = seed / 233280;
    return {
      id: i,
      xPct: originXPct + (r - 0.5) * 80,                 // spread across the top
      fill: CONFETTI_STOPS[i % CONFETTI_STOPS.length],   // round-robin the rainbow
      sizePx: 4 + Math.round(r * 4),                     // 4 to 8px
      delayMs: (i % 8) * 40,                             // shower stagger (volcano pattern)
      driftXPct: (r - 0.5) * 12,                         // +/-6% horizontal sway
      durationMs: 1800 + Math.round(r * 800),            // 1800 to 2600ms float
      rotDeg: 180 + Math.round(r * 360),                 // 180 to 540deg tumble
    };
  });
  return (
    <div className="confetti-layer" aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          onAnimationEnd={(e) => e.currentTarget.remove()}  /* self-cleanup */
          style={{
            left: `${p.xPct}%`,
            width: p.sizePx, height: p.sizePx,
            background: p.fill,
            // per-piece destinations as CSS vars (volcano pattern)
            ["--drift-x" as string]: `${p.driftXPct}%`,
            ["--rot" as string]: `${p.rotDeg}deg`,
            animationDelay: `${p.delayMs}ms`,
            animationDuration: `${p.durationMs}ms`,
          }}
        />
      ))}
    </div>
  );
}
```

```css
/* ILLUSTRATIVE ONLY. Confetti fall: from above the frame to below it,
   with a horizontal drift and a tumble. Floaty (gentle ease), so it
   reads as celebration, not debris. Inverts the upward volcano
   fountain. */
.confetti-piece {
  position: absolute;
  top: -5%;
  border-radius: 2px;                       /* tiny rounded rect */
  opacity: 0;
  animation-name: confettiFall;
  animation-timing-function: cubic-bezier(0.25, 0.6, 0.45, 1);  /* gentle float */
  animation-fill-mode: forwards;
}
@keyframes confettiFall {
  0%   { opacity: 0; transform: translate(0, 0) rotateZ(0deg); }
  8%   { opacity: 1; }
  100% { opacity: 0;
         transform: translate(var(--drift-x, 0), 110vh) rotateZ(var(--rot, 360deg)); }
}
@media (prefers-reduced-motion: reduce) {
  .confetti-layer { display: none; }        /* no confetti; suppressed entirely */
}
```

### R4.2.5 The visual flourishes per phrase (beyond confetti)

- **Spotlight:** on-beat brighten pulses through Phrase 1; a small circular sweep tracking the Twirl in Phrase 2; a double-pulse on the death-drop freeze in Phrase 3; max brightness on the Phrase 4 final downbeat.
- **Catwalk panels:** override their ambient head-to-foot chase to flash on the 500ms downbeat during the dance (the floor keeps the beat), returning to ambient chase after the number.
- **Liquid color shifts (optional, flagged):** R2 floated "color shifts in his liquid" during the dance. BeakerBot's liquid is a fixed five-stop rainbow gradient; a tasteful option is a slow `hue-rotate` filter on the liquid group during the dance only (a gentle rainbow cycle, +/- a small range so he never stops looking like himself), returning to the canonical gradient at the end. This is optional sparkle, not required; default OFF unless Grant wants it, since the canonical rainbow is already the signature. Flagged in R4.4.
- **Rainbow trail:** the Twirl's existing rainbow motion-trail (P1) is reused in Phrase 2 and lingers into beats 3 to 4.
- **Flash flurries:** light per-phrase flashes building to the full pit flurry on the Phrase 4 button (reusing R3.7).

### R4.2.6 New art vs. reused (build-cost ledger for the Dance Number)

| Item | New or reused | Build cost |
|---|---|---|
| Step-touch sway (Phrase 1) | **New timeline** over existing idle-bob + think-lean amplitudes; no new bot art | Low. A beat-gridded translate/rotate sequence. |
| Twirl + rainbow trail (Phrase 2) | **Reused** (the P1 Twirl scene) | Zero (assuming P1 shipped). |
| Shimmy (Phrase 2) | **New small oscillation** (a rotate wiggle) | Low. |
| Death Drop, compressed (Phrase 3) | **Reused** (the P2 Death Drop, time-compressed) | Low (assuming P2 shipped; only the compressed timing is new). |
| Micro-strut + finish (Phrase 4) | **Reused** (P1 Strut steps + `cheering`) | Low. |
| Rainbow confetti system | **New, but built on the existing particle pattern** (inverted volcano fountain, staged bursts, self-cleanup) | Medium. The genuinely new system; the escalation + cleanup are the work. The single most important new thing in this scene. |
| On-beat spotlight / panel accents | **Reused** (R3.6 spotlight, R3.5 panels) + a beat-synced override | Low. |
| Liquid hue-cycle (optional) | **New, optional** (a `hue-rotate` filter, off by default) | Low, and skippable. |
| State machine / envelope / reduced-motion | **Reused pattern** | Low. Boilerplate. |

**Net new art:** the confetti system (the real work) + a few beat-gridded transform timelines (sway, shimmy, finish). Everything dance-move-wise composes from P1 + P2 + existing poses. This matches R2.2's "Medium-to-high: no new bot art, but choreographing the beats so it reads as a dance is the work, plus a confetti system that does not tank performance." R4 resolves both: the four-phrase 120-BPM grid IS the choreography spine, and the staged-burst-with-cleanup confetti IS the perf-safe system.

### R4.2.7 Reduced-motion fallback (Dance Number)

Per R3.10: all motion suppressed, confetti suppressed entirely (`.confetti-layer { display: none }`), replaced by a static **"she served" finale freeze-frame**: BeakerBot in the Phrase 4 big-finish `cheering` pose under a static lit spotlight, the pit cameras at their constant gentle bloom. It reads as the final bow of the number, paused on its best frame. Dwell ~2000ms, then `onComplete`.

---

## R4.3 Catalog + placement

### R4.3.1 How both register in `BEAKERBOT_ANIMATION_CATALOG`

Both are scenes, so they take the `SceneEntry` shape (`kind: "scene"`, verified shape in `frontend/src/app/dev/beakerbot-gallery/page.tsx`: `{ kind, id, label, Component, description, timingNote }`). The `timingNote` is the catalog's looping-metadata field; for one-shot scenes it states the total runtime (mirroring how Centrifuge etc. note their duration). Proposed entries:

```tsx
// ILLUSTRATIVE ONLY. The two new SceneEntry rows for the catalog.
// Same shape as the 9 existing scene entries. Component refs are the
// R3.11 components (DeathDropScene / DanceNumberScene).
{
  kind: "scene",
  id: "scene:death-drop",
  label: "Death Drop",
  Component: DeathDropScene,
  description:
    "The iconic drag finale, done for a beaker: a confident vogue, a controlled backward dip onto a hidden cushion (liquid sloshing, never spilling), a held freeze while the pit erupts in flashbulbs, then a proud rise. Fabulous and safe, never a fall.",
  timingNote: "~5.8s one-shot (matches Centrifuge)",
},
{
  kind: "scene",
  id: "scene:dance-number",
  label: "Dance Number",
  Component: DanceNumberScene,
  description:
    "The grand-finale production number: a 120-BPM four-phrase routine (step-touch, twirl + shimmy, the death-drop showstopper, a big finish) with escalating rainbow confetti made of BeakerBot's own five liquid colors. The closer of the whole show.",
  timingNote: "~8.5s one-shot (the longest scene; the page closer)",
},
```

The category-menu (R3.1) is a runway-pose concern; scenes are announced by their `NOW PERFORMING - [name]` marquee placard (R3.8) pulling `name` + `description` from the catalog, so the Death Drop and Dance Number need no per-pose category line. If Grant wants the Dance Number's closer placard to carry a drag-voice flourish, "THE CATEGORY IS... THE FINAL CURTAIN, DARLING" or "GIVE HIM HIS FLOWERS" are on-tone candidates (flagged, optional).

### R4.3.2 Where they live on the showcase page

**The Death Drop: a featured spotlight moment, NOT a standard proscenium.** It earns special placement because it is the single best screenshot moment. Recommendation: place it as a **featured full-bleed spotlight act at the TOP of the Performance Hall** (between the Runway and the standard 9-scene proscenium grid), in a larger, more dramatic frame than the uniform 16:10 prosceniums, framed as the headliner ("TONIGHT'S HEADLINER" or "THE MAIN EVENT" placard). It gets room: a near-full-viewport stage so the dip reads at full drama, with the pit and flashbulbs prominent. This makes it the transition between "the looks" (Runway) and "the acts" (Performance Hall), and it reads as the marquee draw of the whole show. (Alternative considered: a special spotlight moment ON the runway, as a 22nd "look." Rejected: it is a full scene with a timeline, not a held pose, so it belongs in the Hall with the other timed acts, just elevated. Flagged as Grant's call if he prefers it as a runway capstone instead.)

**The Dance Number: the grand-finale closer at the BOTTOM of the page (the curtain call).** It is explicitly the closer, so it lives at the very bottom, as the page's final act, right before (or merged into) the curtain-call footer (R3.11 `CurtainCallFooter`). Recommendation: the Dance Number plays as the last full stage the user scrolls to, and on its final-downbeat freeze it dovetails into the curtain-call footer (the `bow-wink` BeakerBot + credits caption + link back to the app). So the page's emotional arc is: find the backstage door (unlock) to the marquee hero to the runway of looks to the headliner Death Drop to the 9 acts to the Dance Number finale to the bow. The Dance Number IS the curtain call; the footer is its final bow. This gives the whole scroll a real ending instead of just stopping.

### R4.3.3 Build difficulty + sequencing (confirm/adjust)

R2.2's order holds, confirmed:

- **Death Drop = P2** (after P1's Curtain Reveal / Strut / Twirl land). Confirmed. Rationale: it needs the most genuinely new art (the slosh keyframe + cushion + floor shadow), and it depends on nothing from P3, so it is the right "prove the showstopper" step once the stage exists. Difficulty: medium-high, concentrated in tuning the slosh + the controlled-tip easing to honor the safety thesis.
- **Dance Number = P3** (after the Death Drop, since the routine INCORPORATES the drop as its Phrase-3 centerpiece). Confirmed, and it is now a hard dependency, not just a sequencing preference: the Dance Number's Phrase 3 reuses the `DeathDropScene` timing, and Phrase 2 / Phrase 4 reuse the P1 Twirl / Strut. So P3's Dance Number genuinely cannot be built until P1 (Twirl, Strut) AND P2 (Death Drop) exist. The only NET-new work in the Dance Number itself is the confetti system + the beat-gridded sway/shimmy/finish timelines; the dance moves are reuse. This is why it is correctly last: it is the capstone that composes everything below it.

One adjustment to flag: because the Dance Number leans so heavily on P1 + P2, if Grant wants the Dance Number sooner, the cheapest path is to make sure the Twirl, Strut, and Death Drop are solid first; there is no shortcut that builds the dance independently without re-implementing those moves.

### R4.3.4 Reduced-motion (both): summary

Both follow the house pattern (R3.10), each detailed above (R4.1.7, R4.2.7): suppress all motion, suppress confetti/slosh/flash entirely, render a static "she served" freeze-frame of the end pose (`cheering` for both, with the Death Drop optionally showing its tipped-freeze-on-cushion frame instead if Grant prefers the more dramatic still) under a static lit spotlight with the pit at constant gentle bloom, dwell ~2000ms, then `onComplete`. The fallback is "the show, paused on its best freeze-frame," consistent with every existing scene and the rest of the showcase chrome.

## R4.4 Open questions for Grant (R4-specific)

Few, by design; the choreography is pinned and a build can implement both from the beats + snippets above without a new animation decision. The genuinely open items:

1. **Death Drop dip angle.** Spec defaults to -58deg (dramatic, but shallow enough to keep the liquid safely below the lip with no spill). Grant can push to -64deg max (tighter liquid cap needed) for more extreme drama, or pull shallower for a gentler dip. Default -58deg is shippable as-is.
2. **Death Drop placement.** Recommended as the elevated "headliner" featured act at the top of the Performance Hall (its own larger frame). Alternative: a special capstone moment at the end of the Runway. Recommendation stands; Grant's call.
3. **Dance Number liquid hue-cycle.** R2 floated "color shifts in his liquid" during the dance. Spec leaves it OFF by default (a slow, small-range `hue-rotate` is the optional implementation) because his canonical five-stop rainbow is already the signature. Turn it on, or keep him his canonical self? Default OFF is shippable.
4. **Dance Number closer placard flourish.** The finale can carry a drag-voice flourish on its placard ("THE FINAL CURTAIN, DARLING" / "GIVE HIM HIS FLOWERS") or just read "NOW PERFORMING - Dance Number". Optional; default to the plain catalog name unless Grant picks a flourish.

Everything else (every beat, duration, easing curve, the liquid-slosh keyframe, the confetti system + counts + cleanup, the cushion + floor shadow, the flash schedules, catalog entries, placement, sequencing, reduced-motion) is pinned. A build sub-bot can implement the Death Drop (P2) and the Dance Number (P3) from R4 + the snippets without making a new design decision.

---

*R4 sketches are illustrative. No routes, scene props, or components were built. R4 is the detailed choreography for the two marquee new scenes (Death Drop, Dance Number); hand-off to the build chip happens at Grant's word, sequenced P2 then P3 per R4.3.3. Authored by the showcase-choreography sub-bot per orchestrator manager dispatch.*
