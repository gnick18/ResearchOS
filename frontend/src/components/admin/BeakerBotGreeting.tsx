"use client";

// BeakerBot greeter for the operator dashboard (/admin).
//
// He waves on page load and pops a speech bubble with a real, rotating fact
// drawn from the metrics already on the page (no extra data). The lead fact is
// a "new since you last stopped by" delta, computed against the last visit's
// figures stashed in localStorage, so a returning operator gets a genuine
// "what changed" greeting. Clicking him advances to the next fact (and re-waves,
// plus the SVG's own heart easter-egg fires). Purely a bit of joy on an
// otherwise all-business page.
//
// We deliberately do not track per-user page views, so there is no honest
// "page clicks this week" number to show; the facts come from sign-ups,
// profiles, ORCID links, relay deliveries, and capacity headroom instead.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { useEffect, useRef, useState } from "react";

import BeakerBot, { type BeakerBotPose } from "@/components/BeakerBot";
import { pctUsed } from "@/lib/sharing/capacity-shared";

interface GreetingMetrics {
  directory: {
    totalIdentities: number;
    totalProfiles: number;
    orcidLinks: number;
    signupsByMonth: { month: string; count: number }[];
    profilesByDomain: { domain: string; count: number }[];
  };
  relay: {
    pendingShares: number;
    totalEverSent: number;
  };
  capacity?: {
    neon: { usedBytes: number | null; limitBytes: number };
    resend: { sentLast30Days: number | null };
  };
}

interface GreetingContext {
  /** New registered-identity count since the last visit, or null on a first
   *  visit (nothing to compare against yet). */
  delta: number | null;
  /** Whole days since the last visit, or null on a first visit. */
  daysSince: number | null;
  /** True when a prior visit was recorded (a returning operator). */
  returning: boolean;
}

const LS_COUNT = "ros-admin-last-identities";
const LS_SEEN = "ros-admin-last-seen";

const WAVE_HELLO_MS = 3200;
const WAVE_POKE_MS = 2400;
const ROTATE_MS = 5200;
const BUBBLE_FADE_IN_MS = 350;

/**
 * Builds the ordered list of speech-bubble lines from the metrics plus the
 * returning-visitor context. Pure (no DOM, no localStorage) so it is unit
 * tested directly. The first line is always a greeting, then the most
 * interesting "what changed" line, then a rotation of standing facts. Lines
 * that need data the dashboard does not have yet are skipped, and an all-quiet
 * fallback keeps the bubble from ever being empty.
 */
export function buildGreetingFacts(
  m: GreetingMetrics,
  ctx: GreetingContext,
): string[] {
  const facts: string[] = [];
  const d = m.directory;
  const r = m.relay;

  facts.push(ctx.returning ? "Welcome back!" : "Hi there!");

  if (ctx.delta !== null && ctx.delta > 0) {
    const when =
      ctx.daysSince !== null && ctx.daysSince > 0
        ? ctx.daysSince === 1
          ? "since yesterday"
          : `in the last ${ctx.daysSince} days`
        : "since you last stopped by";
    facts.push(
      `${ctx.delta.toLocaleString()} new ${
        ctx.delta === 1 ? "researcher" : "researchers"
      } joined ${when}.`,
    );
  } else if (ctx.delta === 0 && ctx.returning) {
    facts.push("No new sign-ups since your last visit. Calm seas.");
  }

  if (d.totalIdentities > 0) {
    facts.push(
      `We are up to ${d.totalIdentities.toLocaleString()} registered ${
        d.totalIdentities === 1 ? "researcher" : "researchers"
      }.`,
    );
  }

  const latestMonth = d.signupsByMonth[d.signupsByMonth.length - 1];
  if (latestMonth && latestMonth.count > 0) {
    facts.push(
      `${latestMonth.count.toLocaleString()} ${
        latestMonth.count === 1 ? "person" : "people"
      } signed up this month.`,
    );
  }

  if (d.totalProfiles > 0) {
    const institutions = d.profilesByDomain.length;
    facts.push(
      institutions > 1
        ? `${d.totalProfiles.toLocaleString()} public profiles across ${institutions} institutions.`
        : `${d.totalProfiles.toLocaleString()} public ${
            d.totalProfiles === 1 ? "profile" : "profiles"
          } so far.`,
    );
  }

  if (d.orcidLinks > 0) {
    facts.push(
      `${d.orcidLinks.toLocaleString()} ${
        d.orcidLinks === 1 ? "researcher has" : "researchers have"
      } linked an ORCID.`,
    );
  }

  if (r.totalEverSent > 0) {
    facts.push(
      `${r.totalEverSent.toLocaleString()} ${
        r.totalEverSent === 1 ? "share has" : "shares have"
      } been delivered through the relay.`,
    );
  }

  if (m.capacity && m.capacity.neon.usedBytes !== null) {
    const pct = pctUsed(m.capacity.neon.usedBytes, m.capacity.neon.limitBytes);
    if (pct < 50) {
      facts.push(
        `The database is only ${
          pct < 10 ? pct.toFixed(1) : Math.round(pct)
        }% full. Loads of runway.`,
      );
    }
  }

  if (
    m.capacity &&
    m.capacity.resend.sentLast30Days !== null &&
    m.capacity.resend.sentLast30Days > 0
  ) {
    facts.push(
      `${m.capacity.resend.sentLast30Days.toLocaleString()} emails went out in the last 30 days.`,
    );
  }

  // Only the greeting line so far means an empty / brand-new deployment.
  if (facts.length === 1) {
    facts.push("All quiet so far. The first researchers will show up here.");
  }

  return facts;
}

