"use client";

// PdfFigurePicker: the figure picker for BeakerBot's reproduce-from-PDF flow.
//
// Output 4 (match a paper figure's visual style onto the user's own tree) is
// vision driven, so the figure has to reach the model as an image. PDF extraction
// is text-only, so this picker lets the user SEE the paper's pages, pick the one
// with the figure, and drag-crop the exact figure region. The cropped image is
// rendered at high resolution and handed to onPick, which stages it into the
// existing pending-image vision path. A clean cropped figure gives a faithful
// style match with no wrong-figure guessing (the "efficiency is the name of
// ResearchOS" call, Grant 2026-06-14).
//
// House style: no em-dashes, no emojis, no mid-sentence colons; registry Icon
// only (no inline svg); Tooltip on icon-only buttons.

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Tooltip from "@/components/Tooltip";
import {
  renderPdfThumbnails,
  renderPdfRegion,
  FULL_PAGE_RECT,
  type PdfPageThumb,
  type NormRect,
} from "@/lib/ai/pdf-render";

type Phase = "loading" | "grid" | "pageLoading" | "crop" | "rendering" | "error";

type PdfFigurePickerProps = {
  /** The attached PDF bytes (or File) to render pages from. */
  source: File | ArrayBuffer;
  /** The paper's file name, shown in the header. */
  pdfName: string;
  /** Called with the cropped figure as a PNG data URL once the user confirms. */
  onPick: (dataUrl: string) => void;
  /** Close the picker without picking. */
  onClose: () => void;
};

