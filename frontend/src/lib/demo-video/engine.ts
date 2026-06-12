/**
 * Demo-video engine: a deterministic, on-screen "robot mouse" for recording
 * marketing clips.
 *
 * The problem this solves: driving the app for a screen recording by guessing
 * pixel coordinates (through a browser-automation extension) misses targets,
 * shows no cursor, and stutters. Instead, this engine renders its OWN animated
 * cursor and drives the real UI by TARGETING ELEMENTS (by selector / data-testid),
 * so it is pixel-perfect, resolution-independent, smooth, and reproducible.
 *
 * It is data-driven: a clip is an array of {@link DemoStep}s (the "script" /
 * prompt of exactly what to do and how slowly). `runScript` plays it. The same
 * primitives are the "mouse" a BeakerBot tool can call later (hand it a script).
 *
 * Dev/record-only. Never mounted for real users (see DemoVideoAutoplay).
 */

export type Selector =
  | string // raw CSS selector
  | { testid: string } // [data-testid="…"]
  | { text: string; within?: string } // first element whose trimmed text === text
  | { textContains: string; within?: string }; // most specific clickable el containing text

export type DemoStep =
  | { action: "moveTo"; target: Selector; durationMs?: number }
  | { action: "click"; target: Selector; durationMs?: number }
  | { action: "rightClick"; target: Selector; durationMs?: number }
  | {
      action: "type";
      target: Selector;
      text: string;
      cadenceMs?: number;
      clear?: boolean;
      /** ms to glide the cursor to the field before typing. */
      durationMs?: number;
    }
  | { action: "hover"; target: Selector; durationMs?: number }
  | {
      action: "scroll";
      target: Selector;
      deltaY: number;
      times?: number;
      intervalMs?: number;
      /** ms to glide the cursor to the element before scrolling. */
      durationMs?: number;
    }
  | { action: "wait"; ms: number }
  | { action: "moveToPoint"; x: number; y: number; durationMs?: number }
  | {
      // Press-drag-release within an element, positions given as fractions
      // [0..1] of its bounding box (resolution-independent). Used to select a
      // sequence stretch so the Tm/GC badge appears.
      action: "drag";
      target: Selector;
      fromFrac: [number, number];
      toFrac: [number, number];
      durationMs?: number;
      steps?: number;
    };

export interface RunOptions {
  /** ms to wait for a target element to appear before giving up. Default 8000. */
  waitTimeoutMs?: number;
  /** Called with a short status string before each step (for logging). */
  onStep?: (label: string) => void;
  /** Abort signal so a re-trigger can cancel an in-flight run. */
  signal?: AbortSignal;
}

const CURSOR_ID = "ros-demo-cursor";

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    const id = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(id);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** Create (once) the floating cursor element and return it. */
function ensureCursor(): HTMLElement {
  let el = document.getElementById(CURSOR_ID);
  if (el) return el;
  el = document.createElement("div");
  el.id = CURSOR_ID;
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, {
    position: "fixed",
    top: "0",
    left: "0",
    zIndex: "2147483647",
    pointerEvents: "none",
    width: "28px",
    height: "28px",
    // Anchor the pointer tip at the element's top-left (like a real cursor).
    transform: "translate(-2px, -2px)",
    transition: "none",
    willChange: "transform",
    filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.35))",
    opacity: "0",
  } as CSSStyleDeclaration);
  // Classic arrow pointer: black fill, white outline so it reads on any bg.
  // Built via the DOM (not an inline markup literal) so it stays a pure
  // demo-tool cursor, distinct from the app's product icon system.
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "28");
  svg.setAttribute("height", "28");
  svg.setAttribute("viewBox", "0 0 28 28");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M5 3 L5 21 L10 16 L13.5 23 L16.5 21.5 L13 14.5 L20 14.5 Z");
  path.setAttribute("fill", "#111");
  path.setAttribute("stroke", "#fff");
  path.setAttribute("stroke-width", "1.4");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  el.appendChild(svg);
  document.body.appendChild(el);
  return el;
}

