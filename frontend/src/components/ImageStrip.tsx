"use client";

import { useEffect, useMemo, useState } from "react";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";

interface ImageStripProps {
  /** Raw markdown source — we scan it for image references. */
  content: string;
  /** Directory the markdown file lives in (e.g. `results/task-3`). Used for
   *  resolving relative `Images/x.png` references. */
  basePath?: string;
  /** Fired when the user clicks a thumbnail. `index` is the position of the
   *  image among all image refs in the document (0-based, in source order),
   *  which the caller can use to scroll the editor preview to that image. */
  onImageClick?: (index: number, originalSrc: string) => void;
  className?: string;
}

interface ImageRef {
  /** Original src token as it appears in markdown (e.g. `Images/foo.png`). */
  src: string;
  /** Display name (last path segment). */
  filename: string;
}

const MD_REGEX = /!\[([^\]]*)\]\(([^)\s]+)/g;
const HTML_REGEX = /<img\s+[^>]*src=["']([^"']+)["']/gi;

function extractImageRefs(markdown: string): ImageRef[] {
  const refs: ImageRef[] = [];
  let m: RegExpExecArray | null;

  const mdRe = new RegExp(MD_REGEX.source, "g");
  while ((m = mdRe.exec(markdown)) !== null) {
    refs.push({ src: m[2], filename: m[2].split("/").pop() ?? m[2] });
  }

  const htmlRe = new RegExp(HTML_REGEX.source, "gi");
  while ((m = htmlRe.exec(markdown)) !== null) {
    refs.push({ src: m[1], filename: m[1].split("/").pop() ?? m[1] });
  }

  // Order matters: callers index into the rendered DOM by position, and
  // ReactMarkdown renders images in source order. Sort by their position in
  // the source string to keep markdown and HTML refs interleaved correctly.
  return refs.sort((a, b) => markdown.indexOf(a.src) - markdown.indexOf(b.src));
}

/**
 * Horizontal scrollable strip of every image referenced by a markdown file.
 * Drop in next to a markdown editor; clicking a thumbnail fires `onImageClick`
 * with the image's index, which the caller uses to scroll the preview.
 */
export default function ImageStrip({
  content,
  basePath,
  onImageClick,
  className,
}: ImageStripProps) {
  const images = useMemo(() => extractImageRefs(content), [content]);
  const [blobUrls, setBlobUrls] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (images.length === 0) return;
    let cancelled = false;
    (async () => {
      const next = new Map<string, string>();
      for (const ref of images) {
        if (!blobUrlResolver.isLocalPath(ref.src)) {
          next.set(ref.src, ref.src);
          continue;
        }
        const resolvedPath = blobUrlResolver.resolvePath(ref.src, basePath);
        const cached = blobUrlResolver.getCachedUrl(resolvedPath);
        if (cached) {
          next.set(ref.src, cached);
          continue;
        }
        const url = await blobUrlResolver.getBlobUrl(resolvedPath);
        if (url) next.set(ref.src, url);
      }
      if (!cancelled) setBlobUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [images, basePath]);

  if (images.length === 0) {
    return (
      <div className={className}>
        <p className="text-xs text-gray-400 italic px-3 py-2">
          No images in this document yet. Drag one in or use the Add Image button.
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2 px-3 py-2 overflow-x-auto bg-gray-50 border-t border-gray-200">
        <span className="text-xs text-gray-500 font-medium flex-shrink-0 mr-1">
          {images.length} image{images.length === 1 ? "" : "s"}
        </span>
        {images.map((ref, idx) => {
          const url = blobUrls.get(ref.src);
          return (
            <button
              key={`${idx}-${ref.src}`}
              type="button"
              onClick={() => onImageClick?.(idx, ref.src)}
              className="group relative flex-shrink-0 w-16 h-16 rounded-md border border-gray-200 bg-white overflow-hidden hover:border-blue-400 hover:ring-2 hover:ring-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              title={ref.filename}
            >
              {url ? (
                <img
                  src={url}
                  alt={ref.filename}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300 text-2xl">
                  🖼
                </div>
              )}
              <span className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-[9px] text-white bg-black/60 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                {ref.filename}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
