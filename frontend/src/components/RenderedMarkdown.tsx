"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown/sanitize-schema";
import remarkUnderline from "@/lib/markdown/remark-underline";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";
import AnnotatedImage from "@/components/AnnotatedImage";
import { OcrReveal } from "@/components/OcrImage";
import { filenameFromMarkdownSrc } from "@/lib/attachments/annotations";
import { parseObjectDeepLink, parseObjectEmbed, type EmbedDescriptor } from "@/lib/references";
import { parseExternalEmbed, type ExternalEmbedDescriptor } from "@/lib/embeds/external-embeds";
import ObjectChip from "@/components/ObjectChip";
import ObjectEmbed from "@/components/embeds/ObjectEmbed";
import { Icon } from "@/components/icons/Icon";
import { parsePhoneNoteCallout } from "@/lib/mobile-relay/phone-note-callout";
import { lazy, Suspense } from "react";
import { buildFigureNumberPlan } from "@/lib/embeds/figure-numbering";
// P7-2 transclusion: raw ![[...]] resilience (Part A).
import { notesApi } from "@/lib/local-api";
import {
  TransclusionProvider,
  useTransclusionState,
  MAX_TRANSCLUSION_DEPTH,
} from "@/components/embeds/TransclusionContext";
import { extractNoteSection } from "@/lib/embeds/markdown-section";
import { objectDeepLink } from "@/lib/references";
import type { Note } from "@/lib/types";

const ExternalEmbed = lazy(() => import("@/components/embeds/ExternalEmbed"));

/** Flatten an `a` element's React children to plain text, so a deep-link chip can
 *  label itself with the link text (the object name) even when the markdown
 *  renderer nests it (e.g. emphasis inside the link). Falls back to the href. */
function linkChildrenText(children: React.ReactNode): string {
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) return children.map(linkChildrenText).join("");
  if (typeof children === "object" && children !== null && "props" in children) {
    const props = (children as { props?: { children?: React.ReactNode } }).props;
    return linkChildrenText(props?.children);
  }
  return "";
}

/** A minimal hast node shape, enough to inspect a paragraph's children. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { href?: unknown };
  children?: HastNode[];
}

/** Collect the visible text of a hast subtree (a link's text is its caption). */
function hastText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

/** When a paragraph is exactly one object-embed link (ignoring surrounding
 *  whitespace), return its descriptor + caption so it renders as a block embed.
 *  Otherwise null, and the paragraph renders normally. This is the alone-in-a-
 *  paragraph rule, an embed link mid-sentence stays an inline chip. */
function loneEmbedFromParagraph(
  node: HastNode | undefined,
): { descriptor: EmbedDescriptor; caption: string } | { external: ExternalEmbedDescriptor; caption: string } | null {
  if (!node || !Array.isArray(node.children)) return null;
  const meaningful = node.children.filter(
    (c) => !(c.type === "text" && /^\s*$/.test(c.value ?? "")),
  );
  if (meaningful.length !== 1) return null;
  const el = meaningful[0];
  if (el.type !== "element" || el.tagName !== "a") return null;
  const href = el.properties?.href;
  const hrefStr = typeof href === "string" ? href : null;

  // Internal object embed (existing path, byte-unchanged when no external match).
  const descriptor = parseObjectEmbed(hrefStr);
  if (descriptor?.isEmbed) return { descriptor, caption: hastText(el).trim() };

  // External embed (DOI, PMID, PubChem, bare URL with #ros= fragment).
  // Only render as a block embed when the `#ros=` fragment is present (same
  // alone-in-a-paragraph rule applies: a bare external link stays a link).
  const external = parseExternalEmbed(hrefStr);
  if (external && hrefStr?.includes("#ros=")) {
    return { external, caption: hastText(el).trim() };
  }

  return null;
}

// P7-2 transclusion Part A: detect a raw `![[Note Title#Heading]]` in a
// paragraph whose sole meaningful child is a text node carrying that syntax.
// Returns parsed title + heading when matched; null otherwise (so mid-sentence
// occurrences are treated as literal text and are never silently eaten).
const RAW_TRANSCLUSION_LONE_RE = /^!\[\[([^\]]+)\]\]$/;

