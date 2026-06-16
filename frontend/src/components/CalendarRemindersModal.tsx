"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  DEFAULT_PREFS,
  OFFSET_CHOICES,
  readPrefs,
  writePrefs,
  type NotificationPrefs,
} from "@/lib/calendar/notification-prefs-store";
import LivingPopup from "@/components/ui/LivingPopup";

interface Props {
  open: boolean;
  onClose: () => void;
}

type PermissionState = "default" | "granted" | "denied" | "unsupported";

function readBrowserPermission(): PermissionState {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission as PermissionState;
}

export default function CalendarRemindersModal({ open, onClose }: Props) {
  const { currentUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [permission, setPermission] = useState<PermissionState>(readBrowserPermission());

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    (async () => {
      const p = await readPrefs(currentUser);
      if (!cancelled) {
        setPrefs(p);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const save = async (next: NotificationPrefs) => {
    if (!currentUser) return;
    setPrefs(next);
    setSaving(true);
    try {
      await writePrefs(currentUser, next);
      queryClient.invalidateQueries({ queryKey: ["notification-prefs", currentUser] });
    } finally {
      setSaving(false);
    }
  };

  const handleRequestPermission = async () => {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result as PermissionState);
  };

  const handleTest = () => {
    if (permission === "granted" && "Notification" in window) {
      try {
        new Notification("ResearchOS test reminder", {
          body: "If you can see this, browser notifications are working.",
          icon: "/favicon.ico",
          tag: "ros-test-reminder",
        });
      } catch {
        alert("Browser blocked the test notification.");
      }
    }
  };

  return (
    <LivingPopup
      open={open}
      onClose={onClose}
      label="Event Reminders"
      widthClassName="max-w-md"
      card={false}
    >
      <div className="bg-surface-raised rounded-xl shadow-2xl w-full overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-surface-sunken flex items-start justify-between">
          <div>
            <h3 className="text-title font-semibold text-foreground">Event Reminders</h3>
            <p className="text-meta text-foreground-muted mt-0.5">
              Get a heads-up before timed events start.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5">
          {loading ? (
            <p className="text-body text-foreground-muted py-4 text-center">Loading…</p>
          ) : (
            <>
              {/* Enabled toggle */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.enabled}
                  onChange={(e) => save({ ...prefs, enabled: e.target.checked })}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <p className="text-body font-medium text-foreground">
                    Enable reminders
                  </p>
                  <p className="text-meta text-foreground-muted mt-0.5">
                    A reminder lands in your inbox (bell icon) at the chosen
                    time before each event with a start time. All-day events
                    don&apos;t produce reminders.
                  </p>
                </div>
              </label>

              {/* Offset selector */}
              <div className={prefs.enabled ? "" : "opacity-50 pointer-events-none"}>
                <label className="block text-meta font-medium text-foreground-muted mb-1">
                  Remind me
                </label>
                <select
                  value={prefs.offsetMinutes}
                  onChange={(e) =>
                    save({ ...prefs, offsetMinutes: parseInt(e.target.value, 10) })
                  }
                  className="w-full px-3 py-2 border border-border rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {OFFSET_CHOICES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label} before
                    </option>
                  ))}
                </select>
              </div>

              {/* Browser permission */}
              <div className="border-t border-border pt-4">
                <p className="text-meta font-semibold uppercase tracking-wide text-foreground-muted mb-2">
                  OS popups (optional)
                </p>
                <p className="text-meta text-foreground-muted mb-3">
                  In-app reminders always work while a ResearchOS tab is open.
                  Granting browser permission also raises a system-level
                  notification so you don&apos;t miss it on another tab.
                </p>
                {permission === "unsupported" && (
                  <p className="text-meta text-amber-600">
                    This browser doesn&apos;t support the Notification API.
                  </p>
                )}
                {permission === "default" && (
                  <button
                    onClick={handleRequestPermission}
                    className="ros-btn-raise px-3 py-1.5 text-meta bg-brand-action text-white rounded-lg hover:bg-brand-action/90"
                  >
                    Enable browser notifications
                  </button>
                )}
                {permission === "granted" && (
                  <div className="flex items-center gap-3">
                    <span className="text-meta text-emerald-600 inline-flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      Browser notifications on
                    </span>
                    <button
                      onClick={handleTest}
                      className="text-meta text-blue-600 hover:underline"
                    >
                      Send test
                    </button>
                  </div>
                )}
                {permission === "denied" && (
                  <p className="text-meta text-red-600">
                    Browser notifications are blocked. Re-enable them in your
                    browser&apos;s site settings.
                  </p>
                )}
              </div>

              {/* Status / heads-up */}
              <p className="text-meta text-foreground-muted italic border-t border-border pt-3">
                Reminders fire only while a ResearchOS tab is open. If it&apos;s
                closed, you&apos;ll still see in-app notifications when you
                return, just not a real-time alert.
              </p>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border bg-surface-sunken flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-body text-foreground-muted hover:bg-surface-sunken rounded-lg"
          >
            Done
          </button>
        </div>

        {saving && (
          <div className="absolute inset-0 pointer-events-none bg-surface-overlay/40" />
        )}
      </div>
    </LivingPopup>
  );
}
