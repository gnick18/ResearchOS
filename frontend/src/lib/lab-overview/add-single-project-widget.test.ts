// §6.1 tour-collision dedupe (single-project-tour-collision fix bot,
// 2026-05-29). Proves `addSingleProjectWidgetForProject` keeps the dashboard
// to exactly ONE Single Project widget for a freshly created project:
//
//   - a fresh dashboard with NO single-project widget gets ONE pinned instance
//     appended (id `single-project#<owner>:<id>`);
//   - a dashboard that already carries an EMPTY bare `single-project` widget
//     gets that instance PINNED IN PLACE (renamed to the deterministic id, its
//     widgetConfig moved over) rather than a SECOND widget appended, so no
//     stray empty tile is left behind (the §6.1 "two widgets" bug);
//   - an ALREADY-pinned instance for the same project is a de-dup no-op;
//   - the resulting pinned config carries `pinnedProject`, which is what makes
//     the tile resolve `pinned` and stamp the `home-single-project-open-…`
//     tour target the §6.1 nav beat clicks.
//
// Drives the REAL read/write path through an in-memory fileService so the
// seed -> rename/append -> read-back round-trip is exercised end to end.

import { describe, expect, it, vi, beforeEach } from "vitest";

const memFs = new Map<string, unknown>();

vi.mock("@/lib/file-system/file-service", () => ({
  fileService: {
    readJson: vi.fn(async (path: string) => {
      const v = memFs.get(path);
      return v === undefined ? null : v;
    }),
    writeJson: vi.fn(async (path: string, data: unknown) => {
      memFs.set(path, data);
    }),
    // readUserSettings short-circuits to DEFAULT_SETTINGS when not connected;
    // force connected so our seeded layouts round-trip.
    isConnected: vi.fn(() => true),
    fileExists: vi.fn(async (path: string) => memFs.has(path)),
  },
}));

// readUserSettings seeds color / hide-goals from _user_metadata.json. Return
// null so seeding short-circuits and never touches the layout under test.
vi.mock("@/lib/file-system/user-metadata", () => ({
  getUserMetadata: vi.fn(async () => null),
  setUserMetadataField: vi.fn(async () => {}),
  setUserMetadataColors: vi.fn(async () => {}),
}));

import {
  addSingleProjectWidgetForProject,
  LAB_OVERVIEW_LAYOUT_VERSION,
} from "./layout-persistence";
import { singleProjectInstanceId } from "@/components/lab-overview/widgets/registry";
import {
  readUserSettings,
  patchUserSettings,
  type LabOverviewLayout,
} from "@/lib/settings/user-settings";

const USER = "mira";
const PROJECT = { id: 7, owner: "mira" };
const PINNED_ID = singleProjectInstanceId(PROJECT.owner, PROJECT.id);

async function seedDashboard(layout: LabOverviewLayout): Promise<void> {
  await patchUserSettings(USER, { dashboard_layout: layout });
}

async function readCanvas(): Promise<{
  canvas: string[];
  widgetConfig: Record<string, { pinnedProject?: { id: number; owner: string } }>;
}> {
  const settings = await readUserSettings(USER);
  const dl = settings.dashboard_layout as LabOverviewLayout | undefined;
  return {
    canvas: dl?.widgetOrder.canvas ?? [],
    widgetConfig: (dl?.widgetConfig ?? {}) as Record<
      string,
      { pinnedProject?: { id: number; owner: string } }
    >,
  };
}

beforeEach(() => {
  memFs.clear();
});

describe("addSingleProjectWidgetForProject — §6.1 dedupe", () => {
  it("appends ONE pinned instance when no single-project widget exists", async () => {
    await seedDashboard({
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: { canvas: ["announcements", "comment-feed"], sidebar: [] },
    });

    const returnedId = await addSingleProjectWidgetForProject(USER, PROJECT);
    expect(returnedId).toBe(PINNED_ID);

    const { canvas, widgetConfig } = await readCanvas();
    // Exactly one single-project widget, and it is the PINNED instance.
    const singleProjectIds = canvas.filter((id) =>
      id.startsWith("single-project"),
    );
    expect(singleProjectIds).toEqual([PINNED_ID]);
    expect(widgetConfig[PINNED_ID]?.pinnedProject).toEqual(PROJECT);
  });

  it("PINS an existing EMPTY bare single-project in place (no second widget, no stray empty)", async () => {
    // Dashboard already carries an UNPINNED bare `single-project` (added from
    // the palette / a prior tour run) — the source of the "two widgets" bug.
    await seedDashboard({
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: {
        canvas: ["announcements", "single-project", "comment-feed"],
        sidebar: [],
      },
    });

    const returnedId = await addSingleProjectWidgetForProject(USER, PROJECT);
    expect(returnedId).toBe(PINNED_ID);

    const { canvas, widgetConfig } = await readCanvas();
    // The bare instance was RENAMED in place at its original index — NOT a
    // second widget appended. Exactly one single-project widget remains.
    expect(canvas).toEqual([
      "announcements",
      PINNED_ID,
      "comment-feed",
    ]);
    const singleProjectIds = canvas.filter((id) =>
      id.startsWith("single-project"),
    );
    expect(singleProjectIds).toEqual([PINNED_ID]);
    // No stray empty `single-project` config key lingers.
    expect(canvas).not.toContain("single-project");
    expect(widgetConfig["single-project"]).toBeUndefined();
    expect(widgetConfig[PINNED_ID]?.pinnedProject).toEqual(PROJECT);
  });

  it("is a no-op when the project's pinned instance already exists", async () => {
    await seedDashboard({
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: {
        canvas: ["announcements", PINNED_ID],
        sidebar: [],
      },
      widgetConfig: { [PINNED_ID]: { pinnedProject: PROJECT } },
    });

    const returnedId = await addSingleProjectWidgetForProject(USER, PROJECT);
    expect(returnedId).toBe(PINNED_ID);

    const { canvas } = await readCanvas();
    const singleProjectIds = canvas.filter((id) =>
      id.startsWith("single-project"),
    );
    // Still exactly one; not duplicated.
    expect(singleProjectIds).toEqual([PINNED_ID]);
  });

  it("does NOT reuse a DIFFERENT project's pinned instance — appends a fresh one", async () => {
    const otherId = singleProjectInstanceId("alex", 42);
    await seedDashboard({
      version: LAB_OVERVIEW_LAYOUT_VERSION,
      widgetOrder: { canvas: ["announcements", otherId], sidebar: [] },
      widgetConfig: {
        [otherId]: { pinnedProject: { id: 42, owner: "alex" } },
      },
    });

    const returnedId = await addSingleProjectWidgetForProject(USER, PROJECT);
    expect(returnedId).toBe(PINNED_ID);

    const { canvas, widgetConfig } = await readCanvas();
    // Both pinned instances coexist — a pinned tile for another project is NOT
    // the empty/picker tile, so it must not be re-pinned.
    expect(canvas).toContain(otherId);
    expect(canvas).toContain(PINNED_ID);
    expect(widgetConfig[otherId]?.pinnedProject).toEqual({ id: 42, owner: "alex" });
    expect(widgetConfig[PINNED_ID]?.pinnedProject).toEqual(PROJECT);
  });
});
