# Act 2 montage scene format

Shared spec for every Act 2 montage scene. These are FASTER than the Act 1 hero
scenes (ask-beakerbot / lab-notes / data-hub). Each montage scene is a single
self-contained animated HTML file in docs/teaser/scenes/, rendered to 4K by the
frame-stepped renderer. Match the Act 1 visual language exactly.

## Duration + motion arc

- Build each scene to a 3.5s timeline (render --dur 3.6).
- The signature motion should COMPLETE by ~3.0s, then a gentle camera push
  (scale 1.03 to 1.05) holds to the end.
- NO typing box (that is a hero deep-dive device). Montage scenes open fast:
  the card is already present, then the signature visual ASSEMBLES in one quick
  satisfying motion (staggered reveal, draw-in, stream-in, snap-together).
- These get cut progressively SHORTER in assembly (in-points trimmed from the
  front, ~2.0s down to ~0.7s flashes), so the opening 0.0-0.5s must read
  instantly: the card and its feature identity should be legible from frame 1.

## Design tokens (identical to Act 1, copy from scenes/ask-beakerbot.html)

- body bg #eef2f9, text #15243b, sub-text #7a869b
- card: #fff, 1px #e2e8f3, border-radius 20px, box-shadow 0 24px 60px rgba(20,40,80,.10)
- brand sky blue #1AA0E6, accessible text-blue #1283c9, embed bg #fafbfe, embed border #e7edf6
- BeakerBot pastel palette for accents: #FFD2B0 #FFF1A8 #B7EBB1 #A6D2F4 #D6B5F0
- system font stack only
- camera push: `animation:push 1.0s cubic-bezier(.4,0,.2,1) 2.9s forwards` + `@keyframes push{to{transform:scale(1.04)}}`
- a small header is good (icon chip + feature name + a tiny sub or badge), mirroring
  the Data Hub header. Recreate the feature's REAL signature visual underneath.

## Renderer constraints (HARD)

- Pure CSS @keyframes + transitions ONLY. No JS, no requestAnimationFrame, no
  canvas, no <video>, no external fonts/images/CDN. Everything inline + offline.
- Every motion is a CSS `animation` with explicit `animation-delay` (deterministic,
  discoverable via document.getAnimations()). Use `forwards` fill on reveals.

## Typing-box rule (only if a scene types text)

Montage scenes generally should NOT type. If one must, never set the width
target in `ch` or to scrollWidth: run `render-tooling/measure-typed.mjs` and use
its `widthTarget` (sub-pixel width + 8px pad) with steps = character count, or
the last glyph clips at 4K.

## Brand rules (STRICT, Grant rejects violations)

- NO em-dashes (use commas/parens/periods). NO emojis. NO mid-sentence colons
  (line-start labels and times like "0:30" are fine).
- Wordmark "ResearchOS" renders "OS" in rainbow gradient; never hand-draw a beaker;
  BeakerBot only via the canonical inline SVG mark; mascot always pastel.
- BILLING GUARD: never imply a paid tier is free; no pricing claims in montage scenes.
- Use CLEAN DEMO data only (gene names, sample ids, fake schedules). Never real lab data.

## Render command (per scene)

    cd docs/teaser/render-tooling
    node render-scene.mjs ../scenes/<scene>.html ../frames/<scene> --fps 60 --dur 3.6 --w 3840 --h 2160
    ffmpeg -y -framerate 60 -i ../frames/<scene>/frame_%05d.png \
      -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 16 -movflags +faststart -r 60 ../out/<scene>.mp4

## Self-verify before reporting

Render a low-res pass (`--fps 12 --dur 3.6 --w 1280 --h 720`) and Read frames at
~0.3s, ~1.5s, ~2.8s, ~3.4s to confirm: instant-read at open, signature motion
mid, settled + push at end. Delete the verify frames dir when done.

## Scene list (filename -> feature)

- sequences.html   Sequences
- chemistry.html   Chemistry (molecule/structure, NOT PCR)
- gantt.html       GANTT
- methods.html     Methods
- phylo.html       Phylo Tree
- figure.html      Figure Composer
- lab-sites.html   Lab Sites
- network.html     Network
- calendar.html    Calendar (flash)
- inventory.html   Inventory (flash)
- purchases.html   Purchases (flash)
