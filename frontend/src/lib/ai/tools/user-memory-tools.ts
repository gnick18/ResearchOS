// BeakerBot user-memory tools (BeakerAI memory bot, 2026-06-13).
//
// Two tools that let BeakerBot record and forget standing user preferences:
//
//   remember_preference(text) -- writes one preference to the per-user
//     _beakerbot_memory.json sidecar. Low-stakes, reversible, no approval card.
//
//   forget_preference(idOrText) -- removes a preference by its id or by a
//     text substring. Also low-stakes, reversible (the user can re-add), no
//     approval card.
//
// Both are action:true so the agent loop routes them through the approval gate,
// but isDestructive is not set (false by default) and neither raises a heavy
// step/transform/draft card. The one-line "Allow it?" confirm is the right
// level of friction for a reversible local write the user explicitly asked for.
//
// Mirror of lab-members.ts for the AiTool shape and deps seam.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import {
  addMemoryEntry,
  removeMemoryEntry,
  userMemoryDeps,
  type UserMemoryDeps,
} from "@/lib/ai/user-memory";
import type { AiTool } from "./types";

// Injectable seam so both tools are unit-testable without a real folder.
export type UserMemoryToolDeps = UserMemoryDeps;

export const rememberPreferenceDeps: UserMemoryToolDeps = userMemoryDeps;
export const forgetPreferenceDeps: UserMemoryToolDeps = userMemoryDeps;

// remember_preference -- record a standing preference.
export const rememberPreferenceTool: AiTool = {
  name: "remember_preference",
  description:
    "Save a standing preference or default the user has stated, so it is available in every future BeakerBot chat. Examples: \"I default to Phusion polymerase\", \"my organism is A. fumigatus\", \"I always use 3 technical replicates\". Call this when the user says something like \"remember that\", \"always use X\", \"my default is Y\", or \"keep in mind that Z\". The text you record should be a single, concise statement the user expressed. Do not invent preferences the user did not state. The preference is written to disk and injected into every future turn automatically. The write is reversible via forget_preference.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description:
          "The preference to remember. A single, concise statement in the user's own words, for example \"I default to Phusion polymerase\" or \"3 technical replicates per experiment\".",
      },
    },
    required: ["text"],
    additionalProperties: false,
  },
  action: true,
  describeAction: (args) => ({
    summary: `remember preference: "${String(args.text ?? "").slice(0, 80)}"`,
  }),
  execute: async (args) => {
    const text = typeof args.text === "string" ? args.text : "";
    if (!text.trim()) {
      return { ok: false as const, error: "No preference text provided." };
    }
    try {
      const entries = await addMemoryEntry(text, rememberPreferenceDeps);
      return { ok: true as const, saved: text.trim(), count: entries.length };
    } catch {
      return { ok: false as const, error: "Could not save the preference. A folder may not be connected." };
    }
  },
};

// forget_preference -- remove a preference by id or text substring.
export const forgetPreferenceTool: AiTool = {
  name: "forget_preference",
  description:
    "Remove a previously remembered preference. Pass the exact id returned by remember_preference, or a short phrase from the preference text (case-insensitive substring match). Call this when the user says \"forget that\", \"remove the preference about X\", \"stop remembering Y\", or \"that's no longer my default\". If no match is found, returns a clear message so you can tell the user.",
  parameters: {
    type: "object",
    properties: {
      idOrText: {
        type: "string",
        description:
          "The id of the preference to remove (exact match), OR a short phrase from the preference text (substring match, case-insensitive). For example \"Phusion polymerase\" would match the entry \"I default to Phusion polymerase\".",
      },
    },
    required: ["idOrText"],
    additionalProperties: false,
  },
  action: true,
  describeAction: (args) => ({
    summary: `forget preference: "${String(args.idOrText ?? "").slice(0, 80)}"`,
  }),
  execute: async (args) => {
    const idOrText = typeof args.idOrText === "string" ? args.idOrText : "";
    if (!idOrText.trim()) {
      return { ok: false as const, error: "No id or text provided." };
    }
    try {
      const { entries, removed } = await removeMemoryEntry(idOrText, forgetPreferenceDeps);
      if (!removed) {
        return {
          ok: false as const,
          error: `No preference matched "${idOrText.trim()}". Use remember_preference to see the current list or try a different phrase.`,
        };
      }
      return { ok: true as const, removed: idOrText.trim(), remaining: entries.length };
    } catch {
      return { ok: false as const, error: "Could not remove the preference. A folder may not be connected." };
    }
  },
};
