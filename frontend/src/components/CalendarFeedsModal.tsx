"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  createFeed,
  deleteFeed,
  listFeeds,
  updateFeed,
} from "@/lib/calendar/external-feeds-store";
import { parseIcsToExternalEvents } from "@/lib/calendar/ics-parser";
import { ensureGitignoreEntries } from "@/lib/file-system/gitignore";
import type { CalendarFeed, CalendarFeedProvider } from "@/lib/types";
import Tooltip from "./Tooltip";

const PROVIDER_LABELS: Record<CalendarFeedProvider, string> = {
  google: "Google Calendar",
  outlook: "Outlook",
  icloud: "iCloud",
  other: "Other (any iCal URL)",
};

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

interface Props {
  onClose: () => void;
}

export default function CalendarFeedsModal({ onClose }: Props) {
  const { currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const [feeds, setFeeds] = useState<CalendarFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHelp, setShowHelp] = useState<CalendarFeedProvider | null>(null);

  const [draftProvider, setDraftProvider] = useState<CalendarFeedProvider>("icloud");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftColor, setDraftColor] = useState(DEFAULT_COLORS[0]);
  const [testing, setTesting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  // Initial feed-list load.
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    (async () => {
      const list = await listFeeds(currentUser);
      if (!cancelled) {
        setFeeds(list);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["calendar-feeds", currentUser] });
    queryClient.invalidateQueries({ queryKey: ["calendar-feed-events"] });
  }, [queryClient, currentUser]);

  const handleAdd = async () => {
    if (!currentUser) return;
    const url = draftUrl.trim();
    if (!url) {
      setDraftError("Paste an ICS URL first.");
      return;
    }
    setTesting(true);
    setDraftError(null);
    try {
      const res = await fetch("/api/calendar-feed", {
        headers: { "x-calendar-url": url },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Server returned ${res.status}`);
      }
      const ics = await res.text();
      // Probe-parse to surface broken feeds before saving.
      const probe = parseIcsToExternalEvents(ics, {
        id: 0,
        provider: draftProvider,
        kind: "ics",
        label: "_probe",
        icsUrl: url,
        color: draftColor,
        enabled: true,
        lastSyncAt: null,
      });
      if (probe.length === 0) {
        const ok = window.confirm(
          "The feed was reachable but contained no events in the ±2-year window. Add it anyway?",
        );
        if (!ok) {
          setTesting(false);
          return;
        }
      }
      const label = draftLabel.trim() || PROVIDER_LABELS[draftProvider];
      const created = await createFeed(currentUser, {
        provider: draftProvider,
        label,
        icsUrl: url,
        color: draftColor,
      });
      setFeeds((prev) => [...prev, created]);
      setDraftUrl("");
      setDraftLabel("");
      try {
        await ensureGitignoreEntries([
          "_calendar-feeds.json",
          "users/*/_calendar-feeds.json",
        ]);
      } catch {
        /* ignore */
      }
      invalidate();
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setTesting(false);
    }
  };

  const handleToggle = async (feed: CalendarFeed) => {
    if (!currentUser) return;
    const updated = await updateFeed(currentUser, feed.id, { enabled: !feed.enabled });
    if (!updated) return;
    setFeeds((prev) => prev.map((f) => (f.id === feed.id ? updated : f)));
    invalidate();
  };

  const handleRecolor = async (feed: CalendarFeed, color: string) => {
    if (!currentUser) return;
    const updated = await updateFeed(currentUser, feed.id, { color });
    if (!updated) return;
    setFeeds((prev) => prev.map((f) => (f.id === feed.id ? updated : f)));
    invalidate();
  };

  const handleDelete = async (feed: CalendarFeed) => {
    if (!currentUser) return;
    const ok = window.confirm(
      `Remove "${feed.label}"? Events from this calendar will disappear immediately. ResearchOS events are untouched.`,
    );
    if (!ok) return;
    await deleteFeed(currentUser, feed.id);
    setFeeds((prev) => prev.filter((f) => f.id !== feed.id));
    invalidate();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Linked Calendars</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Subscribe to Google, Outlook, or iCloud calendars via their public
              iCal URL. Read-only overlay alongside ResearchOS events.
            </p>
          </div>
          <Tooltip label="Close" placement="bottom">
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-lg"
            >
              ✕
            </button>
          </Tooltip>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-6">
          {/* Connected feeds */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Connected ({feeds.length})
            </h4>
            {loading ? (
              <p className="text-sm text-gray-500 py-4">Loading…</p>
            ) : feeds.length === 0 ? (
              <p className="text-sm text-gray-400 italic py-2">
                No linked calendars yet. Paste an iCal URL below to subscribe.
              </p>
            ) : (
              <ul className="space-y-2">
                {feeds.map((feed) => (
                  <li
                    key={feed.id}
                    className="border border-gray-200 rounded-lg p-3 flex items-start gap-3"
                  >
                    <div className="flex flex-col gap-1 pt-0.5">
                      {DEFAULT_COLORS.slice(0, 5).map((c) => (
                        <button
                          key={c}
                          onClick={() => handleRecolor(feed, c)}
                          title={`Use color ${c}`}
                          className={`w-3 h-3 rounded-full transition-transform ${
                            feed.color === c ? "ring-2 ring-offset-1 ring-gray-400" : ""
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ backgroundColor: feed.color }}
                        />
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {feed.label}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-gray-400">
                          {PROVIDER_LABELS[feed.provider]}
                        </span>
                      </div>
                      {feed.icsUrl && (
                        <p
                          className="text-xs text-gray-400 truncate mt-0.5"
                          title={feed.icsUrl}
                        >
                          {feed.icsUrl}
                        </p>
                      )}
                      {feed.lastSyncAt && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          Last synced {new Date(feed.lastSyncAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <label className="inline-flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={feed.enabled}
                          onChange={() => handleToggle(feed)}
                          className="rounded"
                        />
                        <span className="text-xs text-gray-600">
                          {feed.enabled ? "On" : "Off"}
                        </span>
                      </label>
                      <button
                        onClick={() => handleDelete(feed)}
                        className="text-[11px] text-red-500 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ICS URL form */}
          <div className="border-t border-gray-100 pt-5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
              Add a calendar subscription
            </h4>
            <p className="text-[11px] text-gray-500 mb-3">
              Works with any public iCal / ICS URL. Every Google, Outlook, and
              iCloud calendar exposes one (sometimes called &ldquo;secret iCal
              address&rdquo; or &ldquo;publish&rdquo;). See the help below for
              where to find it.
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Provider
                  </label>
                  <select
                    value={draftProvider}
                    onChange={(e) => setDraftProvider(e.target.value as CalendarFeedProvider)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="icloud">iCloud / Apple Calendar</option>
                    <option value="google">Google Calendar</option>
                    <option value="outlook">Outlook / Office 365</option>
                    <option value="other">Other (any public iCal URL)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Label
                  </label>
                  <input
                    type="text"
                    value={draftLabel}
                    onChange={(e) => setDraftLabel(e.target.value)}
                    placeholder={`e.g. ${PROVIDER_LABELS[draftProvider]}`}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="text-xs font-medium text-gray-500">
                    ICS URL
                  </label>
                  <Tooltip
                    label="Stored in users/<your-username>/_calendar-feeds.json on your disk. Sent to /api/calendar-feed via an x-calendar-url header (not a query string, so it's not logged) when refreshing events."
                    placement="top"
                  >
                    <button
                      type="button"
                      aria-label="Where does this go?"
                      className="text-gray-400 hover:text-gray-600 text-[11px] leading-none"
                    >
                      (?)
                    </button>
                  </Tooltip>
                </div>
                <input
                  type="url"
                  value={draftUrl}
                  onChange={(e) => setDraftUrl(e.target.value)}
                  placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-[11px] text-amber-600">
                  This URL grants read access to your calendar events to anyone who has
                  it. ResearchOS stores it in your private data folder.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Color
                </label>
                <div className="flex gap-2">
                  {DEFAULT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setDraftColor(c)}
                      title={`Use color ${c}`}
                      className={`w-6 h-6 rounded-full transition-transform ${
                        draftColor === c
                          ? "ring-2 ring-offset-2 ring-gray-400 scale-110"
                          : ""
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              {draftError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded p-2">
                  {draftError}
                </p>
              )}
              <div className="flex items-center justify-between">
                <button
                  onClick={() =>
                    setShowHelp(showHelp === draftProvider ? null : draftProvider)
                  }
                  className="text-xs text-blue-600 hover:underline"
                  type="button"
                >
                  {showHelp === draftProvider ? "Hide" : "Where do I find this URL?"}
                </button>
                <button
                  onClick={handleAdd}
                  disabled={testing || !draftUrl.trim()}
                  className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                >
                  {testing ? "Testing…" : "Add Calendar"}
                </button>
              </div>
              {showHelp === draftProvider && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 space-y-2">
                  <HelpContent provider={draftProvider} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 text-[11px] text-gray-500">
          All linked calendars are read-only. To edit an event, open it in the
          source calendar — your change shows up here within 15 minutes.
        </div>
      </div>
    </div>
  );
}

function HelpContent({ provider }: { provider: CalendarFeedProvider }) {
  switch (provider) {
    case "google":
      return (
        <ol className="list-decimal list-inside space-y-1">
          <li>
            Open <span className="font-medium">Google Calendar</span> in a desktop browser.
          </li>
          <li>
            Click the gear → <span className="font-medium">Settings</span> →{" "}
            <span className="font-medium">Settings for my calendars</span>.
          </li>
          <li>Pick the calendar you want to share.</li>
          <li>
            Copy the <span className="font-medium">&ldquo;Secret address in iCal format&rdquo;</span>{" "}
            URL (or <span className="font-medium">&ldquo;Public address in iCal format&rdquo;</span>{" "}
            if the calendar is already public).
          </li>
        </ol>
      );
    case "outlook":
      return (
        <ol className="list-decimal list-inside space-y-1">
          <li>
            Open <span className="font-medium">Outlook on the web</span> →{" "}
            <span className="font-medium">Settings</span> →{" "}
            <span className="font-medium">Calendar</span> →{" "}
            <span className="font-medium">Shared calendars</span>.
          </li>
          <li>
            Under <span className="font-medium">&ldquo;Publish a calendar&rdquo;</span>, pick
            the calendar, choose <span className="font-medium">&ldquo;Can view all
            details&rdquo;</span>, and click <span className="font-medium">Publish</span>.
          </li>
          <li>
            Copy the <span className="font-medium">ICS</span> link Outlook generates.
          </li>
        </ol>
      );
    case "icloud":
      return (
        <ol className="list-decimal list-inside space-y-1">
          <li>
            Open the <span className="font-medium">Calendar</span> app on macOS or
            iCloud.com.
          </li>
          <li>
            Right-click the calendar →{" "}
            <span className="font-medium">Share Calendar</span> →{" "}
            <span className="font-medium">Public Calendar</span>.
          </li>
          <li>Copy the share link.</li>
          <li>
            If it starts with <span className="font-mono">webcal://</span>, paste it as-is —
            ResearchOS will rewrite it to <span className="font-mono">https://</span>{" "}
            automatically.
          </li>
        </ol>
      );
    case "other":
      return (
        <p>
          Paste any public iCal/ICS URL (starts with <span className="font-mono">http://</span>,
          <span className="font-mono"> https://</span>, or <span className="font-mono">webcal://</span>).
          Common sources: conference calendars, lab seminar feeds, sports schedules, etc.
        </p>
      );
  }
}
