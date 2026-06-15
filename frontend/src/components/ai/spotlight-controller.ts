"use client";

// BeakerBot spotlight controller (ai perception bot, 2026-06-11).
//
// A self-contained, vanilla-DOM spotlight that BeakerBot's guide_to_element tool
// drives to highlight one live element. This is the tour replacement, so the
// highlight is meant to feel premium, not like a debug box. It renders, over the
// target's bounding rect:
//   - a dimming scrim with a soft cut-out around the target, so the eye is pulled
//     to the one control and the rest of the page recedes,
//   - a sky-blue glow ring that breathes (a gentle scale + glow pulse), hugging
//     the element and repositioning on scroll and resize,
//   - an animated pointer cue (a small bouncing arrow) that draws the eye in from
//     the side the bubble sits on,
//   - a BeakerBot narration bubble in the brand sky tone with a one-line note and
//     a dismiss control.
//
// Why vanilla DOM and not a React overlay, the spotlight has to SURVIVE A ROUTE
// CHANGE. guide_to_element can navigate from one page to another, which remounts
// the page tree. A controller that owns its own nodes on document.body outlives
// any React unmount and needs no persistent host, so we never touch AppShell or
// providers (the scope guard). The tool also runs OUTSIDE React in the agent loop,
// so an imperative controller it calls directly is the natural fit.
//
// The visual language (sky-blue ring + sky narration bubble) matches BeakerBot's
// brand and the SpeechBubble primitive. We do NOT re-enable the deprecated tour or
// touch its state machine.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

// How long to keep polling for a target that has not mounted yet before giving
// up. Generous, because a cold route can take a beat to hydrate.
const DEFAULT_TIMEOUT_MS = 6000;

// How often to poll for the target while waiting for it to mount.
const POLL_INTERVAL_MS = 100;

// Z-index band. Above app chrome, the scrim and ring are non-interactive (the
// bubble re-enables pointer events for its dismiss button). Sits over the page,
// below true app modals.
const SCRIM_Z = 2147482999;
const RING_Z = 2147483000;
const CUE_Z = 2147483000;
const BUBBLE_Z = 2147483001;

const GLOW_COLOR = "#0284c7"; // sky-700, BeakerBot brand.
const RING_BORDER = "#38bdf8"; // sky-400, matches the SpeechBubble border.

// How long the spotlight stays up before auto-dismissing, so a forgotten ring
// does not sit on the page forever. Generous, the user can dismiss sooner.
const AUTO_DISMISS_MS = 30000;

type SpotlightHandles = {
  scrim: HTMLDivElement;
  ring: HTMLDivElement;
  cue: HTMLDivElement;
  bubble: HTMLDivElement;
  cleanup: () => void;
};

// The single live spotlight, if any. A new spotlight replaces the old one, so the
// page never stacks rings.
let active: SpotlightHandles | null = null;

// Coaching-spotlight suppression (ai nav-polish bot, 2026-06-13). While a per-step
// plan is running, BeakerBot navigates the background app once per step and a fast
// 2-step plan finishes in ~1-2s. The guide_to_element coaching spotlight (the ring
// + bubble) popping and tearing down on every one of those steps reads as a jarring
// flicker, and the user is not following along element-by-element during an
// autonomous run anyway. So the plan driver suppresses coaching spotlights for the
// duration of the run. APPROVAL spotlights (a destructive or outward-facing step
// asking for consent at the moment it runs) pass `force` and are never suppressed,
// because those ARE the moments the user needs to see.
let coachingSuppressed = false;

/** Suppress (or re-enable) coaching spotlights. Called by the plan driver around a
 *  per-step run. Turning suppression ON also dismisses any coaching spotlight that
 *  is currently showing, so a highlight left over from a prior turn does not linger
 *  into the plan run. Approval spotlights (force) are unaffected. */
export function setSpotlightSuppressed(suppressed: boolean): void {
  coachingSuppressed = suppressed;
  if (suppressed) dismissSpotlight();
}

// ---------------------------------------------------------------------------
// Rect subscription bus (ai adaptive-dodge bot, 2026-06-11).
//
// Exposes the live bounding rect of the spotlight target so that other surfaces
// (the centered BeakerSearch modal) can dodge it. The rect is updated every
// time positionTo runs (scroll, resize, initial mount) and cleared when the
// spotlight is dismissed. Subscribers receive the new rect or null.
// ---------------------------------------------------------------------------

export type SpotlightRect = { left: number; top: number; width: number; height: number };

