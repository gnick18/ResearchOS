"use client";

import { useCallback, useEffect, useState } from "react";
import { fileService } from "@/lib/file-system/file-service";
import { imageEvents } from "@/lib/attachments/image-events";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import InboxPanel from "./InboxPanel";

function inboxImagesDir(username: string): string {
  return `users/${username}/inbox/Images`;
}

const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i;

export default function InboxBadge() {
  const { currentUser } = useCurrentUser();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!currentUser) {
      setCount(0);
      return;
    }
    const files = await fileService.listFiles(inboxImagesDir(currentUser));
    const images = files.filter((n) => IMAGE_EXTS.test(n));
    setCount(images.length);
  }, [currentUser]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on deps change
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubA = imageEvents.onAttached(() => void refresh());
    const unsubD = imageEvents.onDeleted(() => void refresh());
    return () => {
      unsubA();
      unsubD();
    };
  }, [refresh]);

  if (!currentUser) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={count > 0 ? `${count} photo${count === 1 ? "" : "s"} in Telegram image inbox` : "Telegram image inbox"}
        data-tour-target="inbox-badge"
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-meta font-medium border transition-colors ${
          count > 0
            ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
            : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100"
        }`}
      >
        Inbox
        {count > 0 && (
          <span className="px-1.5 py-0.5 text-meta font-semibold rounded-full bg-amber-200 text-amber-900">
            {count}
          </span>
        )}
      </button>
      {open && <InboxPanel onClose={() => setOpen(false)} />}
    </>
  );
}
