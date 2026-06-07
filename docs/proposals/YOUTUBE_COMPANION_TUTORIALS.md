# YouTube companion tutorials (design doc)

Status: draft for Grant's sign-off. No code or recording yet.
Author: brand manager (Claude), 2026-06-07.

## Goal

Short, friendly YouTube tutorials, one per meaningful feature, with the BeakerBot
vtuber face in the corner narrating, embedded right next to the matching wiki page
and (where it fits) reachable from the in-app tour. A researcher reading the
"Sequences" wiki page should be able to press play and watch a 2-to-4 minute
walkthrough of that exact feature, in our voice, with the mascot doing the talking.

Division of labor that Grant asked for: Grant records (screen plus voice plus the
vtuber face), Claude edits the raw capture into the finished video, Claude wires the
embeds into the wiki. This doc defines what gets a video, how the recording is set
up so the BeakerBot face sits nicely bottom-right, the editing pipeline, and how the
videos live on the site.

## Principles

- One feature, one video. Keep each tutorial tight and single-topic so it stays
  useful when a feature changes and only that one video needs a re-record.
- Complement the tour, do not repeat it. The in-app v4 tour already does the
  hand-held first-run walkthrough. Videos go deeper on a single feature for someone
  who already knows the basics and wants to see it done.
- Concept first, then the clicks. Same voice as the wiki. Explain why the feature
  exists, then show it. No hype, no AI-speak, follow the BRAND_MANAGER voice rules
  (no em-dashes, no emojis, no mid-sentence colons, no "in this video we'll").
- Evergreen over timely. Avoid dates, version numbers, and "new" framing in the
  narration so videos age slowly.
- Privacy. Record only against demo or fixture data, never the real data folder,
  same rule as screenshots. Use demo mode or `?wikiCapture=1` fixtures.

## Which features get a companion video

The app has roughly 40 user-facing surfaces. Not all deserve a video. The filter is:
does watching it move differently than reading help, and is the feature visual or
multi-step enough that motion adds something. A calculator does not need a video, a
cloning assembly does.

Tiered by priority. Tier 1 is the launch set, the rest follow once the pipeline is
proven.

### Tier 1, the launch set (8 videos)

These are the highest-traffic, most-visual, hardest-to-grok-from-text features.

1. Getting started, connect your folder and create a user. The single most
   important video, covers the local-first model and the folder gate.
2. The Workbench, projects, experiments, notes, and lists in one place.
3. Notes and the hybrid markdown editor, the daily-driver writing surface.
4. Methods library and the template catalog, find a protocol and run it.
5. Sequences, view, annotate, and the plasmid library.
6. Cloning, in-silico assembly with the review step.
7. Version history, the timeline, per-editor diff, and restore.
8. Sharing and permissions, who can see and edit what.

### Tier 2, deepen coverage (6 videos)

9. Gantt chart, dependencies and drag-to-reschedule.
10. PCR protocols, the thermal gradient editor and reagent table.
11. Lab calculators, a quick tour of molarity, dilution, Tm, mass.
12. Image annotation, marking up gels without touching the original.
13. Purchases and funding, tracking buys against accounts (PI soft-write).
14. Restriction digest, finding cut sites and fragment sizes.

### Tier 3, lab-head and admin (4 videos)

15. Lab overview, the PI landing page.
16. PI soft-write actions and the audit log.
17. Lab inbox, comments, mentions, and announcements.
18. Mentoring and 1:1 check-ins.

### Tier 4, integrations and data (4 videos)

19. Telegram bot, phone photos straight into the inbox.
20. Import from LabArchives, the migration wizard.
21. NIH data sharing, depositing to Zenodo with metadata.
22. Calendar feeds, subscribing to external calendars.

### Intentionally skipped (text and the tour are enough)

Browser requirements, demo mode, settings, trash and history, search, lab links,
notifications, feedback. These are short or self-evident and a video adds nothing.

Open question for Grant. Is Tier 1 the right launch set, or do you want to swap
anything in or out? Marked with a `?` so we resolve it before recording.

## Recording setup, how to get the BeakerBot face in the corner

This is the part Grant flagged as unknown. The avatar tool already supports exactly
this. The recipe uses OBS Studio (free, Mac and Windows), which composites the
screen recording and the vtuber face into one video.

The avatar tool lives at `tools/beakerbot-avatar/`. It is a static web page that
renders the BeakerBot SVG, animates the mouth from microphone volume, and tracks the
head with the webcam via MediaPipe. It has a transparent background mode and a green
background mode, and its own hint text already says "For OBS, add a Browser Source at
this URL, pick Transparent, crop into the corner."

### One-time setup

1. Install OBS Studio from obsproject.com.
2. Serve the avatar locally. The camera and mic need a real origin, so open the tool
   over `http://localhost`, not a `file://` path. From the repo run a tiny static
   server in `tools/beakerbot-avatar/` (for example `npx serve` or
   `python3 -m http.server`) and note the URL, for example
   `http://localhost:3000/index.html`.
3. In OBS create a Scene called "Tutorial". Add two sources to it, in this order
   (top of the list draws on top):
   - Source A, Browser, pointing at the avatar URL. In the avatar page set the
     background to Transparent. In the OBS Browser source tick "Shutdown source when
     not visible" off and set a square-ish size. Then resize and drag it into the
     bottom-right corner, maybe 280 by 280 pixels, and crop away any empty margin by
     holding Alt (Option on Mac) and dragging the source edges.
   - Source B, Display Capture or Window Capture, the screen you will record. This
     sits below the avatar so the face floats over it.
