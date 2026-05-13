"use client";

import Image from "next/image";
import { useState } from "react";

interface Props {
  /** Path under /public, e.g. "/wiki/screenshots/home-projects.png". */
  src: string;
  /** Required alt text for screen readers. */
  alt: string;
  /** Caption rendered under the image. Markdown-free plain text. */
  caption?: string;
  /** Intrinsic dimensions of the source image. */
  width?: number;
  height?: number;
  /** Hide click-to-zoom (default on). */
  noZoom?: boolean;
}

/** Wraps a screenshot with a border, optional caption, and click-to-zoom
 *  lightbox. Falls back to a "screenshot coming soon" placeholder when the
 *  src 404s — useful while the capture script is still being run. */
export default function Screenshot({
  src,
  alt,
  caption,
  width = 1440,
  height = 900,
  noZoom,
}: Props) {
  const [errored, setErrored] = useState(false);
  const [zoom, setZoom] = useState(false);

  const inner = errored ? (
    <div
      className="w-full aspect-[1440/900] flex items-center justify-center bg-gray-50 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg"
      role="img"
      aria-label={`${alt} (screenshot pending capture)`}
    >
      <div className="text-center">
        <div className="text-base font-medium text-gray-500">Screenshot pending</div>
        <div className="mt-1 text-xs text-gray-400">{alt}</div>
        <div className="mt-2 text-[11px] text-gray-400 font-mono">{src}</div>
      </div>
    </div>
  ) : (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      onError={() => setErrored(true)}
      className="w-full h-auto rounded-lg border border-gray-200 shadow-sm"
      unoptimized
    />
  );

  return (
    <figure className="my-5">
      {noZoom || errored ? (
        inner
      ) : (
        <button
          type="button"
          onClick={() => setZoom(true)}
          className="block w-full cursor-zoom-in"
          aria-label={`Zoom screenshot: ${alt}`}
        >
          {inner}
        </button>
      )}
      {caption ? (
        <figcaption className="mt-2 text-xs text-gray-500 text-center">
          {caption}
        </figcaption>
      ) : null}

      {zoom && !errored ? (
        <div
          className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setZoom(false)}
          role="dialog"
          aria-label={`Zoomed: ${alt}`}
        >
          <Image
            src={src}
            alt={alt}
            width={width}
            height={height}
            className="max-w-full max-h-full w-auto h-auto rounded-lg shadow-2xl"
            unoptimized
          />
        </div>
      ) : null}
    </figure>
  );
}
