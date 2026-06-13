// BeakerBot workflow macros persistence (BeakerAI lane, 2026-06-13).
//
// A workflow macro is a saved, named, ordered sequence of BeakerBot steps the
// user replays with one /command. It is the user-authored, persisted cousin of
// propose_plan. Where propose_plan builds a one-off plan the model reasons out on
// the spot, a macro is a plan the user kept, so a weekly routine becomes one
// /command instead of a re-typed paragraph.
//
// On-disk shape. We reuse the generic JsonStore, which writes one file per record
// at users/<currentUser>/beakerbot_macros/<id>.json and draws ids from the
// per-user _counters.json. This mirrors beaker-chats-store exactly, including the
// no-folder-connected fallback (macros live in memory when there is no place to
// persist, like chats do). The `scope` field is on the shape from day one so a
// future PI lab-shared macro needs no migration.
//
// This module is Phase 1, the store plus the pure data helpers (slug, unique
// name, capture, date detection, dangling-step detection). The runner that
// replays a macro lives in Phase 2 (macro-runner.ts) and reuses the agent-loop
// gate, it is not here.
//
// Resilience. None of the disk helpers throw into the UI. When no folder is
// connected (or a read/write fails), they log a warn and return a safe value, so
// BeakerBot keeps working with no place to persist.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { JsonStore } from "@/lib/storage/json-store";

// One step of a macro. `tool` is a registry tool name, `args` are the arguments
// recorded verbatim at capture time, and `label` is the human sentence shown in
// the run card and the editor. A step the user toggled off is kept (so the editor
// can show it) but skipped by the runner.
export type MacroStep = {
  tool: string;
  args: Record<string, unknown>;
  label: string;
  // Optional, defaults to enabled. The editor lets a user disable a step without
  // deleting it, the runner skips disabled steps.
  enabled?: boolean;
};

// A saved macro. `name` is the /token (lowercase, no spaces). `scope` is
// "personal" for v1, the field exists so lab-shared macros need no migration.
export type StoredMacro = {
  id: number;
  name: string;
  description: string;
  steps: MacroStep[];
  scope: "personal";
  createdAt: string; // ISO
  updatedAt: string; // ISO, bumped on every save
};

// The on-disk entity name. Files land at users/<u>/beakerbot_macros/<id>.json.
const ENTITY = "beakerbot_macros";

const store = new JsonStore<StoredMacro>(ENTITY);

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers (unit-tested, no disk)
// ──────────────────────────────────────────────────────────────────────────

const NAME_MAX = 40;

// Turn a human label into a /token, for example "Monday rollup!" -> "monday-rollup".
// Lowercases, replaces any run of non-alphanumeric characters with a single hyphen,
// trims leading/trailing hyphens, and caps the length. Falls back to "macro" when
// the input has no usable characters, so the token is never empty.
export function slugifyMacroName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, NAME_MAX)
    .replace(/-+$/g, "");
  return slug || "macro";
}

