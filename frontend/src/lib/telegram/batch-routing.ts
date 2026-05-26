/**
 * Batch-photo routing state machine.
 *
 * Telegram tags album photos (the "select multiple, send" gesture) with a
 * shared `media_group_id` and delivers each photo as its own `message`
 * update within ~1 second. Per-photo routing — the existing single-shot
 * flow in `image-router.ts` — would prompt the user 10 separate times for
 * "where should this go? what is this?", which is the bug surfaced by
 * Grant's manual testing. This module buffers media_group_id photos into
 * a single batch, asks at most twice ("where?" + "name pattern?"), then
 * commits the batch to disk.
 *
 * Lifecycle (per chat):
 *
 *   buffering ────────────── timer (1.2s no arrivals) OR 10 photos cap
 *      │                          │
 *      │                          │ activeTaskSnapshot != null?
 *      │                          ▼
 *      │                       awaiting-style ──── style click ──┬─► awaiting-batch-name ──► commit
 *      │                                                          │
 *      │                                                          └─► awaiting-per-photo-captions ──► commit
 *      │
 *      └─ no activeTask: awaiting-destination ── click ──► awaiting-style (same fork as above)
 *
 * Tutorial-mode pass-through: the image-router guards entry — when
 * `tutorial_active` is set, batchable photos go through the single-photo
 * flow individually so the tutorial sequencer's "first-photo" broadcast
 * still fires. Nothing in this module checks the flag directly.
 *
 * Single-tab assumption: the polling loop in `use-telegram-polling.ts`
 * holds a cross-tab lock, so there's only ever one routing tab. State
 * lives in a module-scope Map keyed by chatId, mirroring the existing
 * `pendingCaptions` pattern in `image-router.ts`. A tab close mid-batch
 * loses the in-flight decisions; on-disk writes are durable.
 */

import { fileService } from "@/lib/file-system/file-service";
import {
  attachImageToNote,
  attachImageToTask,
} from "@/lib/attachments/attach-image";
import {
  resolveTaskResultsBase,
  taskNotesBase,
  taskResultsBase,
  taskResultsTabBase,
} from "@/lib/tasks/results-paths";
import { sidecarPath, type ImageSidecar } from "@/lib/attachments/image-folder";
import { hasUserContent } from "@/lib/stamp-utils";
import { JsonStore } from "@/lib/storage/json-store";
import type { Note, Project, Task } from "@/lib/types";
import type { ActiveNote, ActiveTask } from "@/lib/store";
import {
  answerCallbackQuery,
  sendMessage,
  sendPhoto,
  type InlineKeyboardButton,
  type InlineKeyboardMarkup,
  type TelegramCallbackQuery,
} from "./telegram-client";

/** Window between photo arrivals before the batch is considered closed.
 *  Telegram delivers album photos within ~1s in practice; 1.2s is enough
 *  slack to absorb network jitter without keeping the user waiting. */
export const BATCH_WINDOW_MS = 1200;
/** Telegram caps an album at 10 photos. Once we've buffered 10 we can
 *  commit early instead of waiting another full window. */
export const BATCH_MAX_PHOTOS = 10;

/** Resolved target for a committed batch. Three shapes:
 *  - `task`: an experiment with a per-tab sub-bucket (Lab Notes vs Results,
 *    both write into the matching `Images/` subdir under that tab's folder).
 *  - `note`: a meeting-style Note. No sub-tabs — a note is a single attach
 *    point. Images land at `users/<owner>/notes/<id>/Images/...` and a
 *    markdown link is appended to the note's latest entry.
 *  - `inbox`: the user's inbox. No sub-tabs; `Images/` lives at the inbox
 *    root. */
export type BatchDestination =
  | {
      kind: "task";
      taskId: number;
      owner: string;
      name: string;
      subTab: "notes" | "results";
    }
  | {
      kind: "note";
      noteId: number;
      owner: string;
      title: string;
    }
  | { kind: "inbox" };

export interface BatchPhoto {
  /** Telegram message id of the photo (used for sidecar metadata). */
  messageId: number;
  /** Telegram-side send timestamp (epoch seconds). */
  date: number;
  /** Optional Telegram caption attached to the photo. */
  caption: string | null;
  /** Pre-downloaded image bytes. */
  blob: Blob;
  /** Filename stem hint from the source (e.g. "photo" for inline
   *  uploads, the original name for documents). */
  suggestedStem: string;
  /** File extension without the dot, lowercased. */
  suggestedExt: string;
  /** Telegram file_id of the largest photo size (or the document's
   *  file_id for image-documents). Re-used by `sendPhoto` so the
   *  per-photo-captions flow can resend each image alongside its
   *  prompt without re-uploading bytes. */
  fileId: string;
}

export interface BatchRouteContext {
  username: string;
  botToken: string;
  chatId: number;
}

type BatchState =
  | {
      kind: "buffering";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      photos: BatchPhoto[];
      activeTaskSnapshot: ActiveTask | null;
      activeNoteSnapshot: ActiveNote | null;
      timerId: ReturnType<typeof setTimeout>;
    }
  | {
      kind: "awaiting-active-confirmation";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      photos: BatchPhoto[];
      activeTask: ActiveTask;
    }
  | {
      /** Both an experiment popup AND a note popup were open at first-photo
       *  time. Prompt lets the user pick which surface (or escape to the
       *  full picker). */
      kind: "awaiting-active-disambiguation";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      photos: BatchPhoto[];
      activeTask: ActiveTask;
      activeNote: ActiveNote;
    }
  | {
      /** Only a note popup was open at first-photo time. Single-question
       *  prompt: attach to this note, or escape to the full picker. */
      kind: "awaiting-note-confirmation";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      photos: BatchPhoto[];
      activeNote: ActiveNote;
    }
  | {
      kind: "awaiting-destination";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      photos: BatchPhoto[];
    }
  | {
      kind: "awaiting-subtab";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      photos: BatchPhoto[];
      /** Task the user picked. We hold id/owner/name here so the sub-tab
       *  click can graduate directly to `awaiting-style` without
       *  re-reading the experiments list. */
      task: { id: number; owner: string; name: string };
    }
  | {
      /** Multi-entry note destination committed; ask the user WHICH entry
       *  the photo should attach to before falling through to style. Single-
       *  entry and empty notes skip this state and graduate directly to
       *  `awaiting-style` from the note callback handler. */
      kind: "awaiting-entry-pick";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      photos: BatchPhoto[];
      destination: BatchDestination & { kind: "note" };
      /** Sorted entry summaries the keyboard built buttons for. Indexed in
       *  PICKER_LETTERS order (A → entries[0], B → entries[1], ...). The
       *  callback handler decodes by index, not raw id, so the payload stays
       *  short (entry ids are UUIDs and a Telegram callback_data is capped
       *  at 64 bytes). */
      entries: { id: string; title: string; date: string }[];
    }
  | {
      kind: "awaiting-style";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      photos: BatchPhoto[];
      destination: BatchDestination;
      /** Entry id resolved by `awaiting-entry-pick` for multi-entry note
       *  destinations. Threaded through to the commit functions so they
       *  pass it to `attachImageToNote` as the `entryId` override. */
      noteEntryId?: string;
    }
  | {
      kind: "awaiting-batch-name";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      photos: BatchPhoto[];
      destination: BatchDestination;
      /** Carried through from `awaiting-entry-pick` for multi-entry notes;
       *  passed to `attachImageToNote` as the `entryId` override. */
      noteEntryId?: string;
    }
  | {
      kind: "awaiting-per-photo-captions";
      chatId: number;
      mediaGroupId: string;
      ctx: BatchRouteContext;
      destination: BatchDestination;
      /** Already-saved photos awaiting captions. Each carries the disk
       *  location of the sidecar (so a caption reply can write through)
       *  and the original Telegram file_id (so the bot can resend the
       *  photo alongside its caption prompt — text-only "What is photo
       *  3?" is hard to disambiguate inside a 5+ photo album). */
      written: { basePath: string; filename: string; fileId: string }[];
      /** Number of captions still expected. We caption in order
       *  (written[written.length - currentRemaining]). */
      currentRemaining: number;
    };

/** chatId to current batch state. Module-scope is fine because only one
 *  tab runs the polling loop (cross-tab lock in `use-telegram-polling`). */
const batches = new Map<number, BatchState>();

/** Test-only escape hatch. Vitest reuses the module across tests; this
 *  clears all in-flight batches between tests. */
