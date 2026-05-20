import { useEffect, useState } from "react";
import { createFeed } from "@/lib/calendar/external-feeds-store";
import type { OnboardingSidecar } from "@/lib/onboarding/sidecar";
import SpeechBubble from "./lib/SpeechBubble";
import {
  appendArtifact,
  encodeCalendarFeedId,
  findArtifact,
} from "./lib/wizard-artifacts";

/**
 * W13: Calendar feed subscribe tour (conditional walkthrough).
 *
 * Fires only when `feature_picks.calendar === "yes"`.
 *
 * BeakerBot walks the user through adding an external calendar feed
 * (Google / Outlook / iCloud / arbitrary ICS URL). The user pastes a
 * URL into an inline form and clicks "Subscribe". The wizard calls
 * `createFeed` directly so the feed lands in the user&apos;s
 * `_calendar-feeds.json` exactly the way the Calendar tab&apos;s
 * `CalendarFeedsModal` would. No external fetch is triggered here;
 * the feed&apos;s sync loop runs on its own schedule. If the user
 * doesn&apos;t have a URL handy, the "Use sample" button drops in a
 * placeholder URL so they get the artifact without leaving the
 * wizard. The sample URL won&apos;t resolve to a real ICS file — the
 * subscribe action itself is what the demo is showing.
 *
 * Artifact: `{ type: "calendar_feed", id: <encoded>, cleanup_default: "keep" }`
 * where the encoded id carries both the integer feed id and the ICS
 * URL so Phase 4 cleanup can show the user the URL it&apos;s about to
 * delete without re-reading `_calendar-feeds.json`.
 */

interface W13Props {
  username: string;
  sidecar: OnboardingSidecar | null;
  setNextDisabled: (disabled: boolean) => void;
  patchSidecar: (
    patch: (cur: OnboardingSidecar) => OnboardingSidecar,
  ) => Promise<void>;
}

const DEFAULT_LABEL = "Sample lab calendar";
const SAMPLE_URL = "https://calendar.example.com/onboarding-sample.ics";

export default function W13CalendarTourStep({
  username,
  sidecar,
  setNextDisabled,
  patchSidecar,
}: W13Props) {
  const existing = findArtifact(sidecar, "calendar_feed");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNextDisabled(existing === null);
  }, [existing, setNextDisabled]);

  const handleSubscribe = async () => {
    if (creating || existing) return;
    const finalUrl = url.trim() || SAMPLE_URL;
    const finalLabel = label.trim() || DEFAULT_LABEL;
    setCreating(true);
    setError(null);
    try {
      const feed = await createFeed(username, {
        provider: "other",
        label: finalLabel,
        icsUrl: finalUrl,
        color: "#3b82f6",
        enabled: true,
      });
      await patchSidecar((cur) =>
        appendArtifact(cur, {
          type: "calendar_feed",
          id: encodeCalendarFeedId(feed.id, finalUrl),
          cleanup_default: "keep",
        }),
      );
    } catch (err) {
      console.error("[onboarding-v3] W13 feed subscribe failed", err);
      setError("Couldn't subscribe to the feed. Try again or skip this step.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div data-step-id="W13" className="space-y-4">
      <SpeechBubble>
        ResearchOS can fold an outside calendar right into the Calendar
        tab: department seminars, instrument bookings, your weekly group
        meeting, whatever. Paste an ICS URL below or use the sample for
        now and edit the link later.
      </SpeechBubble>

      {existing ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Feed subscribed. Pop open the Calendar tab to see it in the
          sidebar. You can rename it, change the color, or remove it
          anytime.
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-700">
            Feed label
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={DEFAULT_LABEL}
            disabled={creating}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
          />
          <label className="block text-xs font-medium text-gray-700 pt-1">
            ICS URL
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={SAMPLE_URL}
            disabled={creating}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
            data-w13-url
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setUrl(SAMPLE_URL)}
              disabled={creating}
              className="px-3 py-2 text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50"
            >
              Use sample
            </button>
            <button
              type="button"
              onClick={() => void handleSubscribe()}
              disabled={creating}
              className="flex-1 px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors shadow-sm disabled:opacity-50"
            >
              {creating ? "Subscribing..." : "Subscribe"}
            </button>
          </div>
          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