function loneRawTransclusion(
  node: HastNode | undefined,
): { title: string; heading: string } | null {
  if (!node || !Array.isArray(node.children)) return null;
  const meaningful = node.children.filter(
    (c) => !(c.type === "text" && /^\s*$/.test(c.value ?? "")),
  );
  if (meaningful.length !== 1) return null;
  const child = meaningful[0];
  if (child.type !== "text") return null;
  const m = (child.value ?? "").trim().match(RAW_TRANSCLUSION_LONE_RE);
  if (!m) return null;
  const inner = m[1];
  const hashIdx = inner.indexOf("#");
  const title = (hashIdx === -1 ? inner : inner.slice(0, hashIdx)).trim();
  const heading = hashIdx === -1 ? "" : inner.slice(hashIdx + 1).trim();
  return title ? { title, heading } : null;
}

// Load states for the by-title async resolve.
type ByTitleState =
  | { k: "loading" }
  | { k: "missing" }
  | { k: "ok"; note: Note };

/** Renders a raw ![[Note Title#Heading]] transclusion by title in a read-only
 *  surface. Resolves the title to a note id asynchronously, then delegates to
 *  the same rendering logic TransclusionEmbed uses (load note, extract section,
 *  render via RenderedMarkdown). Respects MAX_TRANSCLUSION_DEPTH and the
 *  visited cycle guard from TransclusionContext.
 *
 *  Voice: no em-dashes, no emojis, no mid-sentence colons. */