export function _resetBatchesForTests(): void {
  for (const state of batches.values()) {
    if (state.kind === "buffering") clearTimeout(state.timerId);
  }
  batches.clear();
}

/** Test-only inspector. */
export function _peekBatchForTests(chatId: number): BatchState | undefined {
  return batches.get(chatId);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function timestampStem(prefix: string): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}-${prefix}`;
}

function inboxBase(username: string): string {
  return `users/${username}/inbox`;
}

async function writeSidecar(
  basePath: string,
  filename: string,
  updates: Partial<ImageSidecar>
): Promise<void> {
  const path = sidecarPath(basePath, filename);
  const existing = (await fileService.readJson<ImageSidecar>(path)) ?? {};
  const merged: ImageSidecar = { ...existing, ...updates };
  await fileService.writeJson(path, merged);
}

/** Today as YYYY-MM-DD (local), matching the Task.start_date / end_date
 *  string format. */
function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Lazy task fetch surface. Held as a thunk so the test suite can swap
 *  it via `_setExperimentsLoaderForTests`. The default implementation
 *  uses the same `JsonStore<Task>("tasks")` as `local-api.ts`. */
let experimentsLoader: (username: string) => Promise<Task[]> = async (
  username: string
) => {
  const store = new JsonStore<Task>("tasks");
  return store.listAllForUser(username);
};

export function _setExperimentsLoaderForTests(
  loader: (username: string) => Promise<Task[]> | null
): void {
  experimentsLoader = async (u: string) => (await loader(u)) ?? [];
}
export function _resetExperimentsLoaderForTests(): void {
  experimentsLoader = async (username: string) => {
    const store = new JsonStore<Task>("tasks");
    return store.listAllForUser(username);
  };
}

/** Lazy project fetch surface. Buttons include the project folder name
 *  in their single-line label, so the picker resolves project_id → name
 *  once per build. Swappable for tests via `_setProjectsLoaderForTests`. */
let projectsLoader: (username: string) => Promise<Project[]> = async (
  username: string
) => {
  const store = new JsonStore<Project>("projects");
  return store.listAllForUser(username);
};

export function _setProjectsLoaderForTests(
  loader: (username: string) => Promise<Project[]> | null
): void {
  projectsLoader = async (u: string) => (await loader(u)) ?? [];
}
export function _resetProjectsLoaderForTests(): void {
  projectsLoader = async (username: string) => {
    const store = new JsonStore<Project>("projects");
    return store.listAllForUser(username);
  };
}

/** Lazy notes fetch surface. The full picker shows the user's notes
 *  alongside the experiments section so a "attach to a note" path exists
 *  even when no note popup is open. Swappable for tests via
 *  `_setNotesLoaderForTests`. */
let notesLoader: (username: string) => Promise<Note[]> = async (
  username: string
) => {
  const store = new JsonStore<Note>("notes");
  return store.listAllForUser(username);
};

export function _setNotesLoaderForTests(
  loader: (username: string) => Promise<Note[]> | null
): void {
  notesLoader = async (u: string) => (await loader(u)) ?? [];
}
export function _resetNotesLoaderForTests(): void {
  notesLoader = async (username: string) => {
    const store = new JsonStore<Note>("notes");
    return store.listAllForUser(username);
  };
}

/** True when the task's `results.md` exists AND has user content beyond
 *  the stamp / header scaffolding. Used by the picker to hide
 *  experiments that already have results written so the user is nudged
 *  toward the not-yet-documented ones.
 *
 *  Stamp-only detection delegates to `hasUserContent` in stamp-utils,
 *  which strips every supported stamp format + the auto-generated
 *  "# Results: …" header before deciding. */
async function hasMeaningfulResults(
  task: Pick<Task, "id" | "owner">
): Promise<boolean> {
  const path = `${taskResultsBase(task)}/results.md`;
  if (!(await fileService.fileExists(path))) return false;
  const blob = await fileService.readFileAsBlob(path);
  if (!blob) return false;
  let text: string;
  try {
    text = await blob.text();
  } catch {
    return false;
  }
  return hasUserContent(text);
}

/** Format an ISO date (YYYY-MM-DD) as a short "MMM D" string (e.g.
 *  "Apr 1", "May 15"). Parses the local-date triple directly so a
 *  negative-UTC-offset runner doesn't shift the day. Returns the raw
 *  input if it can't be parsed. */
function formatDateShort(iso: string): string {
  if (!iso) return iso;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const d = ymd
    ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))
    : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Letters used to tag picker options (A, B, C, ...). Capped at 26;
 *  the picker is bounded at 11 entries (5 doing + 5 without-results +
 *  active-confirmation reuses A/B/C only), so single letters always
 *  suffice in practice. */
export const PICKER_LETTERS = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K",
  "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V",
  "W", "X", "Y", "Z",
] as const;

/** Inbox is a non-letter selector. Emoji-only is the cleanest tap
 *  target on Telegram (visually distinct from the lettered options)
 *  and matches the screenshot Grant designed against. */
export const INBOX_LABEL = "📥";

/** Number of short-letter buttons per inline-keyboard row. iOS Telegram
 *  still gives each button a comfortable tap target up to ~6 wide for
 *  single-letter labels; 5 leaves a margin for accidental thumbs. */
const BUTTONS_PER_ROW = 5;

/** Build the indented "context" line under a lettered body option:
 *  `<project> · <MMM D → MMM D>`. Falls back to "(no project)" when
 *  the project folder is empty. */
function buildBodyContextLine(
  task: Pick<Task, "start_date" | "end_date">,
  projectFolder: string,
): string {
  const project = projectFolder || "(no project)";
  const dates = `${formatDateShort(task.start_date)} → ${formatDateShort(task.end_date)}`;
  return `${project} · ${dates}`;
}

/** Build a 2-line body block for a lettered option:
 *
 *      A) Inoculate the A. nidulans into shaker flasks
 *         Fungal Bacterial Co-Culturing · May 15 → May 22
 *
 *  iOS Telegram wraps body text naturally, so long task / project
 *  names spread across lines without ellipsis. */
export function buildBodyOptionLine(
  letter: string,
  title: string,
  task: Pick<Task, "start_date" | "end_date">,
  projectFolder: string,
): string {
  return `${letter}) ${title}\n   ${buildBodyContextLine(task, projectFolder)}`;
}

/** Wrap a list of single-letter (or emoji) button selectors into rows
 *  of at most `BUTTONS_PER_ROW`. */
function chunkLetterButtons(
  selectors: { text: string; callback_data: string }[],
): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < selectors.length; i += BUTTONS_PER_ROW) {
    rows.push(selectors.slice(i, i + BUTTONS_PER_ROW));
  }
  return rows;
}

/** Lookup map from `project_id` → project name for a single owner's
 *  projects. Returns "" for any missing id so the label builder can
 *  fall back to "(no project)". */
async function loadProjectNameLookup(
  username: string
): Promise<Map<number, string>> {
  let projects: Project[];
  try {
    projects = await projectsLoader(username);
  } catch {
    projects = [];
  }
  const map = new Map<number, string>();
  for (const p of projects) map.set(p.id, p.name);
  return map;
}

/** Slice an experiment list into the two picker sections — doing-now vs
 *  experiments without results yet — applying today's date and the
 *  results.md content check. Each section is capped at `MAX_PER_SECTION`
 *  rows; overflow is silently dropped (most-recent-by-end-date wins).
 *
 *  Caller wraps with Inbox + (optionally) the active task confirmation
 *  rows. */
export const PICKER_MAX_PER_SECTION = 5;

/** Cap on the picker's Notes section. Notes are flatter than experiments
 *  (no doing-now / no-results split), so a single "most-recent N" slice is
 *  enough; the most-recent-by-updated-at ordering matches the way notes
 *  surface elsewhere in the app. */
export const PICKER_NOTES_CAP = 4;

export async function partitionPickerExperiments(
  experiments: Task[]
): Promise<{ doing: Task[]; withoutResults: Task[] }> {
  const today = todayLocalDate();
  const incomplete = experiments.filter(
    (t) => t.task_type === "experiment" && !t.is_complete
  );
  const doingAll = incomplete
    .filter((t) => t.start_date <= today && t.end_date >= today)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  const doing = doingAll.slice(0, PICKER_MAX_PER_SECTION);

  // Experiments outside the doing-window that haven't had results
  // written yet. We check on-disk results.md content; a stamp-only file
  // counts as "no results yet" because it was auto-generated when the
  // task was created.
  const otherCandidates = incomplete.filter(
    (t) => !(t.start_date <= today && t.end_date >= today)
  );
  const withResultsFlags = await Promise.all(
    otherCandidates.map(async (t) => ({
      task: t,
      hasResults: await hasMeaningfulResults(t),
    }))
  );
  const withoutResults = withResultsFlags
    .filter((x) => !x.hasResults)
    .map((x) => x.task)
    .sort((a, b) => b.end_date.localeCompare(a.end_date))
    .slice(0, PICKER_MAX_PER_SECTION);

  return { doing, withoutResults };
}

/** Slice the user's note list to the most-recent N for the picker's Notes
 *  section. Sort by `updated_at` descending; ties broken by id descending
 *  (newest id first) so the result is deterministic for tests. */
export function partitionPickerNotes(notes: Note[]): Note[] {
  const sorted = [...notes].sort((a, b) => {
    const cmp = (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
    if (cmp !== 0) return cmp;
    return b.id - a.id;
  });
  return sorted.slice(0, PICKER_NOTES_CAP);
}

/** Build the active-task confirmation prompt — lettered body-list plus
 *  short-letter button keyboard. Shown first when an experiment popup
 *  is open in ResearchOS at routing time; gives the user a one-tap
 *  path to "this active task, Lab Notes" or "this active task,
 *  Results" while still allowing a switch to the full task picker via
 *  "Pick another".
 *
 *  iOS Telegram clips button text past ~12 chars even when single-line;
 *  the predecessor (`143ca77f`) packed `<icon> <title> <suffix> · <project>
 *  · <dates>` into the button and Grant's phone showed two ellipses
 *  ("▶ Inoculate the A. nidulans ... · May 15 → M..."). The fix:
 *  buttons carry only the letter selector, the body carries the
 *  human-readable context. Body wraps naturally; never truncated. */
function buildActiveConfirmationPrompt(
  activeTask: ActiveTask,
  projectName: string,
  task: Pick<Task, "start_date" | "end_date"> | null,
): { body: string; keyboard: InlineKeyboardMarkup } {
  const datesPresent = !!(task?.start_date && task?.end_date);
  const contextLine = datesPresent
    ? `   ${buildBodyContextLine(
        { start_date: task!.start_date, end_date: task!.end_date },
        projectName,
      )}\n`
    : "";
  const body =
    `A) ${activeTask.name} — Lab Notes\n${contextLine}\n` +
    `B) ${activeTask.name} — Results\n${contextLine}\n` +
    `C) Pick another experiment`;
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        {
          text: "A",
          callback_data: encodeTabCallback(activeTask.id, activeTask.owner, "notes"),
        },
        {
          text: "B",
          callback_data: encodeTabCallback(activeTask.id, activeTask.owner, "results"),
        },
        { text: "C", callback_data: "pick-other" },
      ],
    ],
  };
  return { body, keyboard };
}

/** Build the full picker prompt — lettered body-list plus short-letter
 *  button keyboard. Three sections (Experiments-Active, Experiments-No-
 *  results-yet, Notes) plus Inbox. Each experiment gets TWO letters
 *  (Lab Notes + Results) so the user lands on the final destination in
 *  one tap; the previous flow had a separate sub-tab keyboard. Notes get
 *  ONE letter each (no sub-tab — a note is a single attach point).
 *
 *  Empty sections are omitted entirely (no header, no rows). The Inbox
 *  selector is always rendered with the `📥` emoji-only button to keep it
 *  visually distinct from the lettered options.
 *
 *  Layout: each section's header sits directly above its options (no
 *  blank line between header and first option); options within a section
 *  pack tight; sections are separated by a single blank line; the Inbox
 *  row gets a final blank line gap. The `——— <label> ———` headers act as
 *  a visible horizontal rule plus section name in one glyph — no separate
 *  divider needed. */
function buildDestinationPrompt(
  doing: Task[],
  withoutResults: Task[],
  notes: Note[],
  projectNames: Map<number, string>,
): { body: string; keyboard: InlineKeyboardMarkup } {
  const sections: string[] = [];
  const selectors: { text: string; callback_data: string }[] = [];
  let letterIdx = 0;

  // Helper: per-experiment 2-line block + 2 letter buttons (Lab Notes,
  // Results). The body line carries the human-readable task name and
  // dates; the keyboard carries only the single-letter selectors. iOS
  // Telegram clips button text past ~12 chars, so we keep the buttons
  // letter-only and let the body wrap naturally.
  const pushExperiment = (lines: string[], t: Task) => {
    const project = projectNames.get(t.project_id) ?? "";
    const notesLetter = PICKER_LETTERS[letterIdx++];
    lines.push(
      buildBodyOptionLine(notesLetter, `${t.name} — Lab Notes`, t, project),
    );
    selectors.push({
      text: notesLetter,
      callback_data: encodeTabCallback(t.id, t.owner, "notes"),
    });
    const resultsLetter = PICKER_LETTERS[letterIdx++];
    lines.push(
      buildBodyOptionLine(resultsLetter, `${t.name} — Results`, t, project),
    );
    selectors.push({
      text: resultsLetter,
      callback_data: encodeTabCallback(t.id, t.owner, "results"),
    });
  };

  if (doing.length > 0) {
    const lines: string[] = ["——— Active ———"];
    for (const t of doing) pushExperiment(lines, t);
    sections.push(lines.join("\n"));
  }

  if (withoutResults.length > 0) {
    const lines: string[] = ["——— No results yet ———"];
    for (const t of withoutResults) pushExperiment(lines, t);
    sections.push(lines.join("\n"));
  }

  if (notes.length > 0) {
    const lines: string[] = ["——— Notes ———"];
    for (const n of notes) {
      const letter = PICKER_LETTERS[letterIdx++];
      lines.push(`${letter}) ${n.title}`);
      selectors.push({
        text: letter,
        callback_data: encodeNoteCallback(n.id, n.username),
      });
    }
    sections.push(lines.join("\n"));
  }

  sections.push(`${INBOX_LABEL}) Save to Inbox`);
  const inlineKeyboard = chunkLetterButtons(selectors);
  inlineKeyboard.push([{ text: INBOX_LABEL, callback_data: "inbox" }]);

  return {
    body: sections.join("\n\n"),
    keyboard: { inline_keyboard: inlineKeyboard },
  };
}

/** Both-active disambiguation prompt: experiment popup AND note popup
 *  were open at first-photo time. Three rows: A picks the experiment
 *  (follow-up sub-tab pick), B picks the note (commits directly to
 *  style), C escapes to the full picker. */
function buildActiveDisambiguationPrompt(
  activeTask: ActiveTask,
  activeNote: ActiveNote,
): { body: string; keyboard: InlineKeyboardMarkup } {
  const body =
    "You have both open in ResearchOS. Attach to which one?\n\n" +
    `A) ${activeTask.name} (experiment)\n` +
    `B) ${activeNote.title} (note)\n` +
    `C) Pick another experiment or note`;
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        { text: "A", callback_data: encodeTaskCallback(activeTask.id, activeTask.owner) },
        { text: "B", callback_data: encodeNoteCallback(activeNote.id, activeNote.owner) },
        { text: "C", callback_data: "pick-other" },
      ],
    ],
  };
  return { body, keyboard };
}

/** Active-note-only confirmation prompt: only a note popup was open at
 *  first-photo time. Two rows: A attaches to the open note, B escapes to
 *  the full picker. */
function buildActiveNoteConfirmationPrompt(
  activeNote: ActiveNote,
): { body: string; keyboard: InlineKeyboardMarkup } {
  const body =
    `You have "${activeNote.title}" open in ResearchOS. Attach there?\n\n` +
    `A) Attach to ${activeNote.title}\n` +
    `B) Pick a different note or experiment`;
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        {
          text: "A",
          callback_data: encodeNoteCallback(activeNote.id, activeNote.owner),
        },
        { text: "B", callback_data: "pick-other" },
      ],
    ],
  };
  return { body, keyboard };
}

/** Build the entry-pick prompt for multi-entry note destinations. Letter
 *  buttons for each entry plus a trailing "Latest entry" default so a user
 *  who doesn't care can one-tap past the question. Bounded at 10 entries
 *  in the body / keyboard (PICKER_LETTERS reaches Z but we cap the prompt
 *  to keep the message readable on Telegram); the "Latest" sentinel always
 *  resolves to the most-recent-by-updated_at entry inside
 *  `attachImageToNote`, so it covers the no-pick case for longer notes too. */
function buildEntryPickPrompt(
  noteTitle: string,
  entries: { id: string; title: string; date: string }[],
): {
  body: string;
  keyboard: InlineKeyboardMarkup;
  shownEntries: { id: string; title: string; date: string }[];
} {
  // Bound to the first 10 so the keyboard stays one column of reasonable
  // height. The "Latest entry" button below covers anything past the cap.
  const shown = entries.slice(0, 10);
  const lines: string[] = [
    `"${noteTitle}" has ${entries.length} entries. Which one should this image go to?`,
    "",
  ];
  shown.forEach((e, i) => {
    const date = formatDateShort(e.date);
    lines.push(`${PICKER_LETTERS[i]}) ${date} — ${e.title}`);
  });
  // The trailing letter for the "Latest" button is one past the last
  // shown entry. We label it as a word for clarity ("Latest entry") rather
  // than a letter — it's a semantic shortcut, not a list position.
  lines.push(`Latest) Latest entry (default)`);
  const buttons: { text: string; callback_data: string }[][] = [];
  // One button per row; Telegram on iOS clips multi-button rows hard when
  // labels include dates + titles. Single column keeps tap targets large.
  shown.forEach((_, i) => {
    buttons.push([
      {
        text: PICKER_LETTERS[i],
        callback_data: encodeEntryPickCallback(i),
      },
    ]);
  });
  buttons.push([
    {
      text: "Latest entry",
      callback_data: encodeEntryLatestCallback(),
    },
  ]);
  return {
    body: lines.join("\n"),
    keyboard: { inline_keyboard: buttons },
    shownEntries: shown,
  };
}

/** Build the sub-tab picker keyboard. Shown after the user picks a task
 *  from the full picker. Plain two-row "Lab Notes" / "Results"; we drop
 *  the rich context here since the user just selected the task. */
function buildSubTabKeyboard(
  task: { id: number; owner: string; name: string }
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: "📝 Lab Notes",
          callback_data: encodeSubTabCallback(task.id, task.owner, "notes"),
        },
      ],
      [
        {
          text: "📊 Results",
          callback_data: encodeSubTabCallback(task.id, task.owner, "results"),
        },
      ],
    ],
  };
}

function buildStyleKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "Batch name + auto-number", callback_data: "style:auto" }],
      [{ text: "Name each individually", callback_data: "style:each" }],
    ],
  };
}

/** Encode the chosen task into the 64-byte `callback_data` slot. Telegram
 *  enforces the 64-byte cap; we keep the encoding minimal (`task:<id>:<owner>`)
 *  so usernames up to ~50 chars fit alongside a numeric id. */
function encodeTaskCallback(taskId: number, owner: string): string {
  return `task:${taskId}:${owner}`;
}

/** Encode a chosen note. Same shape as `task:` but with a distinct prefix so
 *  the callback dispatcher can route it to the note-attach commit path. */
function encodeNoteCallback(noteId: number, owner: string): string {
  return `note:${noteId}:${owner}`;
}

/** Active-task confirmation row encoder. Format: `tab:<id>:<owner>:<subTab>`.
 *  Distinct prefix from `task:` so the callback router can dispatch with a
 *  simple prefix check. */
function encodeTabCallback(
  taskId: number,
  owner: string,
  subTab: "notes" | "results"
): string {
  return `tab:${taskId}:${owner}:${subTab}`;
}

/** Sub-tab pick (after the user picked a task from the full picker).
 *  Format: `subtab:<id>:<owner>:<subTab>`. */
function encodeSubTabCallback(
  taskId: number,
  owner: string,
  subTab: "notes" | "results"
): string {
  return `subtab:${taskId}:${owner}:${subTab}`;
}

/** Entry-pick payload for multi-entry note destinations. Format:
 *  `entry:<index>` where `<index>` is the position of the entry in the
 *  state's `entries[]` array. We encode by index, not raw UUID, because
 *  Telegram callback_data is capped at 64 bytes and a single UUID nearly
 *  fills that. The state holds the id→index mapping, so the resolution
 *  is local. A sentinel `entry:latest` covers the "Latest entry" default
 *  button. */
function encodeEntryPickCallback(index: number): string {
  return `entry:${index}`;
}
function encodeEntryLatestCallback(): string {
  return `entry:latest`;
}

/** Decode a callback from the task-picker row. Returns the bare task ref
 *  (no sub-tab yet — the user hasn't picked one). */
function decodeTaskCallback(
  data: string,
  experiments: Task[]
): { id: number; owner: string; name: string } | null {
  if (!data.startsWith("task:")) return null;
  const rest = data.slice("task:".length);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  const idStr = rest.slice(0, sep);
  const owner = rest.slice(sep + 1);
  const taskId = Number.parseInt(idStr, 10);
  if (!Number.isFinite(taskId) || !owner) return null;
  const match = experiments.find((t) => t.id === taskId && t.owner === owner);
  return {
    id: taskId,
    owner,
    name: match?.name ?? `Experiment ${taskId}`,
  };
}

/** Decode a `note:<id>:<owner>` payload from the picker / confirmation
 *  prompts. The notes list is passed in so we can recover the title for
 *  the bot's "Saved to <note>" reply; missing matches fall back to a
 *  generic name. */
function decodeNoteCallback(
  data: string,
  notes: Note[],
): { id: number; owner: string; title: string } | null {
  if (!data.startsWith("note:")) return null;
  const rest = data.slice("note:".length);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  const idStr = rest.slice(0, sep);
  const owner = rest.slice(sep + 1);
  const noteId = Number.parseInt(idStr, 10);
  if (!Number.isFinite(noteId) || !owner) return null;
  const match = notes.find((n) => n.id === noteId && n.username === owner);
  return {
    id: noteId,
    owner,
    title: match?.title ?? `Note ${noteId}`,
  };
}

/** Decode a `tab:` or `subtab:` payload — both encode an experiment id +
 *  owner + sub-tab choice. Returns the parts plus the `kind` of click so
 *  the callback dispatcher knows which state it landed in. */
function decodeSubTabPayload(
  data: string
): {
  kind: "tab" | "subtab";
  taskId: number;
  owner: string;
  subTab: "notes" | "results";
} | null {
  let kind: "tab" | "subtab";
  let rest: string;
  if (data.startsWith("subtab:")) {
    kind = "subtab";
    rest = data.slice("subtab:".length);
  } else if (data.startsWith("tab:")) {
    kind = "tab";
    rest = data.slice("tab:".length);
  } else {
    return null;
  }
  const parts = rest.split(":");
  if (parts.length < 3) return null;
  const idStr = parts[0];
  // owner may contain extra `:` if usernames ever allowed colons; rejoin
  // the middle parts back into the owner, treating the last segment as
  // the subTab tag. In practice usernames don't contain colons, but the
  // rejoin is defensive.
  const subTabTag = parts[parts.length - 1];
  const owner = parts.slice(1, -1).join(":");
  const taskId = Number.parseInt(idStr, 10);
  if (!Number.isFinite(taskId) || !owner) return null;
  if (subTabTag !== "notes" && subTabTag !== "results") return null;
  return { kind, taskId, owner, subTab: subTabTag };
}

/** Lightweight filename sanitizer for user-typed batch names. Filesystem
 *  safety + a hyphen + a number suffix is all we need; full path-traversal
 *  defense isn't load-bearing here because the file-service write API
 *  scopes to the user's folder. */
function sanitizeBatchName(raw: string): string {
  const trimmed = raw.trim().replace(/[\\/]/g, "-").replace(/\s+/g, " ");
  if (!trimmed) return "batch";
  // Keep alphanumerics, spaces, hyphens, underscores, dots.
  return trimmed.replace(/[^\w \-.]/g, "_").slice(0, 60);
}

function clearBatch(chatId: number): void {
  const existing = batches.get(chatId);
  if (!existing) return;
  if (existing.kind === "buffering") clearTimeout(existing.timerId);
  batches.delete(chatId);
}

/** Send a brief notice that we dropped a previous in-flight batch. Best-
 *  effort: a failed send shouldn't block the new batch from starting. */
async function noticeReplaced(ctx: BatchRouteContext): Promise<void> {
  try {
    await sendMessage(
      ctx.botToken,
      ctx.chatId,
      "New album received — restarting batch flow."
    );
  } catch {
    /* swallow */
  }
}

/** Entry point: a photo with media_group_id has arrived and image-router
 *  has already downloaded the blob + read the source metadata. We either
 *  start a new batch buffer or append to an existing one for the same
 *  album.
 *
 *  Both `activeTask` and `activeNote` are snapshotted at the FIRST photo of
 *  a batch. Either / both / neither can be set; the commit phase
 *  disambiguates with the appropriate prompt shape. */
export async function routeBatchablePhoto(
  mediaGroupId: string,
  photo: BatchPhoto,
  ctx: BatchRouteContext,
  activeTask: ActiveTask | null,
  activeNote: ActiveNote | null = null,
): Promise<void> {
  const existing = batches.get(ctx.chatId);

  if (existing && existing.kind === "buffering" && existing.mediaGroupId === mediaGroupId) {
    // Same album, still buffering: append and reset the debounce timer.
    existing.photos.push(photo);
    clearTimeout(existing.timerId);
    if (existing.photos.length >= BATCH_MAX_PHOTOS) {
      // Commit immediately on cap.
      void commitBuffer(ctx.chatId);
    } else {
      existing.timerId = setTimeout(() => {
        void commitBuffer(ctx.chatId);
      }, BATCH_WINDOW_MS);
    }
    return;
  }

  if (existing && (existing.kind !== "buffering" || existing.mediaGroupId !== mediaGroupId)) {
    // Different album OR same album that already committed past
    // buffering: this is a new batch arriving mid-flow. Drop the prior
    // state with a brief notice so the user knows their previous
    // pending input was swallowed.
    clearBatch(ctx.chatId);
    await noticeReplaced(ctx);
  }

  // New batch.
  const timerId = setTimeout(() => {
    void commitBuffer(ctx.chatId);
  }, BATCH_WINDOW_MS);
  batches.set(ctx.chatId, {
    kind: "buffering",
    chatId: ctx.chatId,
    mediaGroupId,
    ctx,
    photos: [photo],
    activeTaskSnapshot: activeTask,
    activeNoteSnapshot: activeNote,
    timerId,
  });
}

/** Single-photo entry point: a non-album photo arrived. The redesign
 *  (ASK ALWAYS) routes it through the same state machine as an album
 *  batch — just a "batch of one". We bypass buffering (no debounce; no
 *  album to wait for) and jump straight to the active-task confirmation
 *  or full picker prompt.
 *
 *  Synthetic mediaGroupId `single:<messageId>` keeps the state record
 *  shape consistent with album batches while remaining distinct from
 *  any real Telegram media_group_id (those are numeric strings). */
export async function routeSinglePhotoThroughBatch(
  photo: BatchPhoto,
  ctx: BatchRouteContext,
  activeTask: ActiveTask | null,
  activeNote: ActiveNote | null = null,
): Promise<void> {
  // Mirror routeBatchablePhoto's "new batch cancels old" behavior so a
  // fresh single photo arriving mid-flow doesn't leave stale state.
  const existing = batches.get(ctx.chatId);
  if (existing) {
    clearBatch(ctx.chatId);
    await noticeReplaced(ctx);
  }
  const mediaGroupId = `single:${photo.messageId}`;
  // Park in `buffering` so commitBuffer can run the same prompt logic
  // as the album path. The timer is a no-op (immediately superseded);
  // we kick commitBuffer right after the state is set.
  const timerId = setTimeout(() => {
    /* no-op — commitBuffer fires directly below */
  }, 0);
  batches.set(ctx.chatId, {
    kind: "buffering",
    chatId: ctx.chatId,
    mediaGroupId,
    ctx,
    photos: [photo],
    activeTaskSnapshot: activeTask,
    activeNoteSnapshot: activeNote,
    timerId,
  });
  await commitBuffer(ctx.chatId);
}

/** Buffer-window expired or photo cap hit. Branch on which surface(s) were
 *  open at first-photo time:
 *
 *    - both task AND note  → awaiting-active-disambiguation (A/B/C)
 *    - only task           → awaiting-active-confirmation (existing flow)
 *    - only note           → awaiting-note-confirmation (new short prompt)
 *    - neither             → awaiting-destination (full picker)
 *
 *  Either way, ASK first — no more silent auto-attach. */
async function commitBuffer(chatId: number): Promise<void> {
  const state = batches.get(chatId);
  if (!state || state.kind !== "buffering") return;
  clearTimeout(state.timerId);

  // activeTask + activeNote snapshots were taken at the FIRST photo. Any
  // change since doesn't affect this batch.
  if (state.activeTaskSnapshot && state.activeNoteSnapshot) {
    batches.set(chatId, {
      kind: "awaiting-active-disambiguation",
      chatId,
      mediaGroupId: state.mediaGroupId,
      ctx: state.ctx,
      photos: state.photos,
      activeTask: state.activeTaskSnapshot,
      activeNote: state.activeNoteSnapshot,
    });
    await sendActiveDisambiguationPrompt(
      state.ctx,
      state.photos.length,
      state.activeTaskSnapshot,
      state.activeNoteSnapshot,
    );
    return;
  }

  if (state.activeTaskSnapshot) {
    batches.set(chatId, {
      kind: "awaiting-active-confirmation",
      chatId,
      mediaGroupId: state.mediaGroupId,
      ctx: state.ctx,
      photos: state.photos,
      activeTask: state.activeTaskSnapshot,
    });
    await sendActiveConfirmationPrompt(
      state.ctx,
      state.photos.length,
      state.activeTaskSnapshot
    );
    return;
  }

  if (state.activeNoteSnapshot) {
    batches.set(chatId, {
      kind: "awaiting-note-confirmation",
      chatId,
      mediaGroupId: state.mediaGroupId,
      ctx: state.ctx,
      photos: state.photos,
      activeNote: state.activeNoteSnapshot,
    });
    await sendActiveNoteConfirmationPrompt(
      state.ctx,
      state.photos.length,
      state.activeNoteSnapshot,
    );
    return;
  }

  // Nothing active: send the full picker.
  batches.set(chatId, {
    kind: "awaiting-destination",
    chatId,
    mediaGroupId: state.mediaGroupId,
    ctx: state.ctx,
    photos: state.photos,
  });
  await sendDestinationPrompt(state.ctx, state.photos.length);
}

/** Send the first keyboard for the active-task-open case: confirm "this
 *  active task — Lab Notes / Results" or escape to the full picker. */
async function sendActiveConfirmationPrompt(
  ctx: BatchRouteContext,
  count: number,
  activeTask: ActiveTask
): Promise<void> {
  const projectNames = await loadProjectNameLookup(ctx.username);
  // Look up the Task record so the body's context line can show
  // start/end dates. Tolerant of failure: we degrade to a name-only
  // body when the task isn't in the experiments list.
  let experiments: Task[];
  try {
    experiments = await experimentsLoader(ctx.username);
  } catch {
    experiments = [];
  }
  const taskRecord = experiments.find(
    (t) => t.id === activeTask.id && t.owner === activeTask.owner
  );
  const projectName = taskRecord
    ? projectNames.get(taskRecord.project_id) ?? ""
    : "";
  const { body, keyboard } = buildActiveConfirmationPrompt(
    activeTask,
    projectName,
    taskRecord ?? null
  );
  const noun = count === 1 ? "photo" : `album of ${count} photos`;
  await sendMessage(
    ctx.botToken,
    ctx.chatId,
    `Got a ${noun}. Where should it go?\n\n${body}`,
    { reply_markup: keyboard }
  );
}

/** Send the full picker keyboard. Used both when no active surface is open
 *  at first-photo time AND when the user clicked "Pick another" from the
 *  active-confirmation / disambiguation / note-confirmation steps. */
async function sendDestinationPrompt(
  ctx: BatchRouteContext,
  count: number
): Promise<void> {
  let experiments: Task[];
  try {
    experiments = await experimentsLoader(ctx.username);
  } catch {
    experiments = [];
  }
  let notes: Note[];
  try {
    notes = await notesLoader(ctx.username);
  } catch {
    notes = [];
  }
  const projectNames = await loadProjectNameLookup(ctx.username);
  const { doing, withoutResults } = await partitionPickerExperiments(experiments);
  const pickedNotes = partitionPickerNotes(notes);
  const { body, keyboard } = buildDestinationPrompt(
    doing,
    withoutResults,
    pickedNotes,
    projectNames,
  );
  const noun = count === 1 ? "photo" : `album of ${count} photos`;
  await sendMessage(
    ctx.botToken,
    ctx.chatId,
    `Got a ${noun}. Where should it go?\n\n${body}`,
    { reply_markup: keyboard }
  );
}

/** Send the both-active disambiguation prompt: experiment popup AND note
 *  popup were both open at first-photo time. */
async function sendActiveDisambiguationPrompt(
  ctx: BatchRouteContext,
  count: number,
  activeTask: ActiveTask,
  activeNote: ActiveNote,
): Promise<void> {
  const { body, keyboard } = buildActiveDisambiguationPrompt(activeTask, activeNote);
  const noun = count === 1 ? "photo" : `album of ${count} photos`;
  await sendMessage(
    ctx.botToken,
    ctx.chatId,
    `Got a ${noun}. ${body}`,
    { reply_markup: keyboard },
  );
}

/** Send the active-note-only confirmation prompt: only a note popup was
 *  open at first-photo time. */
async function sendActiveNoteConfirmationPrompt(
  ctx: BatchRouteContext,
  count: number,
  activeNote: ActiveNote,
): Promise<void> {
  const { body, keyboard } = buildActiveNoteConfirmationPrompt(activeNote);
  const noun = count === 1 ? "photo" : `album of ${count} photos`;
  await sendMessage(
    ctx.botToken,
    ctx.chatId,
    `Got a ${noun}. ${body}`,
    { reply_markup: keyboard },
  );
}

/** Send the sub-tab picker after the user picked a task from the full
 *  picker. */
async function sendSubTabPrompt(
  ctx: BatchRouteContext,
  task: { id: number; owner: string; name: string }
): Promise<void> {
  await sendMessage(
    ctx.botToken,
    ctx.chatId,
    `"${task.name}" — Lab Notes or Results?`,
    { reply_markup: buildSubTabKeyboard(task) }
  );
}

async function sendStylePrompt(
  ctx: BatchRouteContext,
  count: number,
  destination: BatchDestination
): Promise<void> {
  let target: string;
  if (destination.kind === "task") {
    const tab = destination.subTab === "notes" ? "Lab Notes" : "Results";
    target = `"${destination.name}" (${tab})`;
  } else if (destination.kind === "note") {
    target = `note "${destination.title}"`;
  } else {
    target = "your Inbox";
  }
  const noun = count === 1 ? "Photo" : `${count} photos`;
  await sendMessage(
    ctx.botToken,
    ctx.chatId,
    `${noun} will go to ${target}. How should ${count === 1 ? "it be" : "they be"} named?`,
    { reply_markup: buildStyleKeyboard() }
  );
}

/** Public entry point: a callback_query landed in the polling loop. We
 *  acknowledge regardless of whether the click is still relevant
 *  (clicks on stale prompts get a soft "Album expired" ack so the
 *  client UI clears its spinner). */
export async function routeBatchCallbackQuery(
  cq: TelegramCallbackQuery,
  ctx: BatchRouteContext
): Promise<void> {
  // Defensive: the bot is only paired with one chat, but a stray
  // callback from a different chat (e.g. the bot was added to a group
  // before we cared to check) should be ignored so its state can't
  // collide with the paired chat's in-flight batch.
  const cqChatId = cq.message?.chat.id;
  if (cqChatId !== undefined && cqChatId !== ctx.chatId) return;
  if (!cq.data) {
    await answerCallbackQuery(ctx.botToken, cq.id);
    return;
  }
  const state = batches.get(ctx.chatId);

  // Tab-picker click (`tab:<id>:<owner>:<subTab>`) — commits subTab inline.
  // Valid from:
  //   - awaiting-active-confirmation: existing Case B quick-pick
  //   - awaiting-destination: new picker shape with per-experiment
  //     Lab Notes / Results buttons (collapses the old sub-tab step)
  if (cq.data.startsWith("tab:")) {
    if (
      !state ||
      (state.kind !== "awaiting-active-confirmation" &&
        state.kind !== "awaiting-destination")
    ) {
      await answerCallbackQuery(ctx.botToken, cq.id, {
        text: "Album expired.",
      });
      return;
    }
    const decoded = decodeSubTabPayload(cq.data);
    if (!decoded || decoded.kind !== "tab") {
      await answerCallbackQuery(ctx.botToken, cq.id, { text: "Bad payload." });
      return;
    }
    await answerCallbackQuery(ctx.botToken, cq.id);
    // Resolve the task name. For the active-confirmation case, the
    // snapshot is authoritative. For the picker case, look it up in the
    // experiments list so the bot's reply names the right experiment.
    let taskName: string;
    if (state.kind === "awaiting-active-confirmation") {
      taskName = state.activeTask.name;
    } else {
      let experiments: Task[];
      try {
        experiments = await experimentsLoader(ctx.username);
      } catch {
        experiments = [];
      }
      const match = experiments.find(
        (t) => t.id === decoded.taskId && t.owner === decoded.owner,
      );
      taskName = match?.name ?? `Experiment ${decoded.taskId}`;
    }
    const destination: BatchDestination = {
      kind: "task",
      taskId: decoded.taskId,
      owner: decoded.owner,
      name: taskName,
      subTab: decoded.subTab,
    };
    batches.set(ctx.chatId, {
      kind: "awaiting-style",
      chatId: ctx.chatId,
      mediaGroupId: state.mediaGroupId,
      ctx: state.ctx,
      photos: state.photos,
      destination,
    });
    await sendStylePrompt(state.ctx, state.photos.length, destination);
    return;
  }

  // "Pick another" escape hatch from the active-* confirmation states.
  // Valid from active-confirmation (task-only), active-disambiguation
  // (both), and note-confirmation (note-only). All three escape to the
  // full picker.
  if (cq.data === "pick-other") {
    if (
      !state ||
      (state.kind !== "awaiting-active-confirmation" &&
        state.kind !== "awaiting-active-disambiguation" &&
        state.kind !== "awaiting-note-confirmation")
    ) {
      await answerCallbackQuery(ctx.botToken, cq.id, {
        text: "Album expired.",
      });
      return;
    }
    await answerCallbackQuery(ctx.botToken, cq.id);
    batches.set(ctx.chatId, {
      kind: "awaiting-destination",
      chatId: ctx.chatId,
      mediaGroupId: state.mediaGroupId,
      ctx: state.ctx,
      photos: state.photos,
    });
    await sendDestinationPrompt(state.ctx, state.photos.length);
    return;
  }

  // Inbox click — short-circuits the sub-tab step (no per-tab folders).
  if (cq.data === "inbox") {
    if (!state || state.kind !== "awaiting-destination") {
      await answerCallbackQuery(ctx.botToken, cq.id, {
        text: "Album expired.",
      });
      return;
    }
    await answerCallbackQuery(ctx.botToken, cq.id);
    const destination: BatchDestination = { kind: "inbox" };
    batches.set(ctx.chatId, {
      kind: "awaiting-style",
      chatId: ctx.chatId,
      mediaGroupId: state.mediaGroupId,
      ctx: state.ctx,
      photos: state.photos,
      destination,
    });
    await sendStylePrompt(state.ctx, state.photos.length, destination);
    return;
  }

  // Note-pick click (`note:<id>:<owner>`) — commits directly to style.
  // Valid from active-disambiguation (B button), active-note-confirmation
  // (A button), and awaiting-destination (Notes section of the picker).
  if (cq.data.startsWith("note:")) {
    if (
      !state ||
      (state.kind !== "awaiting-active-disambiguation" &&
        state.kind !== "awaiting-note-confirmation" &&
        state.kind !== "awaiting-destination")
    ) {
      await answerCallbackQuery(ctx.botToken, cq.id, {
        text: "Album expired.",
      });
      return;
    }
    let notes: Note[];
    try {
      notes = await notesLoader(ctx.username);
    } catch {
      notes = [];
    }
    const decoded = decodeNoteCallback(cq.data, notes);
    if (!decoded) {
      await answerCallbackQuery(ctx.botToken, cq.id, { text: "Bad payload." });
      return;
    }
    await answerCallbackQuery(ctx.botToken, cq.id);
    // Prefer the active-note snapshot's title (authoritative for the
    // open popup) over a stale list lookup; for the picker case the list
    // is the only source of truth.
    let title = decoded.title;
    if (state.kind === "awaiting-active-disambiguation") {
      title = state.activeNote.title;
    } else if (state.kind === "awaiting-note-confirmation") {
      title = state.activeNote.title;
    }
    const destination: BatchDestination = {
      kind: "note",
      noteId: decoded.id,
      owner: decoded.owner,
      title,
    };
    // Multi-entry running-log notes ask the user WHICH entry to append to
    // before falling through to style. Single-entry notes (and notes with
    // zero entries — `attachImageToNote` auto-creates a "Photos" entry in
    // that branch) skip the picker entirely so the common case stays
    // one-shot. Sort entries newest-first so the "Latest" default and the
    // top of the lettered list are coherent.
    const note = notes.find((n) => n.id === decoded.id && n.username === decoded.owner);
    const sortedEntries = note
      ? [...note.entries].sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        )
      : [];
    if (sortedEntries.length > 1) {
      batches.set(ctx.chatId, {
        kind: "awaiting-entry-pick",
        chatId: ctx.chatId,
        mediaGroupId: state.mediaGroupId,
        ctx: state.ctx,
        photos: state.photos,
        destination,
        entries: sortedEntries.map((e) => ({
          id: e.id,
          title: e.title,
          date: e.date,
        })),
      });
      const { body, keyboard } = buildEntryPickPrompt(
        title,
        sortedEntries.map((e) => ({ id: e.id, title: e.title, date: e.date })),
      );
      await sendMessage(ctx.botToken, ctx.chatId, body, { reply_markup: keyboard });
      return;
    }
    batches.set(ctx.chatId, {
      kind: "awaiting-style",
      chatId: ctx.chatId,
      mediaGroupId: state.mediaGroupId,
      ctx: state.ctx,
      photos: state.photos,
      destination,
    });
    await sendStylePrompt(state.ctx, state.photos.length, destination);
    return;
  }

  // Entry-pick click (`entry:<index>` or `entry:latest`) — graduates to
  // style. Valid only from `awaiting-entry-pick`. The state holds the
  // entries[] array we built the keyboard against; decoding is a local
  // index lookup, not a re-fetch of the note (the note may have been
  // edited between the prompt and the click; we honor the prompt-time
  // choice rather than racing against live edits).
  if (cq.data.startsWith("entry:")) {
    if (!state || state.kind !== "awaiting-entry-pick") {
      await answerCallbackQuery(ctx.botToken, cq.id, {
        text: "Album expired.",
      });
      return;
    }
    await answerCallbackQuery(ctx.botToken, cq.id);
    const payload = cq.data.slice("entry:".length);
    let chosenEntryId: string | undefined;
    if (payload === "latest") {
      // Sentinel: leave `noteEntryId` undefined so `attachImageToNote`
      // falls through to its own "latest entry by updated_at" pick. This
      // way the resolution happens at commit time, not prompt time —
      // matters when the user added a new entry mid-flow.
      chosenEntryId = undefined;
    } else {
      const idx = Number.parseInt(payload, 10);
      if (!Number.isFinite(idx) || idx < 0 || idx >= state.entries.length) {
        await sendMessage(ctx.botToken, ctx.chatId, "Bad entry pick. Picking the latest entry.");
        chosenEntryId = undefined;
      } else {
        chosenEntryId = state.entries[idx].id;
      }
    }
    batches.set(ctx.chatId, {
      kind: "awaiting-style",
      chatId: ctx.chatId,
      mediaGroupId: state.mediaGroupId,
      ctx: state.ctx,
      photos: state.photos,
      destination: state.destination,
      noteEntryId: chosenEntryId,
    });
    await sendStylePrompt(state.ctx, state.photos.length, state.destination);
    return;
  }

  // Legacy `task:<id>:<owner>` click — graduates to the sub-tab picker.
  // The new picker no longer emits these (it emits `tab:` with the
  // subTab inline), but the disambiguation prompt's A button still does
  // for the both-active case (the user picked "this experiment" — the
  // sub-tab is the natural follow-up). Also retained for in-flight
  // states from a hot-reload prior to the redesign.
  if (cq.data.startsWith("task:")) {
    if (
      !state ||
      (state.kind !== "awaiting-destination" &&
        state.kind !== "awaiting-active-disambiguation")
    ) {
      await answerCallbackQuery(ctx.botToken, cq.id, {
        text: "Album expired.",
      });
      return;
    }
    let experiments: Task[];
    try {
      experiments = await experimentsLoader(ctx.username);
    } catch {
      experiments = [];
    }
    let task = decodeTaskCallback(cq.data, experiments);
    if (!task) {
      await answerCallbackQuery(ctx.botToken, cq.id, {
        text: "Bad destination.",
      });
      return;
    }
    // Disambig case: the active-task snapshot is the authoritative name.
    if (state.kind === "awaiting-active-disambiguation") {
      task = {
        id: state.activeTask.id,
        owner: state.activeTask.owner,
        name: state.activeTask.name,
      };
    }
    await answerCallbackQuery(ctx.botToken, cq.id);
    batches.set(ctx.chatId, {
      kind: "awaiting-subtab",
      chatId: ctx.chatId,
      mediaGroupId: state.mediaGroupId,
      ctx: state.ctx,
      photos: state.photos,
      task,
    });
    await sendSubTabPrompt(state.ctx, task);
    return;
  }

  // Sub-tab click (`subtab:<id>:<owner>:<subTab>`).
  if (cq.data.startsWith("subtab:")) {
    if (!state || state.kind !== "awaiting-subtab") {
      await answerCallbackQuery(ctx.botToken, cq.id, {
        text: "Album expired.",
      });
      return;
    }
    const decoded = decodeSubTabPayload(cq.data);
    if (!decoded || decoded.kind !== "subtab") {
      await answerCallbackQuery(ctx.botToken, cq.id, { text: "Bad payload." });
      return;
    }
    await answerCallbackQuery(ctx.botToken, cq.id);
    const destination: BatchDestination = {
      kind: "task",
      taskId: decoded.taskId,
      owner: decoded.owner,
      name: state.task.name,
      subTab: decoded.subTab,
    };
    batches.set(ctx.chatId, {
      kind: "awaiting-style",
      chatId: ctx.chatId,
      mediaGroupId: state.mediaGroupId,
      ctx: state.ctx,
      photos: state.photos,
      destination,
    });
    await sendStylePrompt(state.ctx, state.photos.length, destination);
    return;
  }

  // Style click.
  if (cq.data === "style:auto" || cq.data === "style:each") {
    if (!state || state.kind !== "awaiting-style") {
      await answerCallbackQuery(ctx.botToken, cq.id, {
        text: "Album expired.",
      });
      return;
    }
    await answerCallbackQuery(ctx.botToken, cq.id);
    if (cq.data === "style:auto") {
      batches.set(ctx.chatId, {
        kind: "awaiting-batch-name",
        chatId: ctx.chatId,
        mediaGroupId: state.mediaGroupId,
        ctx: state.ctx,
        photos: state.photos,
        destination: state.destination,
        noteEntryId: state.noteEntryId,
      });
      const namePrompt =
        state.photos.length === 1
          ? "Reply with a name for the photo."
          : `Reply with a batch name. I'll save photos as <name>-1 through <name>-${state.photos.length}.`;
      await sendMessage(ctx.botToken, ctx.chatId, namePrompt);
      return;
    }
    // style:each — write all photos up front with timestamp names,
    // then ask captions one at a time.
    await commitIndividualStyle(state);
    return;
  }

  // Unknown payload — acknowledge to clear the spinner.
  await answerCallbackQuery(ctx.botToken, cq.id);
}