4. Add an Audio Input Capture for your microphone if OBS does not already show it in
   the Audio Mixer.
5. In the avatar page, click Enable for face tracking, allow the camera, look
   straight ahead, and click Recenter. The mouth moves with your voice automatically.
6. Settings, Output. Set the recording format to MP4 and a sensible quality (1080p,
   30fps is plenty). Set the recording folder somewhere easy to find.

### Recording a take

1. Open the app in the screen you are capturing, in demo mode or with the wiki
   fixtures, never the real data folder.
2. Press Start Recording in OBS, do the walkthrough while narrating, press Stop.
3. Hand the raw MP4 to Claude (drop it somewhere shared, see file conventions below)
   with a one-line note on the feature and anything to cut.

Notes. The vtuber face is composited live, so the raw recording already has BeakerBot
in the corner. That keeps editing simple. If face tracking is fiddly, the mic-driven
mouth alone still looks alive, you can skip the webcam and just talk. The green
background mode is the fallback if transparent ever misbehaves in OBS, chroma-key it
with a Color Key filter on the Browser source.

Open question for Grant. Do you want the face always visible, or only during intros
and key moments. Always-on is simplest to record. Marked `?`.

## Editing pipeline (Claude's job)

Claude takes the raw take and produces the publish-ready file. Editing is done with
ffmpeg (scriptable, no GUI needed) for the deterministic parts, plus a human-reviewed
cut list from Grant for the content trims.

What editing covers:
- Trim dead air at the start and end and any flagged fumbles.
- Normalize audio loudness so every video sits at the same level.
- Add a short branded intro and outro card (BeakerBot lockup, the wordmark, the
  research-os.app URL), generated from the existing `brand/` assets.
- Burn in nothing distracting. No background music unless Grant wants it. Optional
  light lower-third title using the brand font.
- Export 1080p MP4, plus pull a thumbnail frame.
- Write the YouTube description, chapters, and title in brand voice for Grant to
  paste at upload time. Grant uploads, account actions stay with Grant.

Claude does not have the raw camera or mic, so Claude cannot record. The split is
clean, Grant records and uploads, Claude edits and writes the copy and wires the
embeds.

## Site integration

The wiki has no video capability today, it is screenshot-only via the `<Screenshot>`
component. We add a sibling component and a place to embed.

### New `<TutorialVideo>` wiki component

A small TSX component, mirroring `<Screenshot>`, that embeds a YouTube video with
privacy and performance in mind:
- Use the `youtube-nocookie.com` privacy-enhanced embed so we do not set tracking
  cookies before a viewer presses play, consistent with our trust posture.
- Lazy, do not load the iframe until the poster is clicked, to keep wiki pages fast.
  Render our own thumbnail plus a play button, swap to the iframe on click.
- Same caption and lightbox-ish framing as `<Screenshot>` for visual consistency.
- Props, `id` (the YouTube video id), `title`, optional `caption`, optional
  `poster` (a local thumbnail under `public/wiki/video-posters/`).

Each Tier 1 wiki page gets a `<TutorialVideo>` near the top, right under the intro,
so the video is the first thing offered to someone who would rather watch.

### A tutorials index page

Add `/wiki/tutorials` (or `/tutorials`) as a gallery of all companion videos grouped
by the same clusters above, so the set is browsable on its own and linkable from the
welcome page and the footer.

### Tour hook (optional, later)

The v4 tour could, at the end of a feature step, offer a "watch the full tutorial"
link that deep-links to the matching wiki video. Low priority, do after the embed
component ships.

Open question for Grant. Do videos also live as a YouTube playlist on the channel,
yes recommended, and do we want the tutorials index at `/wiki/tutorials` or a
top-level `/tutorials`. Marked `?`.

## File and naming conventions

- Raw takes from Grant, drop in a scratch location agreed per session, named
  `raw-<feature>-<take>.mp4`, for example `raw-sequences-1.mp4`.
- Finished masters, store outside git (large binaries), Grant uploads to YouTube.
  The repo only stores the small poster thumbnails and the video ids.
- Posters, `frontend/public/wiki/video-posters/<feature>.jpg`.
- The mapping of feature to YouTube id lives in one file,
  `frontend/src/lib/wiki/tutorial-videos.ts`, so a future bot updates ids in one
  place. `BRAND_MANAGER.md` social inventory points here.

## Phasing

- Phase 0, this doc signed off, open questions resolved.
- Phase 1, build the `<TutorialVideo>` component and the `tutorial-videos.ts` map,
  with one placeholder so the plumbing is proven before any recording.
- Phase 2, record and ship the first single video end to end (suggest Sequences or
  Cloning, the most visual), prove the full record to edit to embed loop.
- Phase 3, batch the rest of Tier 1, then Tiers 2 to 4 as time allows.

## Open questions for Grant (resolve before Phase 1)

1. Is the Tier 1 launch set right, any swaps.
2. Face always-on, or intros and key moments only.
3. Tutorials index at `/wiki/tutorials` or top-level `/tutorials`, and a YouTube
   playlist yes.
4. Any background music, or voice only.
5. Target length per video, the doc assumes 2 to 4 minutes.