function RawTransclusionEmbed({
  title,
  heading,
  basePath,
}: {
  title: string;
  heading: string;
  basePath?: string;
}) {
  const { depth, visited } = useTransclusionState();
  const overDepth = depth >= MAX_TRANSCLUSION_DEPTH;

  // Step 1: resolve title -> id from the notes list.
  const [noteId, setNoteId] = useState<string | null | "loading">("loading");
  useEffect(() => {
    if (overDepth) return;
    let cancelled = false;
    setNoteId("loading");
    notesApi
      .list()
      .then((all) => {
        if (cancelled) return;
        const key = title.trim().toLowerCase();
        const found = all.find((n) => (n.title ?? "").trim().toLowerCase() === key);
        setNoteId(found ? String(found.id) : null);
      })
      .catch(() => {
        if (!cancelled) setNoteId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [title, overDepth]);

  // Step 2: load the note by id once resolved.
  const [noteState, setNoteState] = useState<ByTitleState>({ k: "loading" });
  useEffect(() => {
    if (overDepth || noteId === "loading") return;
    if (noteId === null) {
      setNoteState({ k: "missing" });
      return;
    }
    const cycle = visited.includes(noteId);
    if (cycle) {
      setNoteState({ k: "missing" });
      return;
    }
    let cancelled = false;
    setNoteState({ k: "loading" });
    notesApi
      .get(Number(noteId))
      .then((n) => {
        if (cancelled) return;
        setNoteState(n ? { k: "ok", note: n } : { k: "missing" });
      })
      .catch(() => {
        if (!cancelled) setNoteState({ k: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, overDepth, visited]);

  if (overDepth) {
    return (
      <figure className="my-3 mx-0 overflow-hidden rounded-xl border border-border bg-surface-raised">
        <div className="px-3 py-3">
          <p className="text-meta text-foreground-muted">Transclusion depth limit reached.</p>
        </div>
      </figure>
    );
  }

  if (noteState.k === "loading") {
    return (
      <figure className="my-3 mx-0 overflow-hidden rounded-xl border border-border bg-surface-raised">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="text-meta text-foreground-muted">Loading transclusion...</span>
        </div>
      </figure>
    );
  }

  if (noteState.k === "missing") {
    // Show the raw text so the user can fix it, rather than silently eating it.
    return <span className="text-foreground-muted">{`![[${title}${heading ? `#${heading}` : ""}]]`}</span>;
  }

  const note = noteState.note;
  const id = String(note.id);
  const cycle = visited.includes(id);
  if (cycle) {
    return (
      <figure className="my-3 mx-0 overflow-hidden rounded-xl border border-border bg-surface-raised">
        <div className="px-3 py-3">
          <p className="text-meta text-foreground-muted">Transclusion cycle detected.</p>
        </div>
      </figure>
    );
  }

  const href = objectDeepLink("note", id);
  const section = extractNoteSection(note, heading);

  if (section == null) {
    return (
      <figure className="my-3 mx-0 overflow-hidden rounded-xl border border-border bg-surface-raised">
        <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
          <span className="truncate text-meta text-foreground-muted">
            Transcluded from{" "}
            <span className="font-semibold text-foreground">{note.title}</span>
          </span>
          <span className="flex-1" />
          <a
            href={href}
            aria-label={`Open source note ${note.title}`}
            className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
          >
            Open
          </a>
        </div>
        <div className="px-3 py-3">
          <p className="text-meta text-foreground-muted">
            Section{" "}
            <span className="font-semibold text-foreground">{heading || "(whole note)"}</span>{" "}
            not found in this note.
          </p>
        </div>
      </figure>
    );
  }

  return (
    <figure className="my-3 mx-0 overflow-hidden rounded-xl border border-border bg-surface-raised">
      <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
        <span className="truncate text-meta text-foreground-muted">
          Transcluded from{" "}
          <span className="font-semibold text-foreground">{note.title}</span>
          {heading ? (
            <>
              {" › "}
              <span className="font-semibold text-foreground">{heading}</span>
            </>
          ) : null}
        </span>
        <span className="flex-1" />
        <a
          href={href}
          aria-label={`Open source note ${note.title}`}
          className="shrink-0 rounded-md px-2 py-0.5 text-meta font-semibold text-foreground-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-action"
        >
          Open
        </a>
      </div>
      <div className="px-3 py-2">
        <TransclusionProvider value={{ depth: depth + 1, visited: [...visited, id] }}>
          <RenderedMarkdown content={section} basePath={basePath} />
        </TransclusionProvider>
      </div>
    </figure>
  );
}

/** Payload passed to `onImageClick` when a rendered image is clicked. */
export interface ImageClickPayload {
  /** Raw markdown src (before blob-URL resolution). */
  originalSrc: string;
  /** Alt text from the markdown. */
  alt: string;
  /** Screen X coordinate of the click event. */
  x: number;
  /** Screen Y coordinate of the click event. */
  y: number;
  /** Current width percentage from a #w= fragment, or null if none. */
  currentWidth: number | null;
}

interface RenderedMarkdownProps {
  content: string;
  /**
   * Path of the directory the markdown file lives in (e.g. `methods/foo` or
   * `results/task-3`). Relative image refs like `Images/x.png` are resolved
   * against it.
   */
  basePath?: string;
  /** Owner username, used when migrating legacy `../../Images/...` refs. */
  ownerUsername?: string;
  className?: string;
  /** Allow callers that opt into highlighting. Off by default. */
  enableSyntaxHighlight?: boolean;
  /** Path of the per-document embed-pins sidecar (markdown embed hybrid P7-1a).
   *  When supplied, a pinned block embed renders its FROZEN snapshot read-only
   *  (no Pin control, this is the Preview / read-only side). Absent everywhere a
   *  pin must not resolve (chips, card previews, method picker, ...), so those
   *  callers are byte-for-byte unchanged. */
  embedPinSidecar?: string;
  /**
   * When provided, rendered images become clickable and this callback fires
   * with the image details. LiveMarkdownEditor uses this to open the resize
   * popover from Preview mode. Absent on all other read-only callers, so
   * those are byte-for-byte unchanged.
   */
  onImageClick?: (payload: ImageClickPayload) => void;
  /**
   * When provided, `Files/` anchor clicks are intercepted and forwarded here
   * instead of following the raw href. LiveMarkdownEditor wires this to its
   * existing file-viewer / download handler so Preview mode handles file links
   * the same way the inline editor does.
   */
  onFileLinkClick?: (href: string) => void;
}

/**
 * Read-only markdown view that turns relative image references into blob URLs
 * so they render under the File System Access API. Use this anywhere we'd
 * otherwise drop in a plain `<ReactMarkdown>` whose images won't resolve.
 *
 * For editable contexts, use `LiveMarkdownEditor` instead — it has its own
 * resolver effects.
 */
export default function RenderedMarkdown({
  content,
  basePath,
  ownerUsername,
  className,
  enableSyntaxHighlight = false,
  embedPinSidecar,
  onImageClick,
  onFileLinkClick,
}: RenderedMarkdownProps) {
  const [resolvedBlobUrls, setResolvedBlobUrls] = useState<Map<string, string>>(new Map());

  // Opt-in figure / table numbering (the `<!-- ros:number-figures -->` directive).
  // The plan is built from the content in document order; the counter is reset at
  // the start of every render and incremented once per block embed in the `p`
  // override, so it tracks document order (react-markdown renders in order).
  const figurePlan = useMemo(() => buildFigureNumberPlan(content), [content]);
  const figureIndexRef = useRef(0);
  figureIndexRef.current = 0;

  useEffect(() => {
    if (!content) return;
    const imageRegex = /!\[([^\]]*)\]\(([^)\s]+)/g;
    const htmlRegex = /<img\s+[^>]*src=["']([^"']+)["']/gi;
    const srcs = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = imageRegex.exec(content)) !== null) srcs.add(m[2]);
    while ((m = htmlRegex.exec(content)) !== null) srcs.add(m[1]);

    let cancelled = false;
    (async () => {
      const newPairs: Array<[string, string]> = [];
      for (const rawKey of srcs) {
        // Strip the display-only #w= fragment before resolution so the
        // file-system path does not contain the fragment and the map key
        // matches what the img override will look up.
        const src = rawKey.replace(/#w=\d+(?:#.*)?$/, "");
        if (!blobUrlResolver.isLocalPath(src)) continue;
        const resolvedPath = blobUrlResolver.resolvePath(src, basePath, ownerUsername);
        const cached = blobUrlResolver.getCachedUrl(resolvedPath);
        if (cached) {
          newPairs.push([src, cached]);
          continue;
        }
        const url = await blobUrlResolver.getBlobUrl(resolvedPath);
        if (url) newPairs.push([src, url]);
      }
      if (cancelled || newPairs.length === 0) return;
      setResolvedBlobUrls((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const [src, url] of newPairs) {
          if (next.get(src) !== url) {
            next.set(src, url);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [content, basePath, ownerUsername]);

  const rehypePlugins: import("unified").PluggableList = enableSyntaxHighlight
    ? [rehypeRaw, [rehypeSanitize, markdownSanitizeSchema], rehypeHighlight]
    : [rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]];

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkUnderline]}
        rehypePlugins={rehypePlugins}
        components={{
          // A paragraph that is a lone object-embed link renders as a block
          // embed. Every other paragraph renders normally, so this is additive.
          p: ({ node, children, ...props }) => {
            const lone = loneEmbedFromParagraph(node as unknown as HastNode);
            if (lone) {
              // External embed (DOI, PMID, PubChem, bare URL).
              if ("external" in lone) {
                return (
                  <Suspense fallback={null}>
                    <ExternalEmbed
                      descriptor={lone.external}
                      caption={lone.caption}
                      sidecarPath={embedPinSidecar}
                    />
                  </Suspense>
                );
              }
              const figureLabel = figurePlan.enabled
                ? figurePlan.labelAt(figureIndexRef.current++)
                : undefined;
              return (
                <ObjectEmbed
                  descriptor={lone.descriptor}
                  caption={lone.caption}
                  basePath={basePath}
                  figureLabel={figureLabel}
                  pinContext={
                    embedPinSidecar ? { sidecarPath: embedPinSidecar } : undefined
                  }
                />
              );
            }
            // P7-2 transclusion Part A: detect a lone raw `![[Note#Heading]]`
            // text node (e.g. already-saved content that was never normalized,
            // or a read-only preview surface). Render it as a live transclusion
            // via by-title resolve. Only a LONE ![[]] in the paragraph triggers
            // this; a ![[]] mid-sentence falls through to the normal <p>.
            const rawTransclusion = loneRawTransclusion(node as unknown as HastNode);
            if (rawTransclusion) {
              return (
                <RawTransclusionEmbed
                  title={rawTransclusion.title}
                  heading={rawTransclusion.heading}
                  basePath={basePath}
                />
              );
            }
            return <p {...props}>{children}</p>;
          },
          // A blockquote tagged `> [!phone-note] ...` renders as a phone-note
          // card (phone glyph + attribution header + body). Every other
          // blockquote renders normally, so this is additive and a callout from
          // any other tool (no marker) degrades to a plain blockquote.
          blockquote: ({ node, children, ...props }) => {
            const text = hastText(node as unknown as HastNode);
            const callout = parsePhoneNoteCallout(text);
            if (!callout) {
              return <blockquote {...props}>{children}</blockquote>;
            }
            return (
              <div
                data-phone-note="true"
                className="my-3 overflow-hidden rounded-xl border border-border bg-surface-raised"
              >
                <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
                  <Icon name="phone" className="h-4 w-4 shrink-0 text-foreground-muted" title="Phone note" />
                  <span className="truncate text-meta font-semibold text-foreground-muted">
                    {callout.header || "Phone note"}
                  </span>
                </div>
                <div className="whitespace-pre-wrap px-3 py-2 text-body text-foreground">
                  {callout.body}
                </div>
              </div>
            );
          },
          a: ({ href, children, ...props }) => {
            const hrefStr = href ? String(href) : "";
            const ref = parseObjectDeepLink(hrefStr || null);
            if (ref) {
              // An in-app object reference. Upgrade it to a live chip. The link
              // text is the object name; fall back to the href when empty.
              const label = linkChildrenText(children) || hrefStr;
              return (
                <ObjectChip type={ref.type} href={hrefStr} label={label} />
              );
            }
            // Files/ links: intercept when the caller supplied a handler so
            // preview mode can open the file viewer / trigger a download.
            if (onFileLinkClick) {
              let decoded = hrefStr;
              try { decoded = decodeURI(hrefStr); } catch { /* fall through */ }
              const clean = decoded.startsWith("./") ? decoded.slice(2) : decoded;
              if (clean.startsWith("Files/")) {
                return (
                  <a
                    href={hrefStr}
                    onClick={(e) => { e.preventDefault(); onFileLinkClick(hrefStr); }}
                    className="text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 underline cursor-pointer"
                    {...props}
                  >
                    {children}
                  </a>
                );
              }
            }
            // Any other link renders as a normal markdown link.
            return (
              <a href={href} {...props}>
                {children}
              </a>
            );
          },
          img: ({ src, alt, width, ...props }) => {
            const rawSrc = String(src || "");
            // Strip the #w=<number> fragment BEFORE resolution so the path
            // matches what the blob-URL cache keyed on. The fragment is a
            // display-only hint; it must never reach the file-system resolver.
            const wMatch = rawSrc.match(/#w=(\d+)(?:#.*)?$/);
            const embedWidth = wMatch ? parseInt(wMatch[1], 10) : undefined;
            const originalSrc = embedWidth !== undefined
              ? rawSrc.slice(0, rawSrc.indexOf("#w="))
              : rawSrc;
            const resolvedSrc = resolvedBlobUrls.get(originalSrc) ?? originalSrc;
            const annotFilename = filenameFromMarkdownSrc(originalSrc);
            const hasCaption = typeof alt === "string" && alt.length > 0;
            // When a click handler is wired (e.g. Preview mode in the editor),
            // parse the current width percentage from the width prop so the
            // resize popover initialises at the right value.
            const currentWidthPct = onImageClick
              ? (() => {
                  const w = typeof width === "string" ? parseInt(width, 10) : (typeof width === "number" ? width : NaN);
                  return isNaN(w) ? null : w;
                })()
              : null;
            const imageElement = (
              <>
                <AnnotatedImage
                  src={resolvedSrc}
                  alt={alt || ""}
                  basePath={basePath}
                  filename={annotFilename ?? undefined}
                  className={`max-w-full rounded-lg${onImageClick ? " cursor-pointer" : ""}`}
                  style={embedWidth !== undefined ? { maxWidth: "100%" } : undefined}
                  draggable={false}
                  onDragOver={onImageClick ? (e) => e.preventDefault() : undefined}
                  onDrop={onImageClick ? (e) => e.preventDefault() : undefined}
                  onClick={onImageClick ? (e) => {
                    e.stopPropagation();
                    onImageClick({
                      originalSrc,
                      alt: String(alt || ""),
                      x: e.clientX + 6,
                      y: e.clientY + 6,
                      currentWidth: currentWidthPct,
                    });
                  } : undefined}
                  title={onImageClick ? "Click to resize" : undefined}
                  {...props}
                />
                {/* Scanned handwriting: hidden editable OCR text reveal under
                    the enhanced image. Null for normal images. */}
                <OcrReveal basePath={basePath} filename={annotFilename ?? undefined} />
              </>
            );
            if (!hasCaption && embedWidth === undefined) {
              // Zero-change path: no alt, no #w -> render exactly as before.
              return imageElement;
            }
            // Use a <span> with display:block rather than <figure> to avoid
            // invalid block-in-inline nesting inside ReactMarkdown's <p> wrapper.
            return (
              <span
                style={{
                  display: "block",
                  margin: 0,
                  ...(embedWidth !== undefined ? { maxWidth: embedWidth } : {}),
                }}
                data-image-embed="true"
              >
                {imageElement}
                {hasCaption && (
                  <span
                    data-image-caption="true"
                    style={{
                      display: "block",
                      fontSize: "0.85em",
                      color: "var(--color-text-secondary, #6b7280)",
                      marginTop: "0.25rem",
                    }}
                  >
                    {alt}
                  </span>
                )}
              </span>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
