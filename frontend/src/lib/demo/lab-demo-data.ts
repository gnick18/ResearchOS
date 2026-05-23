/**
 * Demo Lab Mode data aggregator (Lab Mode demo-data manager, 2026-05-22).
 *
 * Purpose: `DemoLabModeViewer` warps the v4 onboarding tour into a fake
 * Lab Mode that's supposed to look POPULATED — a year of activity, 13+
 * shared notes, SMART goals, multiple users' Gantt bars overlaid,
 * methods-in-use rankings. Without a dedicated demo data source the
 * viewer falls through to `labApi` (which reads the user's real
 * folder), so a brand-new user sees an empty Lab Mode. Pointless.
 *
 * Solution: at viewer-mount time, fetch the demo bundle baked into
 * `frontend/public/demo-data/` and aggregate it across both demo users
 * (alex + morgan) into the same shapes `labApi.*` returns. The viewer
 * then pre-seeds a scoped React Query cache so every panel that calls
 * `useLabData()` / `useQuery({ queryKey: ["lab", ...] })` reads from
 * this aggregated demo data without any per-panel changes.
 *
 * Cross-user aggregation mirrors `labApi`:
 *   - tasks / projects / methods / notes / goals / purchase items are
 *     merged across alex + morgan, decorated with owner+color and (for
 *     tasks/projects) with the user's `user_color` + optional secondary
 *   - purchase items get a `username` field added (matches
 *     `labApi.getAllPurchaseItems`)
 *   - funding accounts come from the shared `users/lab/funding_accounts/`
 *     directory (lab-scoped, not per-user)
 *   - notes carry the user's name so `LabActivityPanel` / `NotesPanel`
 *     can filter by selected usernames
 *
 * Read-only: the aggregator never writes back. The Lab Mode panels
 * inside the viewer are already read-only (no save handlers wired up
 * because `/lab` is "View-only access to all researchers' work" per
 * the header).
 *
 * 404 tolerance: a missing per-entity JSON file is treated as "doesn't
 * exist" rather than wedging the entire dataset — matches the pattern
 * `DemoPurchasesViewer.fetchAlexFixtures` already uses.
 *
 * The exported {@link aggregateDemoLabData} returns a single bundle
 * keyed by the React Query keys the panels use, so the viewer can
 * `setQueryData` against each key in one pass.
 */

import type {
  LabUser,
  LabTask,
  LabProject,
  LabMethod,
  LabGoal,
} from "@/lib/local-api";
import type {
  FundingAccount,
  Note,
  PurchaseItem,
  Task,
  Project,
  HighLevelGoal,
} from "@/lib/types";

/**
 * Per-user `_counters.json` shape on disk: reports the count of each
 * entity directory so the fetch loops know the upper bound. Fields are
 * optional so the aggregator degrades to zero for any missing key.
 */
export interface DemoUserCounters {
  projects?: number;
  tasks?: number;
  methods?: number;
  goals?: number;
  notes?: number;
  purchase_items?: number;
  lab_links?: number;
}

/**
 * The lab namespace (`users/lab/`) has its own counters covering
 * funding accounts.
 */
export interface DemoLabCounters {
  funding_accounts?: number;
}

/**
 * `users/_user_metadata.json` shape on disk: per-username metadata,
 * notably the color used to colorize Lab Mode rows + Gantt bars.
 */
export interface DemoUserMetadataEntry {
  color?: string | null;
  color_secondary?: string | null;
  created_at?: string | null;
  hide_goals_from_lab?: boolean;
}

/**
 * Aggregated lab bundle — every shape the v4 demo Lab Mode panels need.
 *
 * Keys map 1:1 to the React Query keys panels register against, so the
 * viewer can pre-seed the cache with one entry per key and panels will
 * resolve their `useQuery` calls instantly without ever hitting
 * `labApi.*`.
 */
