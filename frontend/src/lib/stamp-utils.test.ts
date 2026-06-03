/**
 * Coverage for the retired-journaling stamp behavior:
 *   - createNewFileContent writes the provenance stamp + H1 ONLY (no last-access
 *     line, no reopened stamps).
 *   - parseContent / extractUserContent still strip the (now journaling-free)
 *     scaffold cleanly, AND still strip leftover legacy last-access / reopened
 *     lines so old files clean up on read.
 *   - The provenance generators (generateStamp / parseStamp / updateStampNames)
 *     are untouched.
 */

import { describe, expect, it } from "vitest";
import {
  createNewFileContent,
  extractUserContent,
  generateStamp,
  parseContent,
  parseStamp,
  updateStampNames,
} from "./stamp-utils";

describe("createNewFileContent (journaling retired)", () => {
  it("ships the provenance stamp but NO last-access line", () => {
    const content = createNewFileContent("Western Blot", "Protein Research", "notes");
    expect(content).toContain("<!-- stamp:start -->");
    expect(content).toContain("<!-- stamp:end -->");
    expect(content).toContain("experiment: Western Blot");
    expect(content).toContain("project folder: Protein Research");
    expect(content).toContain("# Lab Notes: Western Blot");
    // The retired journaling line must not be written anymore.
    expect(content).not.toContain("[last-access]");
    expect(content).not.toContain("Reopened on");
  });

  it("still produces a parseable provenance stamp", () => {
    const content = createNewFileContent("Assay", "Project X", "results");
    const stamp = parseStamp(content);
    expect(stamp).not.toBeNull();
    expect(stamp!.experimentName).toBe("Assay");
    expect(stamp!.projectFolder).toBe("Project X");
  });
});

describe("extractUserContent strips the journaling-free scaffold", () => {
  it("leaves only the user body (incl. the H1 title) for a fresh file", () => {
    const scaffold = createNewFileContent("PCR", "Methods", "method");
    const withBody = `${scaffold}\nMix 10 uL master mix.`;
    const body = extractUserContent(withBody);
    expect(body).toContain("Mix 10 uL master mix.");
    expect(body).not.toContain("<!-- stamp:start -->");
    expect(body).not.toContain("experiment:");
    expect(body).not.toContain("project folder:");
  });
});

describe("strippers still clean leftover legacy journaling in OLD files", () => {
  const legacy = [
    "<!-- stamp:start -->",
    "2026-02-15  ",
    "12:07 PM  ",
    "experiment: Western Blot  ",
    "project folder: Protein  ",
    "<!-- stamp:end -->",
    "___",
    "[last-access]: # (2026-02-15T12:07:00Z)",
    "___",
    "*Reopened on 2026-02-16 at 2:30 PM*",
    "___",
    "",
    "# Lab Notes: Western Blot",
    "",
    "real body content",
  ].join("\n");

  it("parseContent surfaces the legacy last-access value but strips it from content", () => {
    const parsed = parseContent(legacy);
    expect(parsed.lastAccess).toBe("2026-02-15T12:07:00Z");
    expect(parsed.reopenedStamps.length).toBe(1);
    expect(parsed.content).not.toContain("[last-access]");
    expect(parsed.content).not.toContain("Reopened on");
    expect(parsed.content).not.toContain("<!-- stamp");
    expect(parsed.content).toContain("real body content");
  });

  it("extractUserContent drops every journaling artifact", () => {
    const body = extractUserContent(legacy);
    expect(body).not.toContain("last-access");
    expect(body).not.toContain("Reopened");
    expect(body).not.toContain("experiment:");
    expect(body).toContain("real body content");
  });
});

describe("provenance generators untouched", () => {
  it("generateStamp + parseStamp round-trip the experiment / project", () => {
    const stamp = generateStamp("Trial 1", "Folder A");
    const parsed = parseStamp(stamp);
    expect(parsed!.experimentName).toBe("Trial 1");
    expect(parsed!.projectFolder).toBe("Folder A");
  });

  it("updateStampNames rewrites names while keeping the stamp present", () => {
    const stamp = generateStamp("Old", "OldFolder");
    const updated = updateStampNames(stamp, "New", "NewFolder");
    const parsed = parseStamp(updated);
    expect(parsed!.experimentName).toBe("New");
    expect(parsed!.projectFolder).toBe("NewFolder");
    expect(updated).toContain("<!-- stamp:start -->");
  });
});
