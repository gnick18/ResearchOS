"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import { githubApi } from "@/lib/local-api";
import { blobUrlResolver } from "@/lib/utils/blob-url-resolver";

interface MarkdownPreviewProps {
  githubPath: string | null;
  onClose: () => void;
}

/**
 * Quick View modal: renders a .md file from the local data folder.
 */
export default function MarkdownPreview({
  githubPath,
  onClose,
}: MarkdownPreviewProps) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvedBlobUrls, setResolvedBlobUrls] = useState<Map<string, string>>(new Map());

  const basePath = githubPath
    ? githubPath.split("/").slice(0, -1).join("/")
    : undefined;

  useEffect(() => {
    if (!githubPath) return;
    setLoading(true);
    setError(null);

    githubApi
      .readFile(githubPath)
      .then((file) => {
        setContent(file.content);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load file");
        setLoading(false);
      });
  }, [githubPath]);

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
        const resolvedPath = blobUrlResolver.resolvePath(src, basePath);
        const url = await blobUrlResolver.getBlobUrl(resolvedPath);
        if (url) newPairs.push([src, url]);
      }
      if (cancelled || newPairs.length === 0) return;
      setResolvedBlobUrls((prev) => {
        const next = new Map(prev);
        for (const [src, url] of newPairs) next.set(src, url);
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [content, basePath]);

  if (!githubPath) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {githubPath.split("/").pop()}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">{githubPath}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <p className="text-sm text-gray-400 animate-pulse">Loading...</p>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
          {!loading && !error && (
            <div className="prose prose-sm prose-gray max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, rehypeHighlight]}
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
          )}
        </div>
      </div>
    </div>
  );
}
