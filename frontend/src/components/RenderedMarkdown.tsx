"use client";

import { useEffect, useState } from "react";
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
import { parseObjectDeepLink } from "@/lib/references";
import ObjectChip from "@/components/ObjectChip";

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
}: RenderedMarkdownProps) {
  const [resolvedBlobUrls, setResolvedBlobUrls] = useState<Map<string, string>>(new Map());

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
      for (const src of srcs) {
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
          a: ({ href, children, ...props }) => {
            const ref = parseObjectDeepLink(href ? String(href) : null);
            if (ref) {
              // An in-app object reference. Upgrade it to a live chip. The link
              // text is the object name; fall back to the href when empty.
              const label = linkChildrenText(children) || String(href ?? "");
              return (
                <ObjectChip type={ref.type} href={String(href)} label={label} />
              );
            }
            // Any non-object link renders exactly as a normal markdown link.
            return (
              <a href={href} {...props}>
                {children}
              </a>
            );
          },
          img: ({ src, alt, ...props }) => {
            const originalSrc = String(src || "");
            const resolvedSrc = resolvedBlobUrls.get(originalSrc) ?? originalSrc;
            const annotFilename = filenameFromMarkdownSrc(originalSrc);
            return (
              <>
                <AnnotatedImage
                  src={resolvedSrc}
                  alt={alt || ""}
                  basePath={basePath}
                  filename={annotFilename ?? undefined}
                  className="max-w-full rounded-lg"
                  {...props}
                />
                {/* Scanned handwriting: hidden editable OCR text reveal under
                    the enhanced image. Null for normal images. */}
                <OcrReveal basePath={basePath} filename={annotFilename ?? undefined} />
              </>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