/** Write all photos to disk with timestamp-based names (no user
 *  caption yet); transition to per-photo-caption mode and prompt for
 *  the first one by resending the photo with the prompt as its caption
 *  (so the user sees which image is being asked about). */
async function commitIndividualStyle(state: BatchState & { kind: "awaiting-style" }): Promise<void> {
  const written: { basePath: string; filename: string; fileId: string }[] = [];
  for (const photo of state.photos) {
    const desired = `${timestampStem(stemPrefixFor(state.destination, photo.suggestedStem))}.${photo.suggestedExt}`;
    const { basePath, finalFilename } = await attachOnePhoto(
      state.destination,
      photo,
      desired,
      photo.caption ?? "",
      state.ctx,
      state.noteEntryId,
    );
    await writeSidecar(basePath, finalFilename, {
      caption: photo.caption ?? undefined,
      source: "telegram",
      receivedAt: new Date(photo.date * 1000).toISOString(),
      telegramMessageId: photo.messageId,
      telegramChatId: state.ctx.chatId,
    });
    written.push({
      basePath,
      filename: finalFilename,
      fileId: photo.fileId,
    });
  }
  batches.set(state.ctx.chatId, {
    kind: "awaiting-per-photo-captions",
    chatId: state.ctx.chatId,
    mediaGroupId: state.mediaGroupId,
    ctx: state.ctx,
    destination: state.destination,
    written,
    currentRemaining: written.length,
  });
  await sendPhoto(
    state.ctx.botToken,
    state.ctx.chatId,
    written[0].fileId,
    `Saved ${written.length} photos. What's this one? (1 of ${written.length}) Reply with a description, or send /skip to leave it blank.`
  );
}

