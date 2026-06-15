// Onboarding tutor — pick summary (pure).
//
// Turns the role + picked goals + the demos shown into the human-readable
// summary the memory-propose and recap beats display. Honest to what was
// actually collected (role + goals), names a capability set, never invents a
// field the user did not state. No emojis, no em-dashes, no mid-sentence colons.

import {
  ROLES,
  GOALS,
  SURFACE_PRIORITY,
  type Role,
  type GoalKey,
  type Surface,
} from "./reel-director";

const ROLE_LABEL: Record<Role, string> = ROLES.reduce(
  (acc, r) => {
    acc[r.key] = r.label;
    return acc;
  },
  {} as Record<Role, string>,
);

const GOAL_LABEL: Record<GoalKey, string> = GOALS.reduce(
  (acc, g) => {
    acc[g.key] = g.label.toLowerCase();
    return acc;
  },
  {} as Record<GoalKey, string>,
);

const SURFACE_LABEL: Record<Surface, string> = {
  datahub: "Data Hub",
  phylo: "Phylogenetics",
  methods: "Methods",
  sequences: "Sequences",
  chemistry: "Chemistry",
  inventory: "Inventory",
  people: "People",
};

/** Join a list into prose ("a", "a and b", "a, b, and c"). */
function prose(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export interface RecapItem {
  label: string;
  value: string;
}

export interface TutorSummary {
  /** The single line proposed to the user's memory. */
  memoryFact: string;
  /** The recap rows shown on the done beat. */
  recap: RecapItem[];
}

export function summarize(
  role: Role | null,
  goals: GoalKey[],
  deepSurfaces: Surface[],
): TutorSummary {
  const roleLabel = role ? ROLE_LABEL[role] : "Researcher";
  const goalLabels = goals.map((g) => GOAL_LABEL[g]).filter(Boolean);
  const shown = SURFACE_PRIORITY.filter((s) => deepSurfaces.includes(s)).map(
    (s) => SURFACE_LABEL[s],
  );

  const wants =
    goalLabels.length > 0
      ? `Wants to ${prose(goalLabels)}.`
      : "Still exploring what to focus on.";
  const memoryFact = `${roleLabel}. ${wants}`;

  const recap: RecapItem[] = [{ label: "Role", value: roleLabel }];
  if (goalLabels.length > 0) {
    recap.push({ label: "Interested in", value: prose(goalLabels) });
  }
  if (shown.length > 0) {
    recap.push({ label: "Showed you", value: prose(shown) });
  }
  return { memoryFact, recap };
}
