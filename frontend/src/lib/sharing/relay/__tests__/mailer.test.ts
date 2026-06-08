// Cross-boundary sharing, the branded invite email builders.
//
// Pins the content-minimization rule (only the item TITLE is exposed, no note
// body), that the KEYLESS accept link is present for the CTA, that the body
// carries NO one-time key / fragment (P1-A), that the unsubscribe / abuse lines
// exist (CAN-SPAM), and that interpolated fields are HTML-escaped. Pure string
// builders, no Resend send here.

import { describe, expect, it } from "vitest";

import {
  buildInviteHtml,
  buildInviteText,
  inviteSubject,
} from "../mailer";

// The accept URL the mailer receives is now KEYLESS (no #k= fragment). The route
// builds it from the inviteId, the one-time key never reaches the email (P1-A).
const PARAMS = {
  toEmail: "new@uni.edu",
  senderLabel: "alice@lab.edu",
  itemTitle: "PCR optimization run 7",
  acceptUrl: "https://research-os.app/accept/abc-123",
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

  it("carries no one-time key or fragment in the body (P1-A)", () => {
    // Even if a fragment-bearing URL were passed, the body must not surface a
    // decryption key. With the keyless link, there is no "#k=" anywhere, and the
    // CTA invites account creation rather than one-click opening.
    const html = buildInviteHtml(PARAMS);
    expect(html).not.toContain("#k=");
    expect(html).toContain("https://research-os.app/accept/abc-123");
    expect(html).toContain("Create your free account");
    // Whitespace-normalized so the wrapped copy is matched robustly.
    expect(html.replace(/\s+/g, " ")).toContain(
      "will send you a separate private link or unlock code",
    );
  });

  it("uses the item-kind noun in the body (no key-bearing CTA)", () => {
    const html = buildInviteHtml({ ...PARAMS, itemKind: "project" });
    expect(html).toContain("shared a project with you");
    // The default (omitted kind) keeps the original note wording.
    const noteHtml = buildInviteHtml(PARAMS);
    expect(noteHtml).toContain("shared a research note with you");
    // The CTA is kind-independent now, it always opens the keyless landing.
    expect(noteHtml).toContain("Create your free account");
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
    // No one-time key / fragment in the plaintext body either (P1-A).
    expect(text).not.toContain("#k=");
  });
});
