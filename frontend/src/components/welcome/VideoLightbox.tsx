"use client";

// Click-to-enlarge lightbox for the welcome-page demo clips. The inline embeds
// stay tastefully small (capped in R2Demo); clicking one opens it here, larger,
// with native controls so you can scrub or unmute. Closes on: a click in the
// empty side space (the backdrop), the Esc key, or the corner X. House style:
// Icon registry only (no hand-inlined icon markup, keeps icon-guard happy).
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icons";

export default function VideoLightbox({
  src,
  poster,
  label,
  onClose,
}: {
  src: string;
  poster: string;
  label: string;
  onClose: () => void;
}) {
  // Esc closes; lock body scroll while the overlay is up. Restored on unmount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    // Backdrop: clicking it (the empty side space) closes.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[#0a1424]/80 p-4 backdrop-blur-sm sm:p-8"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close video"
        className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <Icon name="close" className="h-5 w-5" />
      </button>
      {/* The clip itself: stop propagation so clicking the video never closes. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[1100px]"
      >
        <div className="overflow-hidden rounded-2xl bg-black shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
          <video
            src={src}
            poster={poster}
            autoPlay
            muted
            loop
            playsInline
            controls
            aria-label={label}
            className="block max-h-[85vh] w-full object-contain"
          />
        </div>
        <p className="mt-3 text-center text-sm text-white/75">{label}</p>
      </div>
    </div>,
    document.body,
  );
}
