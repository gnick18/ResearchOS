# Teaser scene renderer

Renders an animated HTML scene to a clean 4K mp4 with no screen recording.
Uses the system Chrome via puppeteer-core (no Chromium download). Animations are
stepped deterministically frame-by-frame, so output is frame-exact.

## Render a scene

```
cd docs/teaser/render-tooling
# frames -> PNG sequence
node render-scene.mjs ../scenes/<scene>.html ../frames/<scene> --fps 60 --dur 9 --w 3840 --h 2160
# PNG sequence -> mp4 (CapCut-ready: H.264 high, yuv420p, faststart)
ffmpeg -y -framerate 60 -i ../frames/<scene>/frame_%05d.png \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 16 \
  -movflags +faststart -r 60 ../out/<scene>.mp4
```

## Set --dur to cover the scene

Total scene length = the latest CSS animation (delay + duration). For
ask-beakerbot the push-in ends at 7.4s + 1.4s = 8.8s, so --dur 9.

## Layout

- scenes/       designed animated HTML scenes (one per beat)
- frames/       rendered PNG sequences (gitignored, regenerable)
- out/          final scene mp4s handed to CapCut
- render-tooling/  this renderer (puppeteer-core, isolated install)