let currentTargetRect: SpotlightRect | null = null;
const rectSubscribers = new Set<(rect: SpotlightRect | null) => void>();

function notifyRectSubscribers(rect: SpotlightRect | null): void {
  currentTargetRect = rect;
  for (const cb of rectSubscribers) {
    try { cb(rect); } catch (_) { /* subscriber errors must not crash the spotlight */ }
  }
}

/** Subscribe to spotlight rect updates. The callback is called with the target
 *  element's bounding rect whenever the spotlight is shown or repositioned, and
 *  with null when it is dismissed. Returns an unsubscribe function. */
export function subscribeSpotlight(
  cb: (rect: SpotlightRect | null) => void,
): () => void {
  rectSubscribers.add(cb);
  return () => { rectSubscribers.delete(cb); };
}

/** Snapshot of the current spotlight target rect, or null if no spotlight is
 *  active. Updated on every reposition; reads the last-known value synchronously. */
export function getSpotlightRect(): SpotlightRect | null {
  return currentTargetRect;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Inject the keyframes once. Scoped by a stable id so repeat spotlights do not
// duplicate the style node. Two animations, a breathing pulse for the ring and a
// gentle bounce for the pointer cue, plus a soft fade-in for the whole thing.
function ensureKeyframes(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("beakerbot-spotlight-keyframes")) return;
  const style = document.createElement("style");
  style.id = "beakerbot-spotlight-keyframes";
  style.textContent = `
    @keyframes beakerbotSpotlightPulse {
      0%   { box-shadow: 0 0 0 2px ${GLOW_COLOR}33, 0 0 18px 4px ${GLOW_COLOR}99, inset 0 0 10px 0 ${GLOW_COLOR}55; }
      50%  { box-shadow: 0 0 0 4px ${GLOW_COLOR}55, 0 0 40px 12px ${GLOW_COLOR}cc, inset 0 0 16px 0 ${GLOW_COLOR}88; }
      100% { box-shadow: 0 0 0 2px ${GLOW_COLOR}33, 0 0 18px 4px ${GLOW_COLOR}99, inset 0 0 10px 0 ${GLOW_COLOR}55; }
    }
    @keyframes beakerbotSpotlightFadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes beakerbotSpotlightRingIn {
      from { opacity: 0; transform: scale(1.18); }
      to   { opacity: 1; transform: scale(1); }
    }
    @keyframes beakerbotCueBounce {
      0%, 100% { transform: translate(0, 0); }
      50%      { transform: translate(0, 6px); }
    }
  `;
  document.head.appendChild(style);
}

/** Remove the current spotlight if one is showing. Safe to call repeatedly. */
export function dismissSpotlight(): void {
  if (active) {
    active.cleanup();
    active = null;
  }
  notifyRectSubscribers(null);
}

function buildScrim(): HTMLDivElement {
  // A faint full-page dim. The cut-out is faked with a strong box-shadow on the
  // ring (the ring's outer glow plus this scrim makes the target pop), kept light
  // so the page is still readable around the highlight.
  const scrim = document.createElement("div");
  scrim.setAttribute("data-testid", "beakerbot-spotlight-scrim");
  scrim.setAttribute("aria-hidden", "true");
  Object.assign(scrim.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(15, 23, 42, 0.18)", // slate-900 at low alpha.
    pointerEvents: "none",
    zIndex: String(SCRIM_Z),
    animation: "beakerbotSpotlightFadeIn 220ms ease-out forwards",
  } as Partial<CSSStyleDeclaration>);
  return scrim;
}

function buildRing(reducedMotion: boolean): HTMLDivElement {
  const ring = document.createElement("div");
  ring.setAttribute("data-testid", "beakerbot-spotlight-ring");
  ring.setAttribute("aria-hidden", "true");
  Object.assign(ring.style, {
    position: "fixed",
    boxSizing: "border-box",
    borderRadius: "10px",
    border: `3px solid ${RING_BORDER}`,
    // The cut-out illusion, a huge spread shadow darkens everything outside the
    // ring more than the scrim alone, focusing the eye on the target.
    boxShadow: `0 0 0 2px ${GLOW_COLOR}55, 0 0 40px 12px ${GLOW_COLOR}cc, 0 0 0 9999px rgba(15, 23, 42, 0.12)`,
    pointerEvents: "none",
    zIndex: String(RING_Z),
    animation: reducedMotion
      ? "beakerbotSpotlightFadeIn 200ms ease-out forwards"
      : "beakerbotSpotlightRingIn 320ms cubic-bezier(0.22, 1, 0.36, 1) forwards, beakerbotSpotlightPulse 1600ms ease-in-out 320ms infinite",
  } as Partial<CSSStyleDeclaration>);
  return ring;
}

