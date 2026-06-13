// BeakerBot lab-members read tool (BeakerAI lane, 2026-06-12).
//
// Returns the lab's member usernames (own + the other accounts in the folder) so
// BeakerBot can populate the "whose?" step of the summary filter wizard with real
// names, and resolve a name the user types ("Kritika") to a real owner before it
// passes owners[] to a summarize_* tool. Read-only, relays only what usersApi
// returns, never invents a member.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { usersApi } from "@/lib/local-api";
import type { AiTool } from "./types";

// Injectable seam so the tool is unit-testable without a real folder.
export type LabMembersDeps = {
  listMembers: () => Promise<{ users: string[]; current_user: string }>;
};

export const labMembersDeps: LabMembersDeps = {
  listMembers: () => usersApi.list(),
};

export const listLabMembersTool: AiTool = {
  name: "list_lab_members",
  description:
    "List the lab members (the user accounts in the connected folder), and which one is the current user. Use this when the user wants to scope a summary by person (for example \"summarize Kritika's experiments\", \"the whole lab's purchases\"), so you can show their real names as ask_user options for the whose-step and resolve a typed name to a real owner before passing owners to a summarize_* tool. Read-only, runs straight away, you never invent a member name, only repeat what this returns. When the user means everyone, pass every returned member; when they mean themselves, use the current user.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  execute: async () => {
    try {
      const { users, current_user } = await labMembersDeps.listMembers();
      return { ok: true as const, members: users, currentUser: current_user, count: users.length };
    } catch {
      return { ok: false as const, error: "I could not read the lab members. A folder may not be connected." };
    }
  },
};