async function resolveDestinationBase(
  destination: BatchDestination,
  username: string
): Promise<string> {
  if (destination.kind === "inbox") return inboxBase(username);
  if (destination.kind === "note") {
    return `users/${destination.owner}/notes/${destination.noteId}`;
  }
  // Touch resolveTaskResultsBase to ensure any legacy → per-user migration
  // happens before we write to the per-tab subdir. We don't use the
  // returned path directly — the per-tab helpers always anchor at
  // `taskResultsBase`, which `resolveTaskResultsBase` migrated INTO when
  // it returned. We DO write to the per-tab sub-bucket so the Lab Notes
  // tab's image strip / the Results tab's image strip actually see the
  // file, instead of landing at the legacy outer `Images/`.
  await resolveTaskResultsBase(
    { id: destination.taskId, owner: destination.owner },
    username
  );
  const taskRef = { id: destination.taskId, owner: destination.owner };
  return destination.subTab === "notes"
    ? taskNotesBase(taskRef)
    : taskResultsTabBase(taskRef);
}

/** Single-photo commit helper used by every style flow (auto-name, skip,
 *  per-photo-caption). Dispatches on `destination.kind`:
 *   - "task" / "inbox" → `attachImageToTask` with a basePath override
 *   - "note" → `attachImageToNote`, which also appends the markdown link
 *
 *  Returns the resolved on-disk basePath + final filename so the caller
 *  can write the sidecar. */
