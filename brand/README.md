# ResearchOS brand assets

Permanent home for the BeakerBot + ResearchOS branding. Everything here is generated from the
real in-app BeakerBot geometry (`frontend/src/components/BeakerBot.tsx`), so it stays on-brand.

## Colors
- BeakerBot outline / primary sky-blue: `#1AA0E6`
- Wordmark near-black (matches the app, `text-gray-900`): `#111827`
- Rainbow liquid stops, PASTEL (light mode, top to bottom): peach `#FFD2B0`, yellow `#FFF1A8`, mint `#B7EBB1`, sky `#A6D2F4`, lavender `#D6B5F0`
- Rainbow stops, VIVID (dark-mode signature, same hue order): orange `#F97316`, amber `#E8920B`, green `#16A34A`, blue `#0284C7`, purple `#9333EA`. The pastel ramp goes muddy on dark surfaces, so dark mode uses this saturated ramp, as a fill on avatars/swatches and a low-opacity glow on large surfaces (e.g. the loading screen). See `researchos-rainbow-vivid.svg`.
- Channel purple (current YouTube avatar bg): `#5B47D6`

## Type
Wordmark is **Geist** at weight 800 (bold), tight tracking (about -0.03em), in `#111827`.

## Files
- `beakerbot-mark.svg` — BeakerBot alone, transparent background. The reusable logo mark. Scales to any size.
- `beakerbot-avatar-{peach,sky,white,purple}.svg` — square profile images, BeakerBot centered full-bleed so a circular crop frames him with margin.
- `researchos-banner-{lockup,wordmark}.svg` — 2048x1152 channel banner. Lockup = mark + wordmark, wordmark = text only. Logo sits inside YouTube's 1235x338 safe area.
- `researchos-rainbow-vivid.svg` — the dark-mode (vivid) rainbow ramp, for reference + reuse.
- `png/` — rendered exports.
  - `beakerbot-avatar-*-1600.png` — 1600x1600. **Use these for uploads** (YouTube re-compresses small images, which is why an 800px upload looked soft).
  - `researchos-banner-*.png` — 2048x1152.
  - `researchos-og.png` — 1200x630 social-share / OpenGraph card (mark + wordmark + tagline). Wired into the app as `frontend/src/app/opengraph-image.png` + `twitter-image.png`.
  - `researchos-bluesky-banner.png` — 1500x500 (3:1) Bluesky profile header. Lockup nudged right of center to clear the bottom-left avatar overlay.
- `src/` — the editable generators (`profile.html`, `banner.html`, `og.html`, `bluesky-banner.html`). Open over `http://localhost` to re-render or tweak.

## Notes
- SVG is the master format (infinitely crisp), but YouTube/most upload forms only accept PNG/JPG. Upload the PNGs, keep the SVGs for everything else (web, print, slides).
- The banner SVGs reference the Geist font by name. If you open them somewhere without Geist installed they fall back to Inter/system. The PNGs are already rendered with Geist, so they are safe everywhere.
- Re-render any PNG at higher DPI with Chrome headless: `--force-device-scale-factor=2 --window-size=800,800 --screenshot=out.png file://<svg>`.

## Favicon
The site favicon (`frontend/src/app/icon.svg` + `frontend/src/app/favicon.ico`) is the BeakerBot mark on a soft sky disc, generated from the same geometry.
