// The privacy contract for self-hosted feature-usage events, ENFORCED here.
//
// The client sends anonymous usage events to /api/analytics/event. This module
// is the server-side gate that decides what may be stored, so even a hostile or
// buggy client can never put a high-cardinality value or anything identifying
// into our event_log table. It is pure (no imports, no IO) so it is unit tested
// directly and importable from both the route and the client.
//
// Rules:
//   - Only allow-listed event names are accepted. Anything else is rejected.
//   - Only allow-listed property keys per event are kept; unknown keys are
//     dropped (the PII guard, a client cannot smuggle extra fields through).
//   - Enum properties must be one of a fixed small value set, or they are
//     dropped. Boolean properties must be a real boolean, or they are dropped.
//   - The result therefore only ever contains a known name plus known keys with
//     validated low-cardinality values. No emails, names, ids, titles, counts,
//     sizes, or free text can survive.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

type PropSpec =
  | { type: "enum"; values: readonly string[] }
  | { type: "bool" };

/**
 * The allow-list. Keys are the only event names that may be stored, and each
 * maps to the only property keys that survive for that event. Keep this in sync
 * with the emit functions in events.ts.
 */
export const ALLOWED_EVENTS: Record<string, Record<string, PropSpec>> = {
  share_sent: {
    kind: {
      type: "enum",
      values: ["note", "experiment", "method", "project", "sequence", "other"],
    },
    destination: { type: "enum", values: ["existing_user", "email_invite"] },
  },
  profile_published: {
    has_orcid: { type: "bool" },
    has_affiliation: { type: "bool" },
  },
  identity_created: {},
  orcid_linked: {},
};

export interface SanitizedEvent {
  name: string;
  props: Record<string, string | boolean>;
}

/**
 * Validates and strips a raw event down to what the contract allows. Returns the
 * sanitized event, or null when the name is not allow-listed (the only hard
 * reject, everything else is a silent drop of the offending property).
 */
export function sanitizeEvent(
  rawName: unknown,
  rawProps: unknown,
): SanitizedEvent | null {
  if (typeof rawName !== "string") return null;
  const spec = ALLOWED_EVENTS[rawName];
  if (!spec) return null;

  const props: Record<string, string | boolean> = {};
  const source =
    rawProps && typeof rawProps === "object"
      ? (rawProps as Record<string, unknown>)
      : {};

  for (const [key, propSpec] of Object.entries(spec)) {
    const value = source[key];
    if (propSpec.type === "bool") {
      if (typeof value === "boolean") props[key] = value;
    } else {
      if (typeof value === "string" && propSpec.values.includes(value)) {
        props[key] = value;
      }
    }
  }

  return { name: rawName, props };
}
