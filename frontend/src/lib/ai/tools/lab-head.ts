// Lab-head (PI) copilot tools (Phase 1 of the PI copilot, see
// docs/proposals/2026-06-17-beakerbot-lab-head-utilities.md).
//
// These are the three oversight tools BeakerBot offers a lab head on the
// /lab-overview surface. They go through the audited lab-scoped read and index
// search engines, never bypass them. Same house rules as every other BeakerBot
// tool: the tool owns every number, the model only narrates, and it never
// interprets (no "this trainee is struggling", just the counts and the dates).
//
// All three are read-only (no action: true). Each tool is produced by a factory
// that accepts injected deps so the aggregation logic is unit-testable without
// the relay, crypto, or audit machinery. The exported tool constants use the
// real (default) deps; tests call the factory with mocks.
//
// Degrade to a clear "no lab / no data" result rather than throwing, mirroring
// dept-admin's null-safe pattern.
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { AiTool } from "./types";
import { COORDINATION_TOOLS } from "./registry";
import { readLabMembersWork } from "@/lib/lab/lab-scoped-read";
import { searchLabIndex } from "@/lib/lab/lab-index-search";

// ---------------------------------------------------------------------------
// Dep types for each tool factory
// ---------------------------------------------------------------------------

export interface LabPulseDeps {
  readWork: typeof readLabMembersWork;
}

export interface FindAcrossLabDeps {
  searchIndex: typeof searchLabIndex;
}

