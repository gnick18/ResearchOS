# SciDraw — one devtools capture needed before I build the adapter

SciDraw (https://scidraw.io) is the best **physics** illustration source: real
figure-quality drawings (optics, detectors, atoms, apparatus, quantum), each under
**CC-BY** (confirmed per-drawing, e.g. drawing 122 says "creative commons license (CC-BY)").
It's the physics gap-filler the bio sources can't cover.

The one blocker: the **SVG download URL is loaded by JavaScript**, so it isn't in the
page HTML and I can't derive it from the server. I need one capture of the real
request the "Download SVG" button fires. ~60 seconds in Chrome.

## Paste into Claude-in-Chrome (or do it by hand)

> 1. Open `https://scidraw.io/drawing/122`.
> 2. Open DevTools → **Network** tab. Filter to **Fetch/XHR** (and keep "All" handy).
> 3. Click the drawing's **Download** control, choose **SVG**.
> 4. In the Network panel, find the request that returns the SVG (Type `svg` or an
>    XHR whose response starts with `<svg` / `<?xml`). Click it and report:
>    - the full **Request URL**
>    - the **Request Method** (GET/POST) and any query params or POST body
>    - the response **Content-Type** (should be `image/svg+xml`)
> 5. Also grab, from the page, how a drawing's **license** and **author** are shown
>    (so I capture per-drawing attribution — some drawings may differ from the CC-BY
>    default). A screenshot of the drawing's info/credit area is enough.
> 6. Bonus: open `https://scidraw.io/` and report whether there's a paged list or an
>    API (Network tab) that enumerates drawings (so the crawler can walk all of them
>    politely rather than guessing IDs).

## What I'll do with it
Build `ingest-scidraw.mjs` on the same `lib.mjs` pattern: walk the drawing list,
fetch each SVG at the captured URL, sanitize (per-fill preserved), map to taxonomy
leaves (a Physics-leaning set), capture per-drawing CC-BY author attribution into
the auto-credit, then ingest + embed + sync to R2 like the others.

> Note: SciDraw drawings can be intricate multi-path SVGs, so per-fill recolor
> should work well here (unlike the single-tint Tabler glyphs). Polite crawl
> (rate-limited) since it's a small volunteer-run site.

## Open taxonomy question (for the physics/math/CS growth)
The corpus is now growing into physics / math / CS, but the LOCKED 9-section
taxonomy has no **Physics** or **Math** leaf (CS only has "Computer hardware" /
"Machine learning" under Data & informatics). Tabler/Devicon were mapped onto
existing leaves (physics/math glyphs landed in "General"). Worth deciding whether to
add **Physics** + **Math** leaves (and maybe a real CS leaf) before SciDraw lands a
big physics batch, so it doesn't pool into "General". Your call — taxonomy is locked
to you.
