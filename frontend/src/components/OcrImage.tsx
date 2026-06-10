"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ImgHTMLAttributes,
} from "react";
import { readOcr, writeOcr, type OcrResult } from "@/lib/attachments/ocr";
import { Icon } from "@/components/icons";

/**
 * Handwriting note capture (OCR) display.
 *
 * The enhanced (rectified, white-background) scan is shown exactly as any image
 * is. Below it, when a `{filename}.ocr.json` sidecar with non-empty text exists,
 * a collapsed "Show extracted text" disclosure reveals the OCR text in an
 * editable field bound to the sidecar. Editing writes `edited: true` back so a
 * future re-OCR never clobbers a human correction. The text layer powers search
 * and agents whether or not the disclosure is ever opened.
 *
 * Two exports:
 *   - OcrReveal: the disclosure ALONE (no image). The note markdown renderer
 *     pairs this under AnnotatedImage, so a scanned page keeps its annotation
 *     overlay AND gains the text reveal. Renders nothing when there is no OCR.
 *   - OcrImage: a standalone image + reveal, for surfaces that render a bare img.
 *
 * The on-image bbox highlight overlay (lines[].bbox) is deferred to v2 (text
 * first). Spec: docs/proposals/HANDWRITING_DISPLAY_SPEC.md
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

type ImgProps = ImgHTMLAttributes<HTMLImageElement>;

// ---- OcrReveal: the disclosure alone (reads the sidecar, no image) -----------

/**
 * The editable "Show extracted text" disclosure for an image, with no image of
 * its own. Reads `Images/{filename}.ocr.json` under `basePath`; renders nothing
 * when the sidecar is absent or its text is empty. Compose it directly under an
 * image renderer (e.g. AnnotatedImage) in a full-size context. Suppress it at
 * thumbnail sizes (the caller decides where to mount it).
 */
export function OcrReveal({
  basePath,
  filename,
}: {
  basePath?: string;
  filename?: string;
}) {
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  // Stable key so a basePath/filename change clears stale OCR before the async
  // read for the new image resolves.
  const loadKey = basePath && filename ? `${basePath}::${filename}` : null;

  useEffect(() => {
    if (!basePath || !filename) {
      setOcr(null);
      return;
    }
    let cancelled = false;
    void readOcr(basePath, filename).then((result) => {
      if (!cancelled) setOcr(result);
    });
    return () => {
      cancelled = true;
    };
  }, [basePath, filename, loadKey]);

  if (!ocr || !ocr.text.trim() || !basePath || !filename) return null;
  return (
    <OcrRevealDisclosure
      ocr={ocr}
      basePath={basePath}
      filename={filename}
      onOcrChange={setOcr}
    />
  );
}

interface OcrRevealDisclosureProps {
  ocr: OcrResult;
  basePath: string;
  filename: string;
  onOcrChange: (updated: OcrResult) => void;
}

function OcrRevealDisclosure({
  ocr,
  basePath,
  filename,
  onOcrChange,
}: OcrRevealDisclosureProps) {
  const [expanded, setExpanded] = useState(false);
  // Local edit buffer so the textarea feels responsive; debounce-persist below.
  const [editedText, setEditedText] = useState(ocr.text);
  const hasLocalEdit = useRef(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [copied, setCopied] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync the buffer when the sidecar changes externally, unless the user has a
  // pending local edit.
  useEffect(() => {
    if (!hasLocalEdit.current) setEditedText(ocr.text);
  }, [ocr.text]);

  const persistEdit = useCallback(
    async (text: string) => {
      const updated: OcrResult = { ...ocr, text, edited: true };
      setSaveState("saving");
      try {
        await writeOcr(basePath, filename, updated);
        onOcrChange(updated);
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 2000);
      } catch {
        setSaveState("idle");
      }
    },
    [ocr, basePath, filename, onOcrChange],
  );

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      hasLocalEdit.current = true;
      const newText = e.target.value;
      setEditedText(newText);
      setSaveState("idle");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => void persistEdit(newText), 800);
    },
    [persistEdit],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(editedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable in some contexts; ignore.
    }
  }, [editedText]);

  return (
    <span className="flex flex-col gap-0 mt-1 text-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? "Hide extracted text" : "Show extracted text"}
        className="flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground transition-colors w-fit select-none"
      >
        <Icon
          name={expanded ? "chevronDown" : "chevronRight"}
          className="h-3 w-3 flex-shrink-0"
        />
        <span>{expanded ? "Hide extracted text" : "Show extracted text"}</span>
        {ocr.edited && (
          <span className="ml-1 text-foreground-muted opacity-60">(edited)</span>
        )}
      </button>

      {expanded && (
        <span className="flex flex-col gap-1 mt-1">
          <label className="sr-only" htmlFor={`ocr-text-${filename}`}>
            Extracted text from {filename}
          </label>
          <textarea
            id={`ocr-text-${filename}`}
            value={editedText}
            onChange={handleTextChange}
            rows={6}
            className="w-full resize-y rounded border border-border bg-surface text-foreground text-sm p-2 font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-border max-h-64 overflow-y-auto"
            aria-label="Extracted handwriting text (editable)"
          />
          <span className="flex items-center justify-between gap-2">
            <span className="text-xs text-foreground-muted">
              {saveState === "saving" && "Saving..."}
              {saveState === "saved" && (
                <span className="flex items-center gap-1">
                  <Icon name="check" className="h-3 w-3" />
                  Saved
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground transition-colors"
              aria-label="Copy extracted text"
            >
              <Icon name={copied ? "check" : "copy"} className="h-3.5 w-3.5" />
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </span>
        </span>
      )}
    </span>
  );
}

// ---- OcrImage: standalone image + reveal (for bare-img surfaces) -------------

interface OcrImageProps extends ImgProps {
  src: string;
  basePath?: string;
  filename?: string;
  className?: string;
}

export default function OcrImage({
  src,
  basePath,
  filename,
  className,
  ...imgProps
}: OcrImageProps) {
  return (
    <span className="block">
      {/* eslint-disable-next-line @next/next/no-img-element -- src is a blob URL resolved from a local FSA file; next/image cannot optimize blob URLs and intrinsic dimensions are unknown for arbitrary user content */}
      <img src={src} className={className} {...imgProps} />
      <OcrReveal basePath={basePath} filename={filename} />
    </span>
  );
}
