// Class dashboard relay-record I/O (CT-5 + CT-3).
//
// The instructor PUBLISHES the class dashboard template, and a student READS it,
// over the SAME server-blind relay store announcements ride. The record is a
// singleton at `${labId}/<instructor>/class_dashboard/class`, E2E under the class
// team key, surfaced to every roster member by the lab-read.ts isLabWidePublic
// guard. This module is the thin transport glue over putLabRecord / getLabRecord;
// the shape + resolution live in class-dashboard.ts.
//
// FLAG (data-shape): the `class_dashboard` relay record type (additive, E2E under
// the team key, instructor-owned). An unknown record type was invisible before.
//
// No emojis, no em-dashes, no mid-sentence colons.

import { fileService } from "../file-system/file-service";
import { readUserSettings } from "../settings/user-settings";
import { CLASS_MODE_ENABLED } from "./class-mode-config";
import { putLabRecord, getLabRecord } from "./lab-data-client";
import {
  CLASS_DASHBOARD_RECORD_TYPE,
  CLASS_DASHBOARD_RECORD_ID,
  encodeClassDashboard,
  decodeClassDashboard,
  seedSharedWithForVisibility,
  type ClassDashboard,
  type ClassSharedSeedEntry,
} from "./class-dashboard";

/** The root cache file the student workbench reads (written by
 *  materializeLabView from the pulled class_dashboard record). Mirrors the
 *  _announcements.json convention: a folder-local mirror of a lab-wide-public
 *  relay record so consumers read synchronously without the lab key. */
export const CLASS_DASHBOARD_CACHE_PATH = "_class_dashboard.json";

/**
 * Read the folder-local class dashboard cache. Returns null when there is no
 * cached template (not a class, never pulled) or the payload is malformed, so the
 * workbench falls back to today's hardcoded default. Defensive against a bad file
 * exactly like listAnnouncements.
 */
export async function readCachedClassDashboard(): Promise<ClassDashboard | null> {
  let plaintext: Uint8Array;
  try {
    const text = await fileService.readText(CLASS_DASHBOARD_CACHE_PATH);
    if (text == null) return null;
    plaintext = new TextEncoder().encode(text);
  } catch {
    return null;
  }
  return decodeClassDashboard(plaintext);
}

/**
 * Publish (create or overwrite) the singleton class dashboard template. The
 * instructor writes under their OWN owner-prefix; the relay verifies the signer
 * is on the roster, the team key encrypts the payload so the relay stays blind.
 * Bumps `rev` is the caller's responsibility (read-modify-write at the panel).
 */
export async function publishClassDashboard(params: {
  labId: string;
  /** The instructor's username (the owner prefix the record lives under). */
  instructor: string;
  template: ClassDashboard;
  labKey: Uint8Array;
  signerEd25519Priv: Uint8Array;
  signerEd25519Pub: Uint8Array;
  putImpl?: typeof putLabRecord;
}): Promise<void> {
  const put = params.putImpl ?? putLabRecord;
  await put({
    labId: params.labId,
    owner: params.instructor,
    recordType: CLASS_DASHBOARD_RECORD_TYPE,
    recordId: CLASS_DASHBOARD_RECORD_ID,
    plaintext: encodeClassDashboard(params.template),
    labKey: params.labKey,
    signerEd25519Priv: params.signerEd25519Priv,
    signerEd25519Pub: params.signerEd25519Pub,
  });
}

/**
 * Read the class dashboard template directly by key (used by the instructor's
 * own authoring panel to load the current value for editing). Returns null when
 * the record is absent or its payload is malformed (the workbench then falls back
 * to the hardcoded default). Students normally receive this record via pullLabView
 * surfacing it; this direct read is the author-side convenience.
 */
export async function getClassDashboard(params: {
  labId: string;
  /** The instructor's username (the owner prefix the record lives under). */
  instructor: string;
  labKey: Uint8Array;
  getImpl?: typeof getLabRecord;
}): Promise<ClassDashboard | null> {
  const get = params.getImpl ?? getLabRecord;
  let plaintext: Uint8Array;
  try {
    plaintext = await get({
      labId: params.labId,
      owner: params.instructor,
      recordType: CLASS_DASHBOARD_RECORD_TYPE,
      recordId: CLASS_DASHBOARD_RECORD_ID,
      labKey: params.labKey,
    });
  } catch {
    // Missing record (404) or decrypt failure: no template published yet.
    return null;
  }
  return decodeClassDashboard(plaintext);
}

/**
 * CT-3: the create-time `shared_with` seed for a NEW student-authored record,
 * resolved from the class visibility default. Consulted ONLY at record-create
 * time; never retroactively reshares.
 *
 *  - Flag off, or the active folder is NOT a class (lab_kind !== "class"): returns
 *    [] (today's behavior, every new record private). The class cache is not even
 *    read, so a research-lab / solo / flag-off create is byte-identical.
 *  - A class folder with `visibilityDefault === "collaborative"`: returns ["*"]
 *    (the new record is seeded class-readable, the CURE default).
 *  - A class folder with `visibilityDefault === "private"` / absent: returns []
 *    (the exam-safe default).
 *
 * @param username the active user (whose folder settings name lab_kind).
 */
export async function classCreateSharedWithSeed(
  username: string,
): Promise<ClassSharedSeedEntry[]> {
  // Flag off: never touch the class cache; preserve today's empty seed exactly.
  if (!CLASS_MODE_ENABLED) return [];
  let isClass = false;
  try {
    const settings = await readUserSettings(username);
    isClass = settings.lab_kind === "class";
  } catch {
    return [];
  }
  if (!isClass) return [];
  const template = await readCachedClassDashboard();
  return seedSharedWithForVisibility(template?.visibilityDefault);
}
