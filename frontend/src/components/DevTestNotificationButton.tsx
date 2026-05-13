"use client";

import { useState } from "react";
import { sharingApi } from "@/lib/local-api";

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
    <button
      onClick={handleSend}
      disabled={sending}
      title="Dev only: fire a sample reminder into the bell + OS popup"
      className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50 transition-colors"
    >
      {sending ? "Sending…" : "🔔 Dev test"}
    </button>
  );
}
