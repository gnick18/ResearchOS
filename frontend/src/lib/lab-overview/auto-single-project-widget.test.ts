/**
 * Auto Single Project widget on project creation (dashboard-newproject-tour
 * bot, 2026-05-29).
 *
 * Grant's decided model: every project creation appends a `single-project`
 * widget pinned to the new project to the creator's dashboard, so the
 * dashboard SHOWS the project. This suite proves the persistence contract via
 * a real settings round-trip (mem-fs mock, same pattern as
 * last-seen-announcement.test.ts):
 *   - a created project yields a pinned Single Project widget instance in the
 *     dashboard layout (order entry + widgetConfig pin),
 *   - the instance id is deterministic + carries owner:id,
 *   - a second call for the same project is a no-op (no duplicate widget),
 *   - distinct projects each get their own instance,
 *   - the write is additive (the rest of the existing layout is preserved).
 */
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
    isConnected: vi.fn(() => true),
    fileExists: vi.fn(async (path: string) => memFs.has(path)),
  },
}));

vi.mock("@/lib/file-system/user-metadata", () => ({
  getUserMetadata: vi.fn(async () => null),
  setUserMetadataField: vi.fn(async () => {}),
  setUserMetadataColors: vi.fn(async () => {}),
}));

import { readUserSettings, patchUserSettings } from "@/lib/settings/user-settings";
import {
  baseWidgetId,
  singleProjectInstanceId,
} from "@/components/lab-overview/widgets/registry";
import { addSingleProjectWidgetForProject } from "./layout-persistence";

beforeEach(() => {
  memFs.clear();
});

describe("instance-id helpers", () => {
  it("singleProjectInstanceId encodes owner + id after the separator", () => {
    expect(singleProjectInstanceId("alex", 5)).toBe("single-project#alex:5");
  });
  it("baseWidgetId strips the instance suffix; bare ids pass through", () => {
    expect(baseWidgetId("single-project#alex:5")).toBe("single-project");
    expect(baseWidgetId("projects-overview")).toBe("projects-overview");
  });
});

describe("addSingleProjectWidgetForProject — auto widget on create", () => {
  it("appends a pinned Single Project widget instance to the dashboard", async () => {
    const instanceId = await addSingleProjectWidgetForProject("mira", {
      id: 7,
      owner: "mira",
    });
    expect(instanceId).toBe("single-project#mira:7");

    const settings = await readUserSettings("mira");
    const layout = settings.dashboard_layout;
    if (!layout || !("widgetOrder" in layout)) {
      throw new Error("dashboard_layout not written in v2 shape");
    }
    // Order carries the instance id.
    expect(layout.widgetOrder.canvas).toContain("single-project#mira:7");
    // widgetConfig pins the new project (id + owner).
    expect(layout.widgetConfig?.["single-project#mira:7"]).toEqual({
      pinnedProject: { id: 7, owner: "mira" },
    });
  });

  it("is a no-op (no duplicate) when called twice for the same project", async () => {
    await addSingleProjectWidgetForProject("mira", { id: 7, owner: "mira" });
    const second = await addSingleProjectWidgetForProject("mira", {
      id: 7,
      owner: "mira",
    });
    expect(second).toBe("single-project#mira:7");

    const settings = await readUserSettings("mira");
    const layout = settings.dashboard_layout;
    if (!layout || !("widgetOrder" in layout)) {
      throw new Error("dashboard_layout not written in v2 shape");
    }
    const count = layout.widgetOrder.canvas.filter(
      (id) => id === "single-project#mira:7",
    ).length;
    expect(count).toBe(1);
  });

  it("gives DISTINCT projects their own instances", async () => {
    await addSingleProjectWidgetForProject("mira", { id: 7, owner: "mira" });
    await addSingleProjectWidgetForProject("mira", { id: 8, owner: "mira" });

    const settings = await readUserSettings("mira");
    const layout = settings.dashboard_layout;
    if (!layout || !("widgetOrder" in layout)) {
      throw new Error("dashboard_layout not written in v2 shape");
    }
    expect(layout.widgetOrder.canvas).toContain("single-project#mira:7");
    expect(layout.widgetOrder.canvas).toContain("single-project#mira:8");
    expect(layout.widgetConfig?.["single-project#mira:8"]).toEqual({
      pinnedProject: { id: 8, owner: "mira" },
    });
  });

  it("preserves an existing seeded layout (additive append)", async () => {
    // Seed a member dashboard layout (the default member set: no Projects
    // Overview after the default-set change).
    await patchUserSettings("mira", {
      account_type: "member",
      dashboard_layout: {
        version: 2,
        widgetOrder: {
          canvas: ["sidebar-upcoming", "calendar-events-today"],
          sidebar: [],
        },
      },
    });
    await addSingleProjectWidgetForProject("mira", { id: 3, owner: "mira" });

    const settings = await readUserSettings("mira");
    const layout = settings.dashboard_layout;
    if (!layout || !("widgetOrder" in layout)) {
      throw new Error("dashboard_layout not written in v2 shape");
    }
    // The seeded widgets are still present; the new instance is appended.
    expect(layout.widgetOrder.canvas).toEqual([
      "sidebar-upcoming",
      "calendar-events-today",
      "single-project#mira:3",
    ]);
  });
});
