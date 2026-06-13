// write_note + list_notes tool tests (ai write-note bot, 2026-06-11).
//
// The marquee coworker WRITE. write_note drafts content the user reviews, then on
// approval writes it through the real notes API. These tests pin:
//   - list_notes shapes the user's notes to { id, title, snippet }, empty when none.
//   - write_note's describeAction returns a `draft` payload, so the gate raises a
//     "draft" approval carrying the proposed content (not a one-line confirm).
//   - On Approve (allow), execute writes, create -> notesApi.create with the content,
//     append -> notesApi.addEntry with the content, asserted through injected deps.
//   - On Reject (skip), execute does NOT run and a graceful declined result returns.
//   - write_note is NON-destructive (isDestructive false), so the gate never forces
//     the destructive hard-stop, the draft preview is the consent.
//
// The tool's data layer is injected (writeNoteDeps), so these run with no folder and
// no Loro store. The gate behavior is asserted through runAgentLoop with fake model
// + fake requestApproval, the same harness the other approval tests use.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listNotesTool,
  writeNoteTool,
  shapeNotes,
  noteSnippet,
  parseWriteNoteArgs,
  writeNoteDeps,
  type WriteNoteResult,
} from "../tools/write-note";
import { runAgentLoop, type LoopMessage, type ModelResponse } from "../agent-loop";
import type { ApprovalDecision, ApprovalRequest } from "../tools/types";
import type { Note } from "@/lib/types";

// ---- fixtures ---------------------------------------------------------------

function makeNote(over: Partial<Note> = {}): Note {
  return {
    id: 1,
    title: "qPCR optimization",
    description: "",
    is_running_log: false,
    is_shared: false,
    entries: [
      {
        id: "e1",
        title: "Day 1",
        date: "2026-06-10",
        content: "Ran the first plate. Cq looked high for the Drug well.",
        created_at: "2026-06-10T00:00:00.000Z",
        updated_at: "2026-06-10T00:00:00.000Z",
      },
    ],
    comments: [],
    updated_at: "2026-06-10T00:00:00.000Z",
    username: "me",
    ...over,
  };
}

// ---- list_notes -------------------------------------------------------------

describe("list_notes (shaping)", () => {
  it("shapes notes to id + title + snippet", () => {
    const out = shapeNotes([makeNote(), makeNote({ id: 2, title: "Cloning log" })]);
    expect(out.count).toBe(2);
    expect(out.notes[0]).toMatchObject({ id: 1, title: "qPCR optimization" });
    expect(out.notes[0].snippet).toContain("Ran the first plate");
  });

  it("returns an empty list when the user has no notes", () => {
    expect(shapeNotes([])).toEqual({ count: 0, notes: [] });
  });

  it("uses the most recent non-empty entry for the snippet, blank when no content", () => {
    const blank = makeNote({
      entries: [
        {
          id: "e1",
          title: "stub",
          date: "2026-06-10",
          content: "   ",
          created_at: "",
          updated_at: "",
        },
      ],
    });
    expect(noteSnippet(blank)).toBe("");

    const twoEntries = makeNote({
      entries: [
        {
          id: "e1",
          title: "old",
          date: "2026-06-09",
          content: "older content",
          created_at: "",
          updated_at: "",
        },
        {
          id: "e2",
          title: "new",
          date: "2026-06-10",
          content: "newest content wins",
          created_at: "",
          updated_at: "",
        },
      ],
    });
    expect(noteSnippet(twoEntries)).toBe("newest content wins");
  });

  it("list_notes execute returns the shaped list via the injected deps", async () => {
    const original = writeNoteDeps.listNotes;
    writeNoteDeps.listNotes = vi.fn(async () => [makeNote()]);
    try {
      const result = (await listNotesTool.execute({})) as ReturnType<
        typeof shapeNotes
      >;
      expect(result.count).toBe(1);
      expect(result.notes[0].title).toBe("qPCR optimization");
    } finally {
      writeNoteDeps.listNotes = original;
    }
  });
});

// ---- parseWriteNoteArgs -----------------------------------------------------

