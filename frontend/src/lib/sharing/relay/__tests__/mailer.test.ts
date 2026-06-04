// Cross-boundary sharing, the branded invite email builders.
//
// Pins the content-minimization rule (only the item TITLE is exposed, no note
// body), that the accept URL is present for the CTA, that the unsubscribe / abuse
// lines exist (CAN-SPAM), and that interpolated fields are HTML-escaped. Pure
// string builders, no Resend send here.

import { describe, expect, it } from "vitest";

import {
  buildInviteHtml,
  buildInviteText,
  inviteSubject,
} from "../mailer";

const PARAMS = {
  toEmail: "new@uni.edu",
  senderLabel: "alice@lab.edu",
  itemTitle: "PCR optimization run 7",
  acceptUrl: "https://research-os.app/accept/abc-123#k=deadbeef",
};

describe("inviteSubject", () => {
  it("is transactional and names the sender", () => {
    expect(inviteSubject("alice@lab.edu")).toBe(
      "alice@lab.edu shared a research note with you on ResearchOS",
    );
  });

  it("reads with the right noun and article per item kind", () => {
    expect(inviteSubject("alice@lab.edu", "experiment")).toBe(
      "alice@lab.edu shared an experiment with you on ResearchOS",
    );
    expect(inviteSubject("alice@lab.edu", "method")).toBe(
      "alice@lab.edu shared a method with you on ResearchOS",
    );
    expect(inviteSubject("alice@lab.edu", "project")).toBe(
      "alice@lab.edu shared a project with you on ResearchOS",
    );
    // An explicit "note" matches the default.
    expect(inviteSubject("alice@lab.edu", "note")).toBe(
      inviteSubject("alice@lab.edu"),
    );
  });
});

describe("buildInviteHtml", () => {
  it("exposes only the title, not note content", () => {
    const html = buildInviteHtml(PARAMS);
    expect(html).toContain("PCR optimization run 7");
    expect(html).toContain(PARAMS.acceptUrl);
    expect(html).toContain("alice@lab.edu");
  });

  it("includes the unsubscribe and abuse lines (CAN-SPAM)", () => {
    const html = buildInviteHtml(PARAMS);
    expect(html.toLowerCase()).toContain("do not invite me again");
    expect(html.toLowerCase()).toContain("report abuse");
  });

  it("uses the item-kind noun in the body and CTA", () => {
    const html = buildInviteHtml({ ...PARAMS, itemKind: "project" });
    expect(html).toContain("shared a project with you");
    expect(html).toContain("Open this project on ResearchOS");
    // The default (omitted kind) keeps the original note wording.
    const noteHtml = buildInviteHtml(PARAMS);
    expect(noteHtml).toContain("shared a research note with you");
    expect(noteHtml).toContain("Open this research note on ResearchOS");
  });

  it("uses a hosted raster mascot, not inline SVG, in an absolute-URL lockup", () => {
    const html = buildInviteHtml(PARAMS);
    // The mascot is an <img> at an absolute https URL under /email, never inline
    // SVG (Gmail / Outlook strip inline SVG). The wordmark sits beside it as real
    // styled text, and the alt degrades to the brand string.
    expect(html).toContain('<img src="https://research-os.app/email/beakerbot.png"');
    expect(html).toContain('alt="ResearchOS"');
    expect(html).not.toContain("<svg");
    expect(html).toContain(">ResearchOS</span>");
  });

  it("escapes HTML in interpolated fields", () => {
    const html = buildInviteHtml({
      ...PARAMS,
      itemTitle: "<script>x</script>",
      senderLabel: "a&b",
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a&amp;b");
  });
});

describe("buildInviteText", () => {
  it("carries the title and the accept link, nothing more sensitive", () => {
    const text = buildInviteText(PARAMS);
    expect(text).toContain("PCR optimization run 7");
    expect(text).toContain(PARAMS.acceptUrl);
  });
});
