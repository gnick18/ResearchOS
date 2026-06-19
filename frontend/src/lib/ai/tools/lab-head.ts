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
import {
  oneOnOnesApi,
  labApi,
  checkinRotationsApi,
  checkinOnboardingApi,
  idpsApi,
  purchasesApi,
} from "@/lib/local-api";
import type {
  OneOnOne,
  OneOnOneActionItem,
  Note,
  CheckinRotation,
  CheckinOnboarding,
  FundingAccount,
} from "@/lib/types";

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
// Default instances (real deps) -- Phase 1
// ---------------------------------------------------------------------------

export const labPulseTool = makeLabPulseTool({ readWork: readLabMembersWork });
export const findAcrossLabTool = makeFindAcrossLabTool({
  searchIndex: searchLabIndex,
});
export const labThroughputTool = makeLabThroughputTool({
  readWork: readLabMembersWork,
});

// ===========================================================================
// Phase 2: Mentorship tools
// ===========================================================================
//
// These three tools support the PI's mentoring work: preparing for a one-on-one
// meeting, preparing the lab's group meeting (resolving the presenter rotation),
// and setting up the mentorship space + onboarding checklist for a new member.
//
// Audit path: only reads that go through readLabMembersWork (readWork) write
// audit entries. The 1:1, IDP-status, and rotation reads are shared-space or
// existence-only reads (the PI is already a member of those spaces, or they are
// reading an existence flag with no content), so they do not produce separate
// audit entries.
//
// No emojis, no em-dashes, no mid-sentence colons.

// ---------------------------------------------------------------------------
// Dep types -- Phase 2
// ---------------------------------------------------------------------------

export interface PrepOneOnOneDeps {
  readWork: typeof readLabMembersWork;
  listOneOnOnes: () => Promise<OneOnOne[]>;
  getActionItems: (spaceId: string) => Promise<OneOnOneActionItem[]>;
  getMeetingNotes: (spaceId: string) => Promise<Note[]>;
  getIdpStatus: (
    username: string,
  ) => Promise<{ exists: boolean; updated_at: string | null }>;
}

export interface LabMeetingPrepDeps {
  readWork: typeof readLabMembersWork;
  listOneOnOnes: () => Promise<OneOnOne[]>;
  getRotation: (spaceId: string) => Promise<CheckinRotation | null>;
}

export interface OnboardMemberDeps {
  createOneOnOne: (params: {
    members: string[];
    mentor?: string | null;
    title?: string | null;
  }) => Promise<OneOnOne>;
  createOnboardingForSpace: (spaceId: string) => Promise<CheckinOnboarding>;
}

// ---------------------------------------------------------------------------
// prep_one_on_one (factory)
// ---------------------------------------------------------------------------

