"use client";

// In-app researcher profile popup.
//
// Mounted once in AppShell. When a profile is opened from within the app (the
// avatar menu, a search result), this renders it as a living popup OVER the
// current page, with that page left hazy and blurred behind a translucent
// scrim, instead of navigating away. The popup animates in from the point the
// open was triggered (an Apple-style zoom-from-icon), and animates back to that
// point on close.
//
// The shareable /researchers/[fingerprint] route remains the standalone
// fallback for direct links (where there is no app behind to blur).
//
// House style: no em-dashes, no emojis, no mid-sentence colons. Inline SVG.

import { useCallback, useEffect, useRef, useState } from "react";

import Link from "next/link";
import Tooltip from "@/components/Tooltip";
import AppFooter from "@/components/AppFooter";
import ProfileCard from "./ProfileCard";
import {
  type OpenOrigin,
  useProfileModal,
} from "@/lib/sharing/profile-modal-store";
import {
  type PublishedProfile,
  fetchProfileByFingerprint,
} from "@/lib/sharing/profile";

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

export default function ResearcherProfileModal() {
  const closeStore = useProfileModal((s) => s.close);

  // Local lifecycle so the exit animation can play before unmount.
  const [render, setRender] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeFp, setActiveFp] = useState<string | null>(null);
  const [activeOrigin, setActiveOrigin] = useState<OpenOrigin | null>(null);
  const [profile, setProfile] = useState<PublishedProfile | null | undefined>(
    undefined,
  );
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Open when the store gets a new fingerprint. We subscribe to the store
  // directly (rather than mirroring it in an effect body) so the state updates
  // run in the subscription callback, the supported place to react to an
  // external store.
  useEffect(() => {
    const unsub = useProfileModal.subscribe((state, prev) => {
      if (state.fingerprint && state.fingerprint !== prev.fingerprint) {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        setActiveFp(state.fingerprint);
        setActiveOrigin(state.origin);
        setProfile(undefined);
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

  // Fetch the profile for the active fingerprint.
  useEffect(() => {
    if (!activeFp) return;
    let cancelled = false;
    fetchProfileByFingerprint(activeFp).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [activeFp]);

  const handleClose = useCallback(() => {
    setOpen(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setRender(false);
      setActiveFp(null);
      setProfile(undefined);
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
    transform: open ? "translate(0px, 0px) scale(1)" : collapsedTransform(activeOrigin),
    opacity: open ? 1 : 0,
    transition: `transform ${ANIM_MS}ms ${EASE}, opacity ${Math.round(ANIM_MS * 0.7)}ms ease`,
    transformOrigin: "center center",
    willChange: "transform, opacity",
  };

  return (
    <div className="fixed inset-0 z-[400]">
      {/* Hazy, blurred scrim over the live page behind. */}
      <button
        type="button"
        aria-label="Close profile"
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
            aria-label="Close profile"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-gray-600 shadow ring-1 ring-black/5 backdrop-blur transition-colors hover:bg-white hover:text-gray-900"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </Tooltip>
      </div>

      {/* Centered, scrollable content column. Pointer-events pass through to the
          scrim except on the card itself, so clicking outside closes. */}
      <div className="pointer-events-none absolute inset-0 overflow-y-auto">
        <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
          <div className="pointer-events-auto w-full max-w-lg" style={cardStyle}>
            {profile === undefined ? (
              <div className="flex items-center justify-center rounded-2xl bg-white p-12 shadow-2xl ring-1 ring-black/5">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-gray-200 border-t-sky-500" />
              </div>
            ) : profile === null ? (
              <div className="rounded-2xl bg-white p-8 text-center shadow-2xl ring-1 ring-black/5">
                <h2 className="text-heading font-semibold text-gray-900">
                  No profile yet
                </h2>
                <p className="mt-2 text-body text-gray-600 leading-relaxed">
                  This researcher has not published a profile, or the link is
                  out of date.
                </p>
                <Link
                  href="/settings#researcher-profile"
                  onClick={handleClose}
                  className="mt-4 inline-block text-body font-medium text-sky-700 underline-offset-2 hover:underline"
                >
                  Set up your own profile
                </Link>
              </div>
            ) : (
              <ProfileCard profile={profile} />
            )}

            {/* UW-Madison RISE footer, kept at the bottom. */}
            {profile && (
              <div className="mt-6 overflow-hidden rounded-2xl bg-white/95 shadow-xl ring-1 ring-black/5">
                <AppFooter />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
