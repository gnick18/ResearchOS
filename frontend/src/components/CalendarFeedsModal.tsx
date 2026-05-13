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
import type { OAuthTokens } from "@/lib/calendar/oauth-tokens-store";
import { isProviderConfigured } from "@/lib/calendar/oauth-config";
import {
  useOAuthAccount,
  type OAuthCalendar,
  type OAuthProviderKey,
} from "@/lib/calendar/use-oauth-account";
import type { CalendarFeed, CalendarFeedProvider } from "@/lib/types";

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

  // OAuth account state — one hook per provider, identical lifecycle.
  const googleConfigured = isProviderConfigured("google");
  const outlookConfigured = isProviderConfigured("outlook");
  const google = useOAuthAccount(currentUser ?? null, "google");
  const outlook = useOAuthAccount(currentUser ?? null, "outlook");

  // Initial feed-list load — OAuth state is owned by the hooks above.
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

  // ── ICS-form handlers (existing behaviour) ─────────────────────────
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
      const res = await fetch(`/api/calendar-feed?url=${encodeURIComponent(url)}`);
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
        oauthCalendarId: null,
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

  // ── OAuth handlers (shared across Google + Outlook) ────────────────
  const handleConnect = useCallback(
    async (provider: OAuthProviderKey) => {
      const acc = provider === "google" ? google : outlook;
      await acc.connect();
      try {
        await ensureGitignoreEntries([
          "_calendar-oauth.json",
          "users/*/_calendar-oauth.json",
        ]);
      } catch {
        /* ignore */
      }
    },
    [google, outlook],
  );

  const handleDisconnect = useCallback(
    async (provider: OAuthProviderKey) => {
      if (!currentUser) return;
      const providerFeeds = feeds.filter((f) => f.kind === provider);
      const ok = window.confirm(
        providerFeeds.length === 0
          ? `Disconnect your ${labelOf(provider)} account?`
          : `Disconnect your ${labelOf(provider)} account? ${providerFeeds.length} subscribed calendar${
              providerFeeds.length === 1 ? "" : "s"
            } will be removed.`,
      );
      if (!ok) return;
      for (const f of providerFeeds) await deleteFeed(currentUser, f.id);
      const acc = provider === "google" ? google : outlook;
      await acc.disconnect();
      setFeeds((prev) => prev.filter((f) => f.kind !== provider));
      invalidate();
    },
    [currentUser, feeds, google, outlook, invalidate],
  );

  const subscribedFor = useCallback(
    (provider: OAuthProviderKey, calId: string) =>
      feeds.find((f) => f.kind === provider && f.oauthCalendarId === calId),
    [feeds],
  );

  const handleToggleCalendar = useCallback(
    async (provider: OAuthProviderKey, cal: OAuthCalendar) => {
      if (!currentUser) return;
      const existing = subscribedFor(provider, cal.id);
      if (existing) {
        await deleteFeed(currentUser, existing.id);
        setFeeds((prev) => prev.filter((f) => f.id !== existing.id));
        invalidate();
        return;
      }
      // Pick a colour: use the provider's hint when available, otherwise
      // the next unused colour from our palette so concurrent calendars
      // stay visually distinct.
      const usedColors = new Set(feeds.map((f) => f.color));
      const fallbackColor =
        DEFAULT_COLORS.find((c) => !usedColors.has(c)) ?? DEFAULT_COLORS[0];
      const created = await createFeed(currentUser, {
        kind: provider,
        provider,
        label: cal.name,
        oauthCalendarId: cal.id,
        color: cal.colorHint ?? fallbackColor,
      });
      setFeeds((prev) => [...prev, created]);
      invalidate();
    },
    [currentUser, feeds, invalidate, subscribedFor],
  );

  // ── Render ─────────────────────────────────────────────────────────
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
              Show events from Google, Outlook, or iCloud alongside ResearchOS events.
              Google can be two-way; Outlook coming soon; iCloud is read-only.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg"
            title="Close"
          >
            ✕
          </button>
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
                No linked calendars yet. Connect Google below or paste an ICS URL.
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
                          {feed.kind === "ics"
                            ? PROVIDER_LABELS[feed.provider]
                            : feed.kind === "google"
                              ? "Google · two-way"
                              : "Outlook · two-way"}
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

          {/* Connect Google account */}
          <div className="border-t border-gray-100 pt-5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Connect an account
            </h4>
            <div className="space-y-3">
              <OAuthCard
                provider="google"
                configured={googleConfigured}
                account={google}
                isSubscribed={(id) => !!subscribedFor("google", id)}
                onConnect={() => handleConnect("google")}
                onDisconnect={() => handleDisconnect("google")}
                onToggleCalendar={(cal) => handleToggleCalendar("google", cal)}
              />
              <OAuthCard
                provider="outlook"
                configured={outlookConfigured}
                account={outlook}
                isSubscribed={(id) => !!subscribedFor("outlook", id)}
                onConnect={() => handleConnect("outlook")}
                onDisconnect={() => handleDisconnect("outlook")}
                onToggleCalendar={(cal) => handleToggleCalendar("outlook", cal)}
              />
            </div>
          </div>

          {/* ICS URL form */}
          <div className="border-t border-gray-100 pt-5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
              Or paste a public iCal / ICS URL
            </h4>
            <p className="text-[11px] text-gray-500 mb-3">
              The only way to subscribe to iCloud calendars. Read-only.
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
                    <option value="google">Google Calendar (ICS)</option>
                    <option value="outlook">Outlook / Office 365 (ICS)</option>
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
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  ICS URL
                </label>
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
          OAuth-connected calendars become editable once write support ships. ICS
          subscriptions stay read-only.
        </div>
      </div>
    </div>
  );
}