async function attachOnePhoto(
  destination: BatchDestination,
  photo: BatchPhoto,
  desired: string,
  altText: string,
  ctx: BatchRouteContext,
  /** Optional pinned entry id for multi-entry note destinations. Threaded
   *  through from `awaiting-entry-pick`. Ignored when destination !== note,
   *  and a missing/stale id falls back to "latest entry" inside the helper. */
  noteEntryId?: string,
): Promise<{ basePath: string; finalFilename: string }> {
  if (destination.kind === "note") {
    const result = await attachImageToNote({
      ownerUsername: destination.owner,
      noteId: destination.noteId,
      blob: photo.blob,
      suggestedFilename: desired,
      altText,
      entryId: noteEntryId,
    });
    return {
      basePath: `users/${destination.owner}/notes/${destination.noteId}`,
      finalFilename: result.finalFilename,
    };
  }
  const target = await resolveDestinationBase(destination, ctx.username);
  const result = await attachImageToTask({
    ownerUsername:
      destination.kind === "task" ? destination.owner : ctx.username,
    taskId: destination.kind === "task" ? destination.taskId : 0,
    basePath: target,
    blob: photo.blob,
    suggestedFilename: desired,
    altText,
  });
  return { basePath: target, finalFilename: result.finalFilename };
}