export interface DemoLabBundle {
  /** `["lab", "users"]` — list of LabUser (username + color). */
  users: LabUser[];
  /** `["lab", "tasks"]` — every task across every demo user. */
  tasks: LabTask[];
  /** `["lab", "projects"]` — every project across every demo user. */
  projects: LabProject[];
  /** `["lab", "methods"]` — every method across every demo user. */
  methods: LabMethod[];
  /** `["lab", "goals"]` — every project-scoped goal (personal goals
   *  filtered out, matching labApi.getGoals). */
  goals: LabGoal[];
  /** `["lab", "notes-shared"]` AND `["lab-notes", *]` — every shared
   *  note (is_shared = true) decorated with the owner's username. */
  notesShared: Note[];
  /** `["lab", "purchase-items"]` — every purchase item across every
   *  demo user, decorated with `username` field (matches
   *  labApi.getAllPurchaseItems). */
  purchaseItems: Array<PurchaseItem & { username: string }>;
  /** `["funding-accounts"]` — funding accounts from the shared lab
   *  namespace. */
  fundingAccounts: FundingAccount[];
  /** `["lab", "method-folders"]` — empty list (labApi.getMethodFolders
   *  returns []). Kept here so the viewer pre-seeds it explicitly
   *  rather than letting React Query trigger a real fetch. */
  methodFolders: string[];
}

/** Empty bundle used as the error-fallback. */
export function emptyDemoLabBundle(): DemoLabBundle {
  return {
    users: [],
    tasks: [],
    projects: [],
    methods: [],
    goals: [],
    notesShared: [],
    purchaseItems: [],
    fundingAccounts: [],
    methodFolders: [],
  };
}

/**
 * Generic per-entity fetch loop. The demo bundle stores one JSON file
 * per id (1.json, 2.json, ...). A 404 on any single id is non-fatal —
 * we collect every successful parse and skip the misses.
 */
async function fetchRange<T>(dir: string, n: number): Promise<T[]> {
  if (n <= 0) return [];
  const settled: Array<T | null> = await Promise.all(
    Array.from({ length: n }, (_, i) => i + 1).map(
      async (id): Promise<T | null> => {
        try {
          const res = await fetch(`${dir}/${id}.json`);
          if (!res.ok) return null;
          return (await res.json()) as T;
        } catch {
          return null;
        }
      },
    ),
  );
  return settled.filter((v): v is T => v !== null);
}

/** Single-file fetch with 404 tolerance. */
async function fetchOneOptional<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Default color when metadata is missing for a user. */
function defaultColorFor(username: string): string {
  // Mirrors `fallbackUserColor`'s spirit but with a stable demo palette
  // so the three demo users get distinct colors even if the metadata
  // file is missing (tests use minimal fixtures).
  if (username === "alex") return "#3b82f6"; // blue
  if (username === "morgan") return "#10b981"; // emerald
  if (username === "mira") return "#f97316"; // orange — demo PI
  return "#6b7280";
}

/**
 * Recompute task end_date if missing/stale. Mirrors `computeTaskEndDate`
 * in `local-api.ts` but inlined here because the aggregator is meant
 * to be a pure transform with no reach into the rest of the code path
 * (and we don't want to import the whole `local-api` module just for
 * a one-liner). Treats missing end_date as start_date + duration_days,
 * weekends ignored — close enough for the demo where on-disk tasks
 * already carry both fields.
 */
function ensureEndDate(task: Task): string {
  if (task.end_date) return task.end_date;
  if (!task.start_date) return "";
  const start = new Date(task.start_date + "T00:00:00Z");
  start.setUTCDate(
    start.getUTCDate() + Math.max(0, (task.duration_days ?? 1) - 1),
  );
  return start.toISOString().slice(0, 10);
}

/**
 * Convert an on-disk `Task` (per-user file) into the LabTask shape the
 * v4 Lab Mode panels consume. Mirrors `labTaskFrom` in `local-api.ts`.
 */
function labTaskFrom(
  task: Task,
  username: string,
  userColor: string,
  userColorSecondary: string | null,
): LabTask {
  return {
    id: task.id,
    name: task.name,
    project_id: task.project_id,
    start_date: task.start_date,
    duration_days: task.duration_days,
    end_date: ensureEndDate(task),
    is_complete: task.is_complete,
    task_type: task.task_type,
    username: task.owner || username,
    user_color: userColor,
    user_color_secondary: userColorSecondary,
    experiment_color: task.experiment_color,
    method_ids: task.method_ids || [],
    notes: task.deviation_log,
  };
}

