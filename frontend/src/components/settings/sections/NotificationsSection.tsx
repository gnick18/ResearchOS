"use client";

import { useState } from "react";

import type { UserSettings } from "@/lib/settings/user-settings";
import { useAccountCapabilities } from "@/hooks/useAccountCapabilities";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_CATEGORIES,
  normalizeNotificationPreferences,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPreferences,
} from "@/lib/notifications/preferences";

/**
 * The "Notifications" settings section: route each kind of notification to any
 * combination of the bell, laptop pop-ups, the companion phone, and email, plus
 * quiet hours. The bell is always on (always collects). Phone + email are
 * account-only (cloud), so a solo user sees a gentle "create a free account"
 * upsell in their place rather than dead controls (see
 * feedback_solo_user_feature_gating).
 *
 * Phase 1: stores the preferences + the laptop permission. The laptop pop-ups
 * themselves are fired by a separate watcher; email + phone delivery are later
 * phases. No emojis, no em-dashes, no mid-sentence colons.
 */
const CHANNELS: {
  key: NotificationChannel;
  label: string;
  accountOnly?: boolean;
}[] = [
  { key: "inApp", label: "Bell" },
  { key: "laptop", label: "Laptop" },
  { key: "phone", label: "Phone", accountOnly: true },
  { key: "email", label: "Email", accountOnly: true },
];

function Switch({
  on,
  disabled,
  onClick,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-[22px] w-[38px] flex-none rounded-full transition-colors ${
        disabled
          ? "cursor-not-allowed bg-foreground-muted/20"
          : on
            ? "bg-brand-action"
            : "bg-foreground-muted/30"
      }`}
    >
      <span
        className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-[left] ${
          on ? "left-[18px]" : "left-[2px]"
        } ${disabled ? "opacity-60" : ""}`}
      />
    </button>
  );
}