describe("parseWriteNoteArgs", () => {
  it("treats target 'new' as a create", () => {
    const p = parseWriteNoteArgs({ target: "new", content: "hi", title: "T" });
    expect(p.mode).toBe("create");
    expect(p.noteId).toBeNull();
  });

  it("treats a numeric target as an append and resolves the id", () => {
    const p = parseWriteNoteArgs({ target: "7", content: "hi" });
    expect(p.mode).toBe("append");
    expect(p.noteId).toBe(7);
  });

  it("honours an explicit mode over the target heuristic", () => {
    const p = parseWriteNoteArgs({ target: "3", content: "hi", mode: "create" });
    expect(p.mode).toBe("create");
  });

  it("leaves noteId null for an append with a non-numeric target", () => {
    const p = parseWriteNoteArgs({ target: "qPCR note", content: "hi" });
    expect(p.mode).toBe("append");
    expect(p.noteId).toBeNull();
  });
});

// ---- write_note describeAction (the draft payload) --------------------------

describe("write_note describeAction", () => {
  it("returns a draft payload carrying the proposed content and mode", () => {
    const described = writeNoteTool.describeAction!({
      target: "new",
      title: "qPCR summary",
      content: "## Results\nThe t-test was significant.",
      mode: "create",
    });
    expect(described.draft).toBeDefined();
    expect(described.draft?.mode).toBe("create");
    expect(described.draft?.content).toContain("The t-test was significant");
    expect(described.draft?.title).toBe("qPCR summary");
  });

  it("is never destructive (create and append are reversible)", () => {
    expect(
      writeNoteTool.isDestructive!({ target: "new", content: "x" }),
    ).toBe(false);
  });
});

// ---- the gate: draft approval through runAgentLoop --------------------------

function assistantWithToolCall(name: string, args: object): ModelResponse {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  };
}

function assistantFinal(content: string): ModelResponse {
  return { choices: [{ message: { role: "assistant", content } }] };
}

const USER_MESSAGE: LoopMessage = {
  role: "user",
  content: "summarize the result into a new note",
};

