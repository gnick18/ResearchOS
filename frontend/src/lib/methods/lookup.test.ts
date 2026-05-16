import { describe, expect, it } from "vitest";
import type { Method, TaskMethodAttachment } from "@/lib/types";
import { resolveMethodForAttachment, resolveMethodById } from "./lookup";

function method(partial: Partial<Method> & { id: number; owner: string }): Method {
  return {
    name: `method-${partial.id}-${partial.owner}`,
    source_path: null,
    method_type: "markdown",
    folder_path: null,
    parent_method_id: null,
    tags: null,
    is_public: partial.owner === "public",
    created_by: null,
    shared_with: [],
    ...partial,
  };
}

function attachment(partial: Partial<TaskMethodAttachment> & { method_id: number }): TaskMethodAttachment {
  return {
    owner: null,
    pcr_gradient: null,
    pcr_ingredients: null,
    lc_gradient: null,
    body_override: null,
    plate_annotation: null,
    cell_culture_schedule: null,
    variation_notes: null,
    compound_snapshots: null,
    qpcr_analysis: null,
    ...partial,
  };
}

describe("resolveMethodForAttachment", () => {
  const alexPrivate2 = method({ id: 2, owner: "alex", name: "alex's markdown" });
  const publicPcr2 = method({ id: 2, owner: "public", name: "public PCR" });
  const morganPrivate2 = method({ id: 2, owner: "morgan", name: "morgan's plate" });
  const allMethods = [alexPrivate2, publicPcr2, morganPrivate2];

  it("returns undefined for an undefined attachment", () => {
    expect(resolveMethodForAttachment(undefined, allMethods, "alex")).toBeUndefined();
  });

  it("composite (id, owner) match when owner is non-null — picks the public method even when same-id private exists", () => {
    const a = attachment({ method_id: 2, owner: "public" });
    expect(resolveMethodForAttachment(a, allMethods, "alex")).toBe(publicPcr2);
  });

  it("composite (id, owner) match — pinned cross-user method routes correctly", () => {
    const a = attachment({ method_id: 2, owner: "morgan" });
    expect(resolveMethodForAttachment(a, allMethods, "alex")).toBe(morganPrivate2);
  });

  it("null owner — prefers the task owner's own method on id collision", () => {
    const a = attachment({ method_id: 2, owner: null });
    expect(resolveMethodForAttachment(a, allMethods, "alex")).toBe(alexPrivate2);
    expect(resolveMethodForAttachment(a, allMethods, "morgan")).toBe(morganPrivate2);
  });

  it("null owner — falls back to first match when no candidate matches the task owner", () => {
    const a = attachment({ method_id: 2, owner: null });
    // Task owner "kritika" has no method 2; pick first in the list.
    expect(resolveMethodForAttachment(a, allMethods, "kritika")).toBe(alexPrivate2);
  });

  it("composite owner that has no matching record returns undefined", () => {
    const a = attachment({ method_id: 2, owner: "ghost" });
    expect(resolveMethodForAttachment(a, allMethods, "alex")).toBeUndefined();
  });

  it("returns undefined when no method matches the id at all", () => {
    const a = attachment({ method_id: 99, owner: null });
    expect(resolveMethodForAttachment(a, allMethods, "alex")).toBeUndefined();
  });
});

describe("resolveMethodById", () => {
  const alexPrivate2 = method({ id: 2, owner: "alex" });
  const publicPcr2 = method({ id: 2, owner: "public" });
  const allMethods = [alexPrivate2, publicPcr2];

  it("routes through the matching attachment when present (collision case the bug-fix exists for)", () => {
    const attachments = [attachment({ method_id: 2, owner: "public" })];
    expect(resolveMethodById(2, attachments, allMethods, "alex")).toBe(publicPcr2);
  });

  it("falls back to task-owner-first byId when no matching attachment exists", () => {
    expect(resolveMethodById(2, [], allMethods, "alex")).toBe(alexPrivate2);
  });

  it("handles undefined attachments array (newly-created tasks before attachment backfill)", () => {
    expect(resolveMethodById(2, undefined, allMethods, "alex")).toBe(alexPrivate2);
  });

  it("returns undefined when the id is unknown", () => {
    expect(resolveMethodById(99, [], allMethods, "alex")).toBeUndefined();
  });
});
