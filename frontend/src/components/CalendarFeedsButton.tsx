"use client";

import { useState } from "react";
import { useCalendarFeeds } from "@/lib/calendar/use-external-events";
import CalendarFeedsModal from "./CalendarFeedsModal";

export default function CalendarFeedsButton() {
  const [open, setOpen] = useState(false);
  const { data: feeds = [] } = useCalendarFeeds();
  const enabledCount = feeds.filter((f) => f.enabled).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Link external calendars (Google / Outlook / iCloud)"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 rounded-lg"
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
          <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold bg-blue-100 text-blue-700 rounded-full">
            {enabledCount}
          </span>
        )}
      </button>
      {open && <CalendarFeedsModal onClose={() => setOpen(false)} />}
    </>
  );
}