export default function NotificationsSection({
  settings,
  update,
}: {
  settings: UserSettings;
  update: (patch: Partial<UserSettings>) => Promise<void>;
}) {
  // Email + phone are account-only channels; gate them through the unified
  // capability model so this matches every other account-gated surface.
  const { mode } = useAccountCapabilities();
  const hasAccount = mode === "account";

  const prefs = normalizeNotificationPreferences(
    settings.notificationPreferences ?? DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const [email, setEmailLocal] = useState(prefs.email ?? "");
  const [permission, setPermission] = useState<string>(
    typeof Notification !== "undefined" ? Notification.permission : "default",
  );

  const save = (next: NotificationPreferences) =>
    void update({ notificationPreferences: next });

  const setChannel = (
    cat: NotificationCategory,
    ch: NotificationChannel,
    on: boolean,
  ) =>
    save({
      ...prefs,
      channels: {
        ...prefs.channels,
        [cat]: { ...prefs.channels[cat], [ch]: on },
      },
    });

  const setQuiet = (patch: Partial<NotificationPreferences["quietHours"]>) =>
    save({ ...prefs, quietHours: { ...prefs.quietHours, ...patch } });

  const enableLaptop = async () => {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setPermission(p);
  };

  return (
    <div className="max-w-2xl">
      <p className="text-body leading-relaxed text-foreground-muted">
        Decide what you hear about, and where. Every kind of notification can go
        to any combination of places, or nowhere at all. The bell always
        collects everything; the rest is up to you.
      </p>

      {/* Solo upsell */}
      {!hasAccount ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-brand-action/30 bg-gradient-to-br from-brand-action/[0.05] to-brand-purple/[0.05] px-5 py-4">
          <div className="min-w-0">
            <div className="text-body font-extrabold text-foreground">
              Email and phone notifications come with a free account
            </div>
            <div className="mt-0.5 text-meta leading-relaxed text-foreground-muted">
              Solo ResearchOS stays on your machine, so the bell and laptop
              pop-ups work right now. Add an account whenever you want email or
              your phone in the loop.
            </div>
          </div>
        </div>
      ) : null}

      {/* Where notifications reach you */}
      <div className="mt-5 rounded-2xl border border-border bg-surface-raised p-5">
        <h3 className="text-body font-extrabold text-foreground">
          Where notifications can reach you
        </h3>

        <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
          <div className="flex-1">
            <div className="text-meta font-bold text-foreground">In-app bell</div>
            <div className="text-[11.5px] text-foreground-muted">
              The bell in the ResearchOS header.
            </div>
          </div>
          <span className="rounded-full bg-green-500/15 px-2.5 py-0.5 text-[11px] font-bold text-green-700 dark:text-green-300">
            Always on
          </span>
        </div>

        <div className="flex items-center gap-3 border-t border-border pt-3">
          <div className="flex-1">
            <div className="text-meta font-bold text-foreground">Laptop pop-ups</div>
            <div className="text-[11.5px] text-foreground-muted">
              Desktop notifications while a ResearchOS tab is open.
            </div>
          </div>
          {permission === "granted" ? (
            <span className="rounded-full bg-green-500/15 px-2.5 py-0.5 text-[11px] font-bold text-green-700 dark:text-green-300">
              Enabled
            </span>
          ) : permission === "denied" ? (
            <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
              Blocked in browser
            </span>
          ) : (
            <button
              type="button"
              onClick={enableLaptop}
              className="rounded-lg border border-brand-action px-3 py-1.5 text-meta font-bold text-brand-action transition-colors hover:bg-brand-action/[0.06]"
            >
              Enable
            </button>
          )}
        </div>

        {hasAccount ? (
          <>
            <div className="flex items-center gap-3 border-t border-border pt-3">
              <div className="flex-1">
                <div className="text-meta font-bold text-foreground">
                  Companion phone app
                </div>
                <div className="text-[11.5px] text-foreground-muted">
                  Push to your paired phone, even when your laptop is closed.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 border-t border-border pt-3">
              <div className="flex-1">
                <div className="text-meta font-bold text-foreground">Email</div>
                <div className="text-[11.5px] text-foreground-muted">
                  A short note lands in your inbox. We verify the address once.
                </div>
              </div>
              <input
                type="email"
                value={email}
                placeholder="you@university.edu"
                onChange={(e) => setEmailLocal(e.target.value)}
                onBlur={() => {
                  if (email !== (prefs.email ?? "")) save({ ...prefs, email });
                }}
                className="w-[230px] max-w-[46%] rounded-lg border border-border bg-surface-sunken px-2.5 py-1.5 text-meta text-foreground"
              />
            </div>
          </>
        ) : null}
      </div>

      {/* The matrix */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface-raised p-5">
        <h3 className="text-body font-extrabold text-foreground">What goes where</h3>
        <p className="mt-0.5 text-[11.5px] text-foreground-muted">
          Pick a channel per kind of notification.
        </p>
        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr>
              <th className="w-[44%] pb-2 text-left" />
              {CHANNELS.map((ch) => (
                <th
                  key={ch.key}
                  className={`border-b border-border pb-2 text-center text-[11px] font-extrabold uppercase tracking-[0.04em] ${
                    ch.accountOnly && !hasAccount
                      ? "text-foreground-muted/40"
                      : "text-foreground-muted"
                  }`}
                >
                  {ch.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_CATEGORIES.map((cat) => (
              <tr key={cat.id} className="border-b border-border last:border-0">
                <td className="py-3 pr-3 align-top">
                  <div className="text-meta font-bold text-foreground">
                    {cat.title}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-foreground-muted">
                    {cat.description}
                  </div>
                </td>
                {CHANNELS.map((ch) => {
                  const locked = !!ch.accountOnly && !hasAccount;
                  const on = !locked && prefs.channels[cat.id][ch.key];
                  return (
                    <td key={ch.key} className="py-3 text-center">
                      <Switch
                        on={on}
                        disabled={locked}
                        label={`${cat.title} via ${ch.label}`}
                        onClick={() =>
                          setChannel(cat.id, ch.key, !prefs.channels[cat.id][ch.key])
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Quiet hours */}
      <div className="mt-4 rounded-2xl border border-border bg-surface-raised p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-body font-extrabold text-foreground">Quiet hours</h3>
            <p className="mt-0.5 text-[11.5px] leading-snug text-foreground-muted">
              Laptop, phone, and email stay silent in this window. The bell still
              collects everything.
            </p>
          </div>
          <Switch
            on={prefs.quietHours.enabled}
            label="Quiet hours"
            onClick={() => setQuiet({ enabled: !prefs.quietHours.enabled })}
          />
        </div>
        {prefs.quietHours.enabled ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-meta text-foreground-muted">
            <span>From</span>
            <input
              type="time"
              value={prefs.quietHours.start}
              onChange={(e) => setQuiet({ start: e.target.value })}
              className="rounded-lg border border-border bg-surface-sunken px-2 py-1 text-meta text-foreground"
            />
            <span>to</span>
            <input
              type="time"
              value={prefs.quietHours.end}
              onChange={(e) => setQuiet({ end: e.target.value })}
              className="rounded-lg border border-border bg-surface-sunken px-2 py-1 text-meta text-foreground"
            />
            <span className="ml-2 inline-flex items-center gap-2">
              Weekends fully quiet
              <Switch
                on={prefs.quietHours.weekendsQuiet}
                label="Weekends fully quiet"
                onClick={() =>
                  setQuiet({ weekendsQuiet: !prefs.quietHours.weekendsQuiet })
                }
              />
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
