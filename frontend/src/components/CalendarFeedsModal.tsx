"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  createFeed,
  deleteFeed,
  listFeeds,
  updateFeed,
} from "@/lib/calendar/external-feeds-store";
import { parseIcsToExternalEvents } from "@/lib/calendar/ics-parser";
import { useExternalEvents } from "@/lib/calendar/use-external-events";
import { ensureGitignoreEntries } from "@/lib/file-system/gitignore";
import { getNativeCalendarColor } from "@/lib/file-system/user-metadata";
import {
  DEFAULT_CALENDAR_COLORS,
  pickFirstUnusedColor,
} from "@/lib/calendar/calendar-colors";
import type { CalendarFeed, CalendarFeedProvider } from "@/lib/types";
import LivingPopup from "@/components/ui/LivingPopup";
import Tooltip from "./Tooltip";

const PROVIDER_LABELS: Record<CalendarFeedProvider, string> = {
  google: "Google Calendar",
  outlook: "Outlook",
  icloud: "iCloud",
  other: "Other (any iCal URL)",
};

// Local alias so the existing JSX (which still references DEFAULT_COLORS)
// keeps working without touching every call site.
const DEFAULT_COLORS = DEFAULT_CALENDAR_COLORS;

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CalendarFeedsModal({ open, onClose }: Props) {
  const { currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  // Live sync health for the listed feeds: which ones the circuit breaker has
  // given up on (stale link), which have a transient error, and a retry that
  // resets the breaker. Lets this management surface tell the user a feed
  // needs its link re-checked.
  const {
    staleFeedIds,
    errorsByFeedId,
    refetch: refetchFeedSync,
    isFetching: feedSyncFetching,
  } = useExternalEvents();
  const [feeds, setFeeds] = useState<CalendarFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHelp, setShowHelp] = useState<CalendarFeedProvider | null>(null);

  const [draftProvider, setDraftProvider] = useState<CalendarFeedProvider>("icloud");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftColor, setDraftColor] = useState(DEFAULT_COLORS[0]);
  const [draftColorTouched, setDraftColorTouched] = useState(false);
  const [nativeColor, setNativeColor] = useState<string>(DEFAULT_COLORS[0]);
  const [testing, setTesting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  // Initial feed-list load.
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    (async () => {
      const [list, native] = await Promise.all([
        listFeeds(currentUser),
        getNativeCalendarColor(currentUser),
      ]);
      if (!cancelled) {
        setFeeds(list);
        setNativeColor(native);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  // Smart default: auto-pick the first palette color NOT already used by an
  // existing linked feed or the native "ResearchOS events" row. Recomputes
  // whenever feeds or the native color change so the suggestion stays fresh
  // while the modal is open. Once the user has manually clicked a swatch,
  // we stop auto-mutating (draftColorTouched gate) so their pick isn't
  // silently swapped after they add the next feed and re-open the form.
  const suggestedColor = useMemo(() => {
    const taken: string[] = [nativeColor];
    for (const f of feeds) taken.push(f.color);
    return pickFirstUnusedColor(taken);
  }, [feeds, nativeColor]);

  useEffect(() => {
    if (draftColorTouched) return;
    setDraftColor(suggestedColor);
  }, [suggestedColor, draftColorTouched]);

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
      // Release the "touched" gate so the next-feed suggestion can
      // refresh against the now-updated feeds list. Without this, every
      // subsequent add would default to whatever the last manual pick was.
      setDraftColorTouched(false);
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
    <LivingPopup
      open={open}
      onClose={onClose}
      label="Linked Calendars"
      widthClassName="max-w-2xl"
      card={false}
      fillHeight
    >
      <div className="bg-surface-raised rounded-xl ros-popup-card-shadow w-full overflow-hidden max-h-[88vh] flex flex-col">
        <div className="px-5 py-4 border-b border-border bg-surface-sunken flex items-center justify-between">
          <div>
            <h3 className="text-title font-semibold text-foreground">Linked Calendars</h3>
            <p className="text-meta text-foreground-muted mt-0.5">
              Subscribe to Google, Outlook, or iCloud calendars via their public
              iCal URL. Read-only overlay alongside ResearchOS events.
            </p>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-6">
          {/* Connected feeds */}
          <div>
            <h4 className="text-meta font-semibold uppercase tracking-wide text-foreground-muted mb-2">
              Connected ({feeds.length})
            </h4>
            {loading ? (
              <p className="text-body text-foreground-muted py-4">Loading…</p>
            ) : feeds.length === 0 ? (
              <p className="text-body text-foreground-muted italic py-2">
                No linked calendars yet. Paste an iCal URL below to subscribe.
              </p>
            ) : (
              <ul className="space-y-2">
                {feeds.map((feed) => (
                  <li
                    key={feed.id}
                    className="border border-border rounded-lg p-3 flex items-start gap-3"
                  >
                    <div className="flex flex-col gap-1 pt-0.5">
                      {DEFAULT_COLORS.slice(0, 5).map((c) => (
                        <Tooltip key={c} label={`Use color ${c}`} placement="right">
                          <button
                            onClick={() => handleRecolor(feed, c)}
                            aria-label={`Use color ${c}`}
                            className={`w-3 h-3 rounded-full transition-transform ${
                              feed.color === c ? "ring-2 ring-offset-1 ring-gray-400" : ""
                            }`}
                            style={{ backgroundColor: c }}
                          />
                        </Tooltip>
                      ))}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ backgroundColor: feed.color }}
                        />
                        <span className="text-body font-medium text-foreground truncate">
                          {feed.label}
                        </span>
                        <span className="text-meta uppercase tracking-wide text-foreground-muted">
                          {PROVIDER_LABELS[feed.provider]}
                        </span>
                      </div>
                      {feed.icsUrl && (
                        <p
                          className="text-meta text-foreground-muted truncate mt-0.5"
                          title={feed.icsUrl}
                        >
                          {feed.icsUrl}
                        </p>
                      )}
                      {feed.lastSyncAt && (
                        <p className="text-meta text-foreground-muted mt-0.5">
                          Last synced {new Date(feed.lastSyncAt).toLocaleString()}
                        </p>
                      )}
                      {feed.enabled && staleFeedIds.has(feed.id) ? (
                        <div className="mt-1.5 rounded-md border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-2 py-1.5">
                          <p className="text-meta font-medium text-red-700 dark:text-red-300">
                            Stopped syncing — the link may be broken or expired.
                          </p>
                          <p className="text-meta text-red-600/90 dark:text-red-300/80 mt-0.5">
                            Re-copy this calendar&apos;s public iCal URL from its
                            share settings and re-add it (Remove, then paste the
                            new link), or retry.
                          </p>
                          <button
                            onClick={() => void refetchFeedSync()}
                            disabled={feedSyncFetching}
                            className="mt-1 text-meta font-medium text-red-700 dark:text-red-300 underline disabled:opacity-50"
                          >
                            {feedSyncFetching ? "Retrying…" : "Retry now"}
                          </button>
                        </div>
                      ) : feed.enabled && errorsByFeedId.has(feed.id) ? (
                        <p className="mt-1 text-meta text-amber-600 dark:text-amber-300">
                          Couldn&apos;t sync just now — will retry automatically.
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <label className="inline-flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={feed.enabled}
                          onChange={() => handleToggle(feed)}
                          className="rounded"
                        />
                        <span className="text-meta text-foreground-muted">
                          {feed.enabled ? "On" : "Off"}
                        </span>
                      </label>
                      <button
                        onClick={() => handleDelete(feed)}
                        className="text-meta text-red-500 hover:underline"
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
          <div className="border-t border-border pt-5">
            <h4 className="text-meta font-semibold uppercase tracking-wide text-foreground-muted mb-3">
              Add a calendar subscription
            </h4>
            <p className="text-meta text-foreground-muted mb-3">
              Works with any public iCal / ICS URL. Every Google, Outlook, and
              iCloud calendar exposes one (sometimes called &ldquo;secret iCal
              address&rdquo; or &ldquo;publish&rdquo;). See the help below for
              where to find it.
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-meta font-medium text-foreground-muted mb-1">
                    Provider
                  </label>
                  <select
                    value={draftProvider}
                    onChange={(e) => setDraftProvider(e.target.value as CalendarFeedProvider)}
                    className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="icloud">iCloud / Apple Calendar</option>
                    <option value="google">Google Calendar</option>
                    <option value="outlook">Outlook / Office 365</option>
                    <option value="other">Other (any public iCal URL)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-meta font-medium text-foreground-muted mb-1">
                    Label
                  </label>
                  <input
                    type="text"
                    value={draftLabel}
                    onChange={(e) => setDraftLabel(e.target.value)}
                    placeholder={`e.g. ${PROVIDER_LABELS[draftProvider]}`}
                    className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="text-meta font-medium text-foreground-muted">
                    ICS URL
                  </label>
                  <Tooltip
                    label="Stored in users/<your-username>/_calendar-feeds.json on your disk. Sent to /api/calendar-feed via an x-calendar-url header (not a query string, so it's not logged) when refreshing events."
                    placement="top"
                  >
                    <button
                      type="button"
                      aria-label="Where does this go?"
                      className="text-foreground-muted hover:text-foreground-muted text-meta leading-none"
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
                  className="w-full px-3 py-2 border border-border rounded-lg text-body font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-meta text-amber-600 dark:text-amber-300">
                  This URL grants read access to your calendar events to anyone who has
                  it. ResearchOS stores it in your private data folder.
                </p>
              </div>
              <div>
                <label className="block text-meta font-medium text-foreground-muted mb-1">
                  Color
                </label>
                <div className="flex gap-2">
                  {DEFAULT_COLORS.map((c) => (
                    <Tooltip key={c} label={`Use color ${c}`} placement="bottom">
                      <button
                        onClick={() => {
                          setDraftColor(c);
                          setDraftColorTouched(true);
                        }}
                        aria-label={`Use color ${c}`}
                        className={`w-6 h-6 rounded-full transition-transform ${
                          draftColor === c
                            ? "ring-2 ring-offset-2 ring-gray-400 scale-110"
                            : ""
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    </Tooltip>
                  ))}
                </div>
              </div>
              {draftError && (
                <p className="text-meta text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-500/15 border border-red-100 rounded p-2">
                  {draftError}
                </p>
              )}
              <div className="flex items-center justify-between">
                <button
                  onClick={() =>
                    setShowHelp(showHelp === draftProvider ? null : draftProvider)
                  }
                  className="text-meta text-blue-600 dark:text-blue-300 hover:underline"
                  type="button"
                >
                  {showHelp === draftProvider ? "Hide" : "Where do I find this URL?"}
                </button>
                <button
                  onClick={handleAdd}
                  disabled={testing || !draftUrl.trim()}
                  className="ros-btn-raise px-4 py-2 text-body text-white bg-brand-action hover:bg-brand-action/90 rounded-lg disabled:opacity-50"
                >
                  {testing ? "Testing…" : "Add Calendar"}
                </button>
              </div>
              {showHelp === draftProvider && (
                <div className="bg-surface-sunken border border-border rounded-lg p-3 text-meta text-foreground space-y-2">
                  <HelpContent provider={draftProvider} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border bg-surface-sunken text-meta text-foreground-muted">
          All linked calendars are read-only. To edit an event, open it in the
          source calendar — your change shows up here within 15 minutes.
        </div>
      </div>
    </LivingPopup>
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
