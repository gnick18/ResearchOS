"use client";

import { useState } from "react";
import { sharingApi } from "@/lib/local-api";
import Tooltip from "./Tooltip";

/**
 * Dev-only "send a test notification" button. Wired to the same
 * `createEventReminder` path the real ReminderRunner uses so it exercises
 * the in-app inbox + OS-popup pipeline end-to-end.
 *
 * Conditional on `process.env.NODE_ENV === "development"`. Next.js replaces
 * that with the literal `"development"` string at build time, so in production
 * builds (e.g. on Vercel) the early-return turns the body into dead code that
 * the bundler can drop — nothing user-visible ships outside local dev.
 */
const IS_DEV = process.env.NODE_ENV === "development";

function toLocalDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function DevTestNotificationButton() {
  const [sending, setSending] = useState(false);
  if (!IS_DEV) return null;

  const handleSend = async () => {
    setSending(true);
    try {
      const now = new Date();
      const start = new Date(now.getTime() + 15 * 60 * 1000); // imaginary event 15m out
      await sharingApi.createEventReminder({
        event_id: `dev-test-${Date.now()}`,
        event_kind: "native",
        event_title: "Test reminder",
        event_start_iso: start.toISOString(),
        event_date: toLocalDateString(start),
        event_location: "Dev sandbox",
        offset_minutes: 15,
      });
      window.dispatchEvent(new CustomEvent("ros-notifications-changed"));
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("Test reminder", {
            body: "Dev-only test · OS popup pipeline OK",
            icon: "/favicon.ico",
            tag: "ros-dev-test",
          });
        } catch {
          /* some browsers throw under specific states; non-fatal */
        }
      }
    } catch (err) {
      console.error("[dev] test notification failed", err);
      alert("Failed to send dev test notification (check console).");
    } finally {
      setSending(false);
    }
  };

  return (
    <Tooltip label="Send test notification (dev only)" placement="top">
      <button
        onClick={handleSend}
        disabled={sending}
        aria-label="Send test notification (dev only)"
        className="pointer-events-auto w-12 h-12 rounded-full bg-white border-2 border-amber-300 hover:border-amber-500 hover:bg-amber-50 text-amber-600 hover:text-amber-700 shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center disabled:opacity-50"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      </button>
    </Tooltip>
  );
}