describe("write_note gate (draft approval)", () => {
  let createSpy: ReturnType<typeof vi.fn>;
  let appendSpy: ReturnType<typeof vi.fn>;
  let originalCreate: typeof writeNoteDeps.createNote;
  let originalAppend: typeof writeNoteDeps.appendEntry;

  beforeEach(() => {
    createSpy = vi.fn(async () => makeNote({ id: 42, title: "qPCR summary" }));
    appendSpy = vi.fn(async () => makeNote({ id: 1, title: "qPCR optimization" }));
    originalCreate = writeNoteDeps.createNote;
    originalAppend = writeNoteDeps.appendEntry;
    writeNoteDeps.createNote = createSpy as typeof writeNoteDeps.createNote;
    writeNoteDeps.appendEntry = appendSpy as typeof writeNoteDeps.appendEntry;
  });

  it("raises a kind:'draft' approval carrying the proposed content", async () => {
    const seen: ApprovalRequest[] = [];
    const requestApproval = vi.fn(
      async (req: ApprovalRequest): Promise<ApprovalDecision> => {
        seen.push(req);
        return "allow";
      },
    );
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("write_note", {
          target: "new",
          title: "qPCR summary",
          content: "## Results\nThe t-test was significant.",
          mode: "create",
        }),
      )
      .mockResolvedValueOnce(assistantFinal("Added it."));

    try {
      await runAgentLoop({
        messages: [USER_MESSAGE],
        tools: [writeNoteTool],
        callModel,
        getReviewMode: () => "step",
        requestApproval,
      });
    } finally {
      writeNoteDeps.createNote = originalCreate;
      writeNoteDeps.appendEntry = originalAppend;
    }

    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe("draft");
    if (seen[0].kind === "draft") {
      expect(seen[0].content).toContain("The t-test was significant");
      expect(seen[0].mode).toBe("create");
      expect(seen[0].title).toBe("qPCR summary");
    }
  });

  it("on Approve, execute creates the note with the drafted content", async () => {
    const requestApproval = vi.fn(async (): Promise<ApprovalDecision> => "allow");
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("write_note", {
          target: "new",
          title: "qPCR summary",
          content: "## Results\nSignificant.",
          mode: "create",
        }),
      )
      .mockResolvedValueOnce(assistantFinal("Added it."));

    try {
      await runAgentLoop({
        messages: [USER_MESSAGE],
        tools: [writeNoteTool],
        callModel,
        getReviewMode: () => "step",
        requestApproval,
      });
    } finally {
      writeNoteDeps.createNote = originalCreate;
      writeNoteDeps.appendEntry = originalAppend;
    }

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0][0]).toMatchObject({
      title: "qPCR summary",
      content: "## Results\nSignificant.",
    });
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("on a Canvas Save (draft-save decision), execute writes the user's EDITED content", async () => {
    // The user edited the draft in Canvas and saved. The decision carries the
    // edited buffer, and the gate routes it via applyEdit into the content arg,
    // so createNote receives the edited text, not the model's original draft.
    const requestApproval = vi.fn(
      async (): Promise<ApprovalDecision> => ({
        kind: "draft-save",
        content: "## Results\nEdited to 2.41x in Canvas.",
      }),
    );
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("write_note", {
          target: "new",
          title: "qPCR summary",
          content: "## Results\nOriginal 2.4x draft.",
          mode: "create",
        }),
      )
      .mockResolvedValueOnce(assistantFinal("Saved your edits."));

    try {
      await runAgentLoop({
        messages: [USER_MESSAGE],
        tools: [writeNoteTool],
        callModel,
        getReviewMode: () => "step",
        requestApproval,
      });
    } finally {
      writeNoteDeps.createNote = originalCreate;
      writeNoteDeps.appendEntry = originalAppend;
    }

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0][0]).toMatchObject({
      content: "## Results\nEdited to 2.41x in Canvas.",
    });
  });

  it("on Approve, execute appends to the existing note via addEntry", async () => {
    const requestApproval = vi.fn(async (): Promise<ApprovalDecision> => "allow");
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("write_note", {
          target: "1",
          title: "Today's summary",
          content: "Appended section.",
          mode: "append",
        }),
      )
      .mockResolvedValueOnce(assistantFinal("Appended it."));

    try {
      await runAgentLoop({
        messages: [USER_MESSAGE],
        tools: [writeNoteTool],
        callModel,
        getReviewMode: () => "step",
        requestApproval,
      });
    } finally {
      writeNoteDeps.createNote = originalCreate;
      writeNoteDeps.appendEntry = originalAppend;
    }

    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy.mock.calls[0][0]).toBe(1);
    expect(appendSpy.mock.calls[0][1]).toMatchObject({
      content: "Appended section.",
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("on Reject, execute does NOT run and a graceful declined result returns", async () => {
    const requestApproval = vi.fn(async (): Promise<ApprovalDecision> => "skip");
    const callModel = vi
      .fn<(m: LoopMessage[], t: unknown[]) => Promise<ModelResponse>>()
      .mockResolvedValueOnce(
        assistantWithToolCall("write_note", {
          target: "new",
          content: "draft to reject",
          mode: "create",
        }),
      )
      .mockResolvedValueOnce(assistantFinal("No problem, I will not write it."));

    try {
      await runAgentLoop({
        messages: [USER_MESSAGE],
        tools: [writeNoteTool],
        callModel,
        getReviewMode: () => "step",
        requestApproval,
      });
    } finally {
      writeNoteDeps.createNote = originalCreate;
      writeNoteDeps.appendEntry = originalAppend;
    }

    // Nothing was written.
    expect(createSpy).not.toHaveBeenCalled();
    expect(appendSpy).not.toHaveBeenCalled();

    // A graceful declined result was fed back to the model.
    const secondCallMessages = callModel.mock.calls[1][0];
    const toolMsg = secondCallMessages.find((m: LoopMessage) => m.role === "tool");
    const parsed = JSON.parse(toolMsg?.content as string) as {
      approved: boolean;
      message: string;
    };
    expect(parsed.approved).toBe(false);
    expect(parsed.message).toMatch(/declined|draft/i);
  });
});

// ---- execute direct unit (graceful errors) ----------------------------------

describe("write_note execute (direct)", () => {
  it("returns an error when there is no drafted content", async () => {
    const result = (await writeNoteTool.execute({
      target: "new",
      content: "   ",
      mode: "create",
    })) as WriteNoteResult;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/content/i);
  });

  it("returns an error when an append target id cannot be resolved", async () => {
    const result = (await writeNoteTool.execute({
      target: "not-a-number",
      content: "section",
      mode: "append",
    })) as WriteNoteResult;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/which note|list_notes|id/i);
  });
});
