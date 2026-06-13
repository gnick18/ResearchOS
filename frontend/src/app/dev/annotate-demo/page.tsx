"use client";

// Dev-only test harness for the photo-annotation editor (ImageAnnotatorModal).
//
// Mounts the REAL editor over a fake, self-contained data-URI image so the
// full-viewport revamp (floating tools, light/dark, draw/select/undo) can be
// eyeballed without connecting a data folder or touching real research images.
//
// Safe-save tip: open this page with `?wikiCapture=1` so fileService is the
// in-memory mock and the editor's Save never writes to your real folder. The
// image loads from `resolvedSrc` either way, so it does not need a folder to
// render. Toggle the app's header light/dark control to test both themes.

import dynamic from "next/dynamic";
import { useState } from "react";

const ImageAnnotatorModal = dynamic(
  () => import("@/components/ImageAnnotatorModal"),
  { ssr: false },
);

// A believable but obviously-fake plate image, inlined so the harness needs no
// network and no data folder. Watermarked FAKE DEMO so it can never be mistaken
// for real data in a screenshot.
const FAKE_PLATE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='860'>
  <rect width='1200' height='860' fill='#f1eee6'/>
  <text x='44' y='60' font-family='sans-serif' font-size='28' font-weight='700' fill='#1f2937'>Patch plate (8 candidate transformants)</text>
  <defs><radialGradient id='p' cx='42%' cy='38%' r='70%'>
    <stop offset='0%' stop-color='#fff7d6'/><stop offset='55%' stop-color='#fcd34d'/><stop offset='100%' stop-color='#eab308'/>
  </radialGradient></defs>
  <circle cx='600' cy='460' r='340' fill='url(#p)' stroke='#111827' stroke-width='4'/>
  <g fill='#a16207' opacity='0.6'>
    <circle cx='470' cy='350' r='10'/><circle cx='680' cy='320' r='9'/><circle cx='760' cy='500' r='11'/>
    <circle cx='510' cy='600' r='8'/><circle cx='610' cy='660' r='10'/><circle cx='410' cy='500' r='9'/>
    <circle cx='700' cy='620' r='8'/><circle cx='560' cy='400' r='7'/>
  </g>
  <text x='600' y='470' font-family='sans-serif' font-size='40' font-weight='700' fill='#94a3b8' opacity='0.55' text-anchor='middle' transform='rotate(-20 600 470)'>FAKE - demo image</text>
</svg>`)}`;

export default function AnnotateDemoPage() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-heading font-semibold text-foreground">
        Annotate editor demo
      </h1>
      <p className="mt-2 text-body text-foreground-muted">
        Opens the real photo-annotation editor over a fake plate image so you can
        test the full-viewport revamp. Toggle the header light/dark control to
        check both themes. For a no-side-effects test (Save will not write to your
        folder), open this page with{" "}
        <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-meta">
          ?wikiCapture=1
        </code>
        .
      </p>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-brand-action text-white transition-colors hover:bg-brand-action/90 mt-6 rounded-lg px-4 py-2 text-body font-medium"
      >
        Open annotate editor
      </button>

      <ul className="mt-6 space-y-1 text-meta text-foreground-muted">
        <li>Tools, colors, stroke, and text float top-left.</li>
        <li>Title plus Cancel and Save float top-right.</li>
        <li>The image fills the viewport; the chrome floats over it.</li>
        <li>Cancel or Escape closes; Save persists to the (mock) sidecar.</li>
      </ul>

      {open && (
        <ImageAnnotatorModal
          basePath="annotate-demo"
          filename="demo-plate.png"
          resolvedSrc={FAKE_PLATE}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
