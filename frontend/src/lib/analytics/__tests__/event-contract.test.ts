import { describe, expect, it } from "vitest";

import { sanitizeEvent } from "../event-contract";

describe("sanitizeEvent", () => {
  it("rejects an unknown event name", () => {
    expect(sanitizeEvent("definitely_not_allowed", {})).toBeNull();
    expect(sanitizeEvent("", {})).toBeNull();
    expect(sanitizeEvent(123, {})).toBeNull();
  });

  it("keeps allow-listed enum props with valid values", () => {
    expect(
      sanitizeEvent("share_sent", { kind: "method", destination: "email_invite" }),
    ).toEqual({
      name: "share_sent",
      props: { kind: "method", destination: "email_invite" },
    });
  });

  it("drops enum props with values outside the allow-list", () => {
    const out = sanitizeEvent("share_sent", {
      kind: "../../etc/passwd",
      destination: "existing_user",
    });
    expect(out).toEqual({
      name: "share_sent",
      props: { destination: "existing_user" },
    });
  });

  it("drops unknown keys entirely (the PII guard)", () => {
    const out = sanitizeEvent("share_sent", {
      kind: "note",
      destination: "existing_user",
      email: "grant@wisc.edu",
      recipientName: "Dr. Smith",
      noteTitle: "Secret plasmid prep",
    });
    expect(out).toEqual({
      name: "share_sent",
      props: { kind: "note", destination: "existing_user" },
    });
    // Explicitly assert nothing identifying survived.
    expect(JSON.stringify(out)).not.toContain("grant@wisc.edu");
    expect(JSON.stringify(out)).not.toContain("Smith");
    expect(JSON.stringify(out)).not.toContain("plasmid");
  });

  it("keeps real booleans and drops non-boolean values for bool props", () => {
    expect(
      sanitizeEvent("profile_published", {
        has_orcid: true,
        has_affiliation: false,
      }),
    ).toEqual({
      name: "profile_published",
      props: { has_orcid: true, has_affiliation: false },
    });
    // String "true" is not a boolean, so it is dropped.
    expect(
      sanitizeEvent("profile_published", { has_orcid: "true" }),
    ).toEqual({ name: "profile_published", props: {} });
  });

  it("accepts a no-prop event with an empty bag", () => {
    expect(sanitizeEvent("identity_created", undefined)).toEqual({
      name: "identity_created",
      props: {},
    });
    expect(sanitizeEvent("identity_created", { whatever: 1 })).toEqual({
      name: "identity_created",
      props: {},
    });
  });
});
