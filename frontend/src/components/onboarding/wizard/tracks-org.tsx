"use client";

// Org-admin track builders (Track 3). Standalone and folderless: ZERO
// research-workspace steps (no handle, no data folder, no E2E keypair). The
// admin lands in the /department or /institution portal after finishing.
//
// Steps (department): Sign in (no skip) -> Name (no skip) -> Link parent
//   institution (skip) -> Roster / invites (skip) -> Billing (skip).
// Steps (institution): Sign in -> Name -> Roster / invites (skip) -> Billing
//   (skip). No parent-link step (institution is the top tier).
//
// The org id is created in the name step and threaded to the later steps via a
// closure ref, so the roster step can mint invites against it. The host (the
// wizard mount) supplies onOrgCreated so it can route to the portal on finish.
//
// This track is gated behind DEPT_TIER_ENABLED / INSTITUTION_TIER_ENABLED IN
// ADDITION to the wizard flag (the caller checks the flags before building it).
//
// No emojis, no em-dashes, no mid-sentence colons.

import type { WizardTrack } from "./wizard-model";
import SignInStep from "./steps/SignInStep";
import OrgNameStep, { type OrgKind } from "./steps/OrgNameStep";
import OrgParentLinkStep from "./steps/OrgParentLinkStep";
import OrgRosterStep from "./steps/OrgRosterStep";
import OrgBillingStep from "./steps/OrgBillingStep";

export interface OrgTrackCallbacks {
  /** Capture the created org id (the host may persist or route on it). */
  onOrgCreated?: (orgId: string) => void;
  /** Capture an optional parent-institution reference (department only). */
  onParentLinked?: (parentRef: string | null) => void;
}

/**
 * Builds the org-admin track for the given kind. A closure ref holds the org id
 * created in the name step so the roster step can mint invites against it.
 */
export function buildOrgTrack(kind: OrgKind, cb: OrgTrackCallbacks = {}): WizardTrack {
  // Mutable closure ref for the created org id, set in the name step and read in
  // the roster step (which renders after the name step has advanced).
  const orgRef: { id: string } = { id: "" };

  const heading =
    kind === "department" ? "Set up a department account" : "Set up an institution account";
  const subheading =
    kind === "department"
      ? "Sign in to anchor the department admin account. This is org admin only, there is no research workspace, handle, or data folder."
      : "Sign in to anchor the institution admin account. This is org admin only, there is no research workspace, handle, or data folder.";

  const signIn = {
    id: "sign-in",
    label: "Sign in",
    skippable: false,
    render: () => (
      <SignInStep
        heading={heading}
        subheading={subheading}
        orgKind={kind === "department" ? "dept" : "inst"}
      />
    ),
  };

  const name = {
    id: "org-name",
    label: "Name",
    skippable: false,
    render: (c: Parameters<WizardTrack["steps"][number]["render"]>[0]) => (
      <OrgNameStep
        kind={kind}
        onCreated={(orgId) => {
          orgRef.id = orgId;
          cb.onOrgCreated?.(orgId);
          c.next();
        }}
      />
    ),
  };

  const parentLink = {
    id: "parent-link",
    label: "Link institution",
    skippable: true,
    render: (c: Parameters<WizardTrack["steps"][number]["render"]>[0]) => (
      <OrgParentLinkStep
        onNext={(ref) => {
          cb.onParentLinked?.(ref);
          c.next();
        }}
      />
    ),
  };

  const roster = {
    id: "roster",
    label: "Invites",
    skippable: true,
    render: (c: Parameters<WizardTrack["steps"][number]["render"]>[0]) => (
      <OrgRosterStep kind={kind} orgId={orgRef.id} onNext={c.next} />
    ),
  };

  const billing = {
    id: "billing",
    label: "Billing",
    skippable: true,
    render: (c: Parameters<WizardTrack["steps"][number]["render"]>[0]) => (
      <OrgBillingStep kind={kind} onFinish={c.next} />
    ),
  };

  const steps =
    kind === "department"
      ? [signIn, name, parentLink, roster, billing]
      : [signIn, name, roster, billing];

  return {
    id: kind === "department" ? "org-dept" : "org-institution",
    label: kind === "department" ? "Department" : "Institution",
    steps,
  };
}
