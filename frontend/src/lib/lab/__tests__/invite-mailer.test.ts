import { describe, expect, it } from "vitest";

import { EMAIL_COLORS } from "@/lib/email/layout";
import {
  buildLabInviteHtml,
  buildLabInviteText,
  labInviteSubject,
} from "@/lib/lab/invite-mailer";

const PARAMS = {
  toEmail: "member@lab.edu",
  senderLabel: "Dr. Grant Nickles",
  labName: "the Nickles Lab",
  inviteUrl: "https://research-os.app/lab/join#inv=abc123",
};

describe("labInviteSubject", () => {
  it("names the sender and the lab", () => {
    expect(labInviteSubject("Dr. Grant Nickles", "the Nickles Lab")).toBe(
      "Dr. Grant Nickles invited you to join the Nickles Lab on ResearchOS",
    );
  });
});

describe("buildLabInviteHtml", () => {
  const html = buildLabInviteHtml(PARAMS);

  it("is on-brand (sky wordmark, action button, no generic blue)", () => {
    expect(html).toContain(EMAIL_COLORS.sky);
    expect(html).toContain(EMAIL_COLORS.action);
    expect(html).not.toContain("#2563eb");
  });

  it("carries the invite link and the join CTA", () => {
    expect(html).toContain("https://research-os.app/lab/join#inv=abc123");
    expect(html).toContain("Join the lab");
    expect(html).toContain("the Nickles Lab");
  });

  it("escapes interpolated fields", () => {
    const evil = buildLabInviteHtml({ ...PARAMS, labName: "a&<b>lab" });
    expect(evil).toContain("a&amp;&lt;b&gt;lab");
  });
});

describe("buildLabInviteText", () => {
  it("carries the link in the plaintext fallback", () => {
    const text = buildLabInviteText(PARAMS);
    expect(text).toContain("https://research-os.app/lab/join#inv=abc123");
    expect(text).toContain("the Nickles Lab");
  });
});
