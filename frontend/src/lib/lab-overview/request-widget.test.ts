// frontend/src/lib/lab-overview/request-widget.test.ts
//
// Extension Store Phase U3 (extension-store U3 bot) coverage for the
// "request a new widget" STUB URL builder. It must produce a GitHub
// new-issue URL through the shared `generateGitHubIssueUrl` feature rail:
//   - points at the real repo + feature template
//   - frames the body as a widget request (the preamble)
//   - folds the user's free text into both title and body
//   - degrades gracefully with no input

import { describe, expect, it } from "vitest";
import {
  buildRequestWidgetUrl,
  REQUEST_WIDGET_PREAMBLE,
} from "./request-widget";

function parse(url: string): URL {
  return new URL(url);
}

describe("buildRequestWidgetUrl()", () => {
  it("builds a GitHub feature-issue URL against the project repo", () => {
    const u = parse(buildRequestWidgetUrl());
    expect(u.origin + u.pathname).toBe(
      "https://github.com/gnick18/ResearchOS/issues/new",
    );
    // Inherits the feature template + enhancement label from the shared rail.
    expect(u.searchParams.get("template")).toBe("feature.yml");
    expect(u.searchParams.get("labels")).toBe("enhancement");
  });

  it("tags the title and frames the body as a widget request", () => {
    const u = parse(buildRequestWidgetUrl());
    const title = u.searchParams.get("title") ?? "";
    expect(title).toContain("[Feature]");
    expect(title).toContain("New widget");
    // feature.yml prefills the `feature` field id (per generateGitHubIssueUrl).
    const body = u.searchParams.get("feature") ?? "";
    expect(body).toContain(REQUEST_WIDGET_PREAMBLE);
  });

  it("folds the user's description into the title and body", () => {
    const u = parse(
      buildRequestWidgetUrl({ description: "Freezer low-stock alert" }),
    );
    expect(u.searchParams.get("title")).toContain("Freezer low-stock alert");
    const body = u.searchParams.get("feature") ?? "";
    expect(body).toContain(REQUEST_WIDGET_PREAMBLE);
    expect(body).toContain("Freezer low-stock alert");
  });

  it("produces a sensible skeleton body when no description is given", () => {
    const body =
      parse(buildRequestWidgetUrl({ description: "   " })).searchParams.get(
        "feature",
      ) ?? "";
    expect(body).toContain(REQUEST_WIDGET_PREAMBLE);
    expect(body.toLowerCase()).toContain("describe the widget");
  });
});
