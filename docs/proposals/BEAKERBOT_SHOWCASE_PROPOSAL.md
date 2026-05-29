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
