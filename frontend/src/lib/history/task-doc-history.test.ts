// save-checkpoint bot (2026-06-02): coverage for the task Lab Notes / Results
// markdown-document version-control wiring. Locks:
//   - the additive on-disk namespaces (task_notes / task_results),
//   - the {content} payload round-trip through the engine (genesis + deltas),
//   - the viewer adapter's projection + summary rules,
//   - the no-op short-circuit (re-saving unchanged content mints no version).

import { describe, expect, it } from "vitest";
import { HistoryEngine } from "./engine";
import { canonicalize } from "./canonicalize";
import { historyFilePath } from "./storage";
import { isGenesisRow } from "./types";
import { MemoryStorage, makeClock } from "./test-utils";
import {
  taskDocEntityType,
  taskDocPayload,
  projectTaskDocState,
  summarizeTaskDocChange,
  taskDocAdapter,
  TASK_NOTES_ENTITY_TYPE,
  TASK_RESULTS_ENTITY_TYPE,
} from "./task-doc-history";

const OWNER = "mira";
const TASK_ID = 42;

function makeEngine() {
  const storage = new MemoryStorage();
  const engine = new HistoryEngine({ storage, clock: makeClock() });
  return { engine, storage };
}

/** The canonical HEAD string for a markdown body, as the live editor threads it. */
function canonicalForBody(body: string): string {
  return canonicalize(taskDocPayload(body));
}

describe("task-doc entity types", () => {
  it("maps surfaces to additive namespaces", () => {
    expect(taskDocEntityType("notes")).toBe(TASK_NOTES_ENTITY_TYPE);
    expect(taskDocEntityType("results")).toBe(TASK_RESULTS_ENTITY_TYPE);
    expect(TASK_NOTES_ENTITY_TYPE).toBe("task_notes");
    expect(TASK_RESULTS_ENTITY_TYPE).toBe("task_results");
  });

  it("resolves the documented on-disk path", () => {
    expect(historyFilePath(OWNER, taskDocEntityType("notes"), TASK_ID)).toBe(
      "users/mira/_history/task_notes/42.jsonl",
    );
    expect(historyFilePath(OWNER, taskDocEntityType("results"), TASK_ID)).toBe(
      "users/mira/_history/task_results/42.jsonl",
    );
  });
});

describe("{content} payload round-trip through the engine", () => {
  it("versions a plain markdown string as its own document", async () => {
    const { engine } = makeEngine();
    const entityType = taskDocEntityType("notes");

    // First save: genesis (empty pre-image) + first delta.
    await engine.appendEdit({
      type: "update",
      entityType,
      id: TASK_ID,
      owner: OWNER,
      actor: "mira",
      prevState: taskDocPayload(""),
      nextState: taskDocPayload("# Day 1\nPCR run A"),
    });
    // Second save: appends one more delta.
    await engine.appendEdit({
      type: "update",
      entityType,
      id: TASK_ID,
      owner: OWNER,
      actor: "mira",
      prevState: taskDocPayload("# Day 1\nPCR run A"),
      nextState: taskDocPayload("# Day 1\nPCR run A (success)"),
    });

    const rows = await engine.readHistory(entityType, OWNER, TASK_ID);
    expect(rows).toHaveLength(3); // genesis + 2 deltas
    expect(isGenesisRow(rows[0])).toBe(true);

    // The first save's pre-image is {content:""} (NOT the empty doc {}), so the
    // genesis is a bare anchor the engine resolves by reverse-walking from the
    // live HEAD canonical — exactly what the sidebar threads via headCanonical.
    const head = canonicalForBody("# Day 1\nPCR run A (success)");

    // Reconstruct each version and project back to the raw markdown body.
    const v1 = await engine.reconstructState(entityType, OWNER, TASK_ID, 1, head);
    const v2 = await engine.reconstructState(entityType, OWNER, TASK_ID, 2, head);
    expect(projectTaskDocState(v1).body).toBe("# Day 1\nPCR run A");
    expect(projectTaskDocState(v2).body).toBe("# Day 1\nPCR run A (success)");
  });

  it("short-circuits a no-op save once history exists (no phantom version)", async () => {
    const { engine } = makeEngine();
    const entityType = taskDocEntityType("results");

    await engine.appendEdit({
      type: "update",
      entityType,
      id: TASK_ID,
      owner: OWNER,
      actor: "mira",
      prevState: taskDocPayload(""),
      nextState: taskDocPayload("gel image attached"),
    });
    const before = await engine.readHistory(entityType, OWNER, TASK_ID);

    // Re-save identical content: the engine's empty-delta short-circuit must
    // drop it (prev === next), so the row count does not grow.
    await engine.appendEdit({
      type: "update",
      entityType,
      id: TASK_ID,
      owner: OWNER,
      actor: "mira",
      prevState: taskDocPayload("gel image attached"),
      nextState: taskDocPayload("gel image attached"),
    });
    const after = await engine.readHistory(entityType, OWNER, TASK_ID);
    expect(after).toHaveLength(before.length);
  });

  it("reverse-walks to an earlier version for restore", async () => {
    const { engine } = makeEngine();
    const entityType = taskDocEntityType("notes");
    for (const [prev, next] of [
      ["", "v1"],
      ["v1", "v2"],
      ["v2", "v3"],
    ] as const) {
      await engine.appendEdit({
        type: "update",
        entityType,
        id: TASK_ID,
        owner: OWNER,
        actor: "mira",
        prevState: taskDocPayload(prev),
        nextState: taskDocPayload(next),
      });
    }
    const rows = await engine.readHistory(entityType, OWNER, TASK_ID);
    // reverseWalkTo takes the canonical HEAD string (the live on-disk content).
    const targetCanonical = engine.reverseWalkTo(
      rows,
      1, // first delta = "v1"
      canonicalForBody("v3"),
    );
    expect(projectTaskDocState(targetCanonical).body).toBe("v1");
  });
});

describe("taskDoc adapter projection + summaries", () => {
  it("projects a malformed/empty canonical to an empty body", () => {
    expect(projectTaskDocState(null).body).toBe("");
    expect(projectTaskDocState("").body).toBe("");
    expect(projectTaskDocState("not json").body).toBe("");
  });

  it("summarizes create / edit / clear / restore / undo", () => {
    expect(summarizeTaskDocChange(null, { body: "hi" })).toBe("created document");
    expect(summarizeTaskDocChange(null, { body: "  " })).toBe("created");
    expect(
      summarizeTaskDocChange({ body: "a" }, { body: "b" }),
    ).toBe("edited document");
    expect(
      summarizeTaskDocChange({ body: "a" }, { body: "" }),
    ).toBe("cleared document");
    expect(
      summarizeTaskDocChange({ body: "" }, { body: "a" }),
    ).toBe("added content");
    expect(
      summarizeTaskDocChange({ body: "a" }, { body: "a" }),
    ).toBe("saved checkpoint");
    expect(
      summarizeTaskDocChange({ body: "a" }, { body: "b" }, "revert"),
    ).toBe("Restored an earlier version");
    expect(
      summarizeTaskDocChange({ body: "a" }, { body: "b" }, "undo-revert"),
    ).toBe("Undid a restore");
  });

  it("exposes the adapter shape the generic sidebar consumes", () => {
    expect(taskDocAdapter.projectBody("not json").body).toBe("");
    expect(
      taskDocAdapter.summarize(null, { body: "x" }),
    ).toBe("created document");
  });
});
