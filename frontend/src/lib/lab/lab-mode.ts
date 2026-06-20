// Identity model simplification, phase 2: the canonical lab-mode axes.
//
// Phase 2 collapses the historical triple of account signals into two
// orthogonal, well-named axes. This module is the single source of truth for
// both, and for the back-compat composer that reconstructs the old triple when
// a consumer still wants it.
//
// The two axes are:
//   1. isLabHead(accountType)  -- the PI ROLE boolean. A per-user fact read
//      from `_user_settings.account_type` ("member" | "lab_head"). This is the
//      canonical name for the "is this account a principal investigator"
//      question that ~15 call sites currently spell as
//      `useAccountType(x) === "lab_head"`.
//   2. isLabModeFolder({ userCount, anyLabHead }) -- the DERIVED "this folder
//      behaves like a shared lab" signal. A folder is in lab mode the moment it
//      has two or more users OR contains a lab head. This is logically the
//      SAME predicate as `folderRequiresLogin` in lib/auth/login-policy.ts, so
//      this module imports and reuses that function rather than duplicating the
//      `>= 2` logic (one predicate, two names that read naturally at their
//      respective call sites).
//
// Pure, no I/O. Callers (or the hooks layer) supply the folder's user count and
// whether any lab head is present. See
// docs/proposals/IDENTITY_MODEL_SIMPLIFICATION.md.

import type { AccountType } from "../settings/user-settings";
import { folderRequiresLogin } from "../auth/login-policy";

/**
 * Class Mode (CM-P1): the "is this folder a teaching class" predicate. Pure,
 * mirrors isLabHead in shape and altitude.
 *
 * A folder is a CLASS when it is a lab the active user HEADS that is marked as a
 * class. Both conditions are required: lab_kind === "class" tags the folder as
 * teaching, and accountType === "lab_head" confirms the active user is the
 * instructor (the head role). A student folder (lab_kind "class" but the active
 * user is a member) is therefore NOT a class folder by this predicate, which is
 * deliberate: this gates the INSTRUCTOR teaching chrome, not the student view.
 *
 * Flag-agnostic by design (like isLabHead). The flag (CLASS_MODE_ENABLED) gates
 * the WRITERS that ever set lab_kind === "class"; this reader simply answers the
 * question. With class mode off no folder ever carries lab_kind === "class", so
 * this returns false everywhere and changes nothing.
 *
 * @param accountType the active user's stored role from `_user_settings.account_type`
 * @param labKind     the folder's `_user_settings.lab_kind` ("lab" | "class" | absent)
 */
export function isClassFolder({
  accountType,
  labKind,
}: {
  accountType: AccountType;
  labKind: "lab" | "class" | undefined;
}): boolean {
  return labKind === "class" && accountType === "lab_head";
}

/**
 * Class Mode CT-2: the STUDENT-side counterpart of isClassFolder. True when the
 * folder is marked as a class (lab_kind === "class") AND the active user is a
 * MEMBER (a student), not the head. This gates the student teaching chrome (the
 * assignment panel), exactly as isClassFolder gates the instructor chrome. The
 * two are mutually exclusive by construction (one requires lab_head, the other
 * member), so no surface ever shows both the instructor and the student view.
 *
 * Flag-agnostic like isClassFolder; with class mode off no folder carries
 * lab_kind === "class", so this returns false everywhere.
 */
export function isClassStudentFolder({
  accountType,
  labKind,
}: {
  accountType: AccountType;
  labKind: "lab" | "class" | undefined;
}): boolean {
  return labKind === "class" && accountType === "member";
}

/**
 * The PI-role boolean. True when the account is a lab head (principal
 * investigator), false for a regular member. This is the canonical spelling
 * of the `account_type === "lab_head"` check scattered across the PI surfaces.
 *
 * @param accountType the user's stored role from `_user_settings.account_type`
 */
export function isLabHead(accountType: AccountType): boolean {
  return accountType === "lab_head";
}

/**
 * Whether a folder behaves like a shared lab (lab mode). True when the folder
 * has two or more users OR any account in it is a lab head.
 *
 * This is the SAME predicate as `folderRequiresLogin(userCount, anyLabHead)`
 * in lib/auth/login-policy.ts; the two names describe the same fact from
 * different angles (one gates login, one gates lab-mode chrome), so this
 * function delegates to it rather than re-deriving the `>= 2` rule. Keeping a
 * single implementation means the two can never drift.
 *
 * @param userCount  how many users live in this folder
 * @param anyLabHead whether any account in the folder is a lab head (PI)
 */
export function isLabModeFolder({
  userCount,
  anyLabHead,
}: {
  userCount: number;
  anyLabHead: boolean;
}): boolean {
  return folderRequiresLogin(userCount, anyLabHead);
}

/**
 * Back-compat composer. Reconstructs the legacy workspace-account-type triple
 * ("solo" | "lab" | "lab_head") from the two canonical axes, for any consumer
 * that still wants the old single value. A lab head is always "lab_head"; a
 * non-head folder is "lab" when in lab mode and "solo" otherwise.
 *
 * @param isLabHead whether the active user is a lab head (the PI role)
 * @param isLabMode whether the folder is in lab mode (derived shared signal)
 */
export function deriveWorkspaceAccountType({
  isLabHead,
  isLabMode,
}: {
  isLabHead: boolean;
  isLabMode: boolean;
}): "solo" | "lab" | "lab_head" {
  if (isLabHead) return "lab_head";
  return isLabMode ? "lab" : "solo";
}
