"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown/sanitize-schema";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";

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
 * For editable contexts, use `LiveMarkdownEditor` / `HybridMarkdownEditor`
 * instead — they have their own resolver effects.
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
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={{
          img: ({ src, alt, ...props }) => {
            const originalSrc = String(src || "");
            const resolvedSrc = resolvedBlobUrls.get(originalSrc) ?? originalSrc;
            return (
              <img
                src={resolvedSrc}
                alt={alt || ""}
                className="max-w-full rounded-lg"
                {...props}
              />
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