// The animated pointer cue, a small downward chevron arrow that bounces toward
// the target from above the bubble. Drawn with the existing brand sky color, no
// emoji. Direction is set when positioned (it flips when the bubble flips above).
function buildCue(reducedMotion: boolean): HTMLDivElement {
  const cue = document.createElement("div");
  cue.setAttribute("data-testid", "beakerbot-spotlight-cue");
  cue.setAttribute("aria-hidden", "true");
  Object.assign(cue.style, {
    position: "fixed",
    width: "0",
    height: "0",
    borderLeft: "9px solid transparent",
    borderRight: "9px solid transparent",
    pointerEvents: "none",
    zIndex: String(CUE_Z),
    filter: `drop-shadow(0 1px 2px ${GLOW_COLOR}66)`,
    animation: reducedMotion
      ? "beakerbotSpotlightFadeIn 200ms ease-out forwards"
      : "beakerbotSpotlightFadeIn 220ms ease-out forwards, beakerbotCueBounce 1100ms ease-in-out 220ms infinite",
  } as Partial<CSSStyleDeclaration>);
  return cue;
}

function buildBubble(narration: string): HTMLDivElement {
  // Mirrors SpeechBubble's "default" sky tone (white fill, sky-400 border,
  // sky-700 text), with a small dismiss control so the user can clear it.
  const bubble = document.createElement("div");
  bubble.setAttribute("data-testid", "beakerbot-spotlight-bubble");
  Object.assign(bubble.style, {
    position: "fixed",
    maxWidth: "260px",
    background: "white",
    border: `2px solid ${RING_BORDER}`,
    borderRadius: "14px",
    padding: "8px 12px",
    color: "#0369a1",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontWeight: "600",
    fontSize: "13px",
    lineHeight: "1.35",
    boxShadow: "0 6px 20px rgba(2, 132, 199, 0.22)",
    zIndex: String(BUBBLE_Z),
    display: "flex",
    gap: "8px",
    alignItems: "flex-start",
    animation: "beakerbotSpotlightFadeIn 260ms ease-out forwards",
  } as Partial<CSSStyleDeclaration>);

  const text = document.createElement("span");
  text.textContent = narration;
  bubble.appendChild(text);

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", "Dismiss highlight");
  dismiss.setAttribute("data-testid", "beakerbot-spotlight-dismiss");
  dismiss.textContent = "x";
  Object.assign(dismiss.style, {
    flexShrink: "0",
    border: "none",
    background: "transparent",
    color: "#0369a1",
    fontWeight: "700",
    fontSize: "13px",
    lineHeight: "1",
    cursor: "pointer",
    padding: "0 2px",
  } as Partial<CSSStyleDeclaration>);
  dismiss.addEventListener("click", () => dismissSpotlight());
  bubble.appendChild(dismiss);

  return bubble;
}

// Position the ring, cue, and bubble against the target's current bounding rect.
// The ring hugs the element with a little padding, the bubble sits below (or above
// if there is no room), and the cue points from the bubble toward the target.
// Notifies rect subscribers on every call so the dodge layer stays in sync.
function positionTo(handles: SpotlightHandles, el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  // Notify dodge subscribers with the live target rect.
  notifyRectSubscribers({ left: r.left, top: r.top, width: r.width, height: r.height });
  const pad = 6;
  Object.assign(handles.ring.style, {
    left: `${r.left - pad}px`,
    top: `${r.top - pad}px`,
    width: `${r.width + pad * 2}px`,
    height: `${r.height + pad * 2}px`,
  });

  const vh = window.innerHeight;
  const below = r.bottom + 14;
  const placeAbove = below > vh - 90;
  const bubbleLeft = Math.max(8, Math.min(r.left, window.innerWidth - 268));
  handles.bubble.style.left = `${bubbleLeft}px`;

  // Cue sits between the bubble and the target, pointing at the target. Centered
  // on the target horizontally, clamped to the viewport.
  const cueLeft = Math.max(10, Math.min(r.left + r.width / 2 - 9, window.innerWidth - 20));
  handles.cue.style.left = `${cueLeft}px`;

  if (placeAbove) {
    // Bubble above the target, cue points DOWN toward it.
    handles.bubble.style.top = "";
    handles.bubble.style.bottom = `${vh - r.top + 22}px`;
    handles.cue.style.top = `${r.top - pad - 16}px`;
    handles.cue.style.bottom = "";
    handles.cue.style.borderTop = `11px solid ${GLOW_COLOR}`;
    handles.cue.style.borderBottom = "";
  } else {
    // Bubble below the target, cue points UP toward it.
    handles.bubble.style.bottom = "";
    handles.bubble.style.top = `${below + 12}px`;
    handles.cue.style.bottom = "";
    handles.cue.style.top = `${r.bottom + pad + 4}px`;
    handles.cue.style.borderBottom = `11px solid ${GLOW_COLOR}`;
    handles.cue.style.borderTop = "";
  }
}