function stemPrefixFor(
  destination: BatchDestination,
  photoStem: string,
): string {
  if (destination.kind === "task") {
    return `task${destination.taskId}-${photoStem}`;
  }
  if (destination.kind === "note") {
    return `note${destination.noteId}-${photoStem}`;
  }
  return `inbox-${photoStem}`;
}

/** Public entry point: text from the chat. Returns `true` if this
 *  module consumed the message (because a batch is awaiting input), so
 *  the image-router can short-circuit its normal text-handling flow. */
export async function consumeBatchTextReply(
  text: string,
  ctx: BatchRouteContext
): Promise<boolean> {
  const state = batches.get(ctx.chatId);
  if (!state) return false;

  if (state.kind === "awaiting-batch-name") {
    if (text === "/skip") {
      // Skip means "use the generic timestamp-named flow". We treat
      // /skip here as a request to fall back to individual captions
      // since a batch without any naming hint is just a bunch of
      // timestamped images — and the user still might want per-photo
      // notes. Most natural mapping: write timestamped + skip caption
      // round, return.
      await commitAutoNameSkipped(state);
      return true;
    }
    const name = sanitizeBatchName(text);
    await commitAutoNameBatch(state, name);
    return true;
  }

  if (state.kind === "awaiting-per-photo-captions") {
    const idx = state.written.length - state.currentRemaining;
    const target = state.written[idx];
    if (!target) {
      // Shouldn't happen; defensive clear.
      clearBatch(ctx.chatId);
      return true;
    }
    if (text !== "/skip") {
      await writeSidecar(target.basePath, target.filename, { caption: text });
    }
    const nextRemaining = state.currentRemaining - 1;
    if (nextRemaining <= 0) {
      await sendMessage(
        ctx.botToken,
        ctx.chatId,
        `All ${state.written.length} photos captioned.`
      );
      clearBatch(ctx.chatId);
      return true;
    }
    batches.set(ctx.chatId, { ...state, currentRemaining: nextRemaining });
    const nextIdx = state.written.length - nextRemaining;
    const nextEntry = state.written[nextIdx];
    await sendPhoto(
      ctx.botToken,
      ctx.chatId,
      nextEntry.fileId,
      `What's this one? (${nextIdx + 1} of ${state.written.length}) Reply with a description, or send /skip.`
    );
    return true;
  }

  // Buffering / awaiting-destination / awaiting-style: text is unrelated.
  // Let the caller's existing text-handling flow process it.
  return false;
}

