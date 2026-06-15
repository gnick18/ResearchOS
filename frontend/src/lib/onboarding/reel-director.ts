// Onboarding tutor — the reel director (pure, deterministic).
//
// Given who the user is (role) and what they said they want to do (picked
// goals), this builds the ordered "reel" the step machine plays: a welcome, the
// interest picker, a set of DEEP on-page demos, exactly one AI demo, a montage
// of everything else, then the memory + recap. The model never decides pacing,
// this does, so the run length and the token cap are predictable.
//
// Locked design (Grant 2026-06-14, docs/proposals/2026-06-14-llm-onboarding-tutor.md):
//   - DEEP count is ADAPTIVE to picks: 1 pick -> 1 deep, 2-3 -> deep each,
//     4+ -> cap at 3 (top by surface priority), 0 -> role-default set (cap 3).
//   - Always exactly ONE AI demo (the only beat that shows the chat panel),
//     chosen by the top interest.
//   - Every demoable surface NOT shown deep goes to the MONTAGE so nothing is
//     invisible.
//   - Role gates: PI-only surfaces (People) never appear for students.
//
// Pure and unit-tested. No app/store/router state. No emojis, no em-dashes, no
// mid-sentence colons.

export type Role = "pi" | "grad" | "postdoc" | "undergrad" | "industry";

// Roles shown in the interest picker, in display order. Single source of truth
// for the labels so the UI and the director never drift.
export const ROLES = [
  { key: "pi", label: "PI / lab head" },
  { key: "grad", label: "Grad student" },
  { key: "postdoc", label: "Postdoc" },
  { key: "undergrad", label: "Undergrad" },
  { key: "industry", label: "Industry" },
] as const satisfies ReadonlyArray<{ key: Role; label: string }>;

// The surfaces a demo can run on. Order here IS the priority used to break ties
// when more goals are picked than the DEEP cap allows, and to order deep beats.
export const SURFACE_PRIORITY = [
  "datahub",
  "phylo",
  "methods",
  "sequences",
  "chemistry",
  "inventory",
  "people",
] as const;
export type Surface = (typeof SURFACE_PRIORITY)[number];

// PI-only surfaces, never shown to students.
const PI_ONLY: ReadonlySet<Surface> = new Set<Surface>(["people"]);

// The goals shown in the interest picker, each mapping to the surface it
// showcases. Goal-framed (what you want to DO), not page-framed.
export const GOALS = [
  { key: "track", label: "Track experiments", surface: "methods" },
  { key: "analyze", label: "Analyze data", surface: "datahub" },
  { key: "sequences", label: "Work with sequences", surface: "sequences" },
  { key: "trees", label: "Build trees", surface: "phylo" },
  { key: "chemistry", label: "Chemistry", surface: "chemistry" },
  { key: "inventory", label: "Manage inventory", surface: "inventory" },
  { key: "lab", label: "Run a lab", surface: "people" },
] as const;
export type GoalKey = (typeof GOALS)[number]["key"];

const GOAL_TO_SURFACE: Record<GoalKey, Surface> = GOALS.reduce(
  (acc, g) => {
    acc[g.key] = g.surface;
    return acc;
  },
  {} as Record<GoalKey, Surface>,
);

// Role-default DEEP sets when the user picks nothing. Already in priority order.
const ROLE_DEFAULTS: Record<Role, Surface[]> = {
  pi: ["datahub", "phylo", "people"],
  grad: ["methods", "sequences", "datahub"],
  postdoc: ["methods", "sequences", "datahub"],
  undergrad: ["methods", "sequences", "datahub"],
  industry: ["datahub", "methods", "inventory"],
};

export const DEEP_CAP = 3;

// Rough per-beat durations (seconds) used for the run-length estimate and the
// cap logic. Tunable, not load-bearing on correctness.
const SECONDS = {
  welcomePicker: 45,
  deep: 40,
  ai: 40,
  montagePerCard: 3,
  montageBase: 4,
  memoryRecap: 45,
};