/** Find an element by selector, polling until it mounts or the timeout elapses.
 *  Returns the element, or null on timeout. Exported so the tool can wait for the
 *  post-navigation mount, and so the wait logic is testable with a fake document. */
export function waitForElement(
  selector: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    doc?: Pick<Document, "querySelector">;
    now?: () => number;
    setTimeoutFn?: typeof setTimeout;
  } = {},
): Promise<HTMLElement | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  const now = options.now ?? (() => Date.now());
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;

  if (!doc) return Promise.resolve(null);

  return new Promise((resolve) => {
    const start = now();
    const tick = () => {
      const found = doc.querySelector(selector);
      if (found instanceof HTMLElement) {
        resolve(found);
        return;
      }
      if (now() - start >= timeoutMs) {
        resolve(null);
        return;
      }
      setTimeoutFn(tick, intervalMs);
    };
    tick();
  });
}

/** Mount a premium spotlight on the given element with a narration line. Replaces
 *  any existing spotlight. Tracks the target's position on scroll and resize, drops
 *  itself if the target detaches from the DOM, and auto-dismisses after a while.
 *  Returns when mounted. */
export function showSpotlight(
  el: HTMLElement,
  narration: string,
  opts?: { force?: boolean },
): void {
  if (typeof document === "undefined") return;
  // A coaching spotlight is suppressed while a per-step plan runs (see
  // setSpotlightSuppressed). An approval spotlight passes force and shows anyway.
  if (coachingSuppressed && !opts?.force) return;
  dismissSpotlight();
  ensureKeyframes();

  const reducedMotion = prefersReducedMotion();
  const scrim = buildScrim();
  const ring = buildRing(reducedMotion);
  const cue = buildCue(reducedMotion);
  const bubble = buildBubble(narration);
  // The bubble needs pointer events for its dismiss button, the rest do not.
  bubble.style.pointerEvents = "auto";

  document.body.appendChild(scrim);
  document.body.appendChild(ring);
  document.body.appendChild(cue);
  document.body.appendChild(bubble);

  let raf = 0;
  let autoDismiss = 0;
  const handles: SpotlightHandles = {
    scrim,
    ring,
    cue,
    bubble,
    cleanup: () => {
      if (raf) cancelAnimationFrame(raf);
      if (autoDismiss) clearTimeout(autoDismiss);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      mo.disconnect();
      scrim.remove();
      ring.remove();
      cue.remove();
      bubble.remove();
    },
  };

  const reposition = () => {
    raf = 0;
    if (!el.isConnected) {
      dismissSpotlight();
      return;
    }
    positionTo(handles, el);
  };
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(reposition);
  };

  // Track position on scroll (capture, so nested scrollers bubble through) and
  // resize. Drop the spotlight if the target detaches.
  window.addEventListener("scroll", schedule, { capture: true, passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  const mo = new MutationObserver(() => {
    if (!el.isConnected) dismissSpotlight();
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Bring the target into view, then position. Center it so the ring is not at a
  // screen edge.
  el.scrollIntoView({
    behavior: reducedMotion ? "auto" : "smooth",
    block: "center",
    inline: "center",
  });
  positionTo(handles, el);

  // Reposition once more after the smooth scroll settles, so the ring lands on the
  // final rect rather than the pre-scroll one.
  if (!reducedMotion) setTimeout(schedule, 420);

  autoDismiss = window.setTimeout(() => dismissSpotlight(), AUTO_DISMISS_MS);

  active = handles;
}

/** True when a spotlight is currently showing. For tests and callers that want to
 *  avoid stacking. */
export function isSpotlightActive(): boolean {
  return active !== null;
}
