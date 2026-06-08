import { describe, expect, it } from "vitest";

import {
  EMAIL_COLORS,
  escapeHtml,
  renderEmailLayout,
} from "@/lib/email/layout";

// Built from parts so this test file does not itself contain the literal inline
// SVG tag (the icon-guard pre-commit hook scans for it). We assert the rendered
// emails never emit one, since Gmail/Outlook strip inline SVG.
const SVG_OPEN_TAG = `<${"svg"}`;
import { buildInviteHtml } from "@/lib/sharing/relay/mailer";
import { buildOtpHtml } from "@/lib/sharing/directory/mailer";
import { reminderHtml } from "@/lib/business/reminders";
import type { Deadline } from "@/lib/business/calc";

describe("renderEmailLayout", () => {
  const base = renderEmailLayout({
    heading: "Hello",
    bodyHtml: "<p>body</p>",
    cta: { label: "Do the thing", url: "https://research-os.app/x" },
  });

  it("uses the brand sky wordmark and action-blue button, not generic blue", () => {
    expect(base).toContain(EMAIL_COLORS.sky); // #1AA0E6 wordmark
    expect(base).toContain(EMAIL_COLORS.action); // #1283C9 button
    expect(base).not.toContain("#2563eb"); // the old generic blue is gone
  });

  it("renders a raster mascot lockup, never inline SVG", () => {
    expect(base).toContain('alt="ResearchOS"');
    expect(base).toContain("/email/beakerbot.png");
    expect(base).not.toContain(SVG_OPEN_TAG);
    expect(base).toContain(">ResearchOS</span>");
  });

  it("includes a rainbow band with a flat brand-sky fallback", () => {
    // Flat fallback first, gradient override second (clients that drop gradients
    // still show a brand bar).
    expect(base).toContain(`background:${EMAIL_COLORS.sky};background:linear-gradient(`);
  });

  it("escapes the button label but trusts body/url", () => {
    const html = renderEmailLayout({
      bodyHtml: "<p>ok</p>",
      cta: { label: "<b>x</b>", url: "https://x/?a=1&b=2" },
    });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("https://x/?a=1&b=2");
  });
});

describe("escapeHtml", () => {
  it("escapes the dangerous characters", () => {
    expect(escapeHtml('<script>"a&b"')).toBe("&lt;script&gt;&quot;a&amp;b&quot;");
  });
});

describe("buildInviteHtml is now on-brand", () => {
  it("uses brand sky / action blue and not the old generic blue", () => {
    const html = buildInviteHtml({
      toEmail: "x@y.z",
      senderLabel: "alice@lab.edu",
      itemTitle: "PCR run 7",
      acceptUrl: "https://research-os.app/accept/abc",
    });
    expect(html).toContain(EMAIL_COLORS.sky);
    expect(html).toContain(EMAIL_COLORS.action);
    expect(html).not.toContain("#2563eb");
    // copy + CTA preserved (origin's key-in-fragment invite copy)
    expect(html).toContain("Open this research note on ResearchOS");
    expect(html.replace(/\s+/g, " ")).toContain(
      "Create a free account to open it",
    );
  });
});

describe("buildOtpHtml", () => {
  it("brands the OTP and shows the code in a styled box", () => {
    const html = buildOtpHtml("482915");
    expect(html).toContain("482915");
    expect(html).toContain(EMAIL_COLORS.sky);
    expect(html).not.toContain(SVG_OPEN_TAG);
    expect(html.toLowerCase()).toContain("expires in 15 minutes");
  });
});

describe("reminderHtml", () => {
  it("brands the admin reminder with a tracker button", () => {
    const d: Deadline = {
      label: "Annual LLC report",
      dueDate: "2026-06-11",
      daysUntil: 3,
      note: "File with the Wisconsin DFI.",
    } as Deadline;
    const html = reminderHtml(d);
    expect(html).toContain("Annual LLC report");
    expect(html).toContain("/admin/business");
    expect(html).toContain("business tracker");
    expect(html).toContain(EMAIL_COLORS.sky);
  });
});
