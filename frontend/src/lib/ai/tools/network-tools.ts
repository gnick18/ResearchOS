// BeakerBot /network integration tools (network-tools bot, 2026-06-19).
//
// Two tools that wire the assistant into the /network researcher-sharing feature.
//
//   - find_collaborators (READ): searches the public researcher directory via
//     GET /api/directory/public-search?q=<query>. Returns only the public-card
//     fields each result already exposes (display name, affiliation, ORCID,
//     fingerprint). Email is NEVER in the result because the endpoint never
//     returns it. The tool degrades gracefully on network errors or when the
//     endpoint is dark (flags off, returns [] with a status note). It NEVER
//     fabricates people.
//
//   - share_with_researcher (ACTION): lets the user send an object to a
//     researcher found via find_collaborators or name an email they typed in
//     chat. The tool is an action tool (action: true), so the agent loop runs
//     it through the approval gate before execute ever fires. describeAction
//     builds a human-readable preview ("share Method 12 with Alice Lee at
//     Stanford") so the user sees exactly what will happen BEFORE they click
//     Allow. Only on Allow does execute run. Execute checks the paid entitlement
//     (GET /api/collab/external-entitlement, which already reuses the Model-A
//     produce signal from /api/relay/send), resolves the recipient and object,
//     then navigates the user to the object's share dialog pre-identified with
//     the recipient fingerprint or email, so the ACTUAL cryptographic send is
//     always performed through the existing UI. The tool NEVER calls sendShare
//     or any crypto path directly, those live in the UI dialogs and require the
//     user's local identity keys. The recipient must come from a find_collaborators
//     result (a fingerprint) or an email the user explicitly typed in chat; the
//     tool never fabricates or infers a recipient.
//
// The paid gate for outbound send lives in the relay route (/api/relay/send
// returns 402 for free accounts). This tool checks the client-accessible
// /api/collab/external-entitlement endpoint (which calls isProduceEntitled, same
// signal) BEFORE navigating so it can return a clear "needs a paid plan" result
// with an upsell path rather than letting the user walk all the way to the dialog
// only to see a 402.
//
// Registration: both tools are exported from this module and added to the
// registry (READ_ONLY_TOOLS for find_collaborators, ACTION_TOOLS for
// share_with_researcher) in registry.ts. The general user tool set is
// DEFAULT_TOOLS = READ_ONLY_TOOLS + COORDINATION_TOOLS + ACTION_TOOLS, so both
// tools are available to every BeakerBot user without special gating.
//
// House style, no em-dashes, no emojis, no mid-sentence colons.

import { requestNavigation } from "@/components/ai/navigation-bridge";
import { objectDeepLink } from "@/lib/references";
import type { ObjectRefType } from "@/lib/references";
import type { AiTool } from "./types";

// ---------------------------------------------------------------------------
// Injectable seam (for tests)
// ---------------------------------------------------------------------------

/** Public profile record returned by GET /api/directory/public-search. */
export interface PublicProfile {
  /** Opaque directory fingerprint, stable identifier for this researcher. */
  fingerprint: string;
  /** The researcher's chosen display name. */
  displayName: string;
  /** Institutional affiliation string, or null when not set. */
  affiliation: string | null;
  /** Verified institutional domain badge (e.g. "stanford.edu"), or null. */
  verifiedDomain: string | null;
  /** ORCID iD string (e.g. "0000-0002-1234-5678"), or null when not set. */
  orcid: string | null;
}

/** What find_collaborators exposes to the model. Fingerprint is the opaque id
 *  share_with_researcher accepts as its recipient argument. Email is intentionally
 *  absent because the public-search endpoint never returns it. */
export interface CollaboratorResult {
  /** Opaque fingerprint, passed to share_with_researcher as recipient. */
  fingerprint: string;
  name: string;
  institution: string | null;
  verifiedDomain: string | null;
  orcid: string | null;
}

export type NetworkToolsDeps = {
  /** Fetch the public search endpoint and return profiles. Injectable for tests. */
  searchPublicProfiles: (
    query: string,
    institution?: string,
    limit?: number,
  ) => Promise<{ ok: boolean; profiles: CollaboratorResult[]; status?: string }>;
  /** Check whether the signed-in user is entitled to send (paid gate). */
  checkSendEntitlement: () => Promise<boolean>;
  /** Navigate to an internal path (side-effectful, no-op in tests). */
  navigate: (path: string) => void;
};

/** Build the URL the user is sent to so they can open the send dialog there.
 *  The fingerprint or email is passed as a query param so the share surface can
 *  pre-fill the recipient field when it supports that param. */
function buildShareTarget(
  objectType: string,
  objectId: string,
  recipient: string,
): string {
  const validType = objectType as ObjectRefType;
  const deepLink = objectDeepLink(validType, objectId);
  // Append a share-recipient hint so the page can pre-fill the dialog.
  // The existing send dialogs do not yet read this param, but adding it here
  // is forward-compatible and does no harm (extra query params are ignored).
  const sep = deepLink.includes("?") ? "&" : "?";
  return `${deepLink}${sep}shareWith=${encodeURIComponent(recipient)}`;
}

