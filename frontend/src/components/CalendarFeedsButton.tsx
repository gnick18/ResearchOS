"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCalendarFeeds, useExternalEvents } from "@/lib/calendar/use-external-events";
import CalendarFeedsModal from "./CalendarFeedsModal";

export default function CalendarFeedsButton() {
  const [open, setOpen] = useState(false);
  const { data: feeds = [] } = useCalendarFeeds();
  const { staleFeedIds } = useExternalEvents();
  const enabledCount = feeds.filter((f) => f.enabled).length;
  const hasStaleFeed = staleFeedIds.size > 0;

  // Deep-link: `/calendar?addFeed=1` auto-opens the modal once on mount
  // and strips the param so a reload doesn't re-trigger.
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams?.get("addFeed") !== "1") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deep-link handler: imperatively opens modal once when URL param is present, then strips the param. Decoupling to URL-derived open state would require URL navigation on every open/close, which changes user-visible behavior.
    setOpen(true);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("addFeed");
    const query = next.toString();
    router.replace(query ? `/calendar?${query}` : "/calendar");
  }, [searchParams, router]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={
          hasStaleFeed
            ? "A linked calendar stopped syncing — open to check the link"
            : "Link external calendars (Google / Outlook / iCloud)"
        }
        data-tour-target="calendar-linked-feeds-button"
        className="relative inline-flex items-center gap-1.5 px-3 py-1.5 text-body border border-border text-foreground bg-surface-raised hover:bg-surface-sunken rounded-lg"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        Linked Calendars
        {enabledCount > 0 && (
          <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-meta font-semibold bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 rounded-full">
            {enabledCount}
          </span>
        )}
        {hasStaleFeed && (
          <span
            aria-label="A linked calendar stopped syncing"
            className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-surface-raised"
          />
        )}
      </button>
      <CalendarFeedsModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
