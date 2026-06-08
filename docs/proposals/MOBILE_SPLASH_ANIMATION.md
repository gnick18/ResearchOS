# Mobile splash animation, design proposal

Goal: replace the current quick splash (a static BeakerBot+wordmark lockup that scales/fades, ~1.5s) with a high-quality animated brand moment on app open, in the spirit of Grant's three LottieFiles references, but on-brand (BeakerBot).

Watchable prototype: `docs/mockups/2026-06-08-splash-animation.html` (Replay, dark toggle, "show app handoff").

## What the references told us

Three refs Grant shared (downloaded + dissected from lottie.host):
- Ref 1 (3.0s, vivid multi-color, raster assets) , a playful colorful particle/shape burst.
- Ref 2 (3.5s, 60fps, "logo shape" + "logo text" + many "shadow" layers, pink/purple) , a clean logo+wordmark reveal whose quality comes from silky 60fps easing and soft layered drop-shadow depth as it settles.
- Ref 3 (5.7s, letter-by-letter wordmark + a red accent dot + a square↔oval background shape-morph) , kinetic-typography reveal with a morphing backdrop and one pop of accent.

Common thread: a confident logo + wordmark reveal, depth (shadows), one delightful accent, smooth easing, ~3s. All are generic (not our brand), so they are style/motion reference, not shippable as-is.

## The concept, "BeakerBot wakes up" (recommended)

A reveal that turns our logo into a tiny character moment, tied to the mark's own rainbow liquid. Beats (about 2.4s, then the handoff):
1. Beaker glass outline + rim + spout DRAW on (ink-stroke), with a soft drop-shadow appearing underneath (the ref-2 depth cue).
2. The rainbow LIQUID rises into the beaker with a wavy surface and a couple of bubbles floating up and popping (our signature, the logo's liquid coming alive).
3. BeakerBot WAKES: eyes pop in, a single blink, the smile draws.
4. A spout SPARKLE twinkles and the wordmark "ResearchOS" settles in letter by letter (ref-3 nod, subtle).
5. One gentle breathe (the living mark), then the whole lockup shrinks (scale 1->0.88) and fades to reveal the app (our existing no-flash handoff).

This hits every quality note from the refs (logo+text reveal, shadow depth, an accent, smooth easing) while being unmistakably ours. A lighter variant ("rainbow sweep reveal", ~1.2s) is available if 2.4s feels long for a frequently-opened companion.

## Tech options

| Option | On-brand | New dep | Expo Go | Effort | Notes |
|---|---|---|---|---|---|
| Hand-built Reanimated + react-native-svg | yes (our exact mark) | none | yes | medium | We already have the living BeakerBot (blink/sway) + rainbow + the AppSplash handoff. Full control. Recommended. |
| react-native-skia | yes | +skia | yes (since SDK 46) | medium-high | Worth it only if we want GPU liquid sloshing / particle bubbles / shader glow beyond what SVG does smoothly. |
| Lottie (lottie-react-native 7.3.x) | only if we author a BeakerBot Lottie | +lottie | yes (SDK 54) | high (design pipeline) | Lottie's strength is dropping in a designer's After-Effects JSON. The refs are generic; shipping one would break the "mascot is BeakerBot" rule. A custom BeakerBot Lottie means an After-Effects + Bodymovin authoring effort (a design deliverable, not a code task). |

Recommendation: hand-build with Reanimated + react-native-svg (extend the existing `AppSplash.tsx`). It is the only path that is fully on-brand, adds no dependency, runs in Expo Go today, and reuses what we already built. Reserve Skia as an upgrade if we later want richer liquid/particle physics. Lottie only if Grant wants to commission/author a true BeakerBot Lottie.

## Integration

Keep the current native-splash -> JS-overlay handoff (no white flash): `expo-splash-screen` holds the native icon until JS is ready, then `AppSplash` plays the reveal over the app and, on finish, the lockup shrinks + fades to reveal the real UI. The animation lives entirely in `AppSplash.tsx`; no nav or screen changes. Reduce-motion aware (respect the OS setting, fall back to a quick fade). Plays on cold start only.

## Decisions for Grant

1. Tech: hand-built Reanimated+SVG (recommended) vs Skia (more flair, +dep) vs author a BeakerBot Lottie (design pipeline).
2. Concept: "BeakerBot wakes up" (~2.4s, recommended) vs a lighter "rainbow sweep" (~1.2s).
3. Duration tolerance: is ~2.4s on every cold open acceptable for a companion, or keep it under ~1.5s.
