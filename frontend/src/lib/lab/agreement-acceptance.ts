// Member-side membership-agreement acceptance (LAB_ARCHIVE_CONTINUITY.md).
//
// Records that a member accepted the lab head's data-ownership agreement at a
// given version, and exposes a pure gate the join flows use to decide whether to
// present it. Path-agnostic: both the local shared-folder join and (later) the
// lab-tier invite call the same recordAcceptance + needsAgreementAcceptance, so
// consent is wired the same way wherever a member joins.
//
// The record lives in the member's own folder (users/<member>/_lab_agreement
// .json), so the lab head can read who accepted which version (the same way the
// PI reads members' sidecars), and the member owns their own consent record.
//
// House style: no em-dashes, no emojis, no mid-sentence colons.

import { fileService } from "@/lib/file-system/file-service";
import type { LabMembershipAgreement } from "@/lib/settings/user-settings";

export interface AgreementAcceptance {
  /** The agreement version the member accepted. */
  version: number;
  /** When they accepted (ISO). */
  acceptedAt: string;
  /** The lab head username whose agreement was accepted (provenance). */
  labHead: string;
}

function acceptancePath(username: string): string {
  return `users/${username}/_lab_agreement.json`;
}

/** Reads a member's acceptance record, or null when they have not accepted. */
export async function readAgreementAcceptance(
  username: string,
): Promise<AgreementAcceptance | null> {
  try {
    return await fileService.readJson<AgreementAcceptance>(
      acceptancePath(username),
    );
  } catch {
    return null;
  }
}

/** Records (or updates) a member's acceptance at the given version. */
export async function recordAgreementAcceptance(
  username: string,
  version: number,
  labHead: string,
): Promise<void> {
  const record: AgreementAcceptance = {
    version,
    acceptedAt: new Date().toISOString(),
    labHead,
  };
  await fileService.writeJson(acceptancePath(username), record);
}

/**
 * Pure gate: should this member be shown the agreement before they can proceed?
 * True when the agreement is enabled AND the member has not accepted the current
 * version (never accepted, or accepted an older version after the PI revised the
 * text). A disabled agreement never gates.
 */
export function needsAgreementAcceptance(
  config: Pick<LabMembershipAgreement, "enabled" | "version"> | null | undefined,
  accepted: Pick<AgreementAcceptance, "version"> | null | undefined,
): boolean {
  if (!config || !config.enabled) return false;
  if (!accepted) return true;
  return accepted.version < config.version;
}