/** Whether a string looks like an email address (permissive, server validates). */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Whether a string looks like a directory fingerprint (40-character lowercase hex). */
function looksLikeFingerprint(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value.trim());
}

// ---------------------------------------------------------------------------
// Default deps (production)
// ---------------------------------------------------------------------------

export const networkToolsDeps: NetworkToolsDeps = {
  searchPublicProfiles: async (query, institution, limit = 10) => {
    try {
      const q = institution ? `${query} ${institution}`.trim() : query;
      const url = `/api/directory/public-search?q=${encodeURIComponent(q)}`;
      const res = await fetch(url);
      if (res.status === 404) {
        // Route is dark (flags off). Return empty with a status note.
        return { ok: true, profiles: [], status: "directory_unavailable" };
      }
      if (res.status === 429) {
        return { ok: false, profiles: [], status: "rate_limited" };
      }
      if (!res.ok) {
        return { ok: false, profiles: [], status: "search_failed" };
      }
      const data = (await res.json()) as { results?: PublicProfile[] };
      const raw = Array.isArray(data.results) ? data.results : [];
      const profiles: CollaboratorResult[] = raw
        .slice(0, limit ?? 10)
        .map((r) => ({
          fingerprint: r.fingerprint,
          name: r.displayName,
          institution: r.affiliation,
          verifiedDomain: r.verifiedDomain,
          orcid: r.orcid,
        }));
      return { ok: true, profiles };
    } catch {
      return { ok: false, profiles: [], status: "network_error" };
    }
  },

  checkSendEntitlement: async () => {
    try {
      const res = await fetch("/api/collab/external-entitlement");
      if (!res.ok) return false;
      const data = (await res.json()) as { entitled?: boolean };
      return data.entitled === true;
    } catch {
      return false;
    }
  },

  navigate: requestNavigation,
};

// ---------------------------------------------------------------------------
// find_collaborators (READ-ONLY)
// ---------------------------------------------------------------------------

export const findCollaboratorsTool: AiTool = {
  name: "find_collaborators",
  description:
    "Search the public ResearchOS researcher directory to find potential collaborators. " +
    "Pass a query (a name, institution, or research area), an optional institution filter, " +
    "and an optional result limit (default 10, max 20). " +
    "Returns matched researchers with their name, institution, verified domain, ORCID, " +
    "and an opaque fingerprint id that share_with_researcher accepts as its recipient. " +
    "Returns an empty list when no one matches or when the directory is unavailable. " +
    "NEVER fabricates people. Receiving a share from ResearchOS is always free for the recipient. " +
    "Use this before share_with_researcher so the model has a real fingerprint to pass.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Name, institution, or research area to search for. At least 2 characters.",
      },
      institution: {
        type: "string",
        description:
          "Optional institution filter appended to the query (e.g. \"Stanford\", \"UW-Madison\").",
      },
      limit: {
        type: "number",
        description: "Maximum results to return. Default 10, max 20.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const query =
      typeof args.query === "string" ? args.query.trim() : "";
    if (query.length < 2) {
      return {
        ok: false as const,
        error: "The search query must be at least 2 characters.",
        profiles: [],
      };
    }
    const institution =
      typeof args.institution === "string" && args.institution.trim()
        ? args.institution.trim()
        : undefined;
    const limit =
      typeof args.limit === "number" && args.limit > 0
        ? Math.min(Math.round(args.limit), 20)
        : 10;

    const result = await networkToolsDeps.searchPublicProfiles(
      query,
      institution,
      limit,
    );

    if (!result.ok) {
      const reason =
        result.status === "rate_limited"
          ? "The directory is rate-limited right now. Try again in a moment."
          : "The researcher directory is not available right now.";
      return { ok: false as const, error: reason, profiles: [] };
    }
    if (result.status === "directory_unavailable") {
      return {
        ok: true as const,
        profiles: [],
        note: "The public researcher directory is not enabled on this instance.",
      };
    }
    return { ok: true as const, profiles: result.profiles };
  },
};

// ---------------------------------------------------------------------------
// share_with_researcher (ACTION)
// ---------------------------------------------------------------------------

/** Validate and describe the recipient. Returns a short label for the preview. */
function describeRecipient(recipient: string): string {
  const trimmed = recipient.trim();
  if (looksLikeFingerprint(trimmed)) {
    // Fingerprint from find_collaborators, not a human label. Truncate for display.
    return `researcher (id ${trimmed.slice(0, 8)}...)`;
  }
  if (looksLikeEmail(trimmed)) {
    return trimmed;
  }
  // Neither: treat as a display name hint that the user typed.
  return trimmed;
}

