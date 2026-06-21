# ResearchOS teaser, cut-list for CapCut

Target length ~37s (inside the 30 to 40s goal). All clips are in docs/teaser/out/
at 3840x2160, 60fps, silent. Assemble in CapCut Pro (desktop), add music + the
word titles, export.

The arc: a slow deep-dive on 3 hero features, then an accelerating montage of
everything else, the words pile into a wall, close on the mascot + wordmark.

## Master timeline

| # | Clip (out/) | On screen | Starts at | Title overlay |
|---|---|---|---|---|
| 1 | lab-notes.mp4 | 4.3s | 0:00.0 | "Lab Notes" |
| 2 | data-hub.mp4 | 4.4s | 0:04.3 | "Data Hub" |
| 3 | ask-beakerbot.mp4 | 4.85s | 0:08.7 | "BeakerBot" |
| 4 | sequences.mp4 | 1.7s | 0:13.55 | "Sequences" |
| 5 | chemistry.mp4 | 1.55s | 0:15.25 | "Chemistry" |
| 6 | gantt.mp4 | 1.45s | 0:16.8 | "GANTT" |
| 7 | methods.mp4 | 1.35s | 0:18.25 | "Methods" |
| 8 | phylo.mp4 | 1.25s | 0:19.6 | "Phylo trees" |
| 9 | figure.mp4 | 1.15s | 0:20.85 | "Figures" |
| 10 | lab-sites.mp4 | 1.1s | 0:22.0 | "Lab sites" |
| 11 | network.mp4 | 1.05s | 0:23.1 | "Network" |
| 12 | calendar.mp4 | 0.9s | 0:24.15 | "Calendar" |
| 13 | inventory.mp4 | 0.85s | 0:25.05 | "Inventory" |
| 14 | purchases.mp4 | 0.8s | 0:25.9 | "Purchases" |
| 15 | companion.mp4 | 0.95s | 0:26.7 | "In your pocket" |
| 16 | page-word-wall.mp4 | 4.0s | 0:27.65 | (the wall is the words) |
| 17 | closing-hero.mp4 | 6.0s | 0:31.65 | (lockup is baked in) |

End ~0:37.65.

## Act 1, slow deep-dive (0:00 to 0:13.5)

Three hero clips, each held long enough to land its single satisfying beat.
The source mp4s are 9s each (type, build, result, push). Trim to the window
below and apply a light speed-up so the full beat reads in the on-screen time.

- 1. Lab Notes. Source window 0.6s to 7.0s, ~1.5x. Shows the recipe title type
  in, the reagent table, the checklist ticking. Big title "Lab Notes".
- 2. Data Hub. Source window 0.0s to 7.0s, ~1.6x. Formula types, rows stream,
  the Control vs Treated result with p value. Big title "Data Hub".
- 3. BeakerBot. Source window 0.6s to 8.6s, ~1.65x. Query types, the plan card
  runs, the qPCR thermal-cycling protocol forms. Big title "BeakerBot".

Title treatment (Act 1): large bold word, lower third, dark text with the brand
text-blue #1283C9 as an accent. Fade in ~0.3s after the cut, hold, fade before
the next cut. Each hero gets one clean cut on a downbeat.

## Act 2, accelerating montage (0:13.5 to 0:27.65)

Twelve clips, on-screen time shrinking from 1.7s to 0.8s. That shrink IS the
acceleration, so keep playback speed modest (1.2x to 1.5x) and let each flash
land on a crisp formed frame. For each montage clip, trim a window that ENDS at
the scene's settled state (each scene's signature motion completes by ~3.0s, the
gentle camera push starts at 2.9s), so even the 0.8s flashes show the feature
fully formed rather than a blur. Cut every clip ON the beat.

Title treatment (Act 2): small bold kicker word, lower-left, same per-clip
timing. These are quick reads. Each scene also carries its name in its own
header, so the kicker is reinforcement, keep it light. The plasmid (Sequences)
is mid-spin, the molecule (Chemistry) is drawn, the GANTT bars are cascaded, etc.

Note on the companion flash (#15): it is a phone, not a laptop card, on purpose.
Place it last in the montage as the "and it is with you at the bench" beat right
before the wall. Suggested title "In your pocket" (avoid implying the paid cloud
sync is free, see billing guard below).

## Climax, the word wall (0:27.65 to 0:31.65)

page-word-wall.mp4 plays at native speed (no speed-up, this is the payoff). The
feature words accelerate into a grid, then "...and everything in between." holds.
Land the music's biggest hit on the moment the wall completes (~2.5s into this
clip). No overlaid title here, the wall is the title.

## Close (0:31.65 to 0:37.65)

closing-hero.mp4. The real pastel BeakerBot, the ResearchOS wordmark (OS in the
rainbow), "Open source. Free forever.", "Start today", research-os.app, with
rising bubbles. Let it breathe, hold the final lockup ~2s. Music resolves here.

## Music + beat guidance

- One track, building electronic or warm ambient with a clear pulse. Tempo that
  lets montage cuts fall on the beat (a clip every 1 to 2 beats, tightening).
- Act 1: sparse, deliberate, one swell per hero.
- Act 2: the groove kicks in, energy rises as cuts shorten.
- Climax: the drop / biggest moment lands as the wall completes.
- Close: resolve to a clean held chord under the lockup.
- Put CapCut beat markers down first, then snap every montage cut to them.

## Brand guard (do not violate on overlays you add)

- No em-dashes, no emojis, no mid-sentence colons in any added title text.
- The mascot is always the real pastel BeakerBot. "OS" in the wordmark is the
  rainbow gradient. Brand text-blue #1283C9 on light.
- BILLING GUARD: "Open source. Free forever." refers ONLY to the open-source
  local app (it is baked into the close and is correct). Do NOT add any title or
  caption implying a paid tier (Solo, Lab, Dept, cloud sync, external sharing,
  the companion sync) is free. The companion flash title is "In your pocket",
  not "free".

## Source notes

- Every clip is silent and 60fps, so speed changes stay smooth.
- Heroes are 9s, montage scenes 3.6s, climax 4.5s, close 6.0s (as rendered).
- To re-render any scene at a different length, see render-tooling/README.md.
- Alternate Sequences cut available: scenes/sequences-linear.html (the linear
  base/alignment view) if you ever want it instead of the spinning plasmid.
