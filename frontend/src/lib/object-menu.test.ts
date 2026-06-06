import { describe, it, expect, vi } from "vitest";
import { buildObjectMenuItems, type ObjectMenuItem } from "@/lib/object-menu";

const item: ObjectMenuItem = { type: "sequence", id: 5, name: "pUC19" };

describe("buildObjectMenuItems", () => {
  it("shows only the provided handlers (plus copy reference)", () => {
    const items = buildObjectMenuItems(item, {
      onRename: vi.fn(),
      onDelete: vi.fn(),
      onCopyReference: vi.fn(),
    });
    const ids = items.map((i) => i.id);
    expect(ids).toContain("object-rename");
    expect(ids).toContain("object-delete");
    expect(ids).toContain("object-copy-reference");
    expect(ids).not.toContain("object-duplicate");
    expect(ids).not.toContain("object-share");
    expect(ids).not.toContain("object-export");
    expect(ids).not.toContain("object-move");
  });

  it("always includes copy reference when its handler is provided", () => {
    const items = buildObjectMenuItems(item, { onCopyReference: vi.fn() });
    expect(items.map((i) => i.id)).toEqual(["object-copy-reference"]);
  });

  it("puts delete in a destructive group", () => {
    const items = buildObjectMenuItems(item, {
      onCopyReference: vi.fn(),
      onDelete: vi.fn(),
    });
    const del = items.find((i) => i.id === "object-delete");
    expect(del?.destructive).toBe(true);
    expect(del?.group).toBe(true);
  });

  it("orders rename first and runs the handler on its onRun", () => {
    const onRename = vi.fn();
    const items = buildObjectMenuItems(item, {
      onRename,
      onCopyReference: vi.fn(),
    });
    expect(items[0].id).toBe("object-rename");
    items[0].onRun();
    expect(onRename).toHaveBeenCalledOnce();
  });

  it("starts the capability group on its first present member", () => {
    // Duplicate omitted, Share present: Share should still open the group.
    const items = buildObjectMenuItems(item, {
      onShare: vi.fn(),
      onCopyReference: vi.fn(),
    });
    const share = items.find((i) => i.id === "object-share");
    expect(share?.group).toBe(true);
  });

  it("returns an empty list when no handlers are provided", () => {
    expect(buildObjectMenuItems(item, {})).toEqual([]);
  });
});
