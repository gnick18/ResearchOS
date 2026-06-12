// Seamless export, the "push" direction (2026-06-11). The reverse of the
// reference picker: instead of an editor reaching out to pull an object in, the
// object (a sequence, a molecule) pushes a reference chip directly into a chosen
// note, experiment doc, or method, with no copy-paste.
//
// The persistence here mirrors the mobile capture poller's open-aware append
// (see lib/mobile-relay/poll.ts) so a live editor is never clobbered:
//   - Experiment docs (results / lab notes): if that experiment popup is open,
//     dispatch the same `notebook:append-line` event the poller uses so the
//     open editor applies the line through its own buffer + persist. Otherwise
//     write straight to results.md / notes.md on disk.
//   - Notes: append to the latest entry via notesApi.updateEntry (which persists
//     and stamps attribution), then fire `note:routed` so an open note popup
//     refreshes. Same path the poller's append-note-text uses.
//   - Methods: append to the markdown body on disk. The methods page is a
//     separate route, so it cannot be mounted at the same time as the sequence /
//     chemistry surface that triggers the send, so a plain disk append is safe.
//
// Voice: no em-dashes, no emojis, no mid-sentence colons.

import { filesApi, notesApi } from "@/lib/local-api";
import { useAppStore } from "@/lib/store";
import { taskResultsBase } from "@/lib/tasks/results-paths";

/** The kinds of document a reference can be pushed into. An experiment exposes
 *  two independent docs, so it splits into two target kinds. `new-note` is a
 *  create target, it mints a fresh note from the markdown instead of appending
 *  to an existing one (used by the BeakerBot chat export). */
export type SendTargetKind =
  | "note"
  | "new-note"
  | "experiment-results"
  | "experiment-labnotes"
  | "method";

export interface SendTarget {
  kind: SendTargetKind;
  /** Note id / task id / method id. */
  id: number;
  /** Owner-folder routing key. For a note this is `note.username`; for a task /
   *  method it is `.owner`. */
  owner: string;
  /** Display name, used only for the confirmation toast. */
  name: string;
  /** Only set for a method target: the markdown body path to append to. */
  sourcePath?: string | null;
}

/** Append `addition` to `existing`, trimming trailing whitespace and inserting a
 *  blank-line separator so the chip lands as its own paragraph. */
