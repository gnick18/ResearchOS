"use client";

import {
  useEffect,
  useRef,
  useState,
  type ImgHTMLAttributes,
  type ReactElement,
} from "react";
import {
  readAnnotations,
  docToSvgElements,
  type AnnotationDoc,
  type SvgElementSpec,
} from "@/lib/attachments/annotations";
import { imageEvents } from "@/lib/attachments/image-events";

/**
 * Shared image renderer for the non-destructive photo-annotation tool.
 *
 * Renders the raw `<img>` exactly as the surfaces do today. When a
 * `{filename}.annot.json` layer exists for the image, it additionally draws a
 * scaled, vector SVG overlay on top: the overlay uses
 * `viewBox="0 0 imageW imageH"` so a single stored annotation renders crisply
 * from a full-width note down to a 64px thumbnail with NO per-surface math.
 *
 * When NO layer exists (the 99% case), it renders the BARE `<img>` with no
 * wrapper and no overlay: zero overhead, zero behavior change. This is why the
 * common notes bundle does not regress for unannotated images, and why this
 * component is SVG-only and never imports konva (the editor owns konva).
 *
 * Subscribes to `imageEvents.onAnnotated` so a save in the editor re-renders
 * the overlay live.
 *
 * See `plans/PHOTO_ANNOTATION_DESIGN.md` Section 4.
 */

type ImgProps = ImgHTMLAttributes<HTMLImageElement>;

interface AnnotatedImageProps extends ImgProps {
  /** Resolved image source: a blob URL, a data: placeholder, or a path. */
  src: string;
  /**
   * Directory the image's `Images/` folder lives under (e.g.
   * `results/task-3`). Required to locate `Images/{filename}.annot.json`.
   * When unknown, omit it and the component renders the bare `<img>` only.
   */
  basePath?: string;
  /**
   * On-disk image filename within `Images/` (e.g. `gel.png`). Required, with
   * `basePath`, to locate the annotation layer. When unknown, omit it.
   */
  filename?: string;
  /**
   * Class applied to the wrapper element when an overlay is present, AND to
   * the bare `<img>` when there is no overlay. The `<img>` keeps this class in
   * both cases so existing sizing utilities (e.g. `w-full h-full object-cover`)
   * behave identically.
   */
  className?: string;
}

export default function AnnotatedImage({
  src,
  basePath,
  filename,
  className,
  ...imgProps
}: AnnotatedImageProps) {
  const [doc, setDoc] = useState<AnnotationDoc | null>(null);
  // Track the loaded key so a basePath/filename change clears a stale overlay
  // before the async read for the new image resolves.
  const loadKey = basePath && filename ? `${basePath}::${filename}` : null;

  useEffect(() => {
    if (!basePath || !filename) {
      setDoc(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      void readAnnotations(basePath, filename).then((next) => {
        if (!cancelled) setDoc(next);
      });
    };
    load();
    const unsub = imageEvents.onAnnotated((detail) => {
      if (detail.basePath === basePath && detail.filename === filename) {
        load();
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [basePath, filename, loadKey]);

  // No layer (or no addressable image): render exactly today's bare <img>.
  if (!doc || doc.shapes.length === 0) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- src is a blob URL resolved from a local FSA file (or a transparent data: placeholder); next/image cannot optimize blob URLs and intrinsic dimensions are unknown for arbitrary user content
      <img src={src} className={className} {...imgProps} />
    );
  }

  return (
    <AnnotatedImageWithOverlay
      src={src}
      doc={doc}
      className={className}
      imgProps={imgProps}
    />
  );
}

/**
 * The overlay path. Wraps the `<img>` in a relatively-positioned container and
 * lays an absolutely-positioned `<svg>` over it. The wrapper inherits the
 * caller's `className` so a thumbnail's `w-16 h-16 object-cover` still sizes
 * and crops the same way; the `<img>` is forced to fill the wrapper so the
 * overlay (which tracks the wrapper box) and the image stay aligned.
 */
function AnnotatedImageWithOverlay({
  src,
  doc,
  className,
  imgProps,
}: {
  src: string;
  doc: AnnotationDoc;
  className?: string;
  imgProps: Omit<ImgProps, "src" | "className">;
}): ReactElement {
  const elements = docToSvgElements(doc);
  // Preserve a caller-supplied width (e.g. markdown resize percent) on the
  // wrapper so the layout matches the bare-img case.
  const { width, style: imgStyle, ...restImgProps } = imgProps;
  const wrapperStyle: React.CSSProperties = {
    position: "relative",
    display: "inline-block",
    lineHeight: 0,
  };

  return (
    <span className={className} style={wrapperStyle} data-annotated="true">
      {/* The caller's className is also applied to the inner img so object-fit
          utilities (e.g. `object-cover` on thumbnails) still crop the raw
          image; the img is forced to fill the wrapper so the overlay (which
          tracks the wrapper box) stays aligned. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- see AnnotatedImage */}
      <img
        src={src}
        width={width}
        className={className}
        style={{ display: "block", width: "100%", height: "100%", ...imgStyle }}
        {...restImgProps}
      />
      <svg
        viewBox={`0 0 ${doc.imageW} ${doc.imageH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
        aria-hidden="true"
      >
        {elements.map(renderSvgElement)}
      </svg>
    </span>
  );
}

/** Render one DOM-free SVG element spec into a real SVG element. */
function renderSvgElement(spec: SvgElementSpec): ReactElement {
  const attrs = toReactAttrs(spec.attrs);
  switch (spec.tag) {
    case "line":
      return <line key={spec.key} {...attrs} />;
    case "rect":
      return <rect key={spec.key} {...attrs} />;
    case "ellipse":
      return <ellipse key={spec.key} {...attrs} />;
    case "polyline":
      return <polyline key={spec.key} {...attrs} />;
    case "polygon":
      return <polygon key={spec.key} {...attrs} />;
    case "text":
      return (
        <text key={spec.key} {...attrs}>
          {spec.text}
        </text>
      );
    default:
      return <g key={spec.key} />;
  }
}

/**
 * Convert kebab-case SVG attribute names (the testable spec form) to the
 * camelCase React expects (`stroke-width` -> `strokeWidth`). React also accepts
 * hyphenated names, but the camelCase form avoids dev warnings.
 */
function toReactAttrs(
  attrs: Record<string, string | number>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const camel = key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camel] = value;
  }
  return out;
}