/**
 * Fetch + transform every entity for a single demo user. Returns the
 * raw aggregated slices; the cross-user merge happens in
 * {@link aggregateDemoLabData}.
 */
async function fetchUserSlice(
  fixtureBase: string,
  username: string,
  userColor: string,
  userColorSecondary: string | null,
  hideGoalsFromLab: boolean,
): Promise<{
  tasks: LabTask[];
  projects: LabProject[];
  methods: LabMethod[];
  goals: LabGoal[];
  notesShared: Note[];
  purchaseItems: Array<PurchaseItem & { username: string }>;
}> {
  const base = `${fixtureBase}/users/${username}`;

  // Counters file gates the per-entity range fetches. A missing file
  // means we treat every count as zero and the user contributes nothing.
  const counters =
    (await fetchOneOptional<DemoUserCounters>(`${base}/_counters.json`)) ?? {};

  // Helper for each entity type. Tasks/projects/etc. only need the
  // count.
  const [projectsRaw, tasksRaw, methodsRaw, goalsRaw, notesRaw, itemsRaw] =
    await Promise.all([
      fetchRange<Project>(`${base}/projects`, counters.projects ?? 0),
      fetchRange<Task>(`${base}/tasks`, counters.tasks ?? 0),
      fetchRange<
        // On-disk method shape — only the fields LabMethod needs.
        {
          id: number;
          name: string;
          owner?: string | null;
          is_public?: boolean;
        }
      >(`${base}/methods`, counters.methods ?? 0),
      fetchRange<HighLevelGoal>(`${base}/goals`, counters.goals ?? 0),
      fetchRange<Note>(`${base}/notes`, counters.notes ?? 0),
      fetchRange<PurchaseItem>(
        `${base}/purchase_items`,
        counters.purchase_items ?? 0,
      ),
    ]);

  const projects: LabProject[] = projectsRaw.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color || "#3b82f6",
    username: p.owner || username,
    user_color: userColor,
    is_archived: p.is_archived || false,
  }));

  const tasks: LabTask[] = tasksRaw.map((t) =>
    labTaskFrom(
      // Tasks on disk carry `owner: username` already, but if not, the
      // labTaskFrom call falls back to the iteration username.
      { ...t },
      username,
      userColor,
      userColorSecondary,
    ),
  );

  const methods: LabMethod[] = methodsRaw.map((m) => ({
    id: m.id,
    name: m.name,
    username: m.owner || username,
    user_color: userColor,
    is_public: m.is_public ?? false,
  }));

  // Goals: drop personal goals (project_id === null) to match
  // labApi.getGoals; honor the per-user hide_goals_from_lab opt-out
  // metadata flag if set in _user_metadata.json.
  const goals: LabGoal[] = hideGoalsFromLab
    ? []
    : goalsRaw
        .filter((g) => g.project_id !== null)
        .map((g) => ({
          id: g.id,
          name: g.name,
          project_id: g.project_id,
          start_date: g.start_date,
          end_date: g.end_date,
          is_complete: g.is_complete,
          color: g.color,
          smart_goals: g.smart_goals || [],
          username,
          user_color: userColor,
        }));

  // Notes: keep only shared notes (mirrors labApi.getNotes with
  // shared_only=true — the path LabActivityPanel + NotesPanel both
  // use). Decorate with the iteration username so cross-user filtering
  // in the panels works.
  const notesShared: Note[] = notesRaw
    .filter((n) => n.is_shared)
    .map((n) => ({ ...n, username: n.username || username }));

  // Purchase items: decorate with `username` and recompute total_price
  // when missing — labApi.getAllPurchaseItems does the same.
  const purchaseItems: Array<PurchaseItem & { username: string }> =
    itemsRaw.map((item) => ({
      ...item,
      username,
      total_price:
        item.total_price ??
        (item.price_per_unit ?? 0) * item.quantity +
          (item.shipping_fees ?? 0),
      vendor: item.vendor ?? null,
      category: item.category ?? null,
    }));

  return { tasks, projects, methods, goals, notesShared, purchaseItems };
}

