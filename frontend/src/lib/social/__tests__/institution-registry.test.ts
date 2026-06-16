import { afterEach, describe, expect, it } from "vitest";

import { humanizeInstitutionSlug } from "@/lib/social/institution";
import {
  __setRegistryForTests,
  clusterDomainsFor,
  normalizeInstitutionSlug,
  resolveInstitution,
} from "@/lib/social/institution-registry";

// A tiny fixture mirroring the real asset shape. Injected via the test seam so
// these tests never touch the 28 MB on-disk registry.
const FIXTURE = {
  meta: { source: "ROR", license: "CC0" },
  byDomain: {
    "wisc.edu": {
      domain: "wisc.edu",
      canonicalName: "University of Wisconsin-Madison",
      rorId: "https://ror.org/01y2jtd41",
      country: "United States",
      aliases: ["UW", "UW-Madison"],
      clusterDomains: ["cals.wisc.edu", "g.wisc.edu", "wisc.edu"],
    },
    "cals.wisc.edu": {
      domain: "cals.wisc.edu",
      canonicalName: "University of Wisconsin-Madison",
      rorId: "https://ror.org/01y2jtd41",
      country: "United States",
      aliases: ["UW", "UW-Madison"],
      clusterDomains: ["cals.wisc.edu", "g.wisc.edu", "wisc.edu"],
    },
    "ox.ac.uk": {
      domain: "ox.ac.uk",
      canonicalName: "University of Oxford",
      rorId: "https://ror.org/052gg0110",
      country: "United Kingdom",
      aliases: ["Oxford University"],
      clusterDomains: ["chg.ox.ac.uk", "ox.ac.uk"],
    },
  },
};

afterEach(() => {
  __setRegistryForTests(null);
});

describe("normalizeInstitutionSlug", () => {
  it("lowercases and trims a bare domain", () => {
    expect(normalizeInstitutionSlug("  Wisc.EDU ")).toBe("wisc.edu");
  });
  it("strips scheme, www, path, query, and port", () => {
    expect(normalizeInstitutionSlug("https://www.wisc.edu/people?x=1")).toBe(
      "wisc.edu",
    );
  });
  it("keys on the domain of an email-shaped input", () => {
    expect(normalizeInstitutionSlug("sarah@cals.wisc.edu")).toBe("cals.wisc.edu");
  });
  it("returns empty for junk", () => {
    expect(normalizeInstitutionSlug("")).toBe("");
    expect(normalizeInstitutionSlug("   ")).toBe("");
  });
});

describe("resolveInstitution", () => {
  it("resolves a known domain to its canonical ROR name", async () => {
    __setRegistryForTests(FIXTURE);
    const rec = await resolveInstitution("wisc.edu");
    expect(rec).not.toBeNull();
    expect(rec!.canonicalName).toBe("University of Wisconsin-Madison");
    expect(rec!.rorId).toBe("https://ror.org/01y2jtd41");
    expect(rec!.country).toBe("United States");
  });

  it("resolves a known domain regardless of case or URL form", async () => {
    __setRegistryForTests(FIXTURE);
    expect((await resolveInstitution("HTTPS://WISC.EDU/"))!.canonicalName).toBe(
      "University of Wisconsin-Madison",
    );
  });

  it("resolves a child/subdomain to the SAME canonical institution", async () => {
    __setRegistryForTests(FIXTURE);
    const parent = await resolveInstitution("wisc.edu");
    const child = await resolveInstitution("cals.wisc.edu");
    expect(child).not.toBeNull();
    expect(child!.canonicalName).toBe(parent!.canonicalName);
    expect(child!.rorId).toBe(parent!.rorId);
  });

  it("returns null for an unknown domain, so callers humanize the slug", async () => {
    __setRegistryForTests(FIXTURE);
    expect(await resolveInstitution("nowhere.example")).toBeNull();
    // The documented fallback the page uses on null.
    const fallback =
      (await resolveInstitution("max-planck"))?.canonicalName ??
      humanizeInstitutionSlug("max-planck");
    expect(fallback).toBe("Max Planck");
  });

  it("never throws when the registry is empty (missing asset)", async () => {
    __setRegistryForTests({ meta: {}, byDomain: {} });
    expect(await resolveInstitution("wisc.edu")).toBeNull();
  });
});

describe("clusterDomainsFor", () => {
  it("returns every domain for the org, including the queried one, sorted", async () => {
    __setRegistryForTests(FIXTURE);
    expect(await clusterDomainsFor("wisc.edu")).toEqual([
      "cals.wisc.edu",
      "g.wisc.edu",
      "wisc.edu",
    ]);
  });

  it("aggregates the same cluster when queried by a child domain", async () => {
    __setRegistryForTests(FIXTURE);
    expect(await clusterDomainsFor("cals.wisc.edu")).toEqual([
      "cals.wisc.edu",
      "g.wisc.edu",
      "wisc.edu",
    ]);
  });

  it("falls back to just the normalized domain when unknown", async () => {
    __setRegistryForTests(FIXTURE);
    expect(await clusterDomainsFor("UnknownU.edu")).toEqual(["unknownu.edu"]);
  });

  it("returns an empty array for empty input (safe to IN-filter)", async () => {
    __setRegistryForTests(FIXTURE);
    expect(await clusterDomainsFor("   ")).toEqual([]);
  });
});
