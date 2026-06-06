"use client";

// In-app "Profile settings" popup.
//
// Mounted once in AppShell. When "Profile settings" is chosen from the avatar
// menu, this renders the profile-settings body (appearance + researcher
// profile) as a living popup OVER the current page, with that page left hazy and
// blurred behind a translucent scrim, instead of navigating to /profile. The
// popup animates in from the point the open was triggered (an Apple-style
// zoom-from-icon) and animates back to that point on close. Closes on the X, on
// the scrim (click outside), and on Escape.
//
// Mirrors ResearcherProfileModal (the public-profile popup); the only
// differences are the store it reads and the body it renders. The /profile
// route remains as the direct-link fallback.
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Inline SVG.

import { useCallback, useEffect, useRef, useState } from "react";

import Tooltip from "@/components/Tooltip";
import ProfileSettingsContent from "@/components/profile/ProfileSettingsContent";
import {
  type OpenOrigin,
  useProfileSettingsModal,
} from "@/lib/profile/profile-settings-modal-store";

// Duration of the open / close animation. Matched by the inline transitions.
const ANIM_MS = 340;
// Apple-ish ease: quick out, soft settle.
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function collapsedTransform(origin: OpenOrigin | null): string {
  if (typeof window === "undefined" || !origin) {
    return "translate(0px, 24px) scale(0.85)";
  }
  // Vector from screen center to the open point, so the card collapses toward
  // (and grows out of) the icon that was clicked.
  const dx = Math.round(origin.x - window.innerWidth / 2);
  const dy = Math.round(origin.y - window.innerHeight / 2);
  return `translate(${dx}px, ${dy}px) scale(0.15)`;
}

export default function ProfileSettingsModal() {
  const closeStore = useProfileSettingsModal((s) => s.close);

  // Local lifecycle so the exit animation can play before unmount.
  const [render, setRender] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeOrigin, setActiveOrigin] = useState<OpenOrigin | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Open when the store flips to isOpen. We subscribe to the store directly
  // (rather than mirroring it in an effect body) so the state updates run in the
  // subscription callback, the supported place to react to an external store.
  useEffect(() => {
    const unsub = useProfileSettingsModal.subscribe((state, prev) => {
      if (state.isOpen && !prev.isOpen) {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        setActiveOrigin(state.origin);
        setRender(true);
        setOpen(false);
        // Two frames: mount collapsed, then transition to open.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setOpen(true)),
        );
      }
    });
    return unsub;
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setRender(false);
      closeStore();
    }, ANIM_MS);
  }, [closeStore]);

  // Escape to close.
  useEffect(() => {
    if (!render) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [render, handleClose]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  if (!render) return null;

  const cardStyle: React.CSSProperties = {
    transform: open
      ? "translate(0px, 0px) scale(1)"
      : collapsedTransform(activeOrigin),
    opacity: open ? 1 : 0,
    transition: `transform ${ANIM_MS}ms ${EASE}, opacity ${Math.round(
      ANIM_MS * 0.7,
    )}ms ease`,
    transformOrigin: "center center",
    willChange: "transform, opacity",
  };

  return (
    <div className="fixed inset-0 z-[400]">
      {/* Hazy, blurred scrim over the live page behind. Click closes. */}
      <button
        type="button"
        aria-label="Close profile settings"
        onClick={handleClose}
        className="absolute inset-0 h-full w-full cursor-default bg-slate-900/25 backdrop-blur-md"
        style={{
          opacity: open ? 1 : 0,
          transition: `opacity ${ANIM_MS}ms ease`,
        }}
      />

      {/* Close affordance, top-right. */}
      <div
        className="absolute right-4 top-4 z-10"
        style={{
          opacity: open ? 1 : 0,
          transition: `opacity ${ANIM_MS}ms ease`,
        }}
      >
        <Tooltip label="Close" placement="bottom">
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close profile settings"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-raised/80 text-foreground-muted shadow ring-1 ring-black/5 backdrop-blur transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </Tooltip>
      </div>

      {/* Centered, scrollable content column. Pointer-events pass through to the
          scrim except on the card itself, so clicking outside closes. */}
      <div className="pointer-events-none absolute inset-0 overflow-y-auto">
        <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
          <div
            className="pointer-events-auto w-full max-w-2xl rounded-2xl bg-surface-raised p-6 shadow-2xl ring-1 ring-black/5 sm:p-8"
            style={cardStyle}
            role="dialog"
            aria-label="Profile settings"
          >
            <ProfileSettingsContent />
          </div>
        </div>
      </div>
    </div>
  );
}