function labelOf(provider: OAuthProviderKey): string {
  return provider === "google" ? "Google" : "Outlook";
}

function envHintFor(provider: OAuthProviderKey): string {
  return provider === "google"
    ? "NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=1"
    : "NEXT_PUBLIC_MICROSOFT_OAUTH_ENABLED=1";
}

interface OAuthCardProps {
  provider: OAuthProviderKey;
  configured: boolean;
  account: {
    tokens: OAuthTokens | null;
    calendars: OAuthCalendar[];
    busy: boolean;
    error: string | null;
  };
  isSubscribed: (calId: string) => boolean;
  onConnect: () => void | Promise<void>;
  onDisconnect: () => void | Promise<void>;
  onToggleCalendar: (cal: OAuthCalendar) => void | Promise<void>;
}

function OAuthCard({
  provider,
  configured,
  account,
  isSubscribed,
  onConnect,
  onDisconnect,
  onToggleCalendar,
}: OAuthCardProps) {
  const Logo = provider === "google" ? GoogleLogo : OutlookLogo;
  const fullName = provider === "google" ? "Google Calendar" : "Outlook / Microsoft 365";

  if (!configured) {
    return (
      <div className="border border-gray-200 rounded-lg p-3">
        <p className="text-sm text-gray-700 font-medium">{fullName}</p>
        <p className="text-xs text-gray-500 mt-1">
          Not configured for this deployment. Set{" "}
          <code className="px-1 py-0.5 bg-gray-100 rounded">
            {envHintFor(provider)}
          </code>{" "}
          plus your client id/secret to enable.
        </p>
      </div>
    );
  }

  if (!account.tokens) {
    return (
      <div className="border border-gray-200 rounded-lg p-3 flex items-center gap-3">
        <Logo />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{fullName}</p>
          <p className="text-[11px] text-gray-500">
            Read events · edit time / title / location · delete (write
            support lands shortly).
          </p>
          {account.error && (
            <p className="text-[11px] text-red-600 mt-1">{account.error}</p>
          )}
        </div>
        <button
          onClick={() => void onConnect()}
          disabled={account.busy}
          className="px-3 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
        >
          {account.busy ? "Opening…" : "Connect"}
        </button>
      </div>
    );
  }

  return (
    <div className="border border-emerald-200 bg-emerald-50/50 rounded-lg p-3 space-y-3">
      <div className="flex items-start gap-3">
        <Logo />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">
            Connected to {labelOf(provider)}
          </p>
          {account.tokens.accountEmail && (
            <p className="text-[11px] text-gray-500 truncate">
              as {account.tokens.accountEmail}
            </p>
          )}
          {!account.tokens.refreshToken && (
            <p className="text-[11px] text-amber-700 mt-1">
              {labelOf(provider)} didn&apos;t return a refresh token. Access
              will expire in ~1 hour; reconnect to keep syncing.
            </p>
          )}
        </div>
        <button
          onClick={() => void onDisconnect()}
          disabled={account.busy}
          className="text-[11px] text-red-600 hover:underline disabled:opacity-50"
        >
          Disconnect
        </button>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
          Show events from
        </p>
        {account.error && (
          <p className="text-xs text-red-600 mb-2">{account.error}</p>
        )}
        {account.calendars.length === 0 && !account.error ? (
          <p className="text-xs text-gray-400 italic">Loading calendars…</p>
        ) : (
          <ul className="space-y-1">
            {account.calendars.map((cal) => (
              <li key={cal.id}>
                <label className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSubscribed(cal.id)}
                    onChange={() => void onToggleCalendar(cal)}
                  />
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: cal.colorHint ?? "#9ca3af" }}
                  />
                  <span className="text-xs text-gray-800 truncate flex-1">
                    {cal.name}
                    {cal.primary && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-blue-600">
                        primary
                      </span>
                    )}
                  </span>
                  {cal.accessLabel && (
                    <span className="text-[10px] text-gray-400">
                      {cal.accessLabel}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.12c-.22-.66-.35-1.36-.35-2.12s.13-1.46.35-2.12V7.04H2.18a11 11 0 0 0 0 9.92l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function OutlookLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#0078D4"
        d="M21.5 4h-9v3h7.5v10h-7.5v3h9c.55 0 1-.45 1-1V5c0-.55-.45-1-1-1z"
      />
      <path fill="#0078D4" d="M11.5 3.5L1.5 5v14l10 1.5z" />
      <path
        fill="#fff"
        d="M6.5 8.7c-1.78 0-2.97 1.43-2.97 3.3 0 1.89 1.2 3.3 2.97 3.3 1.78 0 2.96-1.41 2.96-3.3 0-1.87-1.19-3.3-2.96-3.3zm0 5.16c-.94 0-1.53-.79-1.53-1.86 0-1.06.6-1.86 1.53-1.86s1.52.8 1.52 1.86c0 1.07-.59 1.86-1.52 1.86z"
      />
    </svg>
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
            URL.
          </li>
          <li>
            Easier alternative: use the &ldquo;Connect Google&rdquo; button above for a
            real OAuth integration (read + write).
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
          <li>
            Apple doesn&apos;t expose a write API to third parties, so iCloud feeds
            stay read-only no matter what.
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