export function PdfFigurePicker({
  source,
  pdfName,
  onPick,
  onClose,
}: PdfFigurePickerProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [thumbs, setThumbs] = useState<PdfPageThumb[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [renderTotal, setRenderTotal] = useState(0);
  const [thumbsDone, setThumbsDone] = useState(false);
  const [capped, setCapped] = useState(false);
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [pagePreview, setPagePreview] = useState<string | null>(null);
  const [rect, setRect] = useState<NormRect | null>(null);

  // Drag state for the crop selection, in normalized [0,1] page coords.
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const imageWrapRef = useRef<HTMLDivElement | null>(null);

  // Render the page thumbnails on mount, PROGRESSIVELY: show the grid as soon as
  // the doc opens (onStart) and append each thumbnail the moment it renders
  // (onThumb), so a long PDF fills in instead of waiting behind one blank screen.
  useEffect(() => {
    let cancelled = false;
    setThumbs([]);
    setThumbsDone(false);
    renderPdfThumbnails(source, {
      onStart: (info) => {
        if (cancelled) return;
        setPageCount(info.pageCount);
        setRenderTotal(info.renderCount);
        setCapped(info.capped);
        setPhase("grid");
      },
      onThumb: (thumb) => {
        if (cancelled) return;
        setThumbs((prev) => [...prev, thumb]);
      },
    })
      .then(() => {
        if (!cancelled) setThumbsDone(true);
      })
      .catch((err) => {
        console.error("[BeakerBot] PDF thumbnail render failed:", err);
        if (cancelled) return;
        setThumbsDone(true);
        // Only show the error card if nothing rendered; if some pages already
        // appeared, keep them usable.
        setPhase((p) => (p === "loading" ? "error" : p));
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  // Escape closes the picker.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const openPage = useCallback(
    async (pageNumber: number) => {
      setSelectedPage(pageNumber);
      setRect(null);
      setPagePreview(null);
      setPhase("pageLoading");
      try {
        // A crisp full-page preview to crop against (the final region is
        // re-rendered at higher resolution on confirm).
        const dataUrl = await renderPdfRegion(source, {
          pageNumber,
          rect: FULL_PAGE_RECT,
          targetWidth: 1200,
        });
        setPagePreview(dataUrl);
        setPhase("crop");
      } catch (err) {
        console.error("[BeakerBot] PDF page preview failed:", err);
        setPhase("error");
      }
    },
    [source],
  );

  const backToGrid = useCallback(() => {
    setSelectedPage(null);
    setPagePreview(null);
    setRect(null);
    setPhase("grid");
  }, []);

  // Map a pointer event to normalized page coords inside the preview image.
  const pointToNorm = useCallback((clientX: number, clientY: number) => {
    const el = imageWrapRef.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return null;
    const nx = (clientX - box.left) / box.width;
    const ny = (clientY - box.top) / box.height;
    return {
      x: Math.max(0, Math.min(1, nx)),
      y: Math.max(0, Math.min(1, ny)),
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (phase !== "crop") return;
      const p = pointToNorm(e.clientX, e.clientY);
      if (!p) return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragStart.current = p;
      setRect({ x: p.x, y: p.y, w: 0, h: 0 });
    },
    [phase, pointToNorm],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragStart.current) return;
      const p = pointToNorm(e.clientX, e.clientY);
      if (!p) return;
      const s = dragStart.current;
      setRect({ x: s.x, y: s.y, w: p.x - s.x, h: p.y - s.y });
    },
    [pointToNorm],
  );

  const onPointerUp = useCallback(() => {
    dragStart.current = null;
  }, []);

  const confirmRegion = useCallback(
    async (useWholePage: boolean) => {
      if (selectedPage == null) return;
      setPhase("rendering");
      try {
        const dataUrl = await renderPdfRegion(source, {
          pageNumber: selectedPage,
          rect: useWholePage ? FULL_PAGE_RECT : rect ?? FULL_PAGE_RECT,
        });
        onPick(dataUrl);
        onClose();
      } catch (err) {
        console.error("[BeakerBot] PDF region render failed:", err);
        setPhase("error");
      }
    },
    [selectedPage, rect, source, onPick, onClose],
  );

  // The current selection box, in CSS percentages, for the overlay rectangle.
  const selectionStyle = (() => {
    if (!rect) return null;
    const x = Math.min(rect.x, rect.x + rect.w);
    const y = Math.min(rect.y, rect.y + rect.h);
    const w = Math.abs(rect.w);
    const h = Math.abs(rect.h);
    return {
      left: `${x * 100}%`,
      top: `${y * 100}%`,
      width: `${w * 100}%`,
      height: `${h * 100}%`,
    };
  })();

  const hasSelection =
    rect != null && Math.abs(rect.w) > 0.02 && Math.abs(rect.h) > 0.02;

  return (
    <div
      data-testid="beakerbot-pdf-figure-picker"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface-overlay ros-popup-card-shadow"
        style={{ fontFamily: "var(--font-geist-sans), system-ui, -apple-system, sans-serif" }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          {phase === "crop" || phase === "pageLoading" || phase === "rendering" ? (
            <Tooltip label="Back to pages" placement="bottom">
              <button
                type="button"
                aria-label="Back to pages"
                onClick={backToGrid}
                className="flex-none rounded-md p-1 text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
              >
                <Icon name="chevronLeft" className="h-4 w-4" title="Back" />
              </button>
            </Tooltip>
          ) : (
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded bg-brand/15 text-brand">
              <Icon name="figure" className="h-4 w-4" title="Figure" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-foreground leading-tight">
              {phase === "grid" || phase === "loading"
                ? "Pick the figure to match"
                : `Crop the figure on page ${selectedPage ?? ""}`}
            </p>
            <p className="truncate text-[11px] text-foreground-muted leading-tight">
              {phase === "grid" || phase === "loading"
                ? pdfName
                : "Drag a box around the figure, or use the whole page"}
            </p>
          </div>
          <Tooltip label="Close" placement="bottom">
            <button
              type="button"
              aria-label="Close figure picker"
              onClick={onClose}
              className="flex-none rounded-md p-1 text-foreground-muted hover:bg-surface-sunken hover:text-foreground"
            >
              <Icon name="close" className="h-4 w-4" title="Close" />
            </button>
          </Tooltip>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {phase === "loading" || phase === "pageLoading" ? (
            <div className="flex h-40 items-center justify-center text-[13px] text-foreground-muted">
              {phase === "loading" ? "Rendering pages locally…" : "Opening page…"}
            </div>
          ) : null}

          {phase === "error" ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
              <p className="text-[13px] text-foreground">Could not render this PDF.</p>
              <p className="text-[11px] text-foreground-muted">
                You can still crop a figure from any other tool and attach it as an image.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="ros-btn-neutral mt-1 px-3 py-1.5 text-[12px] font-medium text-foreground"
              >
                Close
              </button>
            </div>
          ) : null}

          {phase === "grid" ? (
            <>
              {!thumbsDone ? (
                <p
                  data-testid="beakerbot-pdf-progress"
                  className="mb-3 flex items-center gap-1.5 text-[11px] text-foreground-muted"
                >
                  <Icon name="refresh" className="h-3 w-3 animate-spin" title="" />
                  Rendering pages… {thumbs.length} of {renderTotal} ready
                </p>
              ) : capped ? (
                <p className="mb-3 text-[11px] text-foreground-muted">
                  Showing the first {thumbs.length} of {pageCount} pages.
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {thumbs.map((t) => (
                  <button
                    key={t.pageNumber}
                    type="button"
                    data-testid={`beakerbot-pdf-thumb-${t.pageNumber}`}
                    onClick={() => void openPage(t.pageNumber)}
                    className="group flex flex-col items-stretch gap-1 rounded-lg border border-border bg-surface-raised p-1.5 text-left transition-colors hover:border-brand hover:bg-brand/5"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={t.dataUrl}
                      alt={`Page ${t.pageNumber}`}
                      className="w-full rounded border border-border bg-white"
                    />
                    <span className="text-center text-[11px] text-foreground-muted group-hover:text-foreground">
                      Page {t.pageNumber}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {phase === "crop" && pagePreview ? (
            <div className="flex flex-col items-center gap-3">
              <div
                ref={imageWrapRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className="relative max-h-[58vh] cursor-crosshair touch-none select-none overflow-hidden rounded border border-border bg-white"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pagePreview}
                  alt={`Page ${selectedPage}`}
                  draggable={false}
                  className="max-h-[58vh] w-auto select-none"
                />
                {selectionStyle ? (
                  <div
                    data-testid="beakerbot-pdf-crop-box"
                    className="pointer-events-none absolute border-2 border-brand bg-brand/10"
                    style={selectionStyle}
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          {phase === "rendering" ? (
            <div className="flex h-40 items-center justify-center text-[13px] text-foreground-muted">
              Cropping the figure…
            </div>
          ) : null}
        </div>

        {/* Footer actions (crop phase only) */}
        {phase === "crop" ? (
          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={() => void confirmRegion(true)}
              className="ros-btn-neutral px-3 py-1.5 text-[12px] font-medium text-foreground"
            >
              Use whole page
            </button>
            <button
              type="button"
              data-testid="beakerbot-pdf-use-region"
              disabled={!hasSelection}
              onClick={() => void confirmRegion(false)}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="check" className="h-3.5 w-3.5" title="Use region" />
              Use this figure
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