// Make a desired /token unique against the names already in use, appending -2,
// -3, and so on. Comparison is case-insensitive (the menu matches lowercased
// tokens). Returns the original when it is already free.
export function ensureUniqueMacroName(
  desired: string,
  existingNames: string[],
): string {
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  if (!taken.has(desired.toLowerCase())) return desired;
  for (let i = 2; ; i++) {
    const candidate = `${desired}-${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

// Tool names that are pure navigation or read-only context gathering. They depend
// on live page state and add no reproducible work, so they are dropped when
// capturing a macro from a finished run, leaving the meaningful action and data
// steps. Kept as a set so the capture and any future audit agree on the list.
export const MACRO_NOISE_TOOLS: ReadonlySet<string> = new Set([
  "go_to_page",
  "read_page",
  "click_element",
  "guide_to_element",
  "read_artifact",
  "read_my_work",
  "search_my_work",
  "ask_user",
  "propose_plan",
]);

// A tool invocation as it executed in a run. The capture UI (Phase 4) collects
// these in order from the live steps panel and hands them here.
export type CapturedInvocation = {
  tool: string;
  args: Record<string, unknown>;
  label: string;
};

// Build the macro step list from the invocations a run executed, in order,
// dropping the navigation/read noise so the macro is the meaningful steps. Pure,
// so the capture flow and tests share one definition of "what becomes a step".
export function captureMacroSteps(
  invocations: CapturedInvocation[],
): MacroStep[] {
  return invocations
    .filter((inv) => !MACRO_NOISE_TOOLS.has(inv.tool))
    .map((inv) => ({
      tool: inv.tool,
      args: inv.args,
      label: inv.label.trim(),
      enabled: true,
    }));
}

// Detect a value that looks like a concrete (frozen) date or date range, so the
// editor can mark an argument captured verbatim with a "fixed date" badge. This
// is the honest face of deterministic replay, a digest macro recorded today
// freezes today's dates and the user should see that. Matches ISO dates
// (YYYY-MM-DD, optionally with a time) anywhere in a string value, and recurses
// shallowly into plain objects (for example { start, end } range args).
export function looksDateLike(value: unknown): boolean {
  if (typeof value === "string") {
    return /\d{4}-\d{2}-\d{2}/.test(value);
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((v) =>
      typeof v === "string" ? /\d{4}-\d{2}-\d{2}/.test(v) : false,
    );
  }
  return false;
}

// Return true when any argument of a step froze a date at capture time, used by
// the editor to show the "fixed date" marker on that step.
export function stepHasFixedDate(step: MacroStep): boolean {
  return Object.values(step.args).some((v) => looksDateLike(v));
}

// Find steps whose tool is no longer in the registry (renamed or removed). The
// editor surfaces these so the user can fix them, and the runner skips them with
// a visible warning rather than failing the whole run. Pure, takes the set of
// known tool names so it has no registry import.
export function findDanglingSteps(
  macro: Pick<StoredMacro, "steps">,
  knownToolNames: ReadonlySet<string>,
): MacroStep[] {
  return macro.steps.filter((s) => !knownToolNames.has(s.tool));
}

// ──────────────────────────────────────────────────────────────────────────
// Disk helpers (resilient, never throw into the UI)
// ──────────────────────────────────────────────────────────────────────────

// Create a new macro on disk and return it (with its assigned id). On failure
// (no folder, write error) returns null so the caller can keep going.
export async function createMacro(input: {
  name: string;
  description: string;
  steps: MacroStep[];
}): Promise<StoredMacro | null> {
  const now = new Date().toISOString();
  try {
    return await store.create({
      name: input.name,
      description: input.description,
      steps: input.steps,
      scope: "personal",
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    console.warn("[beaker-macros-store] createMacro failed", err);
    return null;
  }
}

// Save edits into an existing macro and bump updatedAt. Resilient, returns the
// saved record or null on failure.
export async function saveMacro(
  id: number,
  patch: { name?: string; description?: string; steps?: MacroStep[] },
): Promise<StoredMacro | null> {
  try {
    const update: Partial<StoredMacro> = {
      updatedAt: new Date().toISOString(),
    };
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.steps !== undefined) update.steps = patch.steps;
    return await store.update(id, update);
  } catch (err) {
    console.warn("[beaker-macros-store] saveMacro failed", err);
    return null;
  }
}

// Read one macro by id. Returns null when missing or unreadable.
export async function getMacro(id: number): Promise<StoredMacro | null> {
  try {
    return await store.get(id);
  } catch (err) {
    console.warn("[beaker-macros-store] getMacro failed", err);
    return null;
  }
}

// List every macro, newest activity first. Returns [] on failure (no folder
// connected, unreadable directory).
export async function listMacros(): Promise<StoredMacro[]> {
  try {
    const all = await store.listAll();
    return all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  } catch (err) {
    console.warn("[beaker-macros-store] listMacros failed", err);
    return [];
  }
}

// Delete a macro from disk. The storage layer trashes rather than hard-deletes
// (recoverable), matching the rest of the app. Returns true on success.
export async function deleteMacro(id: number): Promise<boolean> {
  try {
    return await store.delete(id);
  } catch (err) {
    console.warn("[beaker-macros-store] deleteMacro failed", err);
    return false;
  }
}
