/**
 * App-level undo/redo history stack for controlled `<textarea>` inputs.
 *
 * Why: both markdown editors (LiveMarkdownEditor, HybridMarkdownEditor) are
 * controlled components — every keystroke re-renders the textarea with a new
 * `value` prop, which wipes the browser's native undo stack. In hybrid mode the
 * per-block textarea also remounts on block-offset changes (resetting native
 * undo entirely). So Cmd+Z does nothing.
 *
 * This module owns past/future stacks of string values and the coalescing
 * heuristics that decide when rapid edits fold into one undo step vs. start a
 * new one. It's UI-agnostic — pass `oldValue` and `newValue` into `push`,
 * and call `undo(currentValue)` / `redo(currentValue)` to get the value to
 * apply via the parent's `onChange`. See `LiveMarkdownEditor.tsx` /
 * `HybridMarkdownEditor.tsx` for the React wiring.
 */

export type PushKind = "type" | "paste";

export interface ValueHistoryOptions {
  /** Maximum number of undo entries to retain (older drop off). Default 50. */
  capacity?: number;
  /** Idle-time threshold for coalescing rapid typing into one step. Default 500ms. */
  coalesceIdleMs?: number;
  /**
   * Characters that, when inserted as part of a typing push, end the current
   * undo run so the *next* typing push starts a new step. Default is whitespace
   * + common punctuation.
   */
  boundaryChars?: string;
  /** Time source. Injectable for tests. */
  now?: () => number;
}

const DEFAULT_CAPACITY = 50;
const DEFAULT_COALESCE_IDLE_MS = 500;
const DEFAULT_BOUNDARY_CHARS = " \t\n.,;:!?\"'-()[]{}";

export class ValueHistory {
  private past: string[] = [];
  private future: string[] = [];
  private lastPushAt = 0;
  private lastPushKind: PushKind | "boundary" = "boundary";
  private forceBoundary = false;
  private readonly capacity: number;
  private readonly coalesceIdleMs: number;
  private readonly boundaryChars: Set<string>;
  private readonly now: () => number;

  constructor(opts: ValueHistoryOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.coalesceIdleMs = opts.coalesceIdleMs ?? DEFAULT_COALESCE_IDLE_MS;
    this.boundaryChars = new Set(opts.boundaryChars ?? DEFAULT_BOUNDARY_CHARS);
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Record a transition from `oldValue` to `newValue`. The parent owns the
   * actual `value` state; this method just maintains the past/future stacks
   * and decides whether to merge with the current undo step (coalesce) or
   * start a new one. `future` is always cleared (any pending redo is stale).
   *
   * No-op when `oldValue === newValue`.
   */
  push(oldValue: string, newValue: string, kind: PushKind = "type"): void {
    if (oldValue === newValue) return;
    const t = this.now();
    const coalesce = this.shouldCoalesce(kind, t);
    if (!coalesce) {
      this.past.push(oldValue);
      while (this.past.length > this.capacity) {
        this.past.shift();
      }
    }
    this.future = [];
    this.lastPushAt = t;
    this.lastPushKind = kind;
    this.forceBoundary = this.endsCurrentRun(oldValue, newValue, kind);
  }

  /**
   * Returns the value to revert to, or `null` if nothing to undo.
   * Pushes `currentValue` onto the future stack so a subsequent redo restores
   * it. Marks a boundary so the next push starts a fresh undo step.
   */
  undo(currentValue: string): string | null {
    if (this.past.length === 0) return null;
    const prev = this.past.pop()!;
    this.future.push(currentValue);
    this.forceBoundary = true;
    this.lastPushKind = "boundary";
    return prev;
  }

  /**
   * Returns the value to redo, or `null` if nothing to redo.
   * Pushes `currentValue` onto past so a subsequent undo restores it. Marks
   * a boundary so the next push starts a fresh undo step.
   */
  redo(currentValue: string): string | null {
    if (this.future.length === 0) return null;
    const next = this.future.pop()!;
    this.past.push(currentValue);
    while (this.past.length > this.capacity) {
      this.past.shift();
    }
    this.forceBoundary = true;
    this.lastPushKind = "boundary";
    return next;
  }

  /**
   * Force the next push to start a new undo step regardless of timing.
   * Call on blur, mode switch, or any external event that should logically
   * separate two edits even when they arrive within the coalesce window.
   */
  flushBoundary(): void {
    this.forceBoundary = true;
    this.lastPushKind = "boundary";
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }
  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Test/debug introspection. Returns defensive copies. */
  peek(): { past: readonly string[]; future: readonly string[] } {
    return { past: [...this.past], future: [...this.future] };
  }

  private shouldCoalesce(kind: PushKind, t: number): boolean {
    if (this.forceBoundary) return false;
    if (kind !== "type") return false;
    if (this.lastPushKind !== "type") return false;
    if (t - this.lastPushAt > this.coalesceIdleMs) return false;
    return true;
  }

  /**
   * Decide whether this push ENDS the current undo run (so the next push is
   * forced to start a new step). Paste is always a run end; typing ends the
   * run if any inserted character is in the boundary set.
   */
  private endsCurrentRun(oldValue: string, newValue: string, kind: PushKind): boolean {
    if (kind === "paste") return true;
    const inserted = computeInsertedSlice(oldValue, newValue);
    for (const c of inserted) {
      if (this.boundaryChars.has(c)) return true;
    }
    return false;
  }
}

/**
 * Compute the characters inserted in going from `oldValue` to `newValue` by
 * stripping the common prefix and common suffix. Suffixes do not overlap the
 * prefix region. Returns the empty string if the transition was a pure
 * deletion or substitution that removed more than it added.
 */
function computeInsertedSlice(oldValue: string, newValue: string): string {
  const oldLen = oldValue.length;
  const newLen = newValue.length;
  const minLen = Math.min(oldLen, newLen);
  let i = 0;
  while (i < minLen && oldValue[i] === newValue[i]) i++;
  let j = 0;
  while (
    j < oldLen - i &&
    j < newLen - i &&
    oldValue[oldLen - 1 - j] === newValue[newLen - 1 - j]
  ) {
    j++;
  }
  if (newLen - j <= i) return "";
  return newValue.substring(i, newLen - j);
}