function appendBlock(existing: string, addition: string): string {
  const trimmed = existing.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n\n${addition}` : addition;
}

async function sendToExperimentDoc(
  target: SendTarget,
  referenceMarkdown: string,
): Promise<void> {
  const tab = target.kind === "experiment-results" ? "results" : "notes";

  // If the experiment popup is open, hand off to its live editor so its own
  // buffer + persist path applies the line. This is the same handoff the
  // capture poller does, and the popup's `notebook:append-line` listener flushes
  // unsaved work, switches to the right tab, then appends live.
  const active = useAppStore.getState().activeTask;
  if (
    active &&
    active.id === target.id &&
    active.owner === target.owner &&
    typeof window !== "undefined"
  ) {
    window.dispatchEvent(
      new CustomEvent("notebook:append-line", {
        detail: {
          taskId: target.id,
          owner: target.owner,
          tab,
          text: referenceMarkdown,
        },
      }),
    );
    return;
  }

  // Not open: write straight to the on-disk doc. results.md / notes.md live
  // directly under the task base (not under the per-tab attachment subdirs).
  const base = taskResultsBase({ id: target.id, owner: target.owner });
  const filePath = tab === "results" ? `${base}/results.md` : `${base}/notes.md`;

  let existing = "";
  try {
    const read = await filesApi.readFile(filePath);
    existing = read.content;
  } catch {
    // Fresh experiment with no doc yet: start from an empty body.
  }
  await filesApi.writeFile(
    filePath,
    appendBlock(existing, referenceMarkdown),
    `Add reference to experiment ${target.id} ${tab}`,
  );
}

/** Append `referenceMarkdown` to an existing note. When `asNewEntry` is set the
 *  markdown lands in a FRESH dated entry rather than appended to the latest one,
 *  which keeps a large block (a chat transcript) from being mixed into an
 *  in-progress entry. */
async function sendToNote(
  target: SendTarget,
  referenceMarkdown: string,
  asNewEntry = false,
): Promise<void> {
  let note = await notesApi.get(target.id, target.owner);
  if (!note) throw new Error("note not found");

  // Chat export: create its own dated entry so an existing note is never
  // clobbered and the transcript stands on its own.
  if (asNewEntry) {
    const today = new Date().toISOString().slice(0, 10);
    const created = await notesApi.addEntry(
      target.id,
      { title: target.name || today, date: today, content: referenceMarkdown },
      target.owner,
    );
    const newEntries = created?.entries ?? [];
    if (!created || newEntries.length === 0) {
      throw new Error("addEntry returned no entries");
    }
    const newEntryId = newEntries[newEntries.length - 1].id;
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("note:routed", {
          detail: { noteId: target.id, owner: target.owner, entryId: newEntryId },
        }),
      );
    }
    return;
  }

  const entries = note.entries ?? [];
  let targetEntryId: string;
  if (entries.length > 0) {
    // Append to the most-recently-updated entry, the same choice the capture
    // poller's append-note-text makes.
    const latest = entries.reduce((a, b) =>
      (a.updated_at ?? "") >= (b.updated_at ?? "") ? a : b,
    );
    targetEntryId = latest.id;
  } else {
    // No entries yet: create one, then append to it.
    const today = new Date().toISOString().slice(0, 10);
    const created = await notesApi.addEntry(
      target.id,
      { title: today, date: today, content: "" },
      target.owner,
    );
    const newEntries = created?.entries ?? [];
    if (!created || newEntries.length === 0) {
      throw new Error("addEntry returned no entries");
    }
    targetEntryId = newEntries[newEntries.length - 1].id;
    note = created;
  }

  const existingEntry = (note.entries ?? []).find((e) => e.id === targetEntryId);
  const newContent = appendBlock(existingEntry?.content ?? "", referenceMarkdown);
  await notesApi.updateEntry(
    target.id,
    targetEntryId,
    { content: newContent },
    target.owner,
  );

  // Refresh an open note popup to the entry that just changed.
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("note:routed", {
        detail: { noteId: target.id, owner: target.owner, entryId: targetEntryId },
      }),
    );
  }
}

async function sendToMethod(
  target: SendTarget,
  referenceMarkdown: string,
): Promise<void> {
  if (!target.sourcePath) throw new Error("method has no markdown body to append to");
  let existing = "";
  try {
    const read = await filesApi.readFile(target.sourcePath);
    existing = read.content;
  } catch {
    // A markdown method should always have a body, but degrade to appending to
    // an empty doc rather than throwing if the read fails.
  }
  await filesApi.writeFile(
    target.sourcePath,
    appendBlock(existing, referenceMarkdown),
    `Add reference to method ${target.id}`,
  );
}

/** Create a brand-new note seeded with `markdown` as its first dated entry. The
 *  `name` on the target is used as both the note title and the entry title. */
async function createNote(target: SendTarget, markdown: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const title = target.name || `BeakerBot chat ${today}`;
  await notesApi.create({
    title,
    entries: [{ title, date: today, content: markdown }],
  });
}

/**
 * Append a reference (an `objectReferenceMarkdown` link, which renders as an
 * ObjectChip) to the chosen target's body. Open-aware so a live editor is never
 * clobbered. Throws on a hard failure so the caller can surface an error toast.
 */
export async function sendReferenceToTarget(
  target: SendTarget,
  referenceMarkdown: string,
): Promise<void> {
  switch (target.kind) {
    case "experiment-results":
    case "experiment-labnotes":
      return sendToExperimentDoc(target, referenceMarkdown);
    case "note":
      return sendToNote(target, referenceMarkdown);
    case "new-note":
      return createNote(target, referenceMarkdown);
    case "method":
      return sendToMethod(target, referenceMarkdown);
  }
}

/**
 * Send an arbitrary markdown block (a BeakerBot chat transcript) to the chosen
 * target. This shares every append path with sendReferenceToTarget, the only
 * differences are that it lands the markdown in its OWN block so an existing
 * document is never clobbered:
 *   - new-note   -> mint a fresh note seeded with the transcript.
 *   - note       -> add a fresh dated entry (not append to the latest one).
 *   - experiment -> append as its own blank-line-separated block (open-aware).
 *   - method     -> append as its own blank-line-separated block.
 * The markdown is passed through verbatim, which is what keeps the assistant
 * turns' inline embed links live in the destination.
 */
export async function sendMarkdownToTarget(
  target: SendTarget,
  markdown: string,
): Promise<void> {
  switch (target.kind) {
    case "experiment-results":
    case "experiment-labnotes":
      return sendToExperimentDoc(target, markdown);
    case "note":
      return sendToNote(target, markdown, true);
    case "new-note":
      return createNote(target, markdown);
    case "method":
      return sendToMethod(target, markdown);
  }
}
