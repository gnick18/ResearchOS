"use client";

// BeakerBot spotlight controller (ai spotlight bot, 2026-06-10).
//
// A self-contained, vanilla-DOM spotlight that BeakerBot's spotlight_ui_element
// tool drives to highlight one UI element by selector. It renders a pulsing
// sky-blue glow ring over the target's bounding rect plus a one-line BeakerBot
// narration bubble, then tracks the target's position until dismissed.
//
// Why vanilla DOM and not the React TourSpotlight component:
//   - The spotlight has to survive a route change. spotlight_ui_element navigates
//     from /ai to the target page, which unmounts the BeakerBotPanel (and any
//     React overlay it hosted). A controller that owns its own nodes on
//     document.body outlives any component unmount and needs no persistent React
//     host, so we do not have to touch AppShell or providers (the scope guard).
//   - The tool runs OUTSIDE React in the agent loop, so an imperative controller
//     it can call directly is the natural fit.
// The visual language (sky-blue pulsing glow ring) is a faithful copy of
// TourSpotlight's ring, and the bubble mirrors SpeechBubble's default sky tone,
// so the highlight looks like the rest of BeakerBot. We do NOT re-enable the tour
// or touch its state machine.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

// How long to keep polling for a target that has not mounted yet (the page is
// still rendering after navigation) before giving up. Generous, because a cold
// route can take a beat to hydrate.
const DEFAULT_TIMEOUT_MS = 6000;

// How often to poll for the target while waiting for it to mount.
const POLL_INTERVAL_MS = 100;

// Z-index band. Above app chrome but the ring is non-interactive. Mirrors the
// TourSpotlight slot intent (sits over the page, below true app modals).
const RING_Z = 2147483000;
const BUBBLE_Z = 2147483001;

const GLOW_COLOR = "#0284c7"; // sky-700, same as TourSpotlight default.

type SpotlightHandles = {
  overlay: HTMLDivElement;
  ring: HTMLDivElement;
  bubble: HTMLDivElement;
  cleanup: () => void;
};

// The single live spotlight, if any. A new spotlight replaces the old one, so the
// page never stacks rings.
let active: SpotlightHandles | null = null;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Inject the pulse keyframes once. Scoped by a stable id so repeat spotlights do
// not duplicate the style node.
function ensureKeyframes(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("beakerbot-spotlight-keyframes")) return;
  const style = document.createElement("style");
  style.id = "beakerbot-spotlight-keyframes";
  style.textContent = `
    @keyframes beakerbotSpotlightPulse {
      0%   { opacity: 0.45; }
      50%  { opacity: 0.9; }
      100% { opacity: 0.45; }
    }
    @keyframes beakerbotSpotlightFadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
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
}

function buildRing(reducedMotion: boolean): HTMLDivElement {
  const ring = document.createElement("div");
  ring.setAttribute("data-testid", "beakerbot-spotlight-ring");
  ring.setAttribute("aria-hidden", "true");
  Object.assign(ring.style, {
    position: "fixed",
    boxSizing: "border-box",
    borderRadius: "8px",
    border: `3px solid ${GLOW_COLOR}`,
    boxShadow: `0 0 0 2px ${GLOW_COLOR}40, 0 0 32px 8px ${GLOW_COLOR}, inset 0 0 12px 0 ${GLOW_COLOR}`,
    pointerEvents: "none",
    zIndex: String(RING_Z),
    animation: reducedMotion
      ? "beakerbotSpotlightFadeIn 200ms ease-out forwards"
      : "beakerbotSpotlightPulse 1500ms ease-in-out infinite",
    opacity: reducedMotion ? "0.9" : undefined,
  } as Partial<CSSStyleDeclaration>);
  return ring;
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
    border: "2px solid #38bdf8",
    borderRadius: "14px",
    padding: "8px 12px",
    color: "#0369a1",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontWeight: "600",
    fontSize: "13px",
    lineHeight: "1.35",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.12)",
    zIndex: String(BUBBLE_Z),
    display: "flex",
    gap: "8px",
    alignItems: "flex-start",
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

// Position the ring and bubble against the target's current bounding rect. The
// ring hugs the element with a little padding, the bubble sits just below (or
// above if there is no room below).
function positionTo(handles: SpotlightHandles, el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const pad = 6;
  Object.assign(handles.ring.style, {
    left: `${r.left - pad}px`,
    top: `${r.top - pad}px`,
    width: `${r.width + pad * 2}px`,
    height: `${r.height + pad * 2}px`,
  });

  // Place the bubble below the target by default, flipping above if it would run
  // off the bottom of the viewport.
  const vh = window.innerHeight;
  const below = r.bottom + 10;
  const placeAbove = below > vh - 80;
  handles.bubble.style.left = `${Math.max(8, r.left)}px`;
  if (placeAbove) {
    handles.bubble.style.top = "";
    handles.bubble.style.bottom = `${vh - r.top + 10}px`;
  } else {
    handles.bubble.style.bottom = "";
    handles.bubble.style.top = `${below}px`;
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
      // A non-HTMLElement match (rare) still counts as present but unusable, so we
      // keep waiting rather than resolving with something we cannot position.
      if (now() - start >= timeoutMs) {
        resolve(null);
        return;
      }
      setTimeoutFn(tick, intervalMs);
    };
    tick();
  });
}

/** Mount a spotlight on the given element with a narration line. Replaces any
 *  existing spotlight. Tracks the target's position on scroll and resize, and
 *  drops itself if the target detaches from the DOM. Returns when mounted. */
export function showSpotlight(el: HTMLElement, narration: string): void {
  if (typeof document === "undefined") return;
  dismissSpotlight();
  ensureKeyframes();

  const reducedMotion = prefersReducedMotion();
  const overlay = document.createElement("div");
  overlay.setAttribute("data-testid", "beakerbot-spotlight");
  // The overlay is just a logical group, the ring and bubble are position:fixed.
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = String(RING_Z);

  const ring = buildRing(reducedMotion);
  const bubble = buildBubble(narration);
  // The bubble needs pointer events for its dismiss button, the overlay does not.
  bubble.style.pointerEvents = "auto";

  overlay.appendChild(ring);
  document.body.appendChild(overlay);
  document.body.appendChild(bubble);

  let raf = 0;
  const handles: SpotlightHandles = {
    overlay,
    ring,
    bubble,
    cleanup: () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      mo.disconnect();
      overlay.remove();
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

  active = handles;
}

/** True when a spotlight is currently showing. For tests and callers that want to
 *  avoid stacking. */
export function isSpotlightActive(): boolean {
  return active !== null;
}