export interface LabThroughputDeps {
  readWork: typeof readLabMembersWork;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a record's plaintext as JSON. Returns null rather than throwing when
 * the bytes are not valid JSON (a corrupted or partially-synced record).
 */
function parseRecord(plain: Uint8Array): Record<string, unknown> | null {
  try {
    const text = new TextDecoder().decode(plain);
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Return true when a record's updatedAt or created_at timestamp falls within
 * the last `days` calendar days. Deterministic, never inferred.
 */
function isWithinDays(
  rec: Record<string, unknown>,
  days: number,
  now: Date,
): boolean {
  const stamp =
    (rec.updated_at as string | undefined) ??
    (rec.updatedAt as string | undefined) ??
    (rec.created_at as string | undefined);
  if (!stamp) return false;
  const d = new Date(stamp);
  if (isNaN(d.getTime())) return false;
  const ms = days * 24 * 60 * 60 * 1000;
  return now.getTime() - d.getTime() <= ms;
}

/**
 * Return true when a record has seen NO activity in the last `days` calendar
 * days. "No activity" means the most recent updatedAt / created_at timestamp
 * is older than the threshold. A record with no timestamp is not stalled by
 * default, it is simply undated. Deterministic.
 */
function isStalled(
  rec: Record<string, unknown>,
  stalledDays: number,
  now: Date,
): boolean {
  const stamp =
    (rec.updated_at as string | undefined) ??
    (rec.updatedAt as string | undefined) ??
    (rec.created_at as string | undefined);
  if (!stamp) return false;
  const d = new Date(stamp);
  if (isNaN(d.getTime())) return false;
  const ms = stalledDays * 24 * 60 * 60 * 1000;
  return now.getTime() - d.getTime() > ms;
}

// ---------------------------------------------------------------------------
// lab_pulse (factory)
// ---------------------------------------------------------------------------

export function makeLabPulseTool(deps: LabPulseDeps): AiTool {
  return {
    name: "lab_pulse",
    description:
      "Get a per-member activity digest for the whole lab. Returns, for each lab member: experiment count, notes and results added, tasks done, tasks overdue, what is NEW since `sinceDays` (default 7), and what is STALLED (deterministic: no record activity in `stalledDays`, default 14). Counts only. No ranking, no commentary on any individual. Every read is audited. Call this to answer how active each member is, what is new across the lab, or what has not moved. Lab-head only.",
    parameters: {
      type: "object",
      properties: {
        sinceDays: {
          type: "number",
          description:
            "How many days back to look for NEW activity. Default 7 (one week).",
        },
        stalledDays: {
          type: "number",
          description:
            "A record with no update in this many days is counted as stalled. Default 14.",
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const sinceDays = typeof args.sinceDays === "number" ? args.sinceDays : 7;
      const stalledDays =
        typeof args.stalledDays === "number" ? args.stalledDays : 14;

      const result = await deps.readWork({});
      if (!result.ok || result.members.length === 0) {
        return {
          hasLab: false,
          note:
            result.error ??
            "No lab data is available. Either this account is not a lab head, no members have synced, or the lab is not reachable.",
        };
      }

      const now = new Date();
      const members = result.members.map((m) => {
        let experiments = 0;
        let notesAdded = 0;
        let resultsAdded = 0;
        let tasksDone = 0;
        let tasksOverdue = 0;
        let newSince = 0;
        let stalled = 0;

        for (const r of m.records) {
          const parsed = parseRecord(r.plaintext);
          const type = r.recordType;

          if (type === "experiment" || type === "task_experiment") {
            experiments += 1;
          }
          if (type === "notes_sheet" || type === "note") {
            notesAdded += 1;
          }
          if (type === "result_sheet" || type === "result") {
            resultsAdded += 1;
          }
          if (type === "task" || type === "list_task") {
            if (parsed) {
              const status = (parsed.status as string | undefined) ?? "";
              const dueDate = (parsed.due_date as string | undefined) ?? "";
              if (status === "done" || status === "completed") {
                tasksDone += 1;
              } else if (dueDate) {
                const due = new Date(dueDate);
                if (!isNaN(due.getTime()) && due < now) {
                  tasksOverdue += 1;
                }
              }
            }
          }

          // New: any record updated within sinceDays.
          if (parsed && isWithinDays(parsed, sinceDays, now)) {
            newSince += 1;
          }

          // Stalled: any record with no activity in stalledDays.
          if (parsed && isStalled(parsed, stalledDays, now)) {
            stalled += 1;
          }
        }

        return {
          owner: m.owner,
          experiments,
          notesAdded,
          resultsAdded,
          tasksDone,
          tasksOverdue,
          newSince,
          stalled,
          totalRecords: m.records.length,
          readError: m.error ?? null,
        };
      });

      const totalMembers = members.length;
      const totalExperiments = members.reduce((s, m) => s + m.experiments, 0);
      const totalNewSince = members.reduce((s, m) => s + m.newSince, 0);
      const totalStalled = members.reduce((s, m) => s + m.stalled, 0);

      return {
        hasLab: true,
        sinceDays,
        stalledDays,
        totalMembers,
        totalExperiments,
        totalNewSince,
        totalStalled,
        members,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// find_across_lab (factory)
// ---------------------------------------------------------------------------

export function makeFindAcrossLabTool(deps: FindAcrossLabDeps): AiTool {
  return {
    name: "find_across_lab",
    description:
      "Full-text search across the whole lab using the per-member index. Returns matched records with the owning member shown. Searches titles, tags, and text previews. Use this to find every experiment that used a reagent, every note mentioning a keyword, or any protocol across the lab. Lab-head only. Read-only.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search text to match across all lab members' work.",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of results to return. Default 20. Pass a larger number to see more.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const query = typeof args.query === "string" ? args.query : "";
      const limit = typeof args.limit === "number" ? args.limit : 20;

      const result = await deps.searchIndex(query, { limit });
      if (!result.ok) {
        return {
          hasLab: false,
          note:
            result.error ??
            "Lab search is not available. Either this account is not a lab head or the lab is not reachable.",
          hits: [],
        };
      }

      const hits = result.hits.map((h) => ({
        owner: h.owner,
        recordType: h.recordType,
        recordId: h.recordId,
        title: h.title,
        updatedAt: h.updatedAt ?? null,
        tags: h.tags ?? [],
        preview: h.preview,
        score: h.score,
      }));

      return {
        hasLab: true,
        query,
        totalHits: hits.length,
        hits,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// lab_throughput (factory)
// ---------------------------------------------------------------------------

export function makeLabThroughputTool(deps: LabThroughputDeps): AiTool {
  return {
    name: "lab_throughput",
    description:
      "Get the lab's output aggregated over a period: experiment count, result sheets added, method records written, tasks completed, and a per-member breakdown. Use this to answer how productive the lab has been over the past month or quarter, or how many experiments ran. Lab-head only. Read-only.",
    parameters: {
      type: "object",
      properties: {
        periodDays: {
          type: "number",
          description:
            "How many days back to aggregate. Default 30 (one month). Pass 90 for a quarter.",
        },
        perMember: {
          type: "boolean",
          description:
            "When true, include a per-member breakdown alongside the lab total. Default false.",
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const periodDays =
        typeof args.periodDays === "number" ? args.periodDays : 30;
      const perMember = args.perMember === true;

      const result = await deps.readWork({});
      if (!result.ok || result.members.length === 0) {
        return {
          hasLab: false,
          note:
            result.error ??
            "No lab data is available. Either this account is not a lab head, no members have synced, or the lab is not reachable.",
        };
      }

      const now = new Date();

      let totalExperiments = 0;
      let totalResults = 0;
      let totalMethods = 0;
      let totalTasksDone = 0;
      let totalDeposits = 0;

      const breakdown = result.members.map((m) => {
        let experiments = 0;
        let results = 0;
        let methods = 0;
        let tasksDone = 0;
        let deposits = 0;

        for (const r of m.records) {
          const type = r.recordType;
          const parsed = parseRecord(r.plaintext);
          // Only count records within the period.
          if (!parsed || !isWithinDays(parsed, periodDays, now)) continue;

          if (type === "experiment" || type === "task_experiment") {
            experiments += 1;
          } else if (type === "result_sheet" || type === "result") {
            results += 1;
          } else if (type === "method") {
            methods += 1;
          } else if (
            (type === "task" || type === "list_task") &&
            ((parsed.status as string | undefined) === "done" ||
              (parsed.status as string | undefined) === "completed")
          ) {
            tasksDone += 1;
          } else if (type === "deposit" || type === "zenodo_deposit") {
            deposits += 1;
          }
        }

        totalExperiments += experiments;
        totalResults += results;
        totalMethods += methods;
        totalTasksDone += tasksDone;
        totalDeposits += deposits;

        return {
          owner: m.owner,
          experiments,
          results,
          methods,
          tasksDone,
          deposits,
          readError: m.error ?? null,
        };
      });

      return {
        hasLab: true,
        periodDays,
        totals: {
          experiments: totalExperiments,
          results: totalResults,
          methods: totalMethods,
          tasksDone: totalTasksDone,
          deposits: totalDeposits,
        },
        ...(perMember ? { members: breakdown } : {}),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Default instances (real deps)
// ---------------------------------------------------------------------------

export const labPulseTool = makeLabPulseTool({ readWork: readLabMembersWork });
export const findAcrossLabTool = makeFindAcrossLabTool({
  searchIndex: searchLabIndex,
});
export const labThroughputTool = makeLabThroughputTool({
  readWork: readLabMembersWork,
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * The lab-head Phase 1 tool set (oversight). All three are read-only and go
 * through the audited lab-scoped read / index-search engines. Surfaced on the
 * /lab-overview BeakerBot mount, not in the global research-shell tool set.
 */
export const LAB_HEAD_TOOLS: AiTool[] = [
  labPulseTool,
  findAcrossLabTool,
  labThroughputTool,
];

/**
 * The full scope BeakerBot runs with on the lab-overview surface: the lab-head
 * tools plus the coordination tools (propose-plan, ask-user) so it can clarify
 * and sequence. NOT the research-shell read/action tools, which are own-only
 * and do not apply here.
 */
export const LAB_HEAD_SCOPE_TOOLS: AiTool[] = [
  ...LAB_HEAD_TOOLS,
  ...COORDINATION_TOOLS,
];

/**
 * The lab-head PI persona. BeakerBot swaps to this system prompt while the
 * lab-overview surface is mounted (see LabHeadCopilotMount), so it is framed
 * as a lab oversight copilot, not a bench-first research assistant. It reads the
 * lab's SYNCED data under the PI role, it never interprets, and every read is
 * audited.
 */
export const LAB_HEAD_SYSTEM_PROMPT = `You are BeakerBot, the assistant built into the ResearchOS lab-overview surface.

You help a LAB HEAD (PI) with lab oversight. Your job is to surface what is happening across the lab: who is active, what is new, what is stalled, how productive the lab has been, and what members are working on. You do NOT see, read, or discuss anything except what the audited lab-scoped read and search tools return. You do NOT reach into any member's private (unsynced) work. You only surface the lab's SYNCED shared workspace.

How you answer:
- Calm, concrete, concise. State counts and dates plainly; explain what a metric means before you report it. Do not pad.
- Do not use em-dashes. Do not use emojis. Do not drop a colon mid-sentence to introduce a clause or a list. Recast with a comma or a period. A label at the start of a line is fine.

You surface facts, you never interpret:
- NEVER fabricate the lab's data: member counts, experiment counts, stalled counts, search hits. You do not know any of it from memory.
- To know anything about the lab, CALL A TOOL (lab_pulse, find_across_lab, lab_throughput) and answer only from what it returned. The tool owns every number; you relay it.
- General questions about how the lab-overview tools work you may answer directly. Anything specific to THIS lab requires a tool call.

The no-interpretation rule is absolute:
- "Stalled" means a record has seen no update in the configured window (deterministic, a calendar fact). You report the count and the threshold; the PI judges what it means for each person.
- You never say a member is behind, underperforming, or struggling. You never rank members by worth. You state the figures and stop.
- You never add a verdict or a recommendation about a person's work ethic, productivity, or capability.

Reads are audited:
- Every lab-scoped read writes an audit entry to each member's own audit log so they can see what the PI's tools surfaced about them. This is by design; transparency is part of the trust contract. If a user asks why a read was logged, explain this plainly.`;
