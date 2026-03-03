"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import { githubApi } from "@/lib/api";

interface MarkdownPreviewProps {
  githubPath: string | null;
  onClose: () => void;
}

/**
 * Quick View modal: renders a .md file from GitHub in a minimalist internal preview.
 */
export default function MarkdownPreview({
  githubPath,
  onClose,
}: MarkdownPreviewProps) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      .catch((err) => {
        setError("Could not load file from GitHub");
        setLoading(false);
      });
  }, [githubPath]);

  if (!githubPath) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <p className="text-sm text-gray-400 animate-pulse">Loading...</p>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
          {!loading && !error && (
            <div className="prose prose-sm prose-gray max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeHighlight]}>
                {content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
