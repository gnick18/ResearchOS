// PI-context seed-on-connect (Owen classroom pilot fix, A7 + addendum M5).
//
// THE BUG. A lab head connected a brand-new EMPTY folder with no settings.json,
// so account_type resolved to its default "member" and the app rendered him as
// an individual, never as a PI. account_type and lab_id are folder-local; a
// fresh folder has neither, and account_type: "lab_head" is only ever written by
// explicit promotion, never re-derived on connect. The folder switcher already
// caches a per-folder lab role (RememberedFolderLabRole "head"), but it was never
// read back into account_type.
//
// THE FIX. On connect, if the folder has no PI settings AND the remembered-folder
// meta for that folder says the account was the head ("head" or "class"), we seed
// account_type + lab_id into that folder. But a cached labRole does NOT prove the
// account is the head (M5), so we VALIDATE against the lab DO first: open the lab
// record, verify its signed membership log, and confirm the signed-in account is
// record.head.username. Only a confirmed head match seeds. A non-matching account,
// a missing lab, or a truly new folder with no remembered row seeds nothing (the
// Part 1 banner is the escape for that last case).
//
// This module splits a PURE decision (decideSeed, trivially unit-testable) from
// the IO wrapper (validateHeadAndSeed, which reads the lab DO and writes settings),
// so the gating logic can be tested without mocking crypto or the filesystem.
//
// No emojis, no em-dashes, no mid-sentence colons.

import {
  patchUserSettings,
  type AccountType,
  type UserSettings,
} from "@/lib/settings/user-settings";
import type { RememberedFolderLabRole } from "@/lib/file-system/indexeddb-store";
import { getLabRemote } from "./lab-do-client";
import { verifyMembershipLog } from "./lab-membership";

/**
 * The cached per-folder lab meta the switcher holds, narrowed to the two fields
 * the seed decision needs. Either may be absent on a legacy or solo row.
 */
// The classroom-pilot head role. It is NOT part of the on-disk
// RememberedFolderLabRole enum yet (no schema change here), but the diagnosis
// (A7) treats a "class" folder as a head folder for seeding, so we accept it as
// a forward-compatible widening. A cached value can only ever be one of the enum
// members today, so the "class" branch is inert until that role is introduced.
export type HeadCapableLabRole = RememberedFolderLabRole | "class";

export interface RememberedLabMeta {
  labRole?: HeadCapableLabRole;
  labId?: string;
}

/**
 * The pure inputs to the seed decision, gathered by the caller before any IO.
 *  - currentAccountType is what normalize() resolved for the freshly connected
 *    folder. "member" is the DEFAULT a settings-less folder falls back to, so we
 *    treat it as "no PI context" rather than a deliberate member choice.
 *  - hasOwnSettings is whether the folder actually carried a settings.json for
 *    this user. When true the folder has its own deliberate identity and we never
 *    override it, even if it happens to read "member".
 *  - meta is the cached remembered-folder row for this folder, or null when the
 *    folder is brand new and was never remembered as a head folder.
 */
export interface SeedInputs {
  currentAccountType: AccountType;
  hasOwnSettings: boolean;
  meta: RememberedLabMeta | null;
}

export type SeedDecision =
  | { action: "skip"; reason: string }
  | { action: "validate-then-seed"; labId: string };

/** A remembered labRole that marks the account as the head of this folder's lab.
 *  "class" is the classroom-pilot head role; it seeds the same PI context. */
export function isHeadCapableRole(
  role: HeadCapableLabRole | undefined,
): boolean {
  return role === "head" || role === "class";
}

/**
 * Pure gate. Decides whether a freshly connected folder is a candidate for
 * PI-context seeding, WITHOUT performing any IO. Returns "validate-then-seed"
 * only when every cheap precondition holds; the caller must still confirm the
 * head match against the lab DO (M5) before actually writing.
 *
 * Skips when:
 *  - the folder already carries its own settings.json (deliberate identity), or
 *  - account_type is already "lab_head" (nothing to repair), or
 *  - there is no remembered meta (a truly new folder; the banner is its escape), or
 *  - the cached labRole is not a head role (real solo or member folder), or
 *  - the meta has no labId to validate against.
 *
 * A normal solo connect (no head meta) therefore returns skip and stays
 * byte-identical to today.
 */
export function decideSeed(inputs: SeedInputs): SeedDecision {
  const { currentAccountType, hasOwnSettings, meta } = inputs;

  if (hasOwnSettings) {
    return { action: "skip", reason: "folder has its own settings" };
  }
  if (currentAccountType === "lab_head") {
    return { action: "skip", reason: "already lab_head" };
  }
  if (!meta) {
    return { action: "skip", reason: "no remembered meta" };
  }
  if (!isHeadCapableRole(meta.labRole)) {
    return { action: "skip", reason: "not a head folder" };
  }
  if (!meta.labId) {
    return { action: "skip", reason: "no cached labId" };
  }
  return { action: "validate-then-seed", labId: meta.labId };
}

export type SeedResult =
  | { seeded: true; labId: string }
  | { seeded: false; reason: string };

/**
 * Reads the lab DO for the cached labId and confirms the signed-in account is the
 * head (record.head.username), over a record whose signed membership log verifies.
 * A cached labRole is never trusted on its own (M5). Returns true only on a
 * verified head match.
 *
 * Injectable getRemote keeps the unit test free of network + crypto; production
 * passes the real getLabRemote.
 */
export async function confirmAccountIsHead(
  labId: string,
  username: string,
  getRemote: typeof getLabRemote = getLabRemote,
): Promise<boolean> {
  let remote;
  try {
    remote = await getRemote(labId);
  } catch {
    // A relay hiccup must never seed (fail safe toward NOT re-PI-ing a folder).
    return false;
  }
  if (!remote) return false;
  // Re-verify the head-signed log before trusting record.head (the /lab/get read
  // is open and unauthenticated, see lab-do-client). A tampered roster cannot
  // promote a non-head into a PI.
  if (!verifyMembershipLog(remote.record).ok) return false;
  return remote.record.head.username === username;
}

/**
 * Full seed path. Runs the pure gate, then on a candidate confirms the head match
 * against the lab DO, then seeds account_type ("lab_head") + lab_id into the
 * freshly connected folder. Any failure short-circuits to seeded:false and writes
 * nothing, so the worst case is the Part 1 banner (the visible escape), never a
 * silently mis-promoted folder.
 *
 * patchUserSettings writes to the per-folder users/<username>/settings.json, which
 * is exactly the folder-local slot that was missing.
 */
export async function validateHeadAndSeed(params: {
  username: string;
  inputs: SeedInputs;
  getRemote?: typeof getLabRemote;
  patch?: (
    username: string,
    patch: Partial<UserSettings>,
  ) => Promise<UserSettings>;
}): Promise<SeedResult> {
  const { username, inputs } = params;
  const patch = params.patch ?? patchUserSettings;

  const decision = decideSeed(inputs);
  if (decision.action === "skip") {
    return { seeded: false, reason: decision.reason };
  }

  const isHead = await confirmAccountIsHead(
    decision.labId,
    username,
    params.getRemote ?? getLabRemote,
  );
  if (!isHead) {
    return { seeded: false, reason: "not confirmed head" };
  }

  await patch(username, {
    account_type: "lab_head",
    lab_id: decision.labId,
  });
  return { seeded: true, labId: decision.labId };
}
