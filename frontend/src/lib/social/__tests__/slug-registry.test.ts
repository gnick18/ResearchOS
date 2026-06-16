import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  APP_ROUTE_SEGMENTS,
  RESERVED_SLUGS,
  SLUG_MAX_LENGTH,
  isSlugAvailable,
  normalizeSlug,
  suggestSlugs,
  validateRelease,
  validateReserve,
  validateSlug,
} from "@/lib/social/slug-registry";

describe("normalizeSlug", () => {
  it("lowercases and trims", () => {
    expect(normalizeSlug("  SmithLab  ")).toBe("smithlab");
  });

  it("strips a leading @", () => {
    expect(normalizeSlug("@smithlab")).toBe("smithlab");
    expect(normalizeSlug("@@smithlab")).toBe("smithlab");
  });

  it("maps disallowed characters to single dashes", () => {
    expect(normalizeSlug("Smith Lab!")).toBe("smith-lab");
    expect(normalizeSlug("smith..lab")).toBe("smith-lab");
    expect(normalizeSlug("smith___lab")).toBe("smith-lab");
  });

  it("collapses repeated dashes", () => {
    expect(normalizeSlug("smith---lab")).toBe("smith-lab");
  });

  it("strips leading and trailing dashes", () => {
    expect(normalizeSlug("--smith-lab--")).toBe("smith-lab");
    expect(normalizeSlug("-smithlab-")).toBe("smithlab");
  });

  it("keeps internal digits and dashes", () => {
    expect(normalizeSlug("lab-2024")).toBe("lab-2024");
  });

  it("truncates to the max length without a trailing dash", () => {
    const long = "a".repeat(SLUG_MAX_LENGTH + 10);
    expect(normalizeSlug(long)).toBe("a".repeat(SLUG_MAX_LENGTH));
    // A cut that would land on a dash strips it.
    const dashy = `${"a".repeat(SLUG_MAX_LENGTH - 1)}-extra`;
    const out = normalizeSlug(dashy);
    expect(out.endsWith("-")).toBe(false);
    expect(out.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
  });

  it("returns empty for empty or unusable input", () => {
    expect(normalizeSlug("")).toBe("");
    expect(normalizeSlug("   ")).toBe("");
    expect(normalizeSlug("!!!")).toBe("");
    // @ts-expect-error exercising the non-string guard
    expect(normalizeSlug(null)).toBe("");
  });

  it("is idempotent", () => {
    const inputs = ["Smith Lab!", "@@a--b__c", "  X  "];
    for (const i of inputs) {
      expect(normalizeSlug(normalizeSlug(i))).toBe(normalizeSlug(i));
    }
  });
});

describe("validateSlug", () => {
  it("rejects too-short slugs", () => {
    expect(validateSlug("ab")).not.toBeNull();
  });
  it("accepts a valid slug", () => {
    expect(validateSlug("smithlab")).toBeNull();
    expect(validateSlug("smith-lab-2")).toBeNull();
  });
});

describe("reserved-word blocking", () => {
  it("includes every app route segment in RESERVED_SLUGS", () => {
    for (const seg of APP_ROUTE_SEGMENTS) {
      const n = normalizeSlug(seg);
      if (!n) continue;
      expect(RESERVED_SLUGS.has(n)).toBe(true);
    }
  });

  it("includes core system words", () => {
    for (const w of ["admin", "login", "signup", "api", "settings", "u"]) {
      expect(RESERVED_SLUGS.has(w)).toBe(true);
    }
  });

  it("marks a reserved slug unavailable even when not taken", () => {
    expect(isSlugAvailable("admin", { taken: new Set() })).toBe(false);
    expect(isSlugAvailable("settings")).toBe(false);
  });

  it("RESERVED_SLUGS does not drift from the app route directories", () => {
    // Read the live top-level route segments and assert the literal list is in
    // sync. This fails if a new top-level route is added without updating
    // APP_ROUTE_SEGMENTS, which would otherwise let a lab claim a colliding slug.
    const appDir = join(process.cwd(), "src", "app");
    const onDisk = readdirSync(appDir)
      .filter((name) => {
        if (name === "__tests__") return false;
        // Dynamic segments ([slug]) and route groups ((group)) are not literal
        // static routes, so they are not reservable words. The lab companion-site
        // catch-all [labSlug] lives here and must not register as drift.
        if (name.startsWith("[") || name.startsWith("(")) return false;
        try {
          return statSync(join(appDir, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
    const declared = [...APP_ROUTE_SEGMENTS].sort();
    expect(declared).toEqual(onDisk);
  });
});

describe("isSlugAvailable (uniqueness)", () => {
  it("is false when the slug is already taken", () => {
    const taken = new Set(["smithlab"]);
    expect(isSlugAvailable("smithlab", { taken })).toBe(false);
    expect(isSlugAvailable("SmithLab", { taken })).toBe(false); // normalized
  });

  it("is true for a valid, unreserved, untaken slug", () => {
    expect(isSlugAvailable("joneslab", { taken: new Set(["smithlab"]) })).toBe(
      true,
    );
  });

  it("is false for a structurally invalid slug", () => {
    expect(isSlugAvailable("ab")).toBe(false);
    expect(isSlugAvailable("")).toBe(false);
  });
});

describe("suggestSlugs (institution-aware, deterministic)", () => {
  it("offers institution-suffixed then numeric then generic variants", () => {
    const out = suggestSlugs("smithlab", {
      institutionShortName: "wisc",
      institutionDomain: "uwmadison.edu",
      taken: new Set(["smithlab"]),
    });
    // Deterministic priority order: instShort, instDomain, numeric, -lab.
    expect(out[0]).toBe("smithlab-wisc");
    expect(out).toContain("smithlab-uwmadison");
    expect(out).toContain("smithlab2");
    expect(out).toContain("smithlab-lab");
    // Never the taken desired slug itself.
    expect(out).not.toContain("smithlab");
  });

  it("is deterministic across calls", () => {
    const args = {
      institutionShortName: "wisc",
      institutionDomain: "uwmadison.edu",
      taken: new Set(["smithlab"]),
    } as const;
    expect(suggestSlugs("smithlab", { ...args, taken: new Set(args.taken) })).toEqual(
      suggestSlugs("smithlab", { ...args, taken: new Set(args.taken) }),
    );
  });

  it("filters out suggestions that are themselves taken or reserved", () => {
    const out = suggestSlugs("smithlab", {
      institutionShortName: "wisc",
      taken: new Set(["smithlab", "smithlab-wisc", "smithlab2"]),
    });
    expect(out).not.toContain("smithlab-wisc");
    expect(out).not.toContain("smithlab2");
    // Falls through to the next available numeric / generic option.
    expect(out.length).toBeGreaterThan(0);
  });

  it("derives a suffix from a domain when no short name is given", () => {
    const out = suggestSlugs("smithlab", {
      institutionDomain: "wisc.edu",
      taken: new Set(["smithlab"]),
    });
    expect(out).toContain("smithlab-wisc");
  });

  it("picks the org label before a public suffix for multi-label domains", () => {
    const out = suggestSlugs("smithlab", {
      institutionDomain: "cs.stanford.edu",
      taken: new Set(["smithlab"]),
    });
    expect(out).toContain("smithlab-stanford");
  });

  it("returns numeric and generic fallbacks with no institution info", () => {
    const out = suggestSlugs("smithlab", { taken: new Set(["smithlab"]) });
    expect(out).toContain("smithlab2");
    expect(out).toContain("smithlab-lab");
    expect(out).toContain("lab-smithlab");
  });

  it("returns [] for empty input", () => {
    expect(suggestSlugs("")).toEqual([]);
  });

  it("respects the limit", () => {
    const out = suggestSlugs("smithlab", {
      institutionShortName: "wisc",
      taken: new Set(["smithlab"]),
      limit: 2,
    });
    expect(out.length).toBe(2);
  });
});

describe("validateReserve", () => {
  it("normalizes the slug and returns the validated value", () => {
    const r = validateReserve({ slug: " Smith Lab ", kind: "lab" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.slug).toBe("smith-lab");
      expect(r.value.kind).toBe("lab");
      expect(r.value.ownerKey).toBeNull();
    }
  });

  it("rejects an unknown kind", () => {
    // @ts-expect-error exercising the runtime guard with a bad kind
    const r = validateReserve({ slug: "smithlab", kind: "bogus" });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-reserved kind claiming a reserved slug", () => {
    const r = validateReserve({ slug: "admin", kind: "lab" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/reserved/i);
  });

  it("allows kind=reserved to register a reserved slug (the seeder path)", () => {
    const r = validateReserve({ slug: "admin", kind: "reserved" });
    expect(r.ok).toBe(true);
  });

  it("rejects a too-short slug", () => {
    const r = validateReserve({ slug: "ab", kind: "lab" });
    expect(r.ok).toBe(false);
  });
});

describe("validateRelease", () => {
  it("normalizes and accepts a valid slug", () => {
    const r = validateRelease(" SmithLab ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.slug).toBe("smithlab");
  });
  it("rejects an invalid slug", () => {
    const r = validateRelease("ab");
    expect(r.ok).toBe(false);
  });
});
