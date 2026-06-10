# Welcome page demo-clip capture

Re-records the looping feature clips on the `/welcome` sell page, straight from
the live `/demo` fixture. No screen-recording permission, no manual clicking.

Playwright records the page from the browser's own compositor (so it works
headless and needs no macOS Screen Recording grant), forces light mode to match
the welcome page, hides the dev/demo floating chrome, waits out the loader, and
auto-trims the lead-in. Each clip produces an `mp4` plus a `poster.jpg`.

## Run it

```bash
# dev server must be up (default http://localhost:3000)
node scripts/welcome-demo-capture/capture.mjs all
# or just one clip after a UI change:
node scripts/welcome-demo-capture/capture.mjs methods-library
```

Outputs land in `$TMPDIR/welcome-clips/mp4/` (e.g.
`/var/folders/.../welcome-clips/mp4/methods-library.mp4` + `.poster.jpg`).

Override the target with `BASE_URL=http://localhost:3017 node ...`.

Requires `ffmpeg`/`ffprobe` on PATH (`brew install ffmpeg`) and Playwright's
Chromium (already a `frontend/` dep; `npx playwright install chromium` if missing).

## Clips

| name | welcome slot |
|------|--------------|
| `replaces-5-tools` | one-workspace tab montage |
| `sequence-editor-a` | sequence/plasmid editor, circular map |
| `methods-library` | 91-protocol template library |
| `pi-lab-overview` | PI dashboard (uses `?demoViewAs=mira`) |
| `snap-from-bench` | phone-to-inbox bench photos |
| `nih-zenodo` | grant-ready Zenodo deposit |
| `gibson-cloning` | Gibson / Golden Gate cloning |

`own-your-data` is **not** captured here: that slot keeps a real Finder
recording (the notebook-is-a-folder-on-disk story), which a headless browser
can't show.

The clip clickpaths track the live `/demo` UI. When a surface changes, edit that
clip's function in `capture.mjs` and re-run just that clip.

## Publish

The welcome page's `DemoLoop` `src`/`poster` reference these files by name on the
Vercel Blob bucket (`tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/<name>.mp4`).
Upload the new `mp4` + `poster.jpg` at the **exact** pathname (no random suffix,
overwrite the existing one). Easiest path: Vercel dashboard -> project -> Storage
-> the Blob store -> Upload (drag the files in). CLI alternative needs the
store's read-write token:

```bash
vercel blob put <file> --pathname <file> --rw-token "$BLOB_READ_WRITE_TOKEN" --force
```

No code change is needed for the four reused slots (same filenames); the three
formerly-placeholder slots (`gibson-cloning`, `snap-from-bench`, `nih-zenodo`)
are already wired to real `DemoLoop` players in `WelcomePage.tsx`.