/** Animate a click "pulse" ring at the current cursor position. */
function clickRipple(x: number, y: number): void {
  const ring = document.createElement("div");
  Object.assign(ring.style, {
    position: "fixed",
    left: `${x}px`,
    top: `${y}px`,
    width: "10px",
    height: "10px",
    marginLeft: "-5px",
    marginTop: "-5px",
    borderRadius: "9999px",
    border: "2px solid rgba(37,99,235,0.9)",
    zIndex: "2147483646",
    pointerEvents: "none",
    transform: "scale(0.4)",
    opacity: "0.9",
    transition: "transform 380ms ease-out, opacity 380ms ease-out",
  } as CSSStyleDeclaration);
  document.body.appendChild(ring);
  requestAnimationFrame(() => {
    ring.style.transform = "scale(3.2)";
    ring.style.opacity = "0";
  });
  window.setTimeout(() => ring.remove(), 420);
}

let cursorX = -50;
let cursorY = -50;

function placeCursor(x: number, y: number): void {
  const el = ensureCursor();
  el.style.opacity = "1";
  el.style.transform = `translate(${x - 2}px, ${y - 2}px)`;
  cursorX = x;
  cursorY = y;
}

async function tweenCursorTo(
  x: number,
  y: number,
  durationMs: number,
  signal?: AbortSignal,
): Promise<void> {
  ensureCursor().style.opacity = "1";
  const startX = cursorX < 0 ? x : cursorX;
  const startY = cursorY < 0 ? y : cursorY;
  if (durationMs <= 0) {
    placeCursor(x, y);
    return;
  }
  const start = performance.now();
  return new Promise((resolve, reject) => {
    function frame(now: number) {
      if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
      const t = Math.min(1, (now - start) / durationMs);
      const e = easeInOutCubic(t);
      placeCursor(startX + (x - startX) * e, startY + (y - startY) * e);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

function selectorToString(sel: Selector): string {
  if (typeof sel === "string") return sel;
  if ("testid" in sel) return `[data-testid="${sel.testid}"]`;
  if ("textContains" in sel) return `textContains:"${sel.textContains}"`;
  return `text:"${sel.text}"`;
}

function queryOnce(sel: Selector): HTMLElement | null {
  if (typeof sel === "string") {
    return document.querySelector<HTMLElement>(sel);
  }
  if ("testid" in sel) {
    return document.querySelector<HTMLElement>(`[data-testid="${sel.testid}"]`);
  }
  if ("textContains" in sel) {
    // Most specific (shortest-text) visible clickable element containing the
    // substring. Restricting to clickables avoids matching wrapper containers.
    const scope = sel.within
      ? document.querySelector(sel.within) ?? document
      : document;
    const wanted = sel.textContains.trim();
    let best: HTMLElement | null = null;
    let bestLen = Infinity;
    const clickables = scope.querySelectorAll<HTMLElement>(
      "a,button,[role='button'],[role='tab']",
    );
    for (const el of Array.from(clickables)) {
      const txt = (el.textContent ?? "").trim();
      if (txt.includes(wanted) && isVisible(el) && txt.length < bestLen) {
        best = el;
        bestLen = txt.length;
      }
    }
    return best;
  }
  // exact text match
  const scope = sel.within
    ? document.querySelector(sel.within) ?? document
    : document;
  const wanted = sel.text.trim();
  const candidates = scope.querySelectorAll<HTMLElement>(
    "a,button,[role='button'],[role='tab'],li,div,span",
  );
  for (const el of Array.from(candidates)) {
    if ((el.textContent ?? "").trim() === wanted && isVisible(el)) return el;
  }
  return null;
}

function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

async function waitForEl(
  sel: Selector,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<HTMLElement> {
  const start = performance.now();
  for (;;) {
    const el = queryOnce(sel);
    if (el && isVisible(el)) return el;
    if (performance.now() - start > timeoutMs) {
      throw new Error(`demo-video: timed out waiting for ${selectorToString(sel)}`);
    }
    await sleep(100, signal);
  }
}

function centerOf(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Dispatch a realistic pointer+mouse click sequence on an element. */
function dispatchClick(el: HTMLElement, x: number, y: number): void {
  const base = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
  el.dispatchEvent(new PointerEvent("pointerover", base as PointerEventInit));
  el.dispatchEvent(new PointerEvent("pointerenter", base as PointerEventInit));
  el.dispatchEvent(new MouseEvent("mouseover", base));
  el.dispatchEvent(new PointerEvent("pointerdown", base as PointerEventInit));
  el.dispatchEvent(new MouseEvent("mousedown", base));
  if (typeof (el as HTMLElement).focus === "function") el.focus();
  el.dispatchEvent(new PointerEvent("pointerup", base as PointerEventInit));
  el.dispatchEvent(new MouseEvent("mouseup", base));
  el.dispatchEvent(new MouseEvent("click", base));
}

/** Dispatch a realistic right-click (context menu) sequence on an element. */
function dispatchContextMenu(el: HTMLElement, x: number, y: number): void {
  const base = {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    view: window,
    button: 2,
    buttons: 2,
  };
  el.dispatchEvent(new PointerEvent("pointerover", base as PointerEventInit));
  el.dispatchEvent(new MouseEvent("mouseover", base));
  el.dispatchEvent(new PointerEvent("pointerdown", base as PointerEventInit));
  el.dispatchEvent(new MouseEvent("mousedown", base));
  el.dispatchEvent(new PointerEvent("pointerup", base as PointerEventInit));
  el.dispatchEvent(new MouseEvent("mouseup", base));
  el.dispatchEvent(new MouseEvent("contextmenu", base));
}

/** Dispatch a pointer+mouse event at a screen point, on the element under it. */
function dispatchMouseAt(kind: "down" | "move" | "up", x: number, y: number): void {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return;
  const init = {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    view: window,
    buttons: kind === "up" ? 0 : 1,
  };
  el.dispatchEvent(new PointerEvent(`pointer${kind}`, init as PointerEventInit));
  el.dispatchEvent(new MouseEvent(`mouse${kind}`, init));
}

/** Set a React-controlled input/textarea value so onChange fires. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function moveToEl(
  sel: Selector,
  durationMs: number,
  opts: RunOptions,
): Promise<HTMLElement> {
  const el = await waitForEl(sel, opts.waitTimeoutMs ?? 8000, opts.signal);
  el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  await sleep(180, opts.signal);
  const { x, y } = centerOf(el);
  await tweenCursorTo(x, y, durationMs, opts.signal);
  return el;
}

async function runStep(step: DemoStep, opts: RunOptions): Promise<void> {
  switch (step.action) {
    case "wait":
      await sleep(step.ms, opts.signal);
      return;
    case "moveToPoint":
      await tweenCursorTo(step.x, step.y, step.durationMs ?? 700, opts.signal);
      return;
    case "moveTo":
      await moveToEl(step.target, step.durationMs ?? 700, opts);
      return;
    case "hover": {
      const el = await moveToEl(step.target, step.durationMs ?? 700, opts);
      const { x, y } = centerOf(el);
      el.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, clientX: x, clientY: y }),
      );
      el.dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          clientX: x,
          clientY: y,
        } as PointerEventInit),
      );
      return;
    }
    case "click": {
      const el = await moveToEl(step.target, step.durationMs ?? 700, opts);
      const { x, y } = centerOf(el);
      clickRipple(x, y);
      await sleep(90, opts.signal);
      dispatchClick(el, x, y);
      return;
    }
    case "rightClick": {
      const el = await moveToEl(step.target, step.durationMs ?? 700, opts);
      const { x, y } = centerOf(el);
      clickRipple(x, y);
      await sleep(90, opts.signal);
      dispatchContextMenu(el, x, y);
      return;
    }
    case "type": {
      const el = await moveToEl(step.target, step.durationMs ?? 600, opts);
      const { x, y } = centerOf(el);
      clickRipple(x, y);
      dispatchClick(el, x, y);
      const field = el as HTMLInputElement | HTMLTextAreaElement;
      const cadence = step.cadenceMs ?? 70;
      let current = step.clear === false ? field.value ?? "" : "";
      if (step.clear !== false) setNativeValue(field, "");
      for (const ch of step.text) {
        current += ch;
        setNativeValue(field, current);
        await sleep(cadence, opts.signal);
      }
      return;
    }
    case "scroll": {
      const el = await moveToEl(step.target, step.durationMs ?? 600, opts);
      const { x, y } = centerOf(el);
      const times = step.times ?? 1;
      const interval = step.intervalMs ?? 90;
      for (let i = 0; i < times; i++) {
        el.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: step.deltaY,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
        await sleep(interval, opts.signal);
      }
      return;
    }
    case "drag": {
      const el = await waitForEl(step.target, opts.waitTimeoutMs ?? 8000, opts.signal);
      el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      await sleep(180, opts.signal);
      const r = el.getBoundingClientRect();
      const sx = r.left + step.fromFrac[0] * r.width;
      const sy = r.top + step.fromFrac[1] * r.height;
      const ex = r.left + step.toFrac[0] * r.width;
      const ey = r.top + step.toFrac[1] * r.height;
      await tweenCursorTo(sx, sy, step.durationMs ?? 600, opts.signal);
      dispatchMouseAt("down", sx, sy);
      const n = step.steps ?? 24;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const x = sx + (ex - sx) * t;
        const y = sy + (ey - sy) * t;
        placeCursor(x, y);
        dispatchMouseAt("move", x, y);
        await sleep(16, opts.signal);
      }
      dispatchMouseAt("up", ex, ey);
      return;
    }
  }
}

/** Play a full clip script. Resolves when done; rejects on abort or a missing target. */
export async function runScript(steps: DemoStep[], opts: RunOptions = {}): Promise<void> {
  ensureCursor();
  for (let i = 0; i < steps.length; i++) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const step = steps[i];
    opts.onStep?.(`${i + 1}/${steps.length} ${step.action}`);
    await runStep(step, opts);
  }
}

/** Public wrapper: wait for a selector to be present + visible. */
export function waitForElement(
  sel: Selector,
  timeoutMs = 8000,
  signal?: AbortSignal,
): Promise<HTMLElement> {
  return waitForEl(sel, timeoutMs, signal);
}

const COUNTDOWN_ID = "ros-demo-countdown";

/**
 * Show a centered N-second countdown overlay, then resolve. Gives the operator
 * a beat to start the screen recording after the app has loaded and before the
 * cursor begins. Removed when it reaches zero (or on abort).
 */
export async function showCountdown(seconds: number, signal?: AbortSignal): Promise<void> {
  document.getElementById(COUNTDOWN_ID)?.remove();
  const overlay = document.createElement("div");
  overlay.id = COUNTDOWN_ID;
  overlay.setAttribute("aria-hidden", "true");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483646",
    pointerEvents: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } as CSSStyleDeclaration);
  const num = document.createElement("div");
  Object.assign(num.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "180px",
    height: "180px",
    borderRadius: "9999px",
    background: "rgba(255,255,255,0.78)",
    backdropFilter: "blur(6px)",
    boxShadow: "0 10px 40px rgba(0,0,0,0.18)",
    color: "#2563eb",
    fontSize: "104px",
    fontWeight: "800",
    fontVariantNumeric: "tabular-nums",
    lineHeight: "1",
  } as CSSStyleDeclaration);
  overlay.appendChild(num);
  document.body.appendChild(overlay);
  try {
    for (let n = seconds; n >= 1; n--) {
      num.textContent = String(n);
      num.animate(
        [
          { transform: "scale(1.22)", opacity: 0.25 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: 320, easing: "cubic-bezier(.2,.7,.2,1)" },
      );
      await sleep(1000, signal);
    }
  } finally {
    overlay.remove();
  }
}

/** Remove the cursor element (e.g. when a run is cancelled). */
export function teardownDemoCursor(): void {
  document.getElementById(CURSOR_ID)?.remove();
  document.getElementById(COUNTDOWN_ID)?.remove();
  cursorX = -50;
  cursorY = -50;
}