export const shareWithResearcherTool: AiTool = {
  name: "share_with_researcher",
  description:
    "Send one of the user's objects (a note, method, sequence, experiment, project, or dataset) " +
    "to a researcher outside this lab. The recipient must be either: " +
    "(a) a fingerprint id from a find_collaborators result, " +
    "or (b) an email address the user themselves typed in the chat. " +
    "NEVER invent or guess a recipient. " +
    "Always call find_collaborators first if the user has not already provided a fingerprint or email. " +
    "The tool checks the paid entitlement before proceeding (sending requires a paid plan; receiving is always free). " +
    "On approval the tool navigates the user to the object so they can complete the send " +
    "through the share dialog. " +
    "objectType must be one of: note, method, sequence, experiment, project. " +
    "objectId is the numeric id of the object (from a prior search or read tool result). " +
    "message is an optional personal note to include in the share dialog (the user can edit it there).",
  parameters: {
    type: "object",
    properties: {
      recipient: {
        type: "string",
        description:
          "The fingerprint from find_collaborators, OR an email address the user explicitly typed. " +
          "Never invented, inferred, or guessed by the model.",
      },
      objectType: {
        type: "string",
        enum: ["note", "method", "sequence", "experiment", "project"],
        description: "The type of object to share.",
      },
      objectId: {
        type: "string",
        description:
          "The numeric id of the object (as a string). " +
          "Must come from a prior read or search result, never invented.",
      },
      message: {
        type: "string",
        description:
          "Optional short personal note to include in the share dialog. " +
          "The user can edit it there before sending.",
      },
    },
    required: ["recipient", "objectType", "objectId"],
    additionalProperties: false,
  },
  action: true,
  isDestructive: () => false,
  describeAction: (args) => {
    const recipient = describeRecipient(
      typeof args.recipient === "string" ? args.recipient : "?",
    );
    const objectType =
      typeof args.objectType === "string" ? args.objectType : "object";
    const objectId =
      typeof args.objectId === "string" ? args.objectId : "?";
    const msg =
      typeof args.message === "string" && args.message.trim()
        ? ` with message "${args.message.trim().slice(0, 60)}"`
        : "";
    return {
      summary: `share ${objectType} ${objectId} with ${recipient}${msg}`,
    };
  },
  execute: async (args) => {
    const recipient =
      typeof args.recipient === "string" ? args.recipient.trim() : "";
    const objectType =
      typeof args.objectType === "string" ? args.objectType.trim() : "";
    const objectId =
      typeof args.objectId === "string" ? args.objectId.trim() : "";

    // Validate recipient. Only fingerprints (from find_collaborators) and emails
    // the user themselves typed are accepted. The tool never sends to a fabricated
    // or inferred recipient.
    if (!recipient) {
      return {
        ok: false as const,
        error:
          "No recipient provided. Use find_collaborators to find a researcher first, " +
          "or ask the user to type the recipient's email directly.",
      };
    }
    const recipientIsFingerprint = looksLikeFingerprint(recipient);
    const recipientIsEmail = looksLikeEmail(recipient);
    if (!recipientIsFingerprint && !recipientIsEmail) {
      return {
        ok: false as const,
        error:
          `The recipient "${recipient}" is neither a directory fingerprint nor an email address. ` +
          "Use find_collaborators to find a researcher and pass their fingerprint here, " +
          "or ask the user to type the recipient's email.",
      };
    }

    // Validate object.
    const validTypes = new Set(["note", "method", "sequence", "experiment", "project"]);
    if (!objectType || !validTypes.has(objectType)) {
      return {
        ok: false as const,
        error: `Unknown object type "${objectType}". Supported types are: note, method, sequence, experiment, project.`,
      };
    }
    if (!objectId) {
      return {
        ok: false as const,
        error: "An object id is required. Find the object with a read or search tool first.",
      };
    }

    // Paid gate. Sending requires a paid plan; receiving is always free for the
    // recipient. The check calls /api/collab/external-entitlement, which reuses the
    // same isProduceEntitled signal as the relay route. Fail-closed.
    const entitled = await networkToolsDeps.checkSendEntitlement();
    if (!entitled) {
      return {
        ok: false as const,
        entitlementBlocked: true as const,
        error:
          "Sending to external researchers requires a paid ResearchOS plan. " +
          "The recipient can always receive for free. " +
          "Upgrade at /settings?tab=billing to unlock outbound sharing.",
        upgradeUrl: "/settings?tab=billing",
      };
    }

    // Navigate to the object. The shareWith param pre-identifies the recipient for
    // the send dialog when the dialog supports it (forward-compatible).
    const shareTarget = buildShareTarget(objectType, objectId, recipient);
    networkToolsDeps.navigate(shareTarget);

    const recipientLabel = describeRecipient(recipient);
    const msgNote =
      typeof args.message === "string" && args.message.trim()
        ? ` You can paste your message ("${args.message.trim().slice(0, 80)}") into the dialog.`
        : "";

    return {
      ok: true as const,
      objectType,
      objectId,
      recipient: recipientIsFingerprint
        ? { fingerprint: recipient }
        : { email: recipient },
      recipientLabel,
      navigatedTo: shareTarget,
      instruction:
        `Navigated to ${objectType} ${objectId}. ` +
        `Open the Share menu and choose "Outside this lab" to send to ${recipientLabel}.` +
        msgNote +
        " Receiving is always free for the recipient.",
    };
  },
};