export type AiVariant = "overlay_tree" | "plan_analysis" | "make_table";

export type BeatKind =
  | "welcome"
  | "interest_picker"
  | "deep_demo"
  | "ai_demo"
  | "montage"
  | "memory_propose"
  | "recap";

export interface Beat {
  kind: BeatKind;
  /** Set for deep_demo. */
  surface?: Surface;
  /** Set for montage (the surfaces that flash by). */
  surfaces?: Surface[];
  /** Set for ai_demo. */
  aiVariant?: AiVariant;
  estSeconds: number;
}

export interface Reel {
  beats: Beat[];
  deepSurfaces: Surface[];
  montageSurfaces: Surface[];
  aiVariant: AiVariant;
  estTotalSeconds: number;
}

export interface DirectorInput {
  role: Role;
  /** Goals the user picked in the interest picker. Order is preserved and used
   *  to bias the AI-demo choice toward their FIRST pick. */
  pickedGoals: GoalKey[];
}

/** Surfaces a given role is allowed to see. */
function allowedSurfaces(role: Role): Surface[] {
  return SURFACE_PRIORITY.filter((s) => role === "pi" || !PI_ONLY.has(s));
}

/** Map picked goals to unique surfaces, role-gated, in priority order. */
function pickedSurfaces(input: DirectorInput): Surface[] {
  const allowed = new Set(allowedSurfaces(input.role));
  const seen = new Set<Surface>();
  for (const g of input.pickedGoals) {
    const s = GOAL_TO_SURFACE[g];
    if (s && allowed.has(s)) seen.add(s);
  }
  // Return in priority order so ordering is stable regardless of pick order.
  return SURFACE_PRIORITY.filter((s) => seen.has(s));
}

/** The adaptive DEEP set: 1->1, 2-3->each, 4+->top 3, 0->role default (cap 3),
 *  all role-gated and capped at DEEP_CAP. */
export function selectDeepSurfaces(input: DirectorInput): Surface[] {
  const picked = pickedSurfaces(input);
  if (picked.length === 0) {
    const allowed = new Set(allowedSurfaces(input.role));
    return ROLE_DEFAULTS[input.role]
      .filter((s) => allowed.has(s))
      .slice(0, DEEP_CAP);
  }
  return picked.slice(0, DEEP_CAP);
}

/** The one AI demo, chosen by the deep set (which already reflects top picks). */
export function aiVariantFor(deep: Surface[]): AiVariant {
  if (deep.includes("phylo")) return "overlay_tree";
  if (deep.includes("datahub")) return "plan_analysis";
  return "make_table";
}

/** Build the full ordered reel. */
export function buildReel(input: DirectorInput): Reel {
  const deepSurfaces = selectDeepSurfaces(input);
  const aiVariant = aiVariantFor(deepSurfaces);
  const deep = new Set(deepSurfaces);
  // Everything demoable-and-allowed that we did not show deep flashes by.
  const montageSurfaces = allowedSurfaces(input.role).filter(
    (s) => !deep.has(s),
  );

  const beats: Beat[] = [];
  beats.push({ kind: "welcome", estSeconds: 0 });
  beats.push({ kind: "interest_picker", estSeconds: SECONDS.welcomePicker });
  for (const surface of deepSurfaces) {
    beats.push({ kind: "deep_demo", surface, estSeconds: SECONDS.deep });
  }
  beats.push({ kind: "ai_demo", aiVariant, estSeconds: SECONDS.ai });
  if (montageSurfaces.length > 0) {
    beats.push({
      kind: "montage",
      surfaces: montageSurfaces,
      estSeconds:
        SECONDS.montageBase + montageSurfaces.length * SECONDS.montagePerCard,
    });
  }
  beats.push({ kind: "memory_propose", estSeconds: 0 });
  beats.push({ kind: "recap", estSeconds: SECONDS.memoryRecap });

  const estTotalSeconds = beats.reduce((sum, b) => sum + b.estSeconds, 0);
  return { beats, deepSurfaces, montageSurfaces, aiVariant, estTotalSeconds };
}
