"use client";

// Unified inbox badge (cross-boundary sharing Phase 2b-iii).
//
// The badge count is the sum of two pending arrival types:
//   - pending PHOTOS: images in users/<user>/inbox/Images (event-driven refresh,
//     unchanged from the original badge).
//   - pending SHARES: received cross-boundary bundles sitting in the relay. There
//     is no push channel, so this polls listInbox on panel open, on window focus,
//     and on a gentle 3-minute interval, but ONLY when the user has a usable
//     sharing identity (useSharingIdentity().isReady). The free-tier relay means
//     we keep the poll deliberately gentle.

import { useCallback, useEffect, useRef, useState } from "react";
import { fileService } from "@/lib/file-system/file-service";
import { imageEvents } from "@/lib/attachments/image-events";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAccountCapabilities } from "@/hooks/useAccountCapabilities";
import { listInbox } from "@/lib/sharing/relay/client";
import InboxPanel from "./InboxPanel";

function inboxImagesDir(username: string): string {
  return `users/${username}/inbox/Images`;
}

const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i;

// Gentle poll cadence for received shares (free-tier relay).
const SHARES_POLL_MS = 3 * 60 * 1000;

export default function InboxBadge() {
  const { currentUser } = useCurrentUser();
  // Inbox access (account + a published email) comes from the unified
  // capability model, so the badge gates the same way every other surface does.
  const { canAccessInbox, email } = useAccountCapabilities();
  const [photosCount, setPhotosCount] = useState(0);
  const [sharesCount, setSharesCount] = useState(0);
  const [open, setOpen] = useState(false);

  // ── Photos: event-driven refresh (unchanged). ──────────────────────────────
  const refreshPhotos = useCallback(async () => {
    if (!currentUser) {
      setPhotosCount(0);
      return;
    }
    const files = await fileService.listFiles(inboxImagesDir(currentUser));
    const images = files.filter((n) => IMAGE_EXTS.test(n));
    setPhotosCount(images.length);
  }, [currentUser]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on deps change
    void refreshPhotos();
  }, [refreshPhotos]);

  useEffect(() => {
    const unsubA = imageEvents.onAttached(() => void refreshPhotos());
    const unsubD = imageEvents.onDeleted(() => void refreshPhotos());
    return () => {
      unsubA();
      unsubD();
    };
  }, [refreshPhotos]);

  // ── Shares: polled refresh (open / focus / interval), gated on identity. ────
  const refreshShares = useCallback(async () => {
    if (!canAccessInbox || !email) {
      setSharesCount(0);
      return;
    }
    try {
      const items = await listInbox({ email });
      setSharesCount(items.length);
    } catch (err) {
      // A relay hiccup must not break the badge; keep the last known count.
      console.warn("[inbox] badge share-count poll failed:", err);
    }
  }, [canAccessInbox, email]);

  // Keep the latest refreshShares in a ref so the focus / interval listeners
  // don't need to re-bind on every identity change.
  const refreshSharesRef = useRef(refreshShares);
  refreshSharesRef.current = refreshShares;

  // Initial + identity-change load, plus the gentle interval and focus refresh.
  useEffect(() => {
    if (!canAccessInbox || !email) {
      setSharesCount(0);
      return;
    }
    void refreshShares();
    const onFocus = () => void refreshSharesRef.current();
    const interval = window.setInterval(
      () => void refreshSharesRef.current(),
      SHARES_POLL_MS,
    );
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [canAccessInbox, email, refreshShares]);

  // Refresh shares on panel open so the count is fresh when the user looks.
  useEffect(() => {
    if (open) void refreshSharesRef.current();
  }, [open]);

  if (!currentUser) return null;

  const count = photosCount + sharesCount;
  const title =
    count > 0 ? `${count} item${count === 1 ? "" : "s"} in your inbox` : "Inbox";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title}
        data-tour-target="inbox-badge"
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-meta font-medium border transition-colors ${
          count > 0
            ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-600 dark:border-amber-600 dark:text-white dark:hover:bg-amber-700"
            : "border-border bg-surface-sunken text-foreground-muted hover:bg-foreground-muted/15"
        }`}
      >
        Inbox
        {count > 0 && (
          <span className="px-1.5 py-0.5 text-meta font-semibold rounded-full bg-amber-200 text-amber-900">
            {count}
          </span>
        )}
      </button>
      {open && (
        <InboxPanel
          onClose={() => setOpen(false)}
          photosCount={photosCount}
          sharesCount={sharesCount}
        />
      )}
    </>
  );
}
