"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "@/lib/markdown/sanitize-schema";
import remarkUnderline from "@/lib/markdown/remark-underline";
import { filesApi } from "@/lib/local-api";
import Tooltip from "./Tooltip";
import LivingPopup from "@/components/ui/LivingPopup";

/**
 * Inline viewer for a single attachment, shared by the unified attachments
 * strip (ImageStrip / FileStrip click-to-view). The render logic is lifted
 * verbatim from the retired PdfAttachmentsPanel `activeFile` branch: markdown
 * files render via ReactMarkdown, everything else (PDF / image) goes through a
 * blob-URL iframe. Non-renderable types are downloaded by the caller before
 * this modal is ever opened, so we only handle the renderable set here.
 */

const isMarkdownFile = (filename: string): boolean => {
  const ext = filename.toLowerCase().split(".").pop() || "";
  return ext === "md";
};

const getMimeType = (filename: string): string => {
  const ext = filename.toLowerCase().split(".").pop() || "";
  const mimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
  };
  return mimeTypes[ext] || "application/octet-stream";
};

export default function AttachmentViewerModal({
  path,
  name,
  onClose,
}: {
  /** Full FS path of the file to render. */
  path: string;
  /** Display name (used for the title bar + extension sniffing). */
  name: string;
  onClose: () => void;
}) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [markdownContent, setMarkdownContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const isMarkdown = isMarkdownFile(name);

  const load = useCallback(async () => {
    setFileUrl(null);
    setMarkdownContent(null);
    setFailed(false);
    try {
      const fileData = await filesApi.readFile(path);
      if (isMarkdownFile(name)) {
        const binaryString = atob(fileData.content);
        const textContent = decodeURIComponent(escape(binaryString));
        setMarkdownContent(textContent);
      } else {
        const binaryString = atob(fileData.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: getMimeType(name) });
        setFileUrl(URL.createObjectURL(blob));
      }
    } catch {
      setFailed(true);
    }
  }, [path, name]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount/deps
    void load();
  }, [load]);

  // Revoke the blob URL when it changes or on unmount.
  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  // Close on Escape.
  return (
    <LivingPopup open onClose={onClose} label={name || "Attachment"} selfSize showClose={false}>
      <div
        className="pointer-events-auto flex flex-col w-full max-w-4xl h-[80vh] bg-surface-raised rounded-2xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-border">
          <span className="text-body font-medium text-foreground truncate flex-1" title={name}>
            {name}
          </span>
          <Tooltip label="Close" placement="bottom">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close viewer"
              className="p-1.5 text-foreground-muted hover:text-foreground hover:bg-surface-sunken rounded-md transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Tooltip>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          {failed ? (
            <div className="p-6 text-body text-foreground-muted">Failed to load this file.</div>
          ) : isMarkdown ? (
            markdownContent !== null ? (
              <div className="h-full overflow-y-auto p-6 prose prose-sm prose-gray max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkUnderline]} rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}>
                  {markdownContent}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="p-6 space-y-2 animate-pulse" aria-busy="true">
                <div className="h-3 w-1/3 bg-surface-sunken rounded" />
                <div className="h-3 w-full bg-surface-sunken rounded" />
                <div className="h-3 w-5/6 bg-surface-sunken rounded" />
                <div className="h-3 w-4/5 bg-surface-sunken rounded" />
              </div>
            )
          ) : fileUrl ? (
            <iframe src={fileUrl} className="w-full h-full" title={name} />
          ) : (
            <div className="p-6 space-y-2 animate-pulse" aria-busy="true">
              <div className="h-3 w-1/3 bg-surface-sunken rounded" />
              <div className="h-3 w-full bg-surface-sunken rounded" />
              <div className="h-3 w-5/6 bg-surface-sunken rounded" />
              <div className="h-3 w-4/5 bg-surface-sunken rounded" />
            </div>
          )}
        </div>
      </div>
    </LivingPopup>
  );
}
