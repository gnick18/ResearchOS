import { useEffect, useState } from "react";
import { sharingApi } from "@/lib/local-api";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "./lib/SpeechBubble";

/**
 * W8: Notifications tour (universal walkthrough).
 *
 * BeakerBot fires a test notification through the same
 * `sharingApi.createEventReminder` path the production
 * `DevTestNotificationButton` uses. The notification lands in the
 * user's real inbox; the wizard then nudges them to open the bell
 * icon in the top bar to see it (no programmatic navigation — the
 * wizard stays open).
 *
 * No artifact is logged: the notification itself is transient and the
 * user can dismiss it from the real inbox. If they ignore it, the
 * Phase 4 cleanup grid skips this step entirely.
 *
 * Next enables once the test reminder has been fired.
 */

interface W8Props {
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

function toLocalDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function W8NotificationsTourStep({
  setNextDisabled,
}: W8Props) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNextDisabled(!sent);
  }, [sent, setNextDisabled]);

  const handleSend = async () => {
    if (busy || sent) return;
    setBusy(true);
    setError(null);
    try {
      const now = new Date();
      const start = new Date(now.getTime() + 15 * 60 * 1000);
      await sharingApi.createEventReminder({
        event_id: `onboarding-w8-${Date.now()}`,
        event_kind: "native",
        event_title: "Hi from BeakerBot",
        event_start_iso: start.toISOString(),
        event_date: toLocalDateString(start),
        event_location: "Onboarding tour",
        offset_minutes: 15,
      });
      window.dispatchEvent(new CustomEvent("ros-notifications-changed"));
      setSent(true);
    } catch (err) {
      console.error("[onboarding-v3] W8 notification failed", err);
      setError("Couldn't fire the test notification.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-step-id="W8" className="space-y-4">
      <SpeechBubble>
        Now meet the bell. ResearchOS pings you about reminders, lab shares,
        and anything else that wants your attention. I&apos;ll send a sample
        ping so you know where to find them. Look for the bell icon up in
        the top bar.
      </SpeechBubble>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={busy || sent}
          className="w-full px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
        >
          {sent ? "Sent — check the bell" : busy ? "Sending..." : "Fire a test ping"}
        </button>
        {sent && (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
            One notification incoming. Click the bell in the top bar to open
            your inbox, then dismiss it when you&apos;re done.
          </p>
        )}
        {error && (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