export default function BeakerBotGreeting({
  metrics,
}: {
  metrics: GreetingMetrics;
}) {
  const [pose, setPose] = useState<BeakerBotPose>("waving");
  const [facts, setFacts] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const pokeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Compute facts once on mount: read the last visit's figures, derive the
  // delta + days-since, then stash this visit's figures for next time.
  useEffect(() => {
    let delta: number | null = null;
    let daysSince: number | null = null;
    let returning = false;
    try {
      const prevCount = localStorage.getItem(LS_COUNT);
      const prevSeen = localStorage.getItem(LS_SEEN);
      if (prevCount !== null && prevCount !== "") {
        returning = true;
        delta = metrics.directory.totalIdentities - Number(prevCount);
      }
      if (prevSeen) {
        const ms = Date.now() - Date.parse(prevSeen);
        if (Number.isFinite(ms)) daysSince = Math.floor(ms / 86_400_000);
      }
      localStorage.setItem(
        LS_COUNT,
        String(metrics.directory.totalIdentities),
      );
      localStorage.setItem(LS_SEEN, new Date().toISOString());
    } catch {
      // localStorage unavailable (private mode, etc.): just greet without a delta.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the delta depends on the previous visit's figures in localStorage, which can only be read post-mount (not during render / SSR, and not in a useState lazy init). Set once on mount, no cascade.
    setFacts(buildGreetingFacts(metrics, { delta, daysSince, returning }));

    const fadeTimer = setTimeout(() => setBubbleVisible(true), BUBBLE_FADE_IN_MS);
    const settleTimer = setTimeout(() => setPose("idle"), WAVE_HELLO_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(settleTimer);
    };
  }, [metrics]);

  // Auto-rotate the bubble through the fact list.
  useEffect(() => {
    if (facts.length <= 1) return;
    const interval = setInterval(() => {
      setIdx((i) => (i + 1) % facts.length);
    }, ROTATE_MS);
    return () => clearInterval(interval);
  }, [facts]);

  useEffect(() => {
    return () => {
      if (pokeTimeoutRef.current) clearTimeout(pokeTimeoutRef.current);
    };
  }, []);

  const handlePoke = () => {
    setPose("waving");
    setIdx((i) => (facts.length ? (i + 1) % facts.length : 0));
    if (pokeTimeoutRef.current) clearTimeout(pokeTimeoutRef.current);
    pokeTimeoutRef.current = setTimeout(() => setPose("idle"), WAVE_POKE_MS);
  };

  const message = facts[idx] ?? "";

  return (
    <div className="flex items-center justify-end gap-2">
      {/* Speech bubble, sits to the left of BeakerBot with a tail pointing
          right toward him. */}
      <div
        className={`relative max-w-[230px] rounded-2xl border border-gray-200 bg-white px-3.5 py-2 shadow-sm transition-opacity duration-300 ${
          bubbleVisible && message ? "opacity-100" : "opacity-0"
        }`}
        aria-live="polite"
      >
        <p className="text-meta leading-snug text-gray-700">{message}</p>
        {/* Tail: a small white square rotated 45deg, bordered on the two
            sides that face outward so it reads as the bubble's point. */}
        <span className="absolute right-[-5px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-r border-t border-gray-200 bg-white" />
      </div>

      {/* BeakerBot. The wrapper handles the "advance fact + re-wave" poke; the
          SVG's own click still fires its heart easter-egg, so a tap does both. */}
      <button
        type="button"
        onClick={handlePoke}
        className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        aria-label="BeakerBot, click for another fact"
      >
        <BeakerBot
          pose={pose}
          alive
          className="h-16 w-16 text-sky-500"
          ariaLabel="BeakerBot waving hello"
        />
      </button>
    </div>
  );
}