/** auto-number flow: user gave us a batch name. Write all N photos with
 *  `<name>-1.ext` ... `<name>-N.ext`, send the one-line summary, clear. */
async function commitAutoNameBatch(
  state: BatchState & { kind: "awaiting-batch-name" },
  name: string
): Promise<void> {
  for (let i = 0; i < state.photos.length; i++) {
    const photo = state.photos[i];
    const desired = `${name}-${i + 1}.${photo.suggestedExt}`;
    const { basePath, finalFilename } = await attachOnePhoto(
      state.destination,
      photo,
      desired,
      name,
      state.ctx,
      state.noteEntryId,
    );
    // Caption = the batch name (the thing the user TYPED). Telegram only
    // attaches per-photo caption to the first photo of an album, so
    // `photo.caption ?? name` would leave a single anomalous caption on
    // photo 0 and the batch name on the rest — confusing. Batch name on
    // every photo keeps the album coherent; the per-photo index is
    // already preserved in the filename.
    await writeSidecar(basePath, finalFilename, {
      caption: name,
      source: "telegram",
      receivedAt: new Date(photo.date * 1000).toISOString(),
      telegramMessageId: photo.messageId,
      telegramChatId: state.ctx.chatId,
    });
  }
  await sendMessage(
    state.ctx.botToken,
    state.ctx.chatId,
    `Saved ${state.photos.length} photos as ${name}-1 through ${name}-${state.photos.length}.`
  );
  clearBatch(state.ctx.chatId);
}

/** /skip in awaiting-batch-name: treat as "fall through to timestamp
 *  names" — write with the same per-task timestamp stems the
 *  single-photo flow uses, then leave the user alone. */
async function commitAutoNameSkipped(
  state: BatchState & { kind: "awaiting-batch-name" }
): Promise<void> {
  for (const photo of state.photos) {
    const desired = `${timestampStem(stemPrefixFor(state.destination, photo.suggestedStem))}.${photo.suggestedExt}`;
    const { basePath, finalFilename } = await attachOnePhoto(
      state.destination,
      photo,
      desired,
      photo.caption ?? "",
      state.ctx,
      state.noteEntryId,
    );
    await writeSidecar(basePath, finalFilename, {
      caption: photo.caption ?? undefined,
      source: "telegram",
      receivedAt: new Date(photo.date * 1000).toISOString(),
      telegramMessageId: photo.messageId,
      telegramChatId: state.ctx.chatId,
    });
  }
  await sendMessage(
    state.ctx.botToken,
    state.ctx.chatId,
    `Saved ${state.photos.length} photos with auto-generated names.`
  );
  clearBatch(state.ctx.chatId);
}