/**
 * Public entry point — fetch the demo bundle for every demo user and
 * merge into a single {@link DemoLabBundle} ready to seed React Query.
 *
 * The demo bundle ships two users (alex + morgan). Both contribute to
 * the merged dataset so the Lab Mode demo looks cross-user populated:
 * the Gantt overlays two users' bars, Methods shows two columns of
 * usage, Activity feed surfaces work from both, etc.
 *
 * @param fixtureBase path prefix under which `users/<u>/...` lives.
 *                    Production: `/demo-data`. Tests can pass a fake
 *                    base when stubbing `fetch`.
 */
export async function aggregateDemoLabData(
  fixtureBase = "/demo-data",
): Promise<DemoLabBundle> {
  // 1. User metadata — color + opt-outs, keyed by username.
  const metadata =
    (await fetchOneOptional<Record<string, DemoUserMetadataEntry>>(
      `${fixtureBase}/users/_user_metadata.json`,
    )) ?? {};

  // 2. The three demo users we ship. Hard-coded here because the bundle's
  //    user discovery happens at generate-time and the on-disk demo
  //    folder is the source of truth — we don't enumerate the directory
  //    at runtime (no FSA-listDirectories in the demo path).
  //
  //    Order matters for the Lab Mode user-filter button: mira (the demo
  //    PI archetype, Dr. Mira Castellanos) renders first so PI-side
  //    LabComments surface at the top of any user-grouped view; alex
  //    (postdoc) second, morgan (grad student) third. Mira owns no tasks /
  //    projects / notes / methods of her own in the fixture — her counters
  //    are all zero so the aggregator iterates her directory cleanly and
  //    contributes no rows to Gantt / Notes / Methods panels. Her presence
  //    is the LabComment thread layer authored across alex + morgan's
  //    shared content.
  const usernames = ["mira", "alex", "morgan"];

  // 3. Build LabUser entries up-front so we can decorate each per-user
  //    slice with the matching color in one pass.
  const users: LabUser[] = usernames.map((username) => ({
    username,
    color: metadata[username]?.color ?? defaultColorFor(username),
    color_secondary: metadata[username]?.color_secondary ?? null,
    created_at: metadata[username]?.created_at ?? null,
  }));

  // 4. Funding accounts live under the shared `users/lab/` namespace,
  //    not under any individual user. Count comes from `lab/_counters.json`.
  const labCounters =
    (await fetchOneOptional<DemoLabCounters>(
      `${fixtureBase}/users/lab/_counters.json`,
    )) ?? {};
  const fundingAccounts = await fetchRange<FundingAccount>(
    `${fixtureBase}/users/lab/funding_accounts`,
    labCounters.funding_accounts ?? 3,
  );

  // 5. Per-user slices, fetched in parallel.
  const slices = await Promise.all(
    users.map((u) =>
      fetchUserSlice(
        fixtureBase,
        u.username,
        u.color,
        u.color_secondary,
        metadata[u.username]?.hide_goals_from_lab === true,
      ),
    ),
  );

  // 6. Merge cross-user.
  const tasks: LabTask[] = [];
  const projects: LabProject[] = [];
  const methods: LabMethod[] = [];
  const goals: LabGoal[] = [];
  const notesShared: Note[] = [];
  const purchaseItems: Array<PurchaseItem & { username: string }> = [];
  for (const slice of slices) {
    tasks.push(...slice.tasks);
    projects.push(...slice.projects);
    methods.push(...slice.methods);
    goals.push(...slice.goals);
    notesShared.push(...slice.notesShared);
    purchaseItems.push(...slice.purchaseItems);
  }

  return {
    users,
    tasks,
    projects,
    methods,
    goals,
    notesShared,
    purchaseItems,
    fundingAccounts,
    methodFolders: [],
  };
}
