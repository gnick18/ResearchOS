// frontend/src/lib/methods/request-method-type.test.ts
//
// Extension Store Phase U2 (extension-store U2 bot) coverage for the
// "request a new method type" STUB URL builder. It must produce a GitHub
// new-issue URL through the shared `generateGitHubIssueUrl` feature rail:
//   - points at the real repo + feature template
//   - frames the body as a method-type request (the preamble)
//   - folds the user's free text into both title and body
//   - degrades gracefully with no input

import { describe, expect, it } from "vitest";
import {
  buildRequestMethodTypeUrl,
  REQUEST_METHOD_TYPE_PREAMBLE,
} from "./request-method-type";

function parse(url: string): URL {
  return new URL(url);
}

describe("buildRequestMethodTypeUrl()", () => {
  it("builds a GitHub feature-issue URL against the project repo", () => {
    const u = parse(buildRequestMethodTypeUrl());
    expect(u.origin + u.pathname).toBe(
      "https://github.com/gnick18/ResearchOS/issues/new",
    );
    // Inherits the feature template + enhancement label from the shared rail.
    expect(u.searchParams.get("template")).toBe("feature.yml");
    expect(u.searchParams.get("labels")).toBe("enhancement");
  });

  it("tags the title and frames the body as a method-type request", () => {
    const u = parse(buildRequestMethodTypeUrl());
    const title = u.searchParams.get("title") ?? "";
    expect(title).toContain("[Feature]");
    expect(title).toContain("New method type");
    // feature.yml prefills the `feature` field id (per generateGitHubIssueUrl).
    const body = u.searchParams.get("feature") ?? "";
    expect(body).toContain(REQUEST_METHOD_TYPE_PREAMBLE);
  });

  it("folds the user's description into the title and body", () => {
    const u = parse(
      buildRequestMethodTypeUrl({ description: "Flow cytometry gating panel" }),
    );
    expect(u.searchParams.get("title")).toContain(
      "Flow cytometry gating panel",
    );
    const body = u.searchParams.get("feature") ?? "";
    expect(body).toContain(REQUEST_METHOD_TYPE_PREAMBLE);
    expect(body).toContain("Flow cytometry gating panel");
  });

  it("produces a sensible skeleton body when no description is given", () => {
    const body =
      parse(buildRequestMethodTypeUrl({ description: "   " })).searchParams.get(
        "feature",
      ) ?? "";
    expect(body).toContain(REQUEST_METHOD_TYPE_PREAMBLE);
    expect(body.toLowerCase()).toContain("describe the method type");
  });
});
