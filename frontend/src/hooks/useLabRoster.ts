"use client";

// Shared lab-roster loader. One coherent read of every lab member with the
// display + compliance fields the PI surfaces need (the Settings Lab Roster and
// the PI-Mode People page both render from this). Extracted from LabRoster so
// the two surfaces share a single query (one cache key, one fetch).
//
// Contents-free by design: the IDP signal is only {exists, updated_at}, never the
// plan itself (NSF expects an IDP to exist; the contents belong to the trainee).
// The sharing-identity signal is read-only (a lab head may SEE who has a global
// identity, never control it).
//
// No emojis, no em-dashes, no mid-sentence colons.

import { useQuery } from "@tanstack/react-query";
import { discoverUsers } from "@/lib/file-system/user-discovery";
import { readUserSettings, type AccountType } from "@/lib/settings/user-settings";
import { readOnboarding } from "@/lib/onboarding/sidecar";
import { readSharingIdentity } from "@/lib/sharing/identity/sidecar";
import { idpsApi } from "@/lib/local-api";
import { useFileSystem } from "@/lib/file-system/file-system-context";

export interface RosterRow {
  username: string;
  displayName: string | null;
  account_type: AccountType;
  /** Lab Manager (Phase 1): the member holds the delegated manager capability
   *  (materialized from the head-signed roster's admin flag). Always false for the
   *  head (the head holds every power). */
  lab_manager: boolean;
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  /** Whether the member has published a global sharing identity. READ-ONLY. */
  hasSharingIdentity: boolean;
  /** Whether the member has an IDP on file (contents-free) and when. */
  idpExists: boolean;
  idpUpdatedAt: string | null;
}

export const LAB_ROSTER_QUERY_KEY = ["lab-roster"] as const;

/** Sort: active first, then archived; within each, PI first, then alphabetical. */
function sortRows(rows: RosterRow[]): RosterRow[] {
  return rows.sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    if (a.account_type !== b.account_type) {
      return a.account_type === "lab_head" ? -1 : 1;
    }
    return a.username.localeCompare(b.username);
  });
}

async function loadRosterRow(username: string): Promise<RosterRow> {
  let displayName: string | null = null;
  let account_type: AccountType = "member";
  let lab_manager = false;
  try {
    const settings = await readUserSettings(username);
    displayName = settings.displayName;
    account_type = settings.account_type;
    lab_manager = settings.lab_manager === true && account_type !== "lab_head";
  } catch {
    // Stay on safe defaults.
  }
  let archived = false;
  let archived_at: string | null = null;
  let archived_by: string | null = null;
  try {
    const sidecar = await readOnboarding(username);
    archived = sidecar.archived === true;
    archived_at = sidecar.archived_at ?? null;
    archived_by = sidecar.archived_by ?? null;
  } catch {
    // Stay on non-archived default.
  }
  let hasSharingIdentity = false;
  try {
    const side = await readSharingIdentity(username);
    hasSharingIdentity = side !== null;
  } catch {
    // Stay on "no identity" default.
  }
  let idpExists = false;
  let idpUpdatedAt: string | null = null;
  try {
    const status = await idpsApi.getStatusForMember(username);
    idpExists = status.exists;
    idpUpdatedAt = status.updated_at;
  } catch {
    // Stay on "no IDP" default.
  }
  return {
    username,
    displayName,
    account_type,
    lab_manager,
    archived,
    archived_at,
    archived_by,
    hasSharingIdentity,
    idpExists,
    idpUpdatedAt,
  };
}

/**
 * Loads every lab member as a RosterRow. Uses discoverUsers() so the roster
 * auto-inherits tombstone + sentinel filtering. Best-effort per field, so a
 * missing or unreadable sidecar simply yields the safe default. Cached under
 * LAB_ROSTER_QUERY_KEY (30s) and shared across all roster surfaces.
 */
export function useLabRosterRows() {
  const { isConnected } = useFileSystem();
  return useQuery({
    queryKey: LAB_ROSTER_QUERY_KEY,
    queryFn: async (): Promise<RosterRow[]> => {
      const usernames = await discoverUsers();
      const out = await Promise.all(usernames.map(loadRosterRow));
      return sortRows(out);
    },
    enabled: isConnected,
    staleTime: 30_000,
  });
}
