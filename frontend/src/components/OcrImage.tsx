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
 * Shared image renderer for the handwriting note capture (OCR) feature.
 *
 * Renders the enhanced (rectified, cleaned) image exactly as surfaces do
 * today. When a `{filename}.ocr.json` sidecar exists and contains non-empty
 * text, a collapsed "Show extracted text" disclosure sits below the image.
 * Expanding it reveals the full extracted text in an editable field bound to
 * the sidecar. On any edit, `edited: true` is written back so a future
 * re-OCR run never clobbers a human correction.
 *
 * Spec: docs/proposals/HANDWRITING_DISPLAY_SPEC.md
 *
 * States:
 *   1. No sidecar / empty text  -- renders bare <img>, no reveal affordance.
 *   2. Sidecar present, collapsed (default) -- image + "Show extracted text".
 *   3. Sidecar present, expanded -- image + editable text panel + copy button.
 *
 * The on-image bbox highlight overlay (lines[].bbox) is deferred to v2 per
 * the spec decision (text-only first). The thumbnail badge is also deferred.
 * This component is standalone; wiring it into existing image renderers
 * (AnnotatedImage, ImageStrip, RenderedMarkdown, etc.) is the orchestrator's
 * step.
 *
 * House style: no em-dashes, no emojis, no mid-sentence colons.
 */

type ImgProps = ImgHTMLAttributes<HTMLImageElement>;

interface OcrImageProps extends ImgProps {
  /** Resolved image source: a blob URL, a data: placeholder, or a path. */
  src: string;
  /**
   * Directory the image's `Images/` folder lives under (e.g.
   * `results/task-3`). Required to locate `Images/{filename}.ocr.json`.
   * When unknown, omit and the component renders the bare `<img>` only.
   */
  basePath?: string;
  /**
   * On-disk image filename within `Images/` (e.g. `bench-notes.jpg`).
   * Required, with `basePath`, to locate the OCR sidecar. When unknown, omit.
   */
  filename?: string;
  /**
   * Class applied to the outer wrapper when an OCR reveal is present, and to
   * the bare `<img>` when there is none. Keeps existing sizing utilities
   * (e.g. `w-full`, `object-cover`) behaving identically in both cases.
   */
  className?: string;
}

export default function OcrImage({
  src,
  basePath,
  filename,
  className,
  ...imgProps
}: OcrImageProps) {
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

  // State 1: no sidecar, or text is empty. Render bare <img> with zero overhead.
  if (!ocr || !ocr.text.trim()) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- src is a blob URL resolved from a local FSA file; next/image cannot optimize blob URLs and intrinsic dimensions are unknown for arbitrary user content
      <img src={src} className={className} {...imgProps} />
    );
  }

  return (
    <OcrImageWithReveal
      src={src}
      ocr={ocr}
      basePath={basePath!}
      filename={filename!}
      className={className}
      imgProps={imgProps}
      onOcrChange={setOcr}
    />
  );
}

// ---- Private sub-component: image + collapsible text reveal ------------------

interface OcrImageWithRevealProps {
  src: string;
  ocr: OcrResult;
  basePath: string;
  filename: string;
  className?: string;
  imgProps: Omit<ImgProps, "src" | "className">;
  onOcrChange: (updated: OcrResult) => void;
}

function OcrImageWithReveal({
  src,
  ocr,
  basePath,
  filename,
  className,
  imgProps,
  onOcrChange,
}: OcrImageWithRevealProps) {
  const [expanded, setExpanded] = useState(false);
  // Local edit buffer so the textarea feels responsive; we debounce-persist below.
  const [editedText, setEditedText] = useState(ocr.text);
  // Sync the edit buffer when the sidecar changes externally (e.g. the parent
  // re-reads after a poll update). If the user has already made a local edit,
  // we leave the buffer alone.
  const hasLocalEdit = useRef(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [copied, setCopied] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hasLocalEdit.current) {
      setEditedText(ocr.text);
    }
  }, [ocr.text]);

  const persistEdit = useCallback(
    async (text: string) => {
      const updated: OcrResult = { ...ocr, text, edited: true };
      setSaveState("saving");
      try {
        await writeOcr(basePath, filename, updated);
        onOcrChange(updated);
        setSaveState("saved");
        // Reset the "saved" indicator after 2 seconds.
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
      // Debounce: persist 800ms after the user stops typing.
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void persistEdit(newText);
      }, 800);
    },
    [persistEdit],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(editedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard not available in some contexts; silently ignore.
    }
  }, [editedText]);

  const toggleExpanded = useCallback(() => setExpanded((v) => !v), []);

  return (
    <span className="block">
      {/* The image itself: styled by the caller's className as usual. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- see OcrImage */}
      <img src={src} className={className} {...imgProps} />

      {/* Disclosure control: sits below the image, suppressed at thumbnail. */}
      <span className="flex flex-col gap-0 mt-1 text-sm">
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide extracted text" : "Show extracted text"}
          className="flex items-center gap-1 text-xs text-text-meta hover:text-foreground transition-colors w-fit select-none"
        >
          <Icon
            name={expanded ? "chevronDown" : "chevronRight"}
            className="h-3 w-3 flex-shrink-0"
          />
          <span>{expanded ? "Hide extracted text" : "Show extracted text"}</span>
          {ocr.edited && (
            <span className="ml-1 text-text-meta opacity-60">(edited)</span>
          )}
        </button>

        {expanded && (
          <span className="flex flex-col gap-1 mt-1">
            {/* Editable text field bound to the sidecar. */}
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

            {/* Action row: save state + copy button. */}
            <span className="flex items-center justify-between gap-2">
              <span className="text-xs text-text-meta">
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
                className="flex items-center gap-1 text-xs text-text-meta hover:text-foreground transition-colors"
                aria-label="Copy extracted text"
              >
                <Icon
                  name={copied ? "check" : "copy"}
                  className="h-3.5 w-3.5"
                />
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
            </span>
          </span>
        )}
      </span>
    </span>
  );
}