export function makePrepOneOnOneTool(deps: PrepOneOnOneDeps): AiTool {
  return {
    name: "prep_one_on_one",
    description:
      "Assemble a structured one-on-one meeting prep for a specific trainee. Returns the trainee's recent shared work (counts by type and record titles), their open action items from the 1:1 space, the last check-in date, what has changed since that check-in, their next scheduled meeting date, and whether an IDP exists and when it was last updated (never its contents). The model uses these facts to draft an agenda; the tool supplies only facts. Lab-head only. Read-only.",
    parameters: {
      type: "object",
      properties: {
        trainee: {
          type: "string",
          description: "The trainee's username (required).",
        },
        sinceDays: {
          type: "number",
          description:
            "How many days back to look for recent work. Default 30 (one month).",
        },
      },
      required: ["trainee"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const trainee =
        typeof args.trainee === "string" ? args.trainee.trim() : "";
      const sinceDays =
        typeof args.sinceDays === "number" ? args.sinceDays : 30;

      if (!trainee) {
        return {
          hasLab: false,
          note: "trainee is required.",
        };
      }

      // 1. Audited lab-scoped read. The audit entry is written per member by
      //    readLabMembersWork; we then filter to the trainee in memory (no
      //    single-member param exists on the API).
      const workResult = await deps.readWork({});
      if (!workResult.ok) {
        return {
          hasLab: false,
          note:
            workResult.error ??
            "Lab data is not available. Either this account is not a lab head or the lab is not reachable.",
        };
      }

      const memberEntry = workResult.members.find((m) => m.owner === trainee);
      if (!memberEntry) {
        return {
          hasLab: false,
          note: `Trainee "${trainee}" was not found in the lab's synced membership. Confirm the username and that they have synced at least once.`,
        };
      }

      const now = new Date();

      // Collect recent records within the window.
      const recentRecords = memberEntry.records.filter((r) => {
        const parsed = parseRecord(r.plaintext);
        return parsed !== null && isWithinDays(parsed, sinceDays, now);
      });

      // Count by type.
      let experiments = 0;
      let notes = 0;
      let results = 0;
      let tasksDone = 0;
      let tasksOverdue = 0;
      const recentTitles: string[] = [];

      for (const r of recentRecords) {
        const parsed = parseRecord(r.plaintext);
        if (!parsed) continue;
        const type = r.recordType;
        if (type === "experiment" || type === "task_experiment") {
          experiments += 1;
        } else if (type === "notes_sheet" || type === "note") {
          notes += 1;
        } else if (type === "result_sheet" || type === "result") {
          results += 1;
        } else if (type === "task" || type === "list_task") {
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
        // Collect title when present.
        const title =
          (parsed.title as string | undefined) ??
          (parsed.name as string | undefined);
        if (title) recentTitles.push(title);
      }

      // 2. 1:1 space: list all spaces the viewer participates in and find the
      //    pair space with the trainee. Not a new audited read; oneOnOnesApi.list
      //    returns only spaces the current user is already a member of.
      const spaces = await deps.listOneOnOnes();
      // Prefer a "pair" space containing the trainee. If multiple exist take the
      // one with a next_meeting_date, otherwise the first.
      const traineeSpaces = spaces.filter(
        (s) => Array.isArray(s.members) && s.members.includes(trainee),
      );
      const pairSpaces = traineeSpaces.filter((s) => s.kind === "pair");
      const candidates = pairSpaces.length > 0 ? pairSpaces : traineeSpaces;
      const space =
        candidates.find((s) => s.next_meeting_date) ?? candidates[0] ?? null;

      let lastMeetingDate: string | null = null;
      let nextMeetingDate: string | null = null;
      let openActionItems: Array<{
        text: string;
        assignee?: string | null;
        due_date?: string | null;
      }> = [];
      let changedSinceLastMeetingCount = 0;

      if (space) {
        nextMeetingDate = space.next_meeting_date ?? null;

        // 3. Open action items from the 1:1 space. This is a shared-space read;
        //    the PI is already a member so no additional audit entry is written.
        const allItems = await deps.getActionItems(space.id);
        openActionItems = allItems
          .filter((item) => !item.is_done)
          .map((item) => ({
            text: item.text,
            assignee: item.assignee ?? null,
            due_date: item.due_date ?? null,
          }));

        // 4. Last check-in: meeting notes sorted newest-first.
        const allNotes = await deps.getMeetingNotes(space.id);
        const meetingNotes = allNotes
          .filter((n) => n.note_kind === "meeting")
          .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
        lastMeetingDate = meetingNotes[0]?.updated_at ?? null;

        // What changed since last check-in: records updated after that date.
        if (lastMeetingDate) {
          const lastMeetingMs = new Date(lastMeetingDate).getTime();
          changedSinceLastMeetingCount = memberEntry.records.filter((r) => {
            const parsed = parseRecord(r.plaintext);
            if (!parsed) return false;
            const stamp =
              (parsed.updated_at as string | undefined) ??
              (parsed.updatedAt as string | undefined) ??
              (parsed.created_at as string | undefined);
            if (!stamp) return false;
            const d = new Date(stamp);
            return !isNaN(d.getTime()) && d.getTime() > lastMeetingMs;
          }).length;
        }
      }

      // 5. IDP status: existence + updated_at only (never contents). NSF
      //    compliance: the PI sees only that a plan exists. This is an
      //    existence-only read on the trainee's shared data -- not an audited
      //    lab-scoped record pull.
      const idpStatus = await deps.getIdpStatus(trainee);

      return {
        hasLab: true,
        trainee,
        sinceDays,
        lastMeetingDate,
        nextMeetingDate,
        openActionItems,
        recentWork: {
          experiments,
          notes,
          results,
          tasksDone,
          tasksOverdue,
          recentTitles: recentTitles.slice(0, 10),
        },
        changedSinceLastMeeting: { count: changedSinceLastMeetingCount },
        idp: {
          exists: idpStatus.exists,
          updatedAt: idpStatus.updated_at,
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// lab_meeting_prep (factory)
// ---------------------------------------------------------------------------

export function makeLabMeetingPrepTool(deps: LabMeetingPrepDeps): AiTool {
  return {
    name: "lab_meeting_prep",
    description:
      "Assemble a lab meeting prep brief. Resolves the current presenter from the group check-in space's rotation (or uses an explicit presenter override), then surfaces that person's recent shared work (counts + titles). Pass spaceId to target a specific group space; otherwise the first group space (3+ members) is used. Pass track to select a named rotation track (defaults to the first). The model drafts the meeting outline from the returned facts. Lab-head only. Read-only.",
    parameters: {
      type: "object",
      properties: {
        spaceId: {
          type: "string",
          description:
            "The group check-in space id. Omit to use the first group space found.",
        },
        presenter: {
          type: "string",
          description:
            "Override the rotation and use this username as the presenter.",
        },
        track: {
          type: "string",
          description:
            "The rotation track name to use (e.g. 'Data presentation'). Defaults to the first track.",
        },
        sinceDays: {
          type: "number",
          description:
            "How many days back to look for recent presenter work. Default 30.",
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const spaceIdArg =
        typeof args.spaceId === "string" ? args.spaceId.trim() : "";
      const presenterOverride =
        typeof args.presenter === "string" ? args.presenter.trim() : "";
      const trackArg =
        typeof args.track === "string" ? args.track.trim() : "";
      const sinceDays =
        typeof args.sinceDays === "number" ? args.sinceDays : 30;

      // 1. Audited lab-scoped read first (preserves audit ordering).
      const workResult = await deps.readWork({});
      if (!workResult.ok) {
        return {
          hasLab: false,
          note:
            workResult.error ??
            "Lab data is not available. Either this account is not a lab head or the lab is not reachable.",
        };
      }

      // 2. Resolve the group space. Not a new audited read; list only returns
      //    spaces the PI is already a member of.
      let resolvedSpaceId = spaceIdArg;
      if (!resolvedSpaceId) {
        const spaces = await deps.listOneOnOnes();
        const groupSpace = spaces.find(
          (s) => s.kind === "group" || (Array.isArray(s.members) && s.members.length >= 3),
        );
        if (!groupSpace) {
          return {
            hasLab: true,
            note: "No group check-in space was found. Create a group check-in space to enable lab meeting prep.",
            presenter: null,
            rotation: null,
            recentWork: null,
          };
        }
        resolvedSpaceId = groupSpace.id;
      }

      // 3. Presenter and rotation.
      let presenter = presenterOverride || null;
      let rotationContext: {
        track: string;
        order: string[];
        currentIndex: number;
      } | null = null;

      if (!presenter) {
        const rotation = await deps.getRotation(resolvedSpaceId);
        if (!rotation || rotation.tracks.length === 0) {
          return {
            hasLab: true,
            note: "No rotation found for this group space. Start a rotation to enable automatic presenter resolution.",
            presenter: null,
            rotation: null,
            recentWork: null,
          };
        }
        const track = trackArg
          ? (rotation.tracks.find((t) => t.name === trackArg) ?? rotation.tracks[0])
          : rotation.tracks[0];
        if (track.order.length === 0) {
          return {
            hasLab: true,
            note: "The rotation track has no members in its order list.",
            presenter: null,
            rotation: null,
            recentWork: null,
          };
        }
        presenter = track.order[track.current_index] ?? track.order[0];
        rotationContext = {
          track: track.name,
          order: track.order,
          currentIndex: track.current_index,
        };
      }

      // 4. Presenter's recent work: filter from the already-read lab data.
      const memberEntry = workResult.members.find((m) => m.owner === presenter);
      const now = new Date();
      let experiments = 0;
      let notes = 0;
      let results = 0;
      const recentTitles: string[] = [];

      if (memberEntry) {
        for (const r of memberEntry.records) {
          const parsed = parseRecord(r.plaintext);
          if (!parsed || !isWithinDays(parsed, sinceDays, now)) continue;
          const type = r.recordType;
          if (type === "experiment" || type === "task_experiment") {
            experiments += 1;
          } else if (type === "notes_sheet" || type === "note") {
            notes += 1;
          } else if (type === "result_sheet" || type === "result") {
            results += 1;
          }
          const title =
            (parsed.title as string | undefined) ??
            (parsed.name as string | undefined);
          if (title) recentTitles.push(title);
        }
      }

      return {
        hasLab: true,
        presenter,
        spaceId: resolvedSpaceId,
        sinceDays,
        rotation: rotationContext,
        recentWork: {
          experiments,
          notes,
          results,
          recentTitles: recentTitles.slice(0, 10),
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// onboard_member (factory)
// ---------------------------------------------------------------------------

export function makeOnboardMemberTool(deps: OnboardMemberDeps): AiTool {
  return {
    name: "onboard_member",
    description:
      "Set up onboarding for an EXISTING lab member: create a one-on-one mentorship space (the PI is auto-included as the creator) and seed a starter onboarding checklist (~5 items). The member must already be in the lab; member provisioning and invite links use a separate flow. This is an ACTION that runs only after the PI confirms. Non-destructive.",
    parameters: {
      type: "object",
      properties: {
        member: {
          type: "string",
          description: "The existing lab member's username (required).",
        },
        title: {
          type: "string",
          description:
            "Optional title for the mentorship space. Defaults to 'Onboarding <member>'.",
        },
      },
      required: ["member"],
      additionalProperties: false,
    },
    action: true,
    isDestructive: () => false,
    describeAction: (args) => {
      const member =
        typeof args.member === "string" ? args.member.trim() : "(unknown)";
      return {
        summary: `Set up onboarding for ${member}: create a one-on-one mentorship space and seed a starter onboarding checklist.`,
      };
    },
    execute: async (args) => {
      const member =
        typeof args.member === "string" ? args.member.trim() : "";
      const title =
        typeof args.title === "string" && args.title.trim()
          ? args.title.trim()
          : null;

      if (!member) {
        return { ok: false, error: "member is required." };
      }

      // Create the 1:1 space. oneOnOnesApi.create auto-inserts the current user
      // (the PI) as members[0], so passing [member] is correct -- the PI is
      // force-included by the API and becomes the creator + owner. The PI is set
      // as the mentor because they are auto-inserted into members[].
      //
      // NOTE: protocol assignment and inventory provisioning are DEFERRED.
      // No method-assignment or blank-member-create API exists; members join
      // via invite. This tool only sets up the mentorship space + checklist.
      // Protocol assignment is a future enhancement once an assignment API ships.
      let space: OneOnOne;
      try {
        space = await deps.createOneOnOne({
          members: [member],
          // mentor is resolved to null here because we cannot call the PI's
          // username synchronously; the create impl auto-includes the PI in
          // members[] so the caller's UI can set mentor after creation if needed.
          mentor: null,
          title: title ?? `Onboarding ${member}`,
        });
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      // Seed the onboarding checklist. Idempotent: returns the existing one if
      // already present.
      let checklistSeeded = false;
      try {
        await deps.createOnboardingForSpace(space.id);
        checklistSeeded = true;
      } catch (err) {
        // The space was created successfully; log the checklist failure but do
        // not surface it as a fatal error so the PI still gets the space id.
        console.warn("[onboard_member] checklist seed failed:", err);
      }

      return {
        ok: true,
        spaceId: space.id,
        member,
        checklistSeeded,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Default instances (real deps) -- Phase 2
// ---------------------------------------------------------------------------

export const prepOneOnOneTool = makePrepOneOnOneTool({
  readWork: readLabMembersWork,
  listOneOnOnes: () => oneOnOnesApi.list(),
  getActionItems: (spaceId) => labApi.getOneOnOneActionItems(spaceId),
  getMeetingNotes: (spaceId) => labApi.getOneOnOneNotes(spaceId),
  getIdpStatus: (username) => idpsApi.getStatusForMember(username),
});

export const labMeetingPrepTool = makeLabMeetingPrepTool({
  readWork: readLabMembersWork,
  listOneOnOnes: () => oneOnOnesApi.list(),
  getRotation: (spaceId) => checkinRotationsApi.getForSpace(spaceId),
});

export const onboardMemberTool = makeOnboardMemberTool({
  createOneOnOne: (params) => oneOnOnesApi.create(params),
  createOnboardingForSpace: (spaceId) =>
    checkinOnboardingApi.createForSpace(spaceId),
});

// ===========================================================================
// Phase 3: Grants tools
// ===========================================================================
//
// Two tools support the PI's grant-reporting work: grant_tagged_rollup returns
// every lab record tagged to a specific grant (direct links on projects and
// purchases, plus tasks reverse-mapped through their project), and
// progress_report_scaffold assembles an RPPR-style scaffold over a date window.
//
// The tool owns every number and every record link. The model only narrates.
// The tool NEVER claims significance or impact. The PI writes the narrative.
//
// Audit path: both tools call readLabMembersWork (readWork) which writes an
// audit entry to each member's log. The fundingAccounts read is the PI's own
// local store -- no additional audit entry is written for that fetch.
//
// Markdown sheets (result_sheet, notes_sheet): parseRecord returns null for
// these because they are UTF-8 prose, not JSON. For counts that is fine
// (we count by recordType regardless of parse success). When we need a title
// from a markdown sheet, we decode the plaintext as UTF-8 and take the first
// non-empty line; we do not assume JSON.
//
// dmsp_compliance is NOT built: no deposit-record infrastructure exists.
//
// No emojis, no em-dashes, no mid-sentence colons.

// ---------------------------------------------------------------------------
// Helpers -- Phase 3
// ---------------------------------------------------------------------------

/**
 * Decode a Uint8Array as UTF-8 and return the first non-empty trimmed line.
 * Used to extract a title from markdown sheets (result_sheet, notes_sheet)
 * where parseRecord returns null. Returns null when the buffer is empty or
 * has no non-empty line.
 */
function firstMarkdownLine(plain: Uint8Array): string | null {
  try {
    const text = new TextDecoder().decode(plain);
    for (const line of text.split("\n")) {
      const trimmed = line.replace(/^#+\s*/, "").trim();
      if (trimmed) return trimmed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Return a display-friendly title from a record. Tries JSON title/name first
 * (via parseRecord), then falls back to firstMarkdownLine for sheets.
 */
function recordTitle(
  plain: Uint8Array,
  recordType: string,
): string | null {
  const parsed = parseRecord(plain);
  if (parsed) {
    const t =
      (parsed.title as string | undefined) ??
      (parsed.name as string | undefined);
    if (t) return t;
  }
  // Markdown sheets carry no JSON title; try first heading line.
  if (recordType === "result_sheet" || recordType === "notes_sheet") {
    return firstMarkdownLine(plain);
  }
  return null;
}

/**
 * Return true when a record's best timestamp falls within the window
 * [windowStart, windowEnd]. Both boundaries are inclusive.
 */
function isWithinWindow(
  rec: Record<string, unknown>,
  windowStart: Date,
  windowEnd: Date,
): boolean {
  const stamp =
    (rec.updated_at as string | undefined) ??
    (rec.updatedAt as string | undefined) ??
    (rec.created_at as string | undefined);
  if (!stamp) return false;
  const d = new Date(stamp);
  if (isNaN(d.getTime())) return false;
  return d.getTime() >= windowStart.getTime() && d.getTime() <= windowEnd.getTime();
}

// ---------------------------------------------------------------------------
// Dep types -- Phase 3
// ---------------------------------------------------------------------------

export interface GrantTaggedRollupDeps {
  readWork: typeof readLabMembersWork;
  listFundingAccounts: () => Promise<FundingAccount[]>;
}

export interface ProgressReportScaffoldDeps {
  readWork: typeof readLabMembersWork;
  listFundingAccounts: () => Promise<FundingAccount[]>;
}

// ---------------------------------------------------------------------------
// grant_tagged_rollup (factory)
// ---------------------------------------------------------------------------

export function makeGrantTaggedRollupTool(
  deps: GrantTaggedRollupDeps,
): AiTool {
  return {
    name: "grant_tagged_rollup",
    description:
      "Roll up all lab records tagged to a specific grant (funding account). Returns direct-linked projects and purchases, plus tasks reverse-mapped through their project's grant link. Produces a per-member breakdown and a flat recordLinks list. Read-only. Lab-head only. The tool supplies counts and record links; the PI writes narrative and the model never claims significance.",
    parameters: {
      type: "object",
      properties: {
        grantId: {
          type: "number",
          description:
            "The funding account id to roll up (required). Find ids via the Funding section or by asking which grants exist.",
        },
      },
      required: ["grantId"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const grantId =
        typeof args.grantId === "number" ? args.grantId : null;
      if (grantId === null) {
        return {
          hasGrant: false,
          note: "grantId is required and must be a number.",
        };
      }

      // Resolve the funding account from the PI's own store (no audit entry).
      let accounts: FundingAccount[];
      try {
        accounts = await deps.listFundingAccounts();
      } catch {
        accounts = [];
      }
      const grant = accounts.find((a) => a.id === grantId) ?? null;
      if (!grant) {
        return {
          hasGrant: false,
          note: `No funding account with id ${grantId} was found. Check the grant id and try again.`,
        };
      }

      // Audited lab-scoped read.
      const workResult = await deps.readWork({});
      if (!workResult.ok || workResult.members.length === 0) {
        return {
          hasLab: false,
          note:
            workResult.error ??
            "No lab data is available. Either this account is not a lab head, no members have synced, or the lab is not reachable.",
        };
      }

      // Per-member aggregation.
      //
      // Grant-G project ids are PER-OWNER because numeric ids live in each
      // user's local folder and may collide across users. We track
      // (owner, project_id) pairs via a Map<owner, Set<project_id>>.
      //
      // Task reverse-map: a task belongs to grant G when its project_id is
      // in the set of grant-G project ids for the SAME owner.
      //
      // Purchase direct-link: a purchase (recordType "purchase" or
      // "purchase_item") carries funding_account_id directly.

      interface RecordLink {
        owner: string;
        recordType: string;
        recordId: string;
        title: string | null;
      }

      interface MemberBreakdown {
        owner: string;
        projects: number;
        tasks: number;
        purchases: number;
        readError: string | null;
      }

      const recordLinks: RecordLink[] = [];
      const memberBreakdowns: MemberBreakdown[] = [];

      let totalProjects = 0;
      let totalTasks = 0;
      let totalPurchases = 0;

      for (const member of workResult.members) {
        // Pass 1: collect grant-G project ids for this owner.
        const grantProjectIds = new Set<number>();
        for (const r of member.records) {
          if (r.recordType === "project") {
            const parsed = parseRecord(r.plaintext);
            if (
              parsed &&
              (parsed.funding_account_id as number | null | undefined) ===
                grantId
            ) {
              const pid = parsed.id as number | undefined;
              if (typeof pid === "number") grantProjectIds.add(pid);
            }
          }
        }

        let mProjects = 0;
        let mTasks = 0;
        let mPurchases = 0;

        // Pass 2: collect all grant-tagged records.
        for (const r of member.records) {
          const type = r.recordType;

          if (type === "project") {
            const parsed = parseRecord(r.plaintext);
            if (
              parsed &&
              (parsed.funding_account_id as number | null | undefined) ===
                grantId
            ) {
              mProjects += 1;
              recordLinks.push({
                owner: member.owner,
                recordType: type,
                recordId: r.recordId,
                title: recordTitle(r.plaintext, type),
              });
            }
          } else if (type === "task" || type === "list_task" || type === "task_experiment") {
            // Tasks reverse-map through project_id -> grant.
            const parsed = parseRecord(r.plaintext);
            if (parsed) {
              const pid = parsed.project_id as number | undefined | null;
              if (typeof pid === "number" && grantProjectIds.has(pid)) {
                mTasks += 1;
                recordLinks.push({
                  owner: member.owner,
                  recordType: type,
                  recordId: r.recordId,
                  title: recordTitle(r.plaintext, type),
                });
              }
            }
          } else if (type === "purchase" || type === "purchase_item") {
            // Purchases carry funding_account_id directly.
            const parsed = parseRecord(r.plaintext);
            if (
              parsed &&
              (parsed.funding_account_id as number | null | undefined) ===
                grantId
            ) {
              mPurchases += 1;
              recordLinks.push({
                owner: member.owner,
                recordType: type,
                recordId: r.recordId,
                title: recordTitle(r.plaintext, type),
              });
            }
          }
        }

        totalProjects += mProjects;
        totalTasks += mTasks;
        totalPurchases += mPurchases;

        memberBreakdowns.push({
          owner: member.owner,
          projects: mProjects,
          tasks: mTasks,
          purchases: mPurchases,
          readError: member.error ?? null,
        });
      }

      return {
        hasGrant: true,
        hasLab: true,
        grant: {
          id: grant.id,
          name: grant.name,
          awardNumber: grant.award_number ?? null,
          funderName: grant.funder_name ?? null,
          awardTitle: grant.award_title ?? null,
        },
        totals: {
          projects: totalProjects,
          tasks: totalTasks,
          purchases: totalPurchases,
        },
        members: memberBreakdowns,
        recordLinks,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// progress_report_scaffold (factory)
// ---------------------------------------------------------------------------

// Depositable output record types for the "products" RPPR section. These are
// the record types that represent lab outputs which could eventually be
// deposited externally. deposit/zenodo_deposit are NOT listed here because
// deposit tracking is external to ResearchOS (see the products note string).
const DEPOSITABLE_OUTPUT_TYPES = new Set([
  "datahub",
  "sequence",
  "phylo",
  "molecule",
  "method",
]);

export function makeProgressReportScaffoldTool(
  deps: ProgressReportScaffoldDeps,
): AiTool {
  return {
    name: "progress_report_scaffold",
    description:
      "Assemble an RPPR-style progress report scaffold for a grant period. Aggregates accomplishments (experiments + result sheets), products (depositable outputs), and participant counts from the lab's synced records within the date window. Optionally restricts to records tagged to a specific grant. The tool supplies counts, record titles, and a section structure; it NEVER writes narrative and NEVER claims significance or impact. The PI writes the narrative. Lab-head only. Read-only.",
    parameters: {
      type: "object",
      properties: {
        grantId: {
          type: "number",
          description:
            "Optional. When given, restrict to records tagged to this funding account id. When omitted, covers the whole lab.",
        },
        periodStart: {
          type: "string",
          description:
            "ISO 8601 date string for the start of the reporting period (inclusive). Default is 365 days before periodEnd.",
        },
        periodEnd: {
          type: "string",
          description:
            "ISO 8601 date string for the end of the reporting period (inclusive). Default is now.",
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      // Resolve the reporting period.
      const now = new Date();
      let periodEnd = now;
      if (typeof args.periodEnd === "string" && args.periodEnd.trim()) {
        const parsed = new Date(args.periodEnd.trim());
        if (!isNaN(parsed.getTime())) periodEnd = parsed;
      }
      let periodStart = new Date(periodEnd.getTime() - 365 * 24 * 60 * 60 * 1000);
      if (typeof args.periodStart === "string" && args.periodStart.trim()) {
        const parsed = new Date(args.periodStart.trim());
        if (!isNaN(parsed.getTime())) periodStart = parsed;
      }

      const grantId =
        typeof args.grantId === "number" ? args.grantId : null;

      // Resolve the funding account when grantId is given.
      let grant: {
        id: number;
        name: string;
        awardNumber: string | null;
        funderName: string | null;
        awardTitle: string | null;
      } | null = null;

      if (grantId !== null) {
        let accounts: FundingAccount[];
        try {
          accounts = await deps.listFundingAccounts();
        } catch {
          accounts = [];
        }
        const fa = accounts.find((a) => a.id === grantId) ?? null;
        if (!fa) {
          return {
            hasLab: false,
            note: `No funding account with id ${grantId} was found. Check the grant id and try again.`,
          };
        }
        grant = {
          id: fa.id,
          name: fa.name,
          awardNumber: fa.award_number ?? null,
          funderName: fa.funder_name ?? null,
          awardTitle: fa.award_title ?? null,
        };
      }

      // Audited lab-scoped read.
      const workResult = await deps.readWork({});
      if (!workResult.ok || workResult.members.length === 0) {
        return {
          hasLab: false,
          note:
            workResult.error ??
            "No lab data is available. Either this account is not a lab head, no members have synced, or the lab is not reachable.",
        };
      }

      // Section accumulators.
      // accomplishments: experiments + result_sheets
      let accomplishmentsExperiments = 0;
      let accomplishmentsResults = 0;
      const accomplishmentTitles: string[] = [];

      // products: depositable outputs
      const productCounts: Record<string, number> = {};
      const productTitles: string[] = [];

      // participants: per-member counts
      const participantBreakdown: Array<{
        owner: string;
        experiments: number;
        results: number;
        readError: string | null;
      }> = [];

      let totalRecordsInPeriod = 0;

      for (const member of workResult.members) {
        // For grant filtering: build grant-G project id set for this owner.
        let grantProjectIds: Set<number> | null = null;
        if (grantId !== null) {
          grantProjectIds = new Set<number>();
          for (const r of member.records) {
            if (r.recordType === "project") {
              const parsed = parseRecord(r.plaintext);
              if (
                parsed &&
                (parsed.funding_account_id as number | null | undefined) ===
                  grantId
              ) {
                const pid = parsed.id as number | undefined;
                if (typeof pid === "number") grantProjectIds.add(pid);
              }
            }
          }
        }

        let mExperiments = 0;
        let mResults = 0;

        for (const r of member.records) {
          const type = r.recordType;

          // Determine if this record belongs to the grant (when filtering).
          if (grantId !== null && grantProjectIds !== null) {
            // Direct grant link on the record.
            const parsed = parseRecord(r.plaintext);
            const directMatch =
              parsed &&
              (parsed.funding_account_id as number | null | undefined) ===
                grantId;
            // Reverse-map for tasks.
            const taskMatch =
              (type === "task" ||
                type === "list_task" ||
                type === "task_experiment") &&
              parsed !== null &&
              typeof (parsed.project_id as unknown) === "number" &&
              grantProjectIds.has(parsed.project_id as number);
            if (!directMatch && !taskMatch) continue;
          }

          // Period window filter.
          // Markdown sheets do not parse as JSON, so we attempt a direct
          // UTF-8 decode for their timestamp instead of using parseRecord.
          // For JSON records we already have parsed above; for markdown sheets
          // we re-attempt a JSON parse (which returns null) and then skip the
          // isWithinWindow check, defaulting to include them in the period
          // (they are undated by design). Better to over-count than silently
          // drop result sheets from reports.
          const parsed = parseRecord(r.plaintext);
          if (parsed) {
            if (!isWithinWindow(parsed, periodStart, periodEnd)) continue;
          }
          // Records with no parseable JSON and no timestamp fall through:
          // we include them in the section counts when grant filtering allows.
          // This means undated markdown sheets are included; the PI can note
          // which titles are present and decide their relevance.

          totalRecordsInPeriod += 1;

          if (type === "experiment" || type === "task_experiment") {
            accomplishmentsExperiments += 1;
            mExperiments += 1;
            const title = recordTitle(r.plaintext, type);
            if (title) accomplishmentTitles.push(title);
          } else if (type === "result_sheet" || type === "result") {
            accomplishmentsResults += 1;
            mResults += 1;
            const title = recordTitle(r.plaintext, type);
            if (title) accomplishmentTitles.push(title);
          } else if (DEPOSITABLE_OUTPUT_TYPES.has(type)) {
            productCounts[type] = (productCounts[type] ?? 0) + 1;
            const title = recordTitle(r.plaintext, type);
            if (title) productTitles.push(title);
          }
        }

        participantBreakdown.push({
          owner: member.owner,
          experiments: mExperiments,
          results: mResults,
          readError: member.error ?? null,
        });
      }

      return {
        hasLab: true,
        grant,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        totals: {
          recordsInPeriod: totalRecordsInPeriod,
          accomplishmentsExperiments,
          accomplishmentsResults,
          products: Object.values(productCounts).reduce((s, n) => s + n, 0),
        },
        sections: {
          accomplishments: {
            experiments: accomplishmentsExperiments,
            results: accomplishmentsResults,
            titles: accomplishmentTitles.slice(0, 20),
          },
          products: {
            counts: productCounts,
            titles: productTitles.slice(0, 20),
            note: "This section lists depositable output records that exist in ResearchOS. Deposit tracking and DOI assignment happen outside ResearchOS (Zenodo, Figshare, etc.). This section does not confirm that any output has been deposited or assigned a DOI.",
          },
          participants: {
            members: participantBreakdown,
          },
        },
        note: "The tool supplies counts, record links, and section structure. The PI writes all narrative. No significance or impact is claimed here.",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Default instances (real deps) -- Phase 3
// ---------------------------------------------------------------------------

export const grantTaggedRollupTool = makeGrantTaggedRollupTool({
  readWork: readLabMembersWork,
  listFundingAccounts: () => purchasesApi.listFundingAccounts(),
});

export const progressReportScaffoldTool = makeProgressReportScaffoldTool({
  readWork: readLabMembersWork,
  listFundingAccounts: () => purchasesApi.listFundingAccounts(),
});

// ===========================================================================
// Phase 4: Operations tools
// ===========================================================================
//
// Three tools support the PI's day-to-day lab operations: reorder_digest
// surfaces which supplies are low or out and which orders have not yet been
// placed, spend_summary aggregates purchase spend by vendor and/or grant over
// a date window, and inventory_audit flags expiring / out-of-stock /
// unlocated stocks.
//
// Lab supplies, ordering, and budget are all billed to the PI, so the PI lens
// is the natural one for these tools. They surface what is low, what is on
// order, what has been spent, and what is expiring or unlocated. The tool
// supplies every count and every dollar figure; the model never judges whether
// spending or stock levels are good or bad.
//
// Audit path: every read goes through readLabMembersWork (readWork), which
// writes an audit entry to each member's log. listFundingAccounts is the PI's
// own store and does not produce an audit entry.
//
// Record types used:
//   "inventory"       -- InventoryItem (the catalog entry: what a thing IS)
//   "inventory_stock" -- InventoryStock (the physical containers of one item)
//   "purchase"        -- PurchaseItem (an order line item)
//
// Per-owner isolation: numeric ids (item_id on stocks, funding_account_id on
// purchases) live in each user's local folder and may collide across users.
// Stocks are joined to items via (owner, item_id) -- never across owners.
//
// No emojis, no em-dashes, no mid-sentence colons.

// ---------------------------------------------------------------------------
// Dep types -- Phase 4
// ---------------------------------------------------------------------------

export interface ReorderDigestDeps {
  readWork: typeof readLabMembersWork;
}

export interface SpendSummaryDeps {
  readWork: typeof readLabMembersWork;
  listFundingAccounts: () => Promise<FundingAccount[]>;
}

export interface InventoryAuditDeps {
  readWork: typeof readLabMembersWork;
}

// ---------------------------------------------------------------------------
// reorder_digest (factory)
// ---------------------------------------------------------------------------

export function makeReorderDigestTool(deps: ReorderDigestDeps): AiTool {
  return {
    name: "reorder_digest",
    description:
      "Get a digest of which lab supplies are low or out of stock and which purchase orders have not yet been placed. LOW: an item whose summed container_count is below its low_at_count threshold OR any of its stocks have status 'low'. OUT: an item whose container_count sum is zero OR any of its stocks have status 'empty'. Returns per-member breakdowns and a flat reorder queue (purchases with order_status 'needs_ordering'). Read-only. Lab-head only.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: async (_args) => {
      const result = await deps.readWork({});
      if (!result.ok || result.members.length === 0) {
        return {
          hasLab: false,
          note:
            result.error ??
            "No lab data is available. Either this account is not a lab head, no members have synced, or the lab is not reachable.",
        };
      }

      interface LowItem {
        owner: string;
        itemId: number;
        name: string;
        count: number;
        threshold: number | null;
        vendor: string | null;
      }
      interface OutItem {
        owner: string;
        itemId: number;
        name: string;
        vendor: string | null;
      }
      interface ReorderQueueEntry {
        owner: string;
        itemName: string;
        vendor: string | null;
        assignedTo: string | null;
      }

      const lowItems: LowItem[] = [];
      const outItems: OutItem[] = [];
      const reorderQueue: ReorderQueueEntry[] = [];

      const memberSummaries: Array<{
        owner: string;
        low: number;
        out: number;
        pending: number;
      }> = [];

      for (const member of result.members) {
        // Collect items and stocks for this owner only.
        const itemMap = new Map<
          number,
          { name: string; vendor: string | null; low_at_count: number | null }
        >();
        const stocksByItem = new Map<
          number,
          Array<{ container_count: number; status: string }>
        >();
        let pendingCount = 0;

        for (const r of member.records) {
          const parsed = parseRecord(r.plaintext);
          if (!parsed) continue;

          if (r.recordType === "inventory") {
            const id = parsed.id as number | undefined;
            if (typeof id !== "number") continue;
            itemMap.set(id, {
              name: (parsed.name as string | undefined) ?? "(unnamed)",
              vendor: (parsed.vendor as string | null | undefined) ?? null,
              low_at_count:
                typeof parsed.low_at_count === "number"
                  ? parsed.low_at_count
                  : null,
            });
          } else if (r.recordType === "inventory_stock") {
            const itemId = parsed.item_id as number | undefined;
            if (typeof itemId !== "number") continue;
            const count =
              typeof parsed.container_count === "number"
                ? parsed.container_count
                : 0;
            const status =
              (parsed.status as string | undefined) ?? "in_stock";
            const existing = stocksByItem.get(itemId) ?? [];
            existing.push({ container_count: count, status });
            stocksByItem.set(itemId, existing);
          } else if (r.recordType === "purchase") {
            const orderStatus =
              (parsed.order_status as string | undefined) ?? "needs_ordering";
            if (orderStatus === "needs_ordering") {
              pendingCount += 1;
              reorderQueue.push({
                owner: member.owner,
                itemName:
                  (parsed.item_name as string | undefined) ?? "(unnamed)",
                vendor: (parsed.vendor as string | null | undefined) ?? null,
                assignedTo:
                  (parsed.assigned_to as string | null | undefined) ?? null,
              });
            }
          }
        }

        let memberLow = 0;
        let memberOut = 0;

        // Evaluate low/out per item using only this owner's stocks.
        for (const [itemId, itemMeta] of itemMap.entries()) {
          const stocks = stocksByItem.get(itemId) ?? [];
          const totalCount = stocks.reduce(
            (s, st) => s + st.container_count,
            0,
          );
          const hasLowStatus = stocks.some((st) => st.status === "low");
          const hasEmptyStatus = stocks.some((st) => st.status === "empty");

          // OUT: zero containers OR any stock explicitly "empty".
          if (totalCount === 0 || hasEmptyStatus) {
            memberOut += 1;
            outItems.push({
              owner: member.owner,
              itemId,
              name: itemMeta.name,
              vendor: itemMeta.vendor,
            });
            continue;
          }

          // LOW: below count threshold OR any stock explicitly "low".
          const belowThreshold =
            itemMeta.low_at_count !== null &&
            totalCount < itemMeta.low_at_count;
          if (belowThreshold || hasLowStatus) {
            memberLow += 1;
            lowItems.push({
              owner: member.owner,
              itemId,
              name: itemMeta.name,
              count: totalCount,
              threshold: itemMeta.low_at_count,
              vendor: itemMeta.vendor,
            });
          }
        }

        memberSummaries.push({
          owner: member.owner,
          low: memberLow,
          out: memberOut,
          pending: pendingCount,
        });
      }

      return {
        hasLab: true,
        totals: {
          lowItems: lowItems.length,
          outItems: outItems.length,
          pendingOrders: reorderQueue.length,
        },
        lowItems,
        outItems,
        reorderQueue,
        members: memberSummaries,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// spend_summary (factory)
// ---------------------------------------------------------------------------

export function makeSpendSummaryTool(deps: SpendSummaryDeps): AiTool {
  return {
    name: "spend_summary",
    description:
      "Summarize lab purchase spend over a date window. Separates PLACED orders (status 'ordered' or 'received') from PENDING orders (status 'needs_ordering'). Breakdowns by vendor and/or grant are available via groupBy. Pass grantId to restrict to one funding account. The tool supplies every dollar figure rounded to two decimals; the model never judges whether spending is appropriate. Read-only. Lab-head only.",
    parameters: {
      type: "object",
      properties: {
        periodDays: {
          type: "number",
          description:
            "How many days back to include purchases (by updated_at / created_at). Default 90.",
        },
        grantId: {
          type: "number",
          description:
            "Optional. When given, restrict to purchases whose funding_account_id matches this grant.",
        },
        groupBy: {
          type: "string",
          enum: ["vendor", "grant", "both"],
          description:
            "Which breakdown(s) to include in the response. Default 'both'.",
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const periodDays =
        typeof args.periodDays === "number" ? args.periodDays : 90;
      const grantId =
        typeof args.grantId === "number" ? args.grantId : null;
      const groupBy =
        args.groupBy === "vendor" || args.groupBy === "grant"
          ? (args.groupBy as "vendor" | "grant")
          : "both";

      // Resolve funding account names. The PI's own store, no audit entry.
      let accounts: FundingAccount[] = [];
      try {
        accounts = await deps.listFundingAccounts();
      } catch {
        accounts = [];
      }
      const accountMap = new Map<number, string>(
        accounts.map((a) => [a.id, a.name]),
      );

      // Resolve the filter grant name (if filtering).
      let filterGrant: { id: number; name: string } | null = null;
      if (grantId !== null) {
        const grantName = accountMap.get(grantId) ?? null;
        filterGrant = grantName !== null ? { id: grantId, name: grantName } : null;
      }

      // Audited lab-scoped read.
      const workResult = await deps.readWork({});
      if (!workResult.ok || workResult.members.length === 0) {
        return {
          hasLab: false,
          note:
            workResult.error ??
            "No lab data is available. Either this account is not a lab head, no members have synced, or the lab is not reachable.",
        };
      }

      const now = new Date();

      let totalPlaced = 0;
      let totalPending = 0;
      let totalCount = 0;

      const vendorMap = new Map<string, { total: number; count: number }>();
      const grantBreakMap = new Map<
        string,
        { grantId: number | null; grantName: string; total: number; count: number }
      >();

      const memberSummaries: Array<{
        owner: string;
        placed: number;
        pending: number;
      }> = [];

      for (const member of workResult.members) {
        let mPlaced = 0;
        let mPending = 0;

        for (const r of member.records) {
          if (r.recordType !== "purchase") continue;
          const parsed = parseRecord(r.plaintext);
          if (!parsed) continue;

          // Period filter.
          if (!isWithinDays(parsed, periodDays, now)) continue;

          // Grant filter.
          if (grantId !== null) {
            const fid = parsed.funding_account_id as
              | number
              | null
              | undefined;
            if (fid !== grantId) continue;
          }

          const spend =
            typeof parsed.total_price === "number" ? parsed.total_price : 0;
          const orderStatus =
            (parsed.order_status as string | undefined) ?? "needs_ordering";
          const placed =
            orderStatus === "ordered" || orderStatus === "received";

          totalCount += 1;
          if (placed) {
            totalPlaced += spend;
            mPlaced += spend;
          } else {
            totalPending += spend;
            mPending += spend;
          }

          // Vendor breakdown.
          if (groupBy === "vendor" || groupBy === "both") {
            const vendor =
              (parsed.vendor as string | null | undefined) ?? "Unspecified";
            const key = vendor || "Unspecified";
            const entry = vendorMap.get(key) ?? { total: 0, count: 0 };
            entry.total += spend;
            entry.count += 1;
            vendorMap.set(key, entry);
          }

          // Grant breakdown.
          if (groupBy === "grant" || groupBy === "both") {
            const fid =
              typeof parsed.funding_account_id === "number"
                ? (parsed.funding_account_id as number)
                : null;
            const grantName =
              fid !== null
                ? (accountMap.get(fid) ?? "Unknown grant")
                : "No grant";
            const mapKey = fid !== null ? String(fid) : "null";
            const entry = grantBreakMap.get(mapKey) ?? {
              grantId: fid,
              grantName,
              total: 0,
              count: 0,
            };
            entry.total += spend;
            entry.count += 1;
            grantBreakMap.set(mapKey, entry);
          }
        }

        memberSummaries.push({
          owner: member.owner,
          placed: Math.round(mPlaced * 100) / 100,
          pending: Math.round(mPending * 100) / 100,
        });
      }

      const response: Record<string, unknown> = {
        hasLab: true,
        periodDays,
        grant: filterGrant,
        totals: {
          placed: Math.round(totalPlaced * 100) / 100,
          pending: Math.round(totalPending * 100) / 100,
          count: totalCount,
        },
        members: memberSummaries,
      };

      if (groupBy === "vendor" || groupBy === "both") {
        response.byVendor = Array.from(vendorMap.entries()).map(
          ([vendor, d]) => ({
            vendor,
            total: Math.round(d.total * 100) / 100,
            count: d.count,
          }),
        );
      }
      if (groupBy === "grant" || groupBy === "both") {
        response.byGrant = Array.from(grantBreakMap.values()).map((d) => ({
          grantId: d.grantId,
          grantName: d.grantName,
          total: Math.round(d.total * 100) / 100,
          count: d.count,
        }));
      }

      return response;
    },
  };
}

// ---------------------------------------------------------------------------
// inventory_audit (factory)
// ---------------------------------------------------------------------------

export function makeInventoryAuditTool(deps: InventoryAuditDeps): AiTool {
  return {
    name: "inventory_audit",
    description:
      "Audit the lab's inventory for three classes of issue: EXPIRING (stocks whose expiration_date is within expiringDays of now, already past, or whose status is 'expired'), OUT OF STOCK (items with zero total container_count or any stock with status 'empty'), and UNLOCATED (stocks with container_count > 0 and no location_text or location_node_id). Returns item names, dates, and per-owner breakdowns. Read-only. Lab-head only.",
    parameters: {
      type: "object",
      properties: {
        expiringDays: {
          type: "number",
          description:
            "How many days ahead to flag expiring stocks. Stocks expiring within this window (or already past) are included. Default 30.",
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const expiringDays =
        typeof args.expiringDays === "number" ? args.expiringDays : 30;

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
      const windowMs = expiringDays * 24 * 60 * 60 * 1000;

      interface ExpiringEntry {
        owner: string;
        itemName: string;
        expirationDate: string;
        daysUntil: number;
      }
      interface OutOfStockEntry {
        owner: string;
        itemName: string;
      }
      interface UnlocatedEntry {
        owner: string;
        itemName: string;
        stockId: number;
      }

      const expiring: ExpiringEntry[] = [];
      const outOfStock: OutOfStockEntry[] = [];
      const unlocated: UnlocatedEntry[] = [];

      for (const member of result.members) {
        // Build a per-owner item name map (item_id -> name).
        const itemNameMap = new Map<number, string>();
        // Also collect stocks separately so we can do the item-level out-of-stock check.
        const stocksByItem = new Map<
          number,
          Array<{
            id: number;
            container_count: number;
            status: string;
            expiration_date: string | null;
            location_text: string | null;
            location_node_id: number | null;
          }>
        >();

        for (const r of member.records) {
          const parsed = parseRecord(r.plaintext);
          if (!parsed) continue;

          if (r.recordType === "inventory") {
            const id = parsed.id as number | undefined;
            if (typeof id !== "number") continue;
            itemNameMap.set(
              id,
              (parsed.name as string | undefined) ?? "(unnamed)",
            );
          } else if (r.recordType === "inventory_stock") {
            const itemId = parsed.item_id as number | undefined;
            if (typeof itemId !== "number") continue;
            const stockId = parsed.id as number | undefined;
            if (typeof stockId !== "number") continue;
            const count =
              typeof parsed.container_count === "number"
                ? parsed.container_count
                : 0;
            const status =
              (parsed.status as string | undefined) ?? "in_stock";
            const expDate =
              (parsed.expiration_date as string | null | undefined) ?? null;
            const locText =
              (parsed.location_text as string | null | undefined) ?? null;
            const locNodeId =
              typeof parsed.location_node_id === "number"
                ? parsed.location_node_id
                : null;

            const existing = stocksByItem.get(itemId) ?? [];
            existing.push({
              id: stockId,
              container_count: count,
              status,
              expiration_date: expDate,
              location_text: locText,
              location_node_id: locNodeId,
            });
            stocksByItem.set(itemId, existing);
          }
        }

        // Walk items and their stocks to build audit entries.
        for (const [itemId, stocks] of stocksByItem.entries()) {
          const itemName = itemNameMap.get(itemId) ?? "(unknown item)";
          const totalCount = stocks.reduce(
            (s, st) => s + st.container_count,
            0,
          );
          const hasEmptyStatus = stocks.some((st) => st.status === "empty");

          // OUT OF STOCK.
          if (totalCount === 0 || hasEmptyStatus) {
            outOfStock.push({ owner: member.owner, itemName });
          }

          // Per-stock checks.
          for (const stock of stocks) {
            // EXPIRING.
            const isExpiredStatus = stock.status === "expired";
            if (stock.expiration_date) {
              const expDate = new Date(stock.expiration_date);
              if (!isNaN(expDate.getTime())) {
                const diffMs = expDate.getTime() - now.getTime();
                const daysUntil = Math.round(diffMs / (24 * 60 * 60 * 1000));
                // Include when within window (future) OR already past (negative).
                if (diffMs <= windowMs) {
                  expiring.push({
                    owner: member.owner,
                    itemName,
                    expirationDate: stock.expiration_date,
                    daysUntil,
                  });
                }
              } else if (isExpiredStatus) {
                // expiration_date is unparseable; still flag via status.
                expiring.push({
                  owner: member.owner,
                  itemName,
                  expirationDate: stock.expiration_date,
                  daysUntil: -999,
                });
              }
            } else if (isExpiredStatus) {
              // No expiration_date, but status says "expired".
              expiring.push({
                owner: member.owner,
                itemName,
                expirationDate: "",
                daysUntil: -999,
              });
            }

            // UNLOCATED: real containers with no recorded home.
            if (
              stock.container_count > 0 &&
              stock.location_text === null &&
              stock.location_node_id === null
            ) {
              unlocated.push({
                owner: member.owner,
                itemName,
                stockId: stock.id,
              });
            }
          }
        }

        // Also flag items that have an inventory record but NO stocks at all
        // as out of stock, since they have zero containers.
        for (const [itemId, itemName] of itemNameMap.entries()) {
          if (!stocksByItem.has(itemId)) {
            outOfStock.push({ owner: member.owner, itemName });
          }
        }
      }

      return {
        hasLab: true,
        expiringDays,
        totals: {
          expiring: expiring.length,
          outOfStock: outOfStock.length,
          unlocated: unlocated.length,
        },
        expiring,
        outOfStock,
        unlocated,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Default instances (real deps) -- Phase 4
// ---------------------------------------------------------------------------

export const reorderDigestTool = makeReorderDigestTool({
  readWork: readLabMembersWork,
});

export const spendSummaryTool = makeSpendSummaryTool({
  readWork: readLabMembersWork,
  listFundingAccounts: () => purchasesApi.listFundingAccounts(),
});

export const inventoryAuditTool = makeInventoryAuditTool({
  readWork: readLabMembersWork,
});

// ===========================================================================
// Phase 5: Quality + synthesis tools
// ===========================================================================
//
// Three tools support the PI's quality-review and manuscript-prep work.
// reproduce_member_result and lab_figure are DEFERRED (blocked on
// cross-member compute / figure infra) and are NOT built here.
//
// method_drift
//   Finds experiments where a protocol was run with per-task overrides
//   (pcr_gradient, body_override, variation_notes, etc.) and groups them by
//   base method so the PI can see where the same protocol was executed
//   differently across the lab. The tool LISTS the differences and NEVER
//   judges which variant is correct or better.
//
// protocol_gaps
//   Finds experiments where no protocol is attached at all, or where an
//   attachment references a (method_id, owner) pair that does not exist in
//   the lab's method library. Surfaces what is missing; the PI decides what
//   to do about it.
//
// methods_section
//   Assembles a roster of real method records filtered by tag, date, and/or
//   member. Returns the protocol facts (name, type, tags, source URL, excerpt
//   when present). The model condenses these into a methods-section draft;
//   the tool supplies facts only and never claims significance or completeness.
//
// Audit path: all three call readLabMembersWork (readWork), which writes an
// audit entry to each member's log. No additional reads are made.
//
// Per-owner isolation: method ids are per-user-folder and may collide across
// users. The method library index is keyed by `${id}:${owner}` so ids that
// coincide across different members do not false-positive against each other.
//
// No emojis, no em-dashes, no mid-sentence colons.

// ---------------------------------------------------------------------------
// Dep types -- Phase 5
// ---------------------------------------------------------------------------

export interface MethodDriftDeps {
  readWork: typeof readLabMembersWork;
}

export interface ProtocolGapsDeps {
  readWork: typeof readLabMembersWork;
}

export interface MethodsSectionDeps {
  readWork: typeof readLabMembersWork;
}

// ---------------------------------------------------------------------------
// method_drift (factory)
// ---------------------------------------------------------------------------

// Override field names on TaskMethodAttachment that signal a per-task variant.
const OVERRIDE_FIELDS = [
  "pcr_gradient",
  "pcr_ingredients",
  "lc_gradient",
  "body_override",
  "plate_annotation",
  "cell_culture_schedule",
  "variation_notes",
  "qpcr_analysis",
] as const;

export function makeMethodDriftTool(deps: MethodDriftDeps): AiTool {
  return {
    name: "method_drift",
    description:
      "Find experiments where the same protocol was run with per-task overrides (gradient changes, body edits, variation notes, etc.) and group them by base method so the PI can see where the same protocol was executed differently across the lab. The tool LISTS the differences; it NEVER judges which variant is correct or better. Returns groups of (base method, members, variants). Read-only. Lab-head only.",
    parameters: {
      type: "object",
      properties: {
        methodNamePattern: {
          type: "string",
          description:
            "Optional substring filter on the method name (case-insensitive). When given, only groups whose base-method name contains this substring are returned.",
        },
        sinceDays: {
          type: "number",
          description:
            "When given, only consider experiments whose updated_at or created_at falls within the last N days. When omitted, all experiments are included.",
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const methodNamePattern =
        typeof args.methodNamePattern === "string"
          ? args.methodNamePattern.toLowerCase()
          : null;
      const sinceDays =
        typeof args.sinceDays === "number" ? args.sinceDays : null;

      const result = await deps.readWork({ recordTypes: ["method", "experiment"] });
      if (!result.ok || result.members.length === 0) {
        return {
          hasLab: false,
          note:
            result.error ??
            "No lab data is available. Either this account is not a lab head, no members have synced, or the lab is not reachable.",
        };
      }

      const now = new Date();

      // Build method index keyed by `${id}:${owner}` across all members.
      // Value: { name, methodType, parentMethodId, owner }.
      const methodIndex = new Map<
        string,
        {
          name: string;
          methodType: string | null;
          parentMethodId: number | null;
          owner: string;
        }
      >();

      for (const member of result.members) {
        for (const r of member.records) {
          if (r.recordType !== "method") continue;
          const parsed = parseRecord(r.plaintext);
          if (!parsed) continue;
          const id = parsed.id as number | undefined;
          if (typeof id !== "number") continue;
          const key = `${id}:${member.owner}`;
          methodIndex.set(key, {
            name: (parsed.name as string | undefined) ?? `method ${id}`,
            methodType:
              (parsed.method_type as string | null | undefined) ?? null,
            parentMethodId:
              typeof parsed.parent_method_id === "number"
                ? (parsed.parent_method_id as number)
                : null,
            owner: member.owner,
          });
        }
      }

      // Collect drift entries: one per (experiment, attachment) that has at
      // least one non-null override field.
      interface DriftEntry {
        referencedMethodId: number;
        methodOwner: string;
        methodName: string;
        member: string;
        experimentId: string;
        experimentName: string;
        overridesApplied: string[];
        baseKey: string; // grouping key (internal)
      }

      const driftEntries: DriftEntry[] = [];

      for (const member of result.members) {
        for (const r of member.records) {
          if (r.recordType !== "experiment" && r.recordType !== "task_experiment") continue;
          const parsed = parseRecord(r.plaintext);
          if (!parsed) continue;

          // Date filter when sinceDays is set.
          if (sinceDays !== null && !isWithinDays(parsed, sinceDays, now)) {
            continue;
          }

          const attachments = parsed.method_attachments as
            | Array<Record<string, unknown>>
            | null
            | undefined;
          if (!Array.isArray(attachments) || attachments.length === 0) continue;

          const experimentId = r.recordId;
          const experimentName =
            (parsed.name as string | undefined) ??
            (parsed.title as string | undefined) ??
            `experiment ${experimentId}`;

          for (const att of attachments) {
            const methodId = att.method_id as number | undefined;
            if (typeof methodId !== "number") continue;

            // Resolve the method owner. null means same owner as the experiment.
            const methodOwner =
              typeof att.owner === "string" ? att.owner : member.owner;
            const methodKey = `${methodId}:${methodOwner}`;

            // Collect non-null override fields.
            const overridesApplied: string[] = [];
            for (const field of OVERRIDE_FIELDS) {
              const val = att[field];
              if (val !== null && val !== undefined) {
                overridesApplied.push(field);
              }
            }
            if (overridesApplied.length === 0) continue;

            // Resolve method metadata.
            const methodMeta = methodIndex.get(methodKey);
            const methodName = methodMeta?.name ?? `method ${methodId}`;

            // Base-method grouping key. Prefer the parent_method_id of the
            // referenced method (when present) so that variants of a parent
            // protocol land in the same group. Fall back to the method name,
            // then the method id.
            let baseKey: string;
            if (methodMeta?.parentMethodId !== null && methodMeta?.parentMethodId !== undefined) {
              baseKey = `parent:${methodMeta.parentMethodId}:${methodOwner}`;
            } else {
              baseKey = methodName;
            }

            driftEntries.push({
              referencedMethodId: methodId,
              methodOwner,
              methodName,
              member: member.owner,
              experimentId,
              experimentName,
              overridesApplied,
              baseKey,
            });
          }
        }
      }

      // Group by baseKey into drift groups.
      const groupMap = new Map<
        string,
        {
          baseMethod: string;
          members: string[];
          variants: Array<{
            member: string;
            experimentId: string;
            experimentName: string;
            methodName: string;
            overridesApplied: string[];
          }>;
        }
      >();

      for (const entry of driftEntries) {
        // Apply methodNamePattern filter on the base-method name.
        if (
          methodNamePattern !== null &&
          !entry.methodName.toLowerCase().includes(methodNamePattern)
        ) {
          continue;
        }

        const existing = groupMap.get(entry.baseKey);
        if (existing) {
          existing.variants.push({
            member: entry.member,
            experimentId: entry.experimentId,
            experimentName: entry.experimentName,
            methodName: entry.methodName,
            overridesApplied: entry.overridesApplied,
          });
          if (!existing.members.includes(entry.member)) {
            existing.members.push(entry.member);
          }
        } else {
          groupMap.set(entry.baseKey, {
            baseMethod: entry.methodName,
            members: [entry.member],
            variants: [
              {
                member: entry.member,
                experimentId: entry.experimentId,
                experimentName: entry.experimentName,
                methodName: entry.methodName,
                overridesApplied: entry.overridesApplied,
              },
            ],
          });
        }
      }

      const groups = Array.from(groupMap.values()).map((g) => ({
        baseMethod: g.baseMethod,
        members: g.members,
        variants: g.variants,
      }));

      return {
        hasLab: true,
        sinceDays,
        groups,
        groupCount: groups.length,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// protocol_gaps (factory)
// ---------------------------------------------------------------------------

export function makeProtocolGapsTool(deps: ProtocolGapsDeps): AiTool {
  return {
    name: "protocol_gaps",
    description:
      "Find experiments that are missing a written-up protocol: either no protocol is attached at all, or an attachment references a (method_id, owner) pair that does not exist in the lab's method library. Returns a flat gaps list and a per-member grouping. Read-only. Lab-head only.",
    parameters: {
      type: "object",
      properties: {
        sinceDays: {
          type: "number",
          description:
            "When given, only consider experiments whose updated_at or created_at falls within the last N days. When omitted, all experiments are included.",
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const sinceDays =
        typeof args.sinceDays === "number" ? args.sinceDays : null;

      const result = await deps.readWork({ recordTypes: ["method", "experiment"] });
      if (!result.ok || result.members.length === 0) {
        return {
          hasLab: false,
          note:
            result.error ??
            "No lab data is available. Either this account is not a lab head, no members have synced, or the lab is not reachable.",
        };
      }

      const now = new Date();

      // Build method library index: `${method_id}:${owner}` -> true.
      // Keyed per-owner so method id=2 for alice is not confused with id=2
      // for bob. resolvedOwner = attachment.owner ?? experiment member owner.
      const methodLibrary = new Set<string>();

      for (const member of result.members) {
        for (const r of member.records) {
          if (r.recordType !== "method") continue;
          const parsed = parseRecord(r.plaintext);
          if (!parsed) continue;
          const id = parsed.id as number | undefined;
          if (typeof id !== "number") continue;
          methodLibrary.add(`${id}:${member.owner}`);
        }
      }

      // Walk experiments and collect gaps.
      interface Gap {
        owner: string;
        experimentId: string;
        experimentName: string;
        kind: "no_protocol_attached" | "protocol_not_in_library";
        referencedMethodId?: number;
        referencedMethodOwner?: string;
      }

      const gaps: Gap[] = [];

      for (const member of result.members) {
        for (const r of member.records) {
          if (r.recordType !== "experiment" && r.recordType !== "task_experiment") continue;
          const parsed = parseRecord(r.plaintext);
          if (!parsed) continue;

          // Date filter when sinceDays is set.
          if (sinceDays !== null && !isWithinDays(parsed, sinceDays, now)) {
            continue;
          }

          const experimentId = r.recordId;
          const experimentName =
            (parsed.name as string | undefined) ??
            (parsed.title as string | undefined) ??
            `experiment ${experimentId}`;

          const attachments = parsed.method_attachments as
            | Array<Record<string, unknown>>
            | null
            | undefined;

          if (!Array.isArray(attachments) || attachments.length === 0) {
            gaps.push({
              owner: member.owner,
              experimentId,
              experimentName,
              kind: "no_protocol_attached",
            });
            continue;
          }

          for (const att of attachments) {
            const methodId = att.method_id as number | undefined;
            if (typeof methodId !== "number") continue;
            // resolvedOwner: explicit owner on the attachment, or the
            // experiment's member owner when the attachment owner is null.
            const resolvedOwner =
              typeof att.owner === "string" ? att.owner : member.owner;
            const libraryKey = `${methodId}:${resolvedOwner}`;
            if (!methodLibrary.has(libraryKey)) {
              gaps.push({
                owner: member.owner,
                experimentId,
                experimentName,
                kind: "protocol_not_in_library",
                referencedMethodId: methodId,
                referencedMethodOwner: resolvedOwner,
              });
            }
          }
        }
      }

      // Group gaps by member.
      const gapsByMember: Record<string, Gap[]> = {};
      for (const gap of gaps) {
        const bucket = gapsByMember[gap.owner] ?? [];
        bucket.push(gap);
        gapsByMember[gap.owner] = bucket;
      }

      return {
        hasLab: true,
        sinceDays,
        gapCount: gaps.length,
        gaps,
        gapsByMember,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// methods_section (factory)
// ---------------------------------------------------------------------------

export function makeMethodsSectionTool(deps: MethodsSectionDeps): AiTool {
  return {
    name: "methods_section",
    description:
      "Assemble a roster of real method records for a manuscript methods section. Filters by member, date window, and/or tag. Returns the protocol facts (name, type, tags, source URL, excerpt when present). The model condenses these into a narrative methods section. The tool supplies facts only and never claims significance or completeness. Read-only. Lab-head only.",
    parameters: {
      type: "object",
      properties: {
        filterTag: {
          type: "string",
          description:
            "Optional tag to filter methods by. Only methods whose tags array includes this exact string are returned.",
        },
        sinceDays: {
          type: "number",
          description:
            "When given, only return methods whose updated_at or created_at falls within the last N days.",
        },
        memberFilter: {
          type: "string",
          description:
            "When given, only return methods owned by this member (username).",
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const filterTag =
        typeof args.filterTag === "string" && args.filterTag.trim()
          ? args.filterTag.trim()
          : null;
      const sinceDays =
        typeof args.sinceDays === "number" ? args.sinceDays : null;
      const memberFilter =
        typeof args.memberFilter === "string" && args.memberFilter.trim()
          ? args.memberFilter.trim()
          : null;

      const result = await deps.readWork({ recordTypes: ["method"] });
      if (!result.ok || result.members.length === 0) {
        return {
          hasLab: false,
          note:
            result.error ??
            "No lab data is available. Either this account is not a lab head, no members have synced, or the lab is not reachable.",
        };
      }

      const now = new Date();

      interface MethodEntry {
        owner: string;
        id: number;
        name: string;
        methodType: string | null;
        tags: string[] | null;
        sourceUrl: string | null;
        createdBy: string | null;
        updatedAt: string | null;
        excerpt?: string;
      }

      const methods: MethodEntry[] = [];

      for (const member of result.members) {
        // memberFilter: skip this member if they are not the one requested.
        if (memberFilter !== null && member.owner !== memberFilter) continue;

        for (const r of member.records) {
          if (r.recordType !== "method") continue;
          const parsed = parseRecord(r.plaintext);
          if (!parsed) continue;

          // Date filter.
          if (sinceDays !== null && !isWithinDays(parsed, sinceDays, now)) {
            continue;
          }

          // Tag filter.
          const tags = Array.isArray(parsed.tags)
            ? (parsed.tags as string[])
            : null;
          if (filterTag !== null) {
            if (!Array.isArray(tags) || !tags.includes(filterTag)) continue;
          }

          const id = parsed.id as number | undefined;
          if (typeof id !== "number") continue;

          const updatedAt =
            (parsed.updated_at as string | undefined) ??
            (parsed.updatedAt as string | undefined) ??
            (parsed.last_edited_at as string | undefined) ??
            (parsed.created_at as string | undefined) ??
            null;

          const entry: MethodEntry = {
            owner: member.owner,
            id,
            name: (parsed.name as string | undefined) ?? `method ${id}`,
            methodType:
              (parsed.method_type as string | null | undefined) ?? null,
            tags: tags ?? null,
            sourceUrl: (parsed.source_path as string | null | undefined) ?? null,
            createdBy: (parsed.created_by as string | null | undefined) ?? null,
            updatedAt,
          };

          // excerpt is optional on the Method record. Surface it when present.
          if (typeof parsed.excerpt === "string" && parsed.excerpt.trim()) {
            entry.excerpt = parsed.excerpt;
          }

          methods.push(entry);
        }
      }

      return {
        hasLab: true,
        filterTag,
        sinceDays,
        memberFilter,
        methodCount: methods.length,
        methods,
        note: "The model condenses these into a narrative methods section. The tool supplies facts only and never claims significance or completeness.",
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Default instances (real deps) -- Phase 5
// ---------------------------------------------------------------------------

export const methodDriftTool = makeMethodDriftTool({
  readWork: readLabMembersWork,
});

export const protocolGapsTool = makeProtocolGapsTool({
  readWork: readLabMembersWork,
});

export const methodsSectionTool = makeMethodsSectionTool({
  readWork: readLabMembersWork,
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * The lab-head tool set (Phase 1 oversight + Phase 2 mentorship + Phase 3
 * grants + Phase 4 operations + Phase 5 quality + synthesis). All read-only
 * tools go through the audited lab-scoped read / index-search engines.
 * onboard_member is the one consented action (non-destructive). Surfaced on
 * the /lab-overview BeakerBot mount, not in the global research-shell tool set.
 *
 * Phase 5 deferred: reproduce_member_result and lab_figure are NOT built
 * (blocked on cross-member compute / figure infra).
 */
export const LAB_HEAD_TOOLS: AiTool[] = [
  labPulseTool,
  findAcrossLabTool,
  labThroughputTool,
  prepOneOnOneTool,
  labMeetingPrepTool,
  onboardMemberTool,
  grantTaggedRollupTool,
  progressReportScaffoldTool,
  reorderDigestTool,
  spendSummaryTool,
  inventoryAuditTool,
  methodDriftTool,
  protocolGapsTool,
  methodsSectionTool,
];

/**
 * The full scope BeakerBot runs with on the lab-overview surface: the lab-head
 * tools plus the coordination tools (propose-plan, ask-user) so it can clarify
 * and sequence. NOT the research-shell read/action tools, which are own-only
 * and do not apply here. LAB_HEAD_SCOPE_TOOLS auto-includes any tool added
 * to LAB_HEAD_TOOLS.
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

You help a LAB HEAD (PI) with lab oversight, mentorship, grants reporting, and lab operations. Your job is to surface what is happening across the lab: who is active, what is new, what is stalled, how productive the lab has been, what members are working on, what supplies are running low or expiring, what has been spent, and what orders are pending.

You do NOT see, read, or discuss anything except what the audited lab-scoped read and search tools return. You do NOT reach into any member's private (unsynced) work. You only surface the lab's SYNCED shared workspace.

How you answer:
- Calm, concrete, concise. State counts and dates plainly; explain what a metric means before you report it. Do not pad.
- Do not use em-dashes. Do not use emojis. Do not drop a colon mid-sentence to introduce a clause or a list. Recast with a comma or a period. A label at the start of a line is fine.

You surface facts, you never interpret:
- NEVER fabricate the lab's data: member counts, experiment counts, stalled counts, search hits, action items, meeting dates, IDP status, grant record counts, item counts, spend totals, expiration dates. You do not know any of it from memory.
- To know anything about the lab, CALL A TOOL (lab_pulse, find_across_lab, lab_throughput, prep_one_on_one, lab_meeting_prep, grant_tagged_rollup, progress_report_scaffold, reorder_digest, spend_summary, inventory_audit, method_drift, protocol_gaps, methods_section) and answer only from what it returned. The tool owns every number; you relay it.
- General questions about how the lab-overview tools work you may answer directly. Anything specific to THIS lab requires a tool call.

Grants and reporting:
- grant_tagged_rollup aggregates every lab record tagged to a specific funding account: direct-linked projects and purchases, and tasks reverse-mapped through their project. It returns counts, a per-member breakdown, and a flat record-links list. Call it to answer "what lab work is on grant X" or "how many experiments are charged to this award."
- progress_report_scaffold assembles an RPPR-style scaffold (accomplishments, products, participants) over a date window. The grantId arg restricts it to grant-tagged records. The tool supplies section structure, counts, and record titles only. It does NOT write narrative and does NOT claim significance or impact about any work. The PI writes the narrative. You relay the scaffold and stop.

Lab operations:
- reorder_digest shows which lab supplies are low or out of stock (per item, per owner) and which purchase orders are still in the "needs_ordering" state (not yet placed). Lab supplies and ordering are billed to the PI, so this tool is the PI's lens on what needs to be restocked. The tool supplies item counts and a reorder queue; it does NOT say whether a stock level is acceptable.
- spend_summary aggregates purchase spend over a configurable date window, split into PLACED (ordered or received) and PENDING (not yet placed). Breakdowns by vendor and by grant are available. Dollar figures are rounded to two decimals. The tool supplies totals; it never judges whether spending is appropriate.
- inventory_audit flags three categories of issue: EXPIRING (stocks expiring within the configured window or already past, or whose status is "expired"), OUT OF STOCK (items with zero total containers or any stock with status "empty"), and UNLOCATED (stocks with containers but no location recorded). The tool supplies dates and item names; the PI decides what action to take.

The no-interpretation rule is absolute:
- "Stalled" means a record has seen no update in the configured window (deterministic, a calendar fact). You report the count and the threshold; the PI judges what it means for each person.
- For mentorship: the tools surface a trainee's OWN shared work, their open action items, and what changed since the last check-in. You relay these facts. You NEVER say a member is behind, underperforming, struggling, or ahead. You never rank members by worth. You state the figures and stop.
- For operations: you report what is low, what is on order, what has been spent, what is expiring. You do NOT say whether stock levels, spending totals, or expiration timelines are good or bad. You state the figures and stop.
- You never add a verdict or a recommendation about a person's work ethic, productivity, or capability.

Reads are audited:
- Every lab-scoped read (readWork) writes an audit entry to each member's own audit log so they can see what the PI's tools surfaced about them. This is by design; transparency is part of the trust contract. The 1:1 space, IDP-status, rotation, and funding-account reads are shared-space or existence-only reads and do not produce separate audit entries.
- If a user asks why a read was logged, explain this plainly.

Actions are consented:
- onboard_member creates a one-on-one mentorship space and seeds a starter onboarding checklist for an EXISTING lab member. It runs only after the PI confirms, it is non-destructive, and it never provisions or invites a new account automatically. Member invites use the separate invite flow.

Quality and synthesis:
- method_drift finds experiments where the same protocol was run with per-task overrides (gradient changes, markdown body edits, variation notes, plate annotations, etc.) and groups them by base method. It surfaces WHERE the same protocol was run differently across the lab. It LISTS the variants and NEVER judges which variant is correct or better. You relay the groups and variants; you do not say which version is right.
- protocol_gaps finds experiments with no protocol attached at all, or where an attachment references a (method_id, owner) pair that does not exist in the lab's method library. It surfaces missing documentation; the PI decides what to document.
- methods_section assembles a roster of real method records filtered by tag, date, and/or member. It returns the protocol facts (name, type, tags, source URL, excerpt when present). You use these facts to draft a methods-section scaffold. The tool supplies the protocols; the PI writes the final prose. You never claim significance or completeness about the methods returned.`;

